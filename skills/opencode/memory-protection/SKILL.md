---
name: memory-protection
description: 内存保护设计：MPU区域配置、TrustZone-M（SAU/IDAU）、Flash读/写保护（RDP/WRP/PCROP）、选项字节、eFuse/OTP编程、ECC内存保护、安全/非安全分区、内存防火墙。Memory protection design — MPU region configuration, TrustZone-M (SAU/IDAU), Flash read/write protection (RDP, WRP, PCROP), option bytes, eFuse/OTP programming, ECC memory protection, and secure/non-secure partitioning. Use when the user says MPU, TrustZone, 内存保护, memory protection, flash protection, 闪存保护, eFuse, OTP, or when designing memory access control for an embedded system.
---
# Memory Protection Design

## Overview

Memory protection is the foundation of firmware security and reliability. Without it, a buffer overflow in your BLE stack can corrupt your bootloader; a null pointer dereference can brick the device by writing to flash; a compromised third-party library can read your device secrets. MPU, TrustZone, flash protection, and ECC are not separate features — they form a layered defense that catches errors early and contains breaches when they happen.

This skill covers the full memory protection stack: MPU region design for isolating tasks and drivers, TrustZone-M partitioning for secure/non-secure worlds, flash read/write protection levels, option byte programming, eFuse/OTP usage, and ECC memory configuration.

## When to Use

- Configuring the MPU to isolate RTOS tasks from each other
- Partitioning memory between a secure and non-secure world (TrustZone-M)
- Setting flash read-out protection (RDP) to prevent firmware extraction
- Using write protection (WRP) to lock bootloader or calibration data
- Programming option bytes for boot configuration, BOR levels, or watchdog settings
- Burning eFuses or OTP memory for device identity, keys, or permanent configuration
- Enabling ECC on SRAM or flash for safety-critical applications
- Debugging MemManage faults caused by MPU violations

**When NOT to use:** Choosing between MCUs with/without TrustZone (that's chip selection, see `hardware-architecture-design`), simple GPIO-based tamper detection (use `peripheral-driver-design`), or application-level access control (this is hardware-level memory protection).

## MPU Region Design

### The Power-of-Two Rule

```
MPU regions MUST be power-of-two sized and naturally aligned.
A 16KB region must start at an address that is a multiple of 16KB.

Valid:  0x20000000, size 16KB  (0x20000000 % 16384 = 0) ✓
Invalid: 0x20001000, size 16KB  (0x20001000 % 16384 ≠ 0) ✗
         → This silently rounds down to 0x20000000 on most Cortex-M MPUs

If you need a non-power-of-two region, split it into power-of-two chunks.
Example: 12KB region → 8KB + 4KB sub-regions.

Exception: Some Cortex-M MPUs support sub-region disable (SRD),
           allowing a single region to cover a non-power-of-two area
           by disabling specific 1/8 sub-regions within it.
```

### MPU Configuration Helper

```c
#include <stdint.h>

// MPU Region Attribute and Size Register (RASR) encoding
// Simplified for readability — consult your Cortex-M TRM for exact bit positions

typedef enum {
    MPU_REGION_SIZE_256B    = 7,    // 2^(7+1)   = 256 bytes
    MPU_REGION_SIZE_512B    = 8,
    MPU_REGION_SIZE_1KB     = 9,
    MPU_REGION_SIZE_2KB     = 10,
    MPU_REGION_SIZE_4KB     = 11,
    MPU_REGION_SIZE_8KB     = 12,
    MPU_REGION_SIZE_16KB    = 13,
    MPU_REGION_SIZE_32KB    = 14,
    MPU_REGION_SIZE_64KB    = 15,
    MPU_REGION_SIZE_128KB   = 16,
    MPU_REGION_SIZE_256KB   = 17,
    MPU_REGION_SIZE_512KB   = 18,
    MPU_REGION_SIZE_1MB     = 19,
} mpu_region_size_t;

typedef enum {
    MPU_ACCESS_NONE         = 0,  // No access (privileged or unprivileged)
    MPU_ACCESS_PRIV_RW      = 1,  // Privileged read-write, unprivileged no-access
    MPU_ACCESS_PRIV_RW_USER_RO = 2,  // All read, privileged write
    MPU_ACCESS_FULL         = 3,  // Full access, all modes
    MPU_ACCESS_PRIV_RO      = 5,  // Privileged read-only, unprivileged no-access
    MPU_ACCESS_PRIV_RO_USER_RO = 6,  // All read-only
} mpu_access_permission_t;

typedef struct __attribute__((packed)) {
    uint8_t  xn     : 1;   // Execute Never: 1 = no instruction fetch
    uint8_t  ap     : 3;   // Access Permission
    uint8_t  tex    : 3;   // Type Extension (0=strongly ordered, 1=normal for cacheable)
    uint8_t  s      : 1;   // Shareable
    uint8_t  c      : 1;   // Cacheable
    uint8_t  b      : 1;   // Bufferable
    uint8_t  srd    : 8;   // Sub-Region Disable (bit per 1/8 sub-region)
    uint8_t  size   : 5;   // Region size (log2(size) - 1)
    uint8_t  enable : 1;   // Region enable
} mpu_rasr_t;

typedef struct {
    uint32_t         base_address;
    mpu_region_size_t size;
    mpu_rasr_t        attributes;
} mpu_region_config_t;

hal_err_t mpu_configure_region(uint8_t region_num, 
                                const mpu_region_config_t* cfg) {
    // Validate alignment — CRITICAL
    if (cfg->base_address % (1UL << (cfg->size + 1)) != 0) {
        LOG_ERROR("MPU region %d base 0x%08lx not aligned to size %lu",
                  region_num, cfg->base_address, 1UL << (cfg->size + 1));
        return HAL_ERR_ALIGN;
    }
    
    // Disable MPU during configuration
    MPU->CTRL &= ~MPU_CTRL_ENABLE_Msk;
    __DSB();
    __ISB();
    
    // Select region
    MPU->RNR = region_num;
    
    // Set base address
    MPU->RBAR = cfg->base_address | (1 << 4);  // Bit 4 = VALID
    
    // Set attributes
    uint32_t rasr = 0;
    rasr |= (cfg->attributes.enable  & 1) << 0;
    rasr |= (cfg->attributes.size    & 0x1F) << 1;
    rasr |= (cfg->attributes.srd     & 0xFF) << 8;
    rasr |= (cfg->attributes.b       & 1) << 16;
    rasr |= (cfg->attributes.c       & 1) << 17;
    rasr |= (cfg->attributes.s       & 1) << 18;
    rasr |= (cfg->attributes.tex     & 0x7) << 19;
    rasr |= (cfg->attributes.ap      & 0x7) << 24;
    rasr |= (cfg->attributes.xn      & 1) << 28;
    MPU->RASR = rasr;
    
    // Re-enable MPU
    MPU->CTRL |= MPU_CTRL_ENABLE_Msk | MPU_CTRL_PRIVDEFENA_Msk;
    __DSB();
    __ISB();
    
    return HAL_OK;
}
```

### RTOS Task Isolation with MPU

```c
// Protect each RTOS task's stack from other tasks.
// A stack overflow in Task A becomes a precise MemManage fault
// instead of silent corruption of Task B's data.

typedef struct {
    uint32_t stack_base;
    size_t   stack_size;
    uint8_t  mpu_region;
} task_mpu_guard_t;

void mpu_configure_task_stack_guard(task_mpu_guard_t* guard) {
    // Guard region: the first 32 bytes of the stack are no-access.
    // If the task overflows its stack, the SP hits this guard → MemManage fault.
    
    mpu_region_config_t guard_cfg = {
        .base_address = guard->stack_base,
        .size         = MPU_REGION_SIZE_32B,  // Smallest region that covers guards
        .attributes   = {
            .enable = 1,
            .xn     = 1,  // No code execution
            .ap     = MPU_ACCESS_NONE,  // No access at all
            .tex    = 1,  // Normal memory
            .c      = 1,
            .b      = 0,
        },
    };
    
    // For stacks < power-of-two, use sub-regions to disable the guard
    // on the actual stack area and enable it only at the boundaries.
    
    mpu_configure_region(guard->mpu_region, &guard_cfg);
}

// On context switch, reprogram the MPU for the incoming task.
// This is the OS's responsibility, not the application's.
void mpu_switch_context(task_mpu_guard_t* next_task) {
    // Disable previous task's MPU region, enable next task's
    // (Implementation depends on MPU region allocation strategy)
}
```

### MPU Fault Handler

```c
// Catch MPU violations and report them usefully
void MemManage_Handler(void) {
    uint32_t cfsr = SCB->CFSR;
    uint32_t mmfar = SCB->MMFAR;
    
    if (cfsr & SCB_CFSR_IACCVIOL_Msk) {
        LOG_CRITICAL("MPU: Instruction access violation at 0x%08lx", mmfar);
        // PC tried to execute code from a no-execute region.
        // Likely: stack overflow overwrote return address → PC = stack address.
        uint32_t pc = get_fault_pc();
        LOG_CRITICAL("Fault PC: 0x%08lx", pc);
    }
    
    if (cfsr & SCB_CFSR_DACCVIOL_Msk) {
        LOG_CRITICAL("MPU: Data access violation at 0x%08lx", mmfar);
        // Data access (read or write) to an MPU-protected region.
        // Check: is the address in a task's stack guard? A peripheral's protected buffer?
        
        // If this is a task stack overflow, report which task
        uint32_t psp = __get_PSP();
        task_id_t task = scheduler_get_current_task_for_sp(psp);
        LOG_CRITICAL("Active task at fault: %d (PSP=0x%08lx)", task, psp);
    }
    
    if (cfsr & SCB_CFSR_MSTKERR_Msk) {
        LOG_CRITICAL("MPU: Stacking error — stack overflow during exception entry");
    }
    
    if (cfsr & SCB_CFSR_MUNSTKERR_Msk) {
        LOG_CRITICAL("MPU: Unstacking error — stack corruption during exception return");
    }
    
    // Clear fault status
    SCB->CFSR = cfsr;
    
    // Don't return — the faulting context is corrupted.
    // Reset or enter a safe state.
    NVIC_SystemReset();
}
```

## TrustZone-M Partitioning

### Secure/Non-Secure Memory Map

```c
// TrustZone-M (ARMv8-M) splits the 4GB address space into Secure (S) and
// Non-Secure (NS) worlds. IDAU (Implementation Defined Attribution Unit)
// provides the default partition, SAU (Security Attribution Unit) overrides it.

// Example partitioning for a 512KB flash + 128KB SRAM MCU:

/*
Memory Map (TrustZone-M):
┌──────────────────────────────────────────┐ 0xFFFFFFFF
│  System Control (NVIC, SysTick, MPU)      │ S
├──────────────────────────────────────────┤
│  Peripherals — Non-Secure                 │ NSC (callable from NS)
├──────────────────────────────────────────┤
│  Peripherals — Secure                     │ S
├──────────────────────────────────────────┤
│  SRAM — Non-Secure (96KB)                │ NS
├──────────────────────────────────────────┤
│  SRAM — Secure (32KB)                     │ S
├──────────────────────────────────────────┤
│  Flash — Non-Secure (256KB)               │ NS
├──────────────────────────────────────────┤
│  Flash — Non-Secure Callable (16KB)       │ NSC
├──────────────────────────────────────────┤
│  Flash — Secure (240KB)                   │ S
└──────────────────────────────────────────┘ 0x00000000
*/
```

### SAU Configuration

```c
// SAU (Security Attribution Unit): up to 8 regions to override IDAU defaults.
// Configure SAU BEFORE enabling the Non-Secure world.

#define NUM_SAU_REGIONS 4

typedef struct {
    uint32_t base;
    uint32_t limit;
    uint8_t  nsc : 1;   // 1 = Non-Secure Callable (NS can call into S via SG)
} sau_region_t;

void trustzone_configure_sau(void) {
    const sau_region_t regions[NUM_SAU_REGIONS] = {
        // Non-Secure flash (application code)
        { .base = 0x08010000, .limit = 0x0804FFFF, .nsc = 0 },
        // Non-Secure Callable flash (veneer table)
        { .base = 0x08050000, .limit = 0x08053FFF, .nsc = 1 },
        // Non-Secure SRAM
        { .base = 0x20008000, .limit = 0x2001FFFF, .nsc = 0 },
    };
    
    // Disable SAU during configuration
    SAU->CTRL = 0;
    
    for (int i = 0; i < NUM_SAU_REGIONS; i++) {
        SAU->RNR = i;
        SAU->RBAR = regions[i].base & SAU_RBAR_BADDR_Msk;
        SAU->RLAR = ((regions[i].limit & SAU_RLAR_LADDR_Msk) 
                     | (regions[i].nsc ? SAU_RLAR_NSC_Msk : 0)
                     | 1);  // Enable bit
    }
    
    // Enable SAU with all region writes completed
    __DSB();
    __ISB();
    SAU->CTRL = SAU_CTRL_ENABLE_Msk;
    
    // Enable the Non-Secure MPU (controlled by Secure world)
    // The NS world gets its own MPU for intra-NS protection.
}
```

### Secure Gateway (SG) Veneer

```c
// The NS world calls into S world through an SG instruction in the NSC region.
// The veneer function provides the trampoline.

// In NSC region (compiled as Secure code, placed in NSC flash section):
__attribute__((cmse_nonsecure_entry))
int32_t secure_aes_encrypt(const uint8_t* plaintext, size_t len,
                            uint8_t* ciphertext, size_t cipher_len) {
    // Parameters arrive from NS world — they are NS pointers.
    // The hardware clears bits [28:0] of NS addresses automatically
    // to prevent NS from referencing S memory.
    
    // Validate parameters — NEVER trust NS input!
    if (plaintext == NULL || ciphertext == NULL) return -1;
    if (len == 0 || cipher_len < len) return -2;
    
    // Check that the pointers actually point to NS memory
    if (cmse_check_address_range((void*)plaintext, len, 
                                  CMSE_NONSECURE) == NULL) return -3;
    if (cmse_check_address_range((void*)ciphertext, cipher_len,
                                  CMSE_NONSECURE) == NULL) return -3;
    
    // Now safe to use the data — we've validated it's truly NS memory
    aes_encrypt_internal(plaintext, len, ciphertext);
    
    return 0;
}

// NS application calls this function normally:
//   int result = secure_aes_encrypt(my_plaintext, len, my_ciphertext, sizeof(my_ciphertext));
```

## Flash Protection

### Read-Out Protection (RDP) Levels

```c
// RDP prevents firmware extraction via debugger or bootloader.
// Levels (ST-specific; other vendors have similar concepts):

typedef enum {
    RDP_LEVEL_0 = 0xAA,   // No protection. Debugger can read all flash.
    RDP_LEVEL_1 = 0xBB,   // Flash read-protected. Debugger can connect but
                           // flash reads return garbage or trigger mass erase.
                           // Option bytes can be changed back to Level 0,
                           // but this triggers a mass erase (protects secrets).
    RDP_LEVEL_2 = 0xCC,   // FULL protection. Debugger permanently disabled.
                           // Option bytes CANNOT be changed. IRREVERSIBLE.
                           // Use only in production after full validation.
} rdp_level_t;

// RDP level 2 is permanent. Before setting it, verify:
//   1. All OTP/eFuse secrets are correct and match the production values
//   2. The bootloader recovery mechanism is tested and working
//   3. There are no remaining debug/test features that need to be disabled
//   4. You have a separate way to re-flash if needed (e.g., factory tools
//      that use a bootloader, not the debugger)
```

### Write Protection (WRP)

```c
// WRP locks specific flash sectors against accidental or malicious writes.
// Use cases: protect bootloader, calibration data, factory settings.

typedef struct {
    uint32_t start_page;
    uint32_t end_page;
    bool     enabled;
} flash_wrp_config_t;

hal_err_t flash_enable_write_protection(const flash_wrp_config_t* wrp) {
    // WRP is typically configured through option bytes.
    // The programming sequence is vendor-specific. Example for STM32:
    
    // 1. Unlock option bytes
    FLASH->OPTKEYR = 0x08192A3B;
    FLASH->OPTKEYR = 0x4C5D6E7F;
    
    // 2. Configure WRP sectors
    //    WRP bits: 0 = protected, 1 = unprotected (inverted logic!)
    uint32_t wrp_reg = ~((1u << (wrp->end_page - wrp->start_page + 1)) - 1)
                       << wrp->start_page;
    FLASH->WRP1AR = wrp_reg;
    
    // 3. Set option bit to program
    FLASH->OPTCR |= FLASH_OPTCR_OPTSTRT;
    while (FLASH->SR & FLASH_SR_BSY);
    
    // 4. Lock option bytes
    FLASH->OPTCR |= FLASH_OPTCR_OPTLOCK;
    
    // 5. Verify: attempt a write to protected area, expect error
    uint32_t protected_addr = FLASH_BASE + wrp->start_page * FLASH_PAGE_SIZE;
    hal_err_t write_err = flash_write_word(protected_addr, 0xDEADBEEF);
    if (write_err == HAL_OK) {
        LOG_ERROR("WRP not applied — write to protected address succeeded!");
        return HAL_ERR_WRP_FAIL;
    }
    
    return HAL_OK;
}
```

### Proprietary Code Read-Out Protection (PCROP)

```c
// PCROP: blocks code execution AND data read access to specific flash areas.
// Use for protecting proprietary algorithms, DRM code, or license checks.
// Once set, even privileged code can't READ from PCROP areas — only execute.

// PCROP-protected code can call out to non-PCROP areas, but parameters
// must be in registers, not in PCROP memory (because they can't be read).

// Anti-pattern: putting data (look-up tables, keys) in PCROP.
// PCROP blocks ALL reads, including D-Code bus reads.
// Data in PCROP is inaccessible — use WRP for data protection instead.
```

## Option Bytes and eFuse/OTP Programming

### Option Bytes

```c
// Option bytes: non-volatile configuration stored in a dedicated flash region.
// Configured once, persists across power cycles and resets.
// Common uses: BOR level, watchdog mode, boot source, RDP level, WRP sectors.

typedef struct {
    uint32_t bor_level;       // Brown-Out Reset threshold (level 0-3)
    uint32_t bor_enable;      // BOR enabled in all modes?
    uint8_t  wdg_sw;          // 0=hardware watchdog, 1=software watchdog
    uint8_t  nrst_stop;       // NRST pin behavior in STOP mode
    uint8_t  nrst_stdby;      // NRST pin behavior in STANDBY mode
    uint8_t  boot_sel;        // Boot source selection
    uint8_t  boot_addr0;      // Boot address offset
    uint8_t  rdp_level;       // Read protection level
} option_bytes_config_t;

hal_err_t option_bytes_program(const option_bytes_config_t* cfg) {
    // 1. Unlock flash option bytes
    if (FLASH->OPTCR & FLASH_OPTCR_OPTLOCK) {
        FLASH->OPTKEYR = 0x08192A3B;
        FLASH->OPTKEYR = 0x4C5D6E7F;
    }
    
    // 2. Program option bytes (vendor-specific register layout)
    FLASH->OPTCR = (cfg->bor_level    << FLASH_OPTCR_BORLEV_Pos)
                 | (cfg->wdg_sw       << FLASH_OPTCR_WDGSW_Pos)
                 | (cfg->nrst_stop    << FLASH_OPTCR_NRST_STOP_Pos)
                 // ... more fields ...
                 | FLASH_OPTCR_OPTSTRT;  // Start programming
    
    while (FLASH->SR & FLASH_SR_BSY);  // Wait for completion
    
    // 3. Trigger a system reset for new option bytes to take effect
    NVIC_SystemReset();
    
    return HAL_OK;  // Never reached due to reset
}
```

### eFuse / OTP Programming Safety Checklist

```c
// eFuses and OTP are ONE-TIME programmable. A single wrong bit is permanent.
// The following checklist MUST be satisfied before ANY OTP write:

bool otp_write_safety_check(void) {
    // 1. Double-check the target address and bit positions
    LOG_INFO("OTP WRITE: Address=0x%08lx, Mask=0x%08lx, Value=0x%08lx",
             otp_addr, otp_mask, otp_value);
    LOG_INFO("OTP: %lu bits will be permanently changed", popcount(otp_mask));
    
    // 2. Verify we're not writing to already-programmed bits
    uint32_t current = otp_read(otp_addr);
    if (current & otp_mask) {
        LOG_ERROR("OTP: Attempting to program already-programmed bits! "
                  "current=0x%08lx, mask=0x%08lx", current, otp_mask);
        return false;
    }
    
    // 3. Verify the value makes sense (sanity checks)
    if (otp_addr == OTP_DEVICE_ID && otp_value == 0) {
        LOG_ERROR("OTP: Refusing to program zero device ID");
        return false;
    }
    
    // 4. Read-back verify is NOT possible after OTP write (already burned).
    //    Triple-check the value BEFORE writing.
    //    Consider a "dry run" that logs but doesn't actually write.
    
    // 5. Confirm voltage and timing from the datasheet
    //    Wrong voltage → unreliable programming (bits may read as 0 but fail later)
    //    Wrong timing → incomplete programming
    
    return true;
}

// Before burning security-critical OTP (keys, lock bits):
//   1. Have TWO engineers independently verify the values
//   2. Use a checksum to detect bit errors in the production programming tool
//   3. Never program lock bits (RDP Level 2) on the same run as other OTP
//      — do it as a separate, verified step
```

## ECC Memory Protection

### SRAM ECC Configuration

```c
// ECC (Error Correction Code) protects SRAM against single-bit errors
// and detects double-bit errors. Single-bit errors are corrected transparently;
// double-bit errors trigger an NMI.

// ECC is configured by the hardware at boot — firmware typically only
// needs to:
//   1. Initialize ECC on SRAM at startup (write all SRAM so ECC bits are set)
//   2. Handle ECC error interrupts

void sram_ecc_init(void) {
    // Newly powered SRAM has random data and random ECC bits.
    // The ECC bits may not match the data → spurious ECC errors on first read.
    // Solution: write all SRAM at startup to initialize ECC.
    
    // This is typically done in the startup code BEFORE .data/.bss init.
    // WARNING: This overwrites ALL SRAM including any bootloader data.
    // Ensure bootloader passes data via registers or a known-safe region.
    
    uint32_t* sram_start = (uint32_t*)SRAM_BASE;
    uint32_t* sram_end   = (uint32_t*)(SRAM_BASE + SRAM_SIZE);
    
    for (uint32_t* p = sram_start; p < sram_end; p++) {
        *p = 0;  // Write: ECC bits computed and stored alongside data
    }
}

void ECC_NMI_Handler(void) {
    // Single-bit ECC errors: corrected by hardware, logged for monitoring.
    // Double-bit ECC errors: uncorrectable, system must handle gracefully.
    
    uint32_t ecc_status = ECC->SR;
    
    if (ecc_status & ECC_SR_SINGLE_ERR) {
        uint32_t addr = ECC->FAR;  // Fault address register
        LOG_WARN("ECC: Single-bit error corrected at 0x%08lx", addr);
        ecc_single_bit_count++;
        
        // If rate > threshold, this SRAM cell is degrading — consider
        // retiring this memory region or alerting for maintenance.
    }
    
    if (ecc_status & ECC_SR_DOUBLE_ERR) {
        uint32_t addr = ECC->FAR;
        LOG_CRITICAL("ECC: Double-bit error (uncorrectable) at 0x%08lx", addr);
        
        // Uncorrectable ECC error — data at this address is corrupt.
        // Options:
        //   1. If in non-critical data: zero the region and continue
        //   2. If in critical data (task stack, kernel structures):
        //      reset the system
        //   3. Log the error for post-mortem analysis
        
        NVIC_SystemReset();  // Safest default
    }
    
    ECC->SR = ecc_status;  // Clear flags
}
```

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "MPU is only for safety-critical systems" | An MPU catches bugs that would otherwise go undetected for weeks — buffer overflows, null pointer writes, stack corruption. On an MCU with no MMU, the MPU is your ONLY hardware memory protection. Use it. |
| "I'll configure the MPU later" | MPU configuration is tightly coupled to your memory layout. Changes to the linker script, stack sizes, or memory map require MPU updates. Configure the MPU when the memory layout is defined, not as an afterthought. |
| "TrustZone is only for DRM and payment systems" | TrustZone isolates firmware components with different trust levels. Your BLE stack from a vendor? Put it in NS. Your device identity key? Put it in S. A compromised BLE stack can't read the key. Isolation is defense in depth. |
| "RDP Level 1 is good enough for production" | Level 1 allows a debugger to connect and trigger mass erase. If an attacker can erase and flash their own firmware, they can bypass your software checks. RDP Level 2 prevents debugger access entirely — but is irreversible. Choose based on threat model. |
| "I don't need ECC, SRAM is reliable" | SRAM soft errors increase with altitude, temperature, and smaller process nodes. At 28nm and below, cosmic-ray-induced bit flips are measurable. ECC turns a silent data corruption into a logged, handled event. |
| "I already have CRC on flash, so I don't need WRP" | CRC tells you the flash is corrupted. WRP prevents the corruption from happening in the first place. A runaway pointer can overwrite flash; WRP stops it at the hardware level. |

## Red Flags

- MPU disabled entirely in production firmware
- MPU region base address not aligned to region size
- No MemManage fault handler (undefined MPU fault → escalates to HardFault with less info)
- TrustZone SAU configured with regions that don't cover all memory (undefined regions may default to Secure — check IDAU)
- NSC veneer functions that don't validate NS pointer ranges
- RDP Level 2 programmed without verified recovery mechanism
- OTP/eFuse write without the safety checklist executed
- ECC initialization skipped (spurious ECC errors on first boot)
- Flash writes without verifying WRP is active on bootloader region
- Security-critical keys stored in non-protected flash (use OTP or dedicated secure storage)
- Option bytes not locked after programming (option bytes can be modified by rogue code)

## Verification

After implementing memory protection:

- [ ] MPU regions verified: read from protected address → MemManage fault; write to protected → MemManage fault
- [ ] Stack overflow guard: overflow a task stack by 64 bytes, verify MemManage fault fires with correct PC
- [ ] TrustZone: NS code reads from S memory → SecureFault; NS code calls S function via NSC → works; S function validates NS pointer range
- [ ] Flash RDP: verify debugger cannot read flash in Level 1 (returns zeros or triggers mass erase)
- [ ] Flash WRP: attempt to write to write-protected sector → flash error returned, data unchanged
- [ ] Option bytes: program, power cycle, verify values persist and take effect
- [ ] OTP/eFuse: burn a test word (if test bits available), verify it reads back correctly and cannot be changed
- [ ] ECC: inject single-bit error (if hardware supports test injection), verify corrected and logged
- [ ] ECC: inject double-bit error, verify NMI fires and system resets gracefully
- [ ] All memory regions defined in the linker script are covered by either MPU regions or default memory map
- [ ] Negative test: NS code attempts direct S function call (not through NSC veneer) → SecureFault
- [ ] Negative test: write to RDP Level 2 device via debugger → no connection possible

## After This Skill

Once memory protection is configured and verified:

| Next Step | Skill | What It Produces |
|-----------|-------|-----------------|
| Secure boot with hardware root of trust | `bootloader-design` | Boot verification using OTP keys, anti-rollback via eFuse |
| Peripheral access control | `peripheral-driver-design` | Driver MPU regions, DMA buffer protection |
| Security hardening | `security-and-hardening` | Full threat model, secure key storage, tamper detection |
| Fault handling | `embedded-debugging` | MemManage/SecureFault/BusFault handler integration |
| System architecture | `software-architecture-design` | Secure/non-secure partition in firmware architecture |
