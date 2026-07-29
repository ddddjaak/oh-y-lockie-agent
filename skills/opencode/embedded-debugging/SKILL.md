---
name: embedded-debugging
description: Systematic debugging of embedded firmware crashes and anomalies. Use when firmware HardFaults, watchdog resets, memory corrupts, or behaves unexpectedly on target hardware. Use when you need to analyze a crash dump, interpret fault registers, or isolate a timing-dependent bug. Covers Cortex-M fault analysis, JTAG/SWD debugging, stack overflow detection, and memory corruption tactics.
---

# Embedded Debugging and Fault Analysis

## Overview

Systematic debugging for embedded firmware running on real hardware. When a server crashes, you get a stack trace. When an MCU crashes, you get a HardFault — with zero context unless you've instrumented for it. This skill covers how to instrument for crashes, how to interpret fault registers when they happen, and how to isolate the hardest embedded bugs: memory corruption, stack overflows, timing races, and intermittent watchdog resets.

## When to Use

- Firmware HardFaults, MemManage faults, BusFaults, or UsageFaults
- Device resets unexpectedly (watchdog, brownout, or unknown cause)
- Memory corruption: variables change values mysteriously, data structures corrupted
- Stack overflow suspected (random crashes, corruption of adjacent memory)
- Code works on one board but not another
- Bug only appears at specific optimization levels or compiler versions
- Bug is timing-dependent (works with a breakpoint, fails without)

**When NOT to use:** Build errors (read the compiler output), logic bugs reproducible in unit tests (use TDD), or known-issue diagnosis where the root cause is already identified.

## The Stop-the-Line Rule

When an embedded crash occurs:

```
1. STOP — Don't re-flash. Don't reset. Don't power-cycle yet.
2. PRESERVE — Attach debugger WITHOUT resetting the target.
               Read fault registers. Dump stack. Capture RAM state.
3. DIAGNOSE — Work through the fault analysis checklist.
4. FIX — Address the root cause.
5. GUARD — Add assertions, stack monitoring, or regression tests.
6. RESUME — Only after verification passes.
```

**Attach without reset is critical.** Most debuggers default to reset-on-connect. Change this: in pyOCD use `--no-reset`, in OpenOCD use `reset_config none`, in J-Link Commander use `connect` (not `r`).

## Cortex-M Fault Register Analysis

The Cortex-M fault registers tell you exactly what went wrong. Learn to read them.

### The Fault Status Registers

```
HardFault Status Register (HFSR) — 0xE000ED2C
├── FORCED  (bit 30): HardFault was escalated from another fault handler
├── VECTTBL (bit 1):  BusFault on vector table read during exception entry
└── DEBUGEVT (bit 31): Fault during debug event (usually not a crash)

MemManage Fault Status Register (MMFSR) — 0xE000ED28 (low byte)
├── MMARVALID (bit 7): MMAR register contains the faulting address
├── MSTKERR   (bit 4): Stacking error (context save/restore)
├── MUNSTKERR (bit 3): Unstacking error
├── DACCVIOL  (bit 1): Data access violation (MPU or execute-only region)
└── IACCVIOL  (bit 0): Instruction access violation (trying to execute non-executable region)

BusFault Status Register (BFSR) — 0xE000ED29 (middle byte)
├── BFARVALID (bit 7): BFAR register contains the faulting address
├── STKERR    (bit 4): Stacking error
├── UNSTKERR  (bit 3): Unstacking error
├── IMPRECISERR (bit 2): Imprecise bus fault (async — harder to locate)
├── PRECISERR (bit 1): Precise bus fault (BFAR has the address)
└── IBUSERR   (bit 0): Instruction bus error

UsageFault Status Register (UFSR) — 0xE000ED2A (high byte)
├── DIVBYZERO (bit 9): Divide by zero
├── UNALIGNED (bit 8): Unaligned access (when enabled)
├── NOCP      (bit 3): Coprocessor access (FPU not enabled?)
├── INVPC     (bit 2): Invalid PC loaded (branch to non-code address)
├── INVSTATE  (bit 1): Invalid state (trying to execute ARM code in Thumb mode, or vice versa)
└── UNDEFINSTR (bit 0): Undefined instruction (corrupted code or bad jump)
```

### Fault Handler Implementation

```c
// Minimal HardFault handler that captures context for post-mortem analysis
// Place in a no-init section so it survives a warm reset.

#include <stdint.h>

// Structure to hold the fault snapshot
typedef struct __attribute__((packed)) {
    uint32_t r0;
    uint32_t r1;
    uint32_t r2;
    uint32_t r3;
    uint32_t r12;
    uint32_t lr;       // Link register at time of fault
    uint32_t pc;       // Program counter at time of fault
    uint32_t psr;      // Program status register
} exception_stack_frame_t;

typedef struct {
    uint32_t signature;          // Magic number to detect valid crash record
    uint32_t fault_type;         // 3=HardFault, 4=MemManage, 5=BusFault, 6=UsageFault
    uint32_t hfsr;
    uint32_t cfsr;               // Combined: [UFSR:16][BFSR:8][MMFSR:8]
    uint32_t mmfar;              // MemManage Fault Address Register
    uint32_t bfar;               // BusFault Address Register
    uint32_t pc;
    uint32_t lr;
    uint32_t stacked_frame[8];   // r0, r1, r2, r3, r12, lr, pc, psr
    uint32_t msp;
    uint32_t psp;
    uint32_t exc_return;         // EXC_RETURN value from LR on entry
    uint32_t ticks;
    uint32_t reserved[3];
} crash_record_t;

// Place the crash record in a no-init section so it survives a warm reset
// NOTE: section attribute goes on the VARIABLE definition, not the typedef
#define CRASH_RECORD_ADDR  (0x20000000 + 128*1024 - 256)  // Example: end of 128KB RAM - 256 bytes
// Adjust CRASH_RECORD_ADDR for your MCU's RAM size and base address.
// Must be in a region that the startup code does NOT zero or initialize.

crash_record_t* const crash_record = (crash_record_t*)CRASH_RECORD_ADDR;

#define CRASH_SIGNATURE 0xDEADBEEF

// The actual HardFault handler
void HardFault_Handler(void) {
    crash_record_t* crash = crash_record;
    
    // Capture fault registers
    crash->signature = CRASH_SIGNATURE;
    crash->fault_type = 3;  // HardFault
    crash->hfsr = SCB->HFSR;
    crash->cfsr = SCB->CFSR;
    crash->mmfar = SCB->MMFAR;
    crash->bfar = SCB->BFAR;
    crash->msp = __get_MSP();
    crash->psp = __get_PSP();
    crash->exc_return = __get_LR();  // EXC_RETURN tells us which stack the frame is on
    crash->ticks = system_tick;      // Your global system tick counter
    
    // Capture the exception stack frame
    // On Cortex-M, the exception frame is pushed onto the stack that was active
    // BEFORE the exception. We determine which stack that was from EXC_RETURN bit 2.
    // (In handler mode, CONTROL.SPSEL is always 0, so we cannot use __get_CONTROL().)
    uint32_t* frame;
    if (__get_LR() & (1 << 2)) {
        // EXC_RETURN bit 2 = 1: frame was pushed onto PSP
        frame = (uint32_t*)__get_PSP();
    } else {
        // EXC_RETURN bit 2 = 0: frame was pushed onto MSP
        frame = (uint32_t*)__get_MSP();
    }
    
    crash->pc = frame[6];  // PC at time of fault
    crash->lr = frame[5];  // LR at time of fault
    for (int i = 0; i < 8; i++) {
        crash->stacked_frame[i] = frame[i];
    }
    
    // Optional: dump to UART for immediate visibility
    // uart_puts("HARD FAULT: PC=0x"); uart_puthex(crash->pc);
    
    // Optional: store reset reason and trigger a controlled reset
    // so the device doesn't stay hung in the fault handler
    
    // If you have a watchdog, let it fire
    while (1) { /* Wait for watchdog */ }
}

// Also implement for other fault handlers if you have them enabled:
// MemManage_Handler, BusFault_Handler, UsageFault_Handler
```

### Fault Analysis Decision Tree

```
Read CFSR register:
├── IACCVIOL or DACCVIOL set?
│   └── MPU violation. Check MMAR/BFAR for the address.
│       Is address in a valid region? Is MPU configured correctly?
│       Is code trying to execute from read-only/no-execute region?
├── PRECISERR or IMPRECISERR set?
│   ├── PRECISERR → BFAR has the exact faulting address.
│   │   Check if that address is valid for the access type.
│   │   Common: accessing a peripheral whose clock is disabled,
│   │          reading from uninitialized external memory,
│   │          writing to flash while it's busy.
│   └── IMPRECISERR → Bus fault reported asynchronously.
│       Much harder to isolate. Common causes:
│       - Wrote to a buffer, then DMA started using it before write completed
│       - Accessed unmapped external memory (the access is buffered)
│       Strategy: disable write buffering (set ACTLR.DISDEFWBUF on Cortex-M7)
│                  or scatter MPU checks around suspect code.
├── UNDEFINSTR or INVSTATE set?
│   └── Corrupted code or bad jump.
│       Check PC: is it in a valid code region?
│       Is the function pointer null or corrupted?
│       Is a jump table index out of bounds?
│       Is FPU context being corrupted (check LR bit 4 — if set, FPU was active)?
├── UNALIGNED set?
│   └── Unaligned access with UNALIGN_TRP enabled (SCB->CCR).
│       Fix the alignment, or disable the trap if intentional.
├── DIVBYZERO set?
│   └── Integer divide by zero. Check denominator before division.
├── INVPC set?
│   └── Loading a non-code address into PC. Likely a corrupted function pointer
│       or a stack smash that overwrote the return address.
└── NOCP set?
    └── FPU instruction executed but FPU not enabled (SCB->CPACR).
        Enable FPU, or don't use floating point in that context.
```

## JTAG/SWD Debugging Workflow

### Connecting Without Destroying Evidence

```bash
# pyOCD: attach without reset
pyocd commander --no-reset --target nrf52840

# OpenOCD: connect without reset
openocd -f interface/cmsis-dap.cfg -f target/nrf52.cfg -c "init; reset_config none; halt"

# J-Link Commander: connect without reset
JLinkExe -device NRF52840_XXAA -if SWD -speed 4000 -autoconnect 1
# Then type: connect (NOT 'r' which resets)
```

### Essential Debugging Commands

```
First things to check after a crash (attach without reset):

# 1. Read fault registers
(gdb) x/1xw 0xE000ED28   # CFSR (combined)
(gdb) x/1xw 0xE000ED2C   # HFSR
(gdb) x/1xw 0xE000ED34   # MMFAR
(gdb) x/1xw 0xE000ED38   # BFAR

# 2. Find where the fault occurred
(gdb) info registers pc lr

# 3. Map PC to source line
(gdb) info line *$pc

# 4. Check the stack pointer
(gdb) info registers sp msp psp

# 5. Backtrace (limited on Cortex-M without frame pointer)
(gdb) bt

# 6. Examine the stack around SP
(gdb) x/32xw $sp

# 7. Check reset reason
(gdb) x/1xw <RCC_CSR_address>  # STM32
(gdb) x/1xw 0x40000400          # nRF52 RESETREAS

# For a more useful backtrace, enable frame pointers:
# Add -fno-omit-frame-pointer to your debug build CFLAGS
```

### Semi-Hosting for Debug Output

When you have a debugger attached but no UART available, semi-hosting lets printf go to the debugger console:

```c
// Enable semi-hosting (Arm GCC)
// In your debug build linker flags: --specs=rdimon.specs -lrdimon
// Call initialise_monitor_handles() before using printf

extern void initialise_monitor_handles(void);

int main(void) {
    initialise_monitor_handles();
    printf("System starting...\n");
    // printf now outputs to your GDB console
}
```

## Stack Overflow Detection

Stack overflow is the most common cause of mysterious crashes in embedded firmware. The symptoms: random HardFaults, corrupted global variables, incorrect function returns.

### Method 1: Watermark (Fill Pattern)

```c
// At startup, fill the entire stack with a known pattern
#define STACK_FILL 0xDEADBEEF

// These symbols come from your linker script
extern uint32_t _stack_bottom;  // Lowest stack address
extern uint32_t _stack_top;     // Highest stack address (initial SP value)

void stack_init_watermark(void) {
    uint32_t* p = &_stack_bottom;
    while (p < &_stack_top) {
        *p++ = STACK_FILL;
    }
}

// After running, measure:
size_t stack_get_high_water(void) {
    uint32_t* p = &_stack_bottom;
    size_t used = 0;
    while (*p == STACK_FILL && p < &_stack_top) {
        p++;
        used += 4;
    }
    return (size_t)(&_stack_top - &_stack_bottom) * 4 - used;
}
```

### Method 2: MPU Guard Region

```c
// Place a no-access MPU region at the bottom of the stack.
// If the stack overflows into the guard, you get a precise MemManage fault
// instead of silent corruption.

void mpu_setup_stack_guard(void) {
    // Assume stack is at 0x20000000, size 16KB, guard is 256 bytes at bottom
    uint32_t guard_start = 0x20000000;
    
    // Disable MPU during configuration
    MPU->CTRL &= ~MPU_CTRL_ENABLE_Msk;
    
    // Program MPU region 0 as no-access for the guard area
    MPU->RBAR = guard_start | (0 << 0);     // Region 0, valid
    
    // RASR encoding (Cortex-M4/M7/M33):
    // Bits [31:0]:
    //   [0]     ENABLE  — region enable
    //   [4:1]   SIZE    — 2^(SIZE+1) bytes; 7 → 2^8 = 256 bytes
    //   [15:8]  SRD     — subregion disable (0 = all enabled)
    //   [17:16] B       — bufferable
    //   [18]    C       — cacheable
    //   [19]    S       — shareable
    //   [23:21] TEX     — type extension (0 = strongly ordered for device memory)
    //   [26:24] AP      — access permissions (0 = no access for all)
    //   [27]             — reserved
    //   [28]    XN      — execute never (1 = no instruction fetch)
    MPU->RASR = (0 << 28)      // XN = 0 (no code here anyway)
              | (0 << 24)      // AP = 000: no access, privileged or unprivileged
              | (0 << 21)      // TEX = 000
              | (0 << 19)      // S = 0 (non-shareable for stack guard)
              | (1 << 18)      // C = 1 (cacheable — normal memory)
              | (0 << 17)      // B = 0 (non-bufferable for guard)
              | (7 << 1)       // SIZE = 7 → 2^(7+1) = 256 bytes
              | (1 << 0);      // ENABLE
    
    MPU->CTRL |= MPU_CTRL_ENABLE_Msk;  // Re-enable MPU
}
```

### Method 3: RTOS Stack Monitoring

Most RTOSes provide per-task stack monitoring:

```c
// FreeRTOS
UBaseType_t uxTaskGetStackHighWaterMark(TaskHandle_t xTask);
// Returns: words remaining. If < 10 words, task is close to overflow.

// Zephyr
size_t k_thread_stack_space_get(k_tid_t thread);
// Returns: unused bytes. 0 = overflow has occurred or imminent.
```

## Memory Corruption Debugging

Memory corruption is the hardest embedded bug. The symptom (a crash) is far removed from the cause (a write that happened seconds or minutes earlier).

### Tactic 1: Data Watchpoints

```gdb
# GDB: Break when a specific variable is written
(gdb) watch my_struct.field
(gdb) continue

# Hardware watchpoints on Cortex-M are limited (usually 4-6).
# Each watchpoint can cover 1-4 words.
(gdb) watch *0x20001234    # Watch a specific address
(gdb) rwatch *0x20001234   # Watch reads from this address
(gdb) awatch *0x20001234   # Watch reads OR writes
```

### Tactic 2: MPU Write-Protect

```c
// Make a critical data region read-only.
// Any write will trigger a precise MemManage fault.
void mpu_protect_region(void* addr, size_t size) {
    // Configure MPU region as read-only (privileged and unprivileged)
    // Any write → immediate MemManage fault with the exact address
}
```

### Tactic 3: Sentinel Values (Canaries)

```c
// Place known values around critical structures.
// Periodically check if they're intact.

typedef struct {
    uint32_t head_canary;   // Must be CANARY_VALUE
    // ... critical data ...
    uint32_t tail_canary;   // Must be CANARY_VALUE
} protected_data_t;

#define CANARY_VALUE 0xCAFEBABE

void assert_canary_intact(protected_data_t* p) {
    if (p->head_canary != CANARY_VALUE || p->tail_canary != CANARY_VALUE) {
        // Memory corruption detected! Log and halt or reset.
        crash_record_t* crash = get_crash_record();
        crash->pc = (uint32_t)__builtin_return_address(0);
        crash_handler();
    }
}
```

### Tactic 4: Binary Search with MPU

When you can't narrow down the corrupting code with watchpoints:

```
1. Protect the FIRST HALF of the suspect memory region with MPU (no-write)
2. Run the system. If it crashes → corrupting code is in first half
   Keep narrowing: protect first quarter, then first eighth, etc.
3. If it doesn't crash → corrupting code is in second half
   Protect that half and repeat.
4. Converge to the exact function.
```

## Watchdog Reset Root Cause

A watchdog reset means something hung. Finding out what requires instrumentation:

```c
// Track where the system is spending time so you know what hung
typedef enum {
    TASK_IDLE,
    TASK_SENSOR_POLL,
    TASK_BLE_PROCESS,
    TASK_UART_RX,
    TASK_ADC_SAMPLE,
    TASK_OTA_UPDATE,
    // ... add entries for each major code path
} task_checkpoint_t;

// In no-init RAM (survives reset):
static task_checkpoint_t __attribute__((section(".noinit"))) last_checkpoint;

// Scatter these throughout your main loop and tasks:
#define CHECKPOINT(label) (last_checkpoint = (label))

// In main loop:
while (1) {
    CHECKPOINT(TASK_SENSOR_POLL);
    read_sensors();
    
    CHECKPOINT(TASK_BLE_PROCESS);
    ble_process_events();
    
    CHECKPOINT(TASK_IDLE);
    rtos_delay(10);
}

// On boot after watchdog reset:
void check_watchdog_cause(void) {
    if (reset_reason() == RESET_WATCHDOG) {
        LOG_ERROR("Watchdog reset! Last checkpoint: %d", last_checkpoint);
    }
}
```

## Logic Analyzer / Oscilloscope Debugging

When the debugger can't help (timing-dependent bugs, interrupt latency issues):

### GPIO Toggle Profiling

```c
// Toggle a spare GPIO to measure timing with an oscilloscope or logic analyzer.
// Connect the scope probe to the GPIO pin, configure as push-pull output.

// Write to the GPIO's bit-set and bit-clear registers for atomic, fast toggling.
// Example for CMSIS-level access (GPIOB, pin 0):
#define PROFILE_PIN_SET()   (GPIOB->BSRR = (1 << 0))        // Set pin high
#define PROFILE_PIN_CLEAR() (GPIOB->BSRR = (1 << (0 + 16)))  // Clear pin low

// Or use your HAL's gpio_write() if the overhead is acceptable for your measurement

// Measure ISR duration:
void MY_IRQHandler(void) {
    PROFILE_PIN_SET();      // Scope trigger: ISR starts
    // ... ISR work ...
    PROFILE_PIN_CLEAR();    // Scope trigger: ISR ends
}

// Measure critical section duration:
void critical_function(void) {
    PROFILE_PIN_SET();
    __disable_irq();
    // ... critical section ...
    __enable_irq();
    PROFILE_PIN_CLEAR();
}

// Measure time between events:
// Toggle the pin each time an event occurs.
// On the scope: measure the period or pulse width.
// Multiple GPIOs = multiple channels = correlate events in time.
```

## Common Crash Patterns and Their Causes

| Symptom | Most Likely Cause | First Debugging Step |
|---------|------------------|---------------------|
| HardFault, INVSTATE set, PC in RAM | Stack overflow overwrote return address | Check stack watermark |
| HardFault, UNDEFINSTR, PC looks like data | Corrupted function pointer or vtable | Check the object the pointer came from |
| MemManage fault, DACCVIOL, address near 0 | NULL pointer dereference | Check uninitialized pointers |
| MemManage fault, IACCVIOL | Jump to non-executable memory | Check function pointer initialization |
| BusFault, PRECISERR, address in peripheral range | Accessing a peripheral with clock disabled | Check RCC/peripheral clock enable |
| BusFault, IMPRECISERR | Async write buffering issue | Disable write buffer, re-test |
| UsageFault, DIVBYZERO | Division by zero | Check denominator before divide |
| Crash only with -O2, not -O0 | Compiler optimization exposing UB | Check for uninitialized variables, volatile omissions |
| Crash after hours of operation | Slow memory leak or stack creep | Instrument free heap, check stack high-water over time |
| Crash in a specific ISR | ISR stack overflow or ISR taking too long | Profile ISR duration with GPIO toggle |

## See Also

For stack sizing and memory analysis at build time, see `embedded-build-and-toolchain`. For RTOS task stack monitoring, see `rtos-and-concurrency`.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll just reset and see if it happens again" | You destroyed the evidence. The fault registers were the only clue. Attach without reset. |
| "The crash is random, must be hardware" | "Random" crashes are almost always memory corruption, stack overflow, or timing races — software bugs with random-trigger conditions. |
| "I'll add a printf to debug it" | printf changes timing and stack usage. The bug may disappear (Heisenbug) or move. Use a GPIO toggle or trace buffer instead. |
| "Fault handlers are over-engineering" | A 100-line fault handler saves days of guesswork. Instrument before you crash. |
| "I don't need an MPU, the MCU has plenty of RAM" | MPU catches the bug at the exact instruction. Without it, you're left with a corrupted heap and a crash 10 seconds later. |
| "Breakpoints will find it" | Timing-dependent bugs disappear under a debugger. For those, you need GPIO toggles + logic analyzer. |

## Red Flags

- Production firmware without any fault handler (default infinite loop)
- No stack overflow detection (watermark, MPU guard, or RTOS monitoring)
- "Works with breakpoint, crashes without" — timing bug, not a debugging artifact to ignore
- Resetting the MCU after a crash without reading fault registers
- Using `-O0` to "fix" a bug (the bug is still there, just relocated by the optimizer)
- No reset reason tracking in the firmware
- No no-init crash record mechanism

## Verification

After implementing embedded debugging infrastructure:

- [ ] HardFault/MemManage/BusFault/UsageFault handlers capture registers, PC, and stack to no-init RAM
- [ ] Fault handler preserves crash context across a controlled reset (not just an infinite loop)
- [ ] Stack watermark or MPU guard region configured
- [ ] Reset reason tracked and reported (watchdog vs brownout vs software vs pin reset)
- [ ] Crash record reported on next boot (UART, BLE, or stored for later retrieval)
- [ ] At least one spare GPIO available for timing profiling (solder a test point on the PCB)
- [ ] Negative test: intentionally trigger a HardFault (e.g., `*(volatile uint32_t*)0xFFFFFFFF = 0;`), confirm handler captures it correctly
- [ ] Negative test: overflow the stack, confirm detection mechanism catches it
