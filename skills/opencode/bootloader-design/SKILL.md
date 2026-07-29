---
name: bootloader-design
description: 引导加载程序设计：多级启动架构、安全启动链、镜像验证（CRC/签名）、A/B分区OTA、回退/恢复启动、看门狗辅助启动、启动模式选择（BOOT引脚/选项字节）。Bootloader design — multi-stage boot architecture, secure boot chain, image verification (CRC/signature), A/B partition OTA, fallback/recovery boot, watchdog-assisted boot, boot mode selection (BOOT pins, option bytes). Use when the user says bootloader, 启动加载, secure boot, OTA, DFU, 固件升级, firmware update, or when designing a bootloader for an embedded system.
---
# Bootloader Design

## Overview

The bootloader is the most safety-critical piece of firmware on any embedded device. Application firmware can crash and the device reboots. The bootloader crashes and the device is a brick. A well-designed bootloader ensures that even a failed OTA update, a corrupted flash sector, or a watchdog reset during update results not in a dead device, but in a graceful fallback to a known-good image.

This skill covers the complete bootloader design lifecycle: multi-stage boot architecture, image format specification, secure boot verification, A/B partition OTA update state machine, bootloader-application handoff protocol, and the brick-proof design patterns that separate a production bootloader from a hobby project.

## When to Use

- Designing the boot sequence for a new embedded device
- Implementing OTA (over-the-air) firmware updates with fail-safe rollback
- Adding secure boot (image signature verification before execution)
- Designing a dual-bank or A/B partition flash layout
- Implementing DFU (Device Firmware Upgrade) over USB or UART
- Creating a recovery/factory-reset mechanism
- Configuring boot mode selection (BOOT pins, option bytes, boot from different media)

**When NOT to use:** Writing the application firmware (this is about the boot sequence, not the app), choosing flash memory hardware (use `hardware-architecture-design`), implementing a boot ROM (boot ROM is mask-ROM, factory-programmed — you can't change it), or writing a PC/OS bootloader (GRUB, U-Boot have different constraints).

## Multi-Stage Boot Architecture

### The Standard Boot Sequence

```
Power-On / Reset
       │
       ▼
┌──────────────────────────────────────────┐
│  Stage 0: Boot ROM (mask ROM, immutable)  │
│  - Minimal initialization                 │
│  - Read BOOT pins / option bytes          │
│  - Load Stage 1 from selected medium      │
│  - Verify (optional, chip-dependent)      │
│  - Jump to Stage 1                        │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Stage 1: Primary Bootloader (your code)  │
│  - Clock tree to full speed               │
│  - External RAM init (if present)          │
│  - Validate application image (CRC/sig)   │
│  - If valid: jump to application          │
│  - If invalid: enter recovery/DFU mode    │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Stage 2: Application Firmware            │
│  - Full system init                       │
│  - Main application logic                 │
│  - OTA handler: receive new image,         │
│    write to inactive partition,           │
│    set "pending verify" flag, reboot      │
└──────────────────────────────────────────┘
```

### Bootloader Memory Layout

```c
// Typical flash layout for a dual-bank (A/B) system:
//
// ┌──────────────────────────────────────────┐ 0x08000000
// │  Bootloader (64KB)                        │
// │  - Vector table                           │
// │  - Bootloader code + data                 │
// │  - Boot parameters (shared with app)       │
// ├──────────────────────────────────────────┤ 0x08010000
// │  Partition A: Application (Bank 0)        │
// │  - App vector table                       │
// │  - App code                               │
// │  - Image metadata (version, CRC, etc.)    │
// ├──────────────────────────────────────────┤ 0x08050000
// │  Partition B: Application (Bank 1)        │
// │  - Same layout as Partition A             │
// │  - Updated during OTA                     │
// ├──────────────────────────────────────────┤ 0x08090000
// │  NV Storage / Configuration               │
// │  - Boot count, update status, etc.        │
// └──────────────────────────────────────────┘

#define FLASH_BASE              0x08000000
#define FLASH_SIZE              (512 * 1024)  // 512KB
#define FLASH_PAGE_SIZE         2048
#define FLASH_SECTOR_SIZE       (16 * 1024)   // 16KB — check your MCU

#define BOOTLOADER_ADDR         FLASH_BASE
#define BOOTLOADER_SIZE         (64 * 1024)    // 64KB

#define APP_PARTITION_A_ADDR    (BOOTLOADER_ADDR + BOOTLOADER_SIZE)
#define APP_PARTITION_B_ADDR    (APP_PARTITION_A_ADDR + (FLASH_SIZE - BOOTLOADER_SIZE) / 2)
#define APP_PARTITION_SIZE      ((FLASH_SIZE - BOOTLOADER_SIZE) / 2)

// Shared region: bootloader and app both access this
// Must NOT be erased during OTA
#define NV_STORAGE_ADDR         (APP_PARTITION_B_ADDR + APP_PARTITION_SIZE - NV_STORAGE_SIZE)
#define NV_STORAGE_SIZE         (4 * FLASH_SECTOR_SIZE)  // Use last sectors
```

## Image Format Specification

### Image Header

```c
// Every firmware image must have a header at a known location.
// The bootloader reads this header to validate the image.

#define IMAGE_MAGIC             0x494D4147  // "IMAG"
#define IMAGE_HEADER_VERSION    1

typedef struct __attribute__((packed)) {
    uint32_t magic;                // IMAGE_MAGIC
    uint32_t header_version;       // IMAGE_HEADER_VERSION — for future compatibility
    uint32_t image_size;           // Total image size in bytes (including header)
    uint32_t code_size;            // Code + data size (used for SHA/CRC calculation)
    uint32_t version_major;
    uint32_t version_minor;
    uint32_t version_patch;
    uint32_t build_timestamp;      // UNIX timestamp of build
    uint32_t entry_point;          // Address to jump to (app vector table)
    uint32_t load_address;         // Where the image should reside in flash
    uint32_t crc32;                // CRC32 of header (with this field zeroed) + code
    uint32_t signature_size;       // Size of signature appended after image (0 if no secure boot)
    uint8_t  image_type;           // 0=application, 1=recovery, 2=factory-test
    uint8_t  compression;          // 0=none, 1=zlib, 2=lz4
    uint16_t header_checksum;      // 16-bit ones' complement of first 14 bytes (excludes this field)
    uint32_t reserved[4];          // Future expansion — must be 0
} image_header_t;

// Header is placed at the START of each partition.
// Bootloader reads: header = *(image_header_t*)APP_PARTITION_A_ADDR;
// Validate magic, checksum, then CRC32 the full image.
```

### Image Validation

```c
typedef enum {
    IMAGE_VALID_OK,
    IMAGE_VALID_BAD_MAGIC,
    IMAGE_VALID_BAD_HEADER_CHECKSUM,
    IMAGE_VALID_BAD_CRC,
    IMAGE_VALID_BAD_SIGNATURE,
    IMAGE_VALID_WRONG_LOAD_ADDRESS,
    IMAGE_VALID_EMPTY,           // All 0xFF (erased flash)
} image_valid_result_t;

image_valid_result_t bootloader_validate_image(uint32_t image_addr) {
    const image_header_t* header = (const image_header_t*)image_addr;
    
    // 1. Check magic
    if (header->magic != IMAGE_MAGIC) {
        if (header->magic == 0xFFFFFFFF) {
            return IMAGE_VALID_EMPTY;     // Erased flash
        }
        return IMAGE_VALID_BAD_MAGIC;
    }
    
    // 2. Check header version
    if (header->header_version > IMAGE_HEADER_VERSION) {
        // Bootloader too old for this image — don't try to boot it
        LOG_ERROR("Image header version %lu > bootloader version %d",
                  header->header_version, IMAGE_HEADER_VERSION);
        return IMAGE_VALID_BAD_HEADER_CHECKSUM;
    }
    
    // 3. Verify CRC32
    // CRC covers: header (with crc32 field zeroed) + all code bytes
    uint32_t computed_crc = crc32_calculate(image_addr, header->code_size, 
                                             offsetof(image_header_t, crc32));
    if (computed_crc != header->crc32) {
        LOG_ERROR("CRC mismatch: computed=0x%08lx, header=0x%08lx",
                  computed_crc, header->crc32);
        return IMAGE_VALID_BAD_CRC;
    }
    
    // 4. Verify load address matches partition
    if (header->load_address != image_addr) {
        return IMAGE_VALID_WRONG_LOAD_ADDRESS;
    }
    
    // 5. If secure boot is enabled, verify signature
    if (header->signature_size > 0) {
        if (verify_signature(image_addr, header) != SIGNATURE_VALID) {
            return IMAGE_VALID_BAD_SIGNATURE;
        }
    }
    
    return IMAGE_VALID_OK;
}
```

## Secure Boot Verification Flow

```c
// Secure boot: the bootloader cryptographically verifies the application
// image before executing it. Prevents unauthorized firmware from running.

// Key hierarchy (simplified ECDSA approach):
//   Root key (private): held offline, never on device
//   Root key (public): burned into OTP/eFuse, immutable
//   Signing key (private): used to sign firmware images in CI
//   Signing key (public): embedded in bootloader, verifiable against root key

typedef struct {
    const uint8_t* public_key;     // Public key data (e.g., 64 bytes for ECDSA P-256)
    size_t         public_key_len;
    const uint8_t* hash;           // Hash of signing key (for key revocation check)
} secure_boot_key_t;

bool secure_boot_verify(const uint8_t* image_addr, size_t image_size,
                         const uint8_t* signature, size_t sig_size,
                         const secure_boot_key_t* key) {
    // 1. Compute SHA-256 of the image
    uint8_t image_hash[32];
    sha256_compute(image_addr, image_size, image_hash);
    
    // 2. Verify the signature against the public key
    // Using ECDSA P-256 with SHA-256
    return ecdsa_verify(key->public_key, key->public_key_len,
                        image_hash, sizeof(image_hash),
                        signature, sig_size);
}

// Anti-rollback: prevent flashing old (potentially vulnerable) firmware.
// Store minimum allowed version in OTP or write-protected flash.
// Reject any image with version < minimum.
bool anti_rollback_check(const image_header_t* header) {
    uint32_t min_version = otp_read32(OTP_MIN_VERSION);
    if (header->version_major < GET_MAJOR(min_version)) {
        return false;  // Too old — reject
    }
    return true;
}
```

## A/B OTA Update State Machine

### The States

```c
// The OTA update must be atomic from the user's perspective:
// either the new firmware runs, or the old firmware runs.
// There is no "partially updated" state visible to the user.

typedef enum {
    OTA_STATE_IDLE,               // No update in progress
    OTA_STATE_DOWNLOADING,        // Receiving image data
    OTA_STATE_DOWNLOAD_COMPLETE,  // All data received, CRC verified
    OTA_STATE_PENDING_VERIFY,     // New image flashed, reboot to try it
    OTA_STATE_ACCEPTED,           // New image booted successfully, make it primary
    OTA_STATE_REJECTED,           // New image failed to boot, fallback to old
} ota_state_t;

// These states are stored in a flash page reserved for OTA metadata.
// Must survive power loss at any point.

typedef struct __attribute__((packed)) {
    uint32_t    magic;                  // OTA_MAGIC = 0x4F544101 ("OTA!")
    ota_state_t state;
    uint32_t    active_partition;       // 0 = A, 1 = B
    uint32_t    update_partition;       // The partition being updated
    uint32_t    new_version_major;
    uint32_t    new_version_minor;
    uint32_t    new_version_patch;
    uint32_t    bytes_received;         // Progress (for resume support)
    uint32_t    total_bytes;            // Total expected size
    uint32_t    boot_attempt_count;     // Tracks PENDING_VERIFY boot attempts
    uint32_t    crc32;                  // CRC of this metadata struct
} ota_metadata_t;

#define MAX_BOOT_ATTEMPTS 3  // Try new image 3 times before fallback
```

### State Machine Implementation

```c
// Called by bootloader on every boot — CRITICAL PATH:
void ota_state_machine_on_boot(void) {
    ota_metadata_t* meta = ota_metadata_load();
    
    if (!ota_metadata_valid(meta)) {
        // No valid metadata — first boot or corruption. Start fresh.
        ota_metadata_init(meta);
        ota_metadata_save(meta);
        return;
    }
    
    switch (meta->state) {
    case OTA_STATE_PENDING_VERIFY:
        // We just rebooted to try the new image.
        // The fact that we're back in the bootloader means:
        //   Case 1: The new app booted and set state to PENDING_VERIFY.
        //           It will set ACCEPTED after passing self-test.
        //   Case 2: The app crashed/didn't boot, and the watchdog
        //           reset brought us here. The app never set ACCEPTED.
        //   Case 3: The app booted but was our NEWLY installed bootloader(?)
        //           — we are the bootloader, so this doesn't apply.
        
        meta->boot_attempt_count++;
        
        if (meta->boot_attempt_count >= MAX_BOOT_ATTEMPTS) {
            // Too many attempts — new image is bad. Fall back.
            LOG_WARN("Boot attempt %lu of %d failed, rolling back",
                     meta->boot_attempt_count, MAX_BOOT_ATTEMPTS);
            ota_rollback(meta);
        } else {
            // Try again
            LOG_INFO("Boot attempt %lu of %d for new image",
                     meta->boot_attempt_count, MAX_BOOT_ATTEMPTS);
        }
        ota_metadata_save(meta);
        break;
        
    case OTA_STATE_ACCEPTED:
        // New image was verified good — make it the active partition
        meta->active_partition = meta->update_partition;
        meta->state = OTA_STATE_IDLE;
        meta->update_partition = 0xFF;  // Invalid
        ota_metadata_save(meta);
        LOG_INFO("OTA update accepted, new version active");
        break;
        
    case OTA_STATE_REJECTED:
        // Already handled — bootloader should boot the active partition
        break;
        
    default:
        break;
    }
}

void ota_rollback(ota_metadata_t* meta) {
    // Mark the update partition's image as invalid
    uint32_t update_addr = ota_get_partition_addr(meta->update_partition);
    flash_erase_page(update_addr);  // Erase the bad image
    
    meta->state = OTA_STATE_REJECTED;
    meta->boot_attempt_count = 0;
    ota_metadata_save(meta);
}
```

### Application-Side OTA API

```c
// Application calls these functions to participate in the OTA state machine:

// Call AFTER the application has booted successfully and passed self-test.
// If this is never called, the bootloader will eventually roll back.
void ota_confirm_image(void) {
    ota_metadata_t* meta = ota_metadata_load();
    if (meta->state == OTA_STATE_PENDING_VERIFY) {
        meta->state = OTA_STATE_ACCEPTED;
        meta->boot_attempt_count = 0;
        ota_metadata_save(meta);
        LOG_INFO("OTA image confirmed — will be set as active on next boot");
    }
}

// Application self-test:
void app_self_test(void) {
    // Test critical hardware: sensors, radio, storage
    if (sensor_self_test() != OK) goto fail;
    if (radio_self_test() != OK) goto fail;
    if (storage_self_test() != OK) goto fail;
    
    // All tests passed — confirm the image
    ota_confirm_image();
    return;
    
fail:
    // Don't call ota_confirm_image — watchdog will reset,
    // bootloader will see PENDING_VERIFY + increment attempt count,
    // eventually roll back.
    LOG_ERROR("Self-test failed — waiting for watchdog reset");
    while (1);  // Let watchdog fire
}
```

## Bootloader-Application Handoff Protocol

```c
// The bootloader must leave the system in a clean state before
// jumping to the application. This is the most bug-prone step.

typedef struct {
    uint32_t bootloader_version;
    uint32_t reset_reason;
    uint32_t boot_flags;         // e.g., BOOT_FLAG_RECOVERY, BOOT_FLAG_OTA_PENDING
    uint32_t active_partition;
    uint32_t fallback_partition;  // In case app wants to trigger a rollback
    uint32_t crc32;
} shared_boot_info_t;

// Placed at a fixed address in RAM that survives a soft reset but
// not a power cycle. Used to pass info between bootloader and app.

__attribute__((noreturn)) void bootloader_jump_to_app(uint32_t app_addr) {
    const image_header_t* header = (const image_header_t*)app_addr;
    
    // 1. Validate image one final time
    if (bootloader_validate_image(app_addr) != IMAGE_VALID_OK) {
        // Don't jump to invalid image — enter DFU/recovery mode instead
        bootloader_enter_dfu();
        // dfu should never return
        while (1);
    }
    
    // 2. Disable ALL interrupts
    __disable_irq();
    
    // 3. Clear all pending interrupts
    for (int i = 0; i < 8; i++) {
        NVIC->ICER[i] = 0xFFFFFFFF;
    }
    
    // 4. Reset all peripherals to default state
    //    The application expects a clean slate.
    //    At minimum, disable DMA, reset systick, clear clock enables
    SysTick->CTRL = 0;
    SysTick->LOAD = 0;
    SysTick->VAL = 0;
    
    // 5. Set the vector table offset (VTOR) for the application
    SCB->VTOR = app_addr;
    __DSB();
    __ISB();
    
    // 6. Set the MSP to the application's initial stack pointer
    //    First word of vector table is the initial SP value
    uint32_t app_sp = ((uint32_t*)app_addr)[0];
    __set_MSP(app_sp);
    
    // 7. Jump to application reset handler
    //    Second word of vector table is the reset handler address
    uint32_t app_reset_handler = ((uint32_t*)app_addr)[1];
    
    // Function pointer cast: jump to the application's reset handler
    void (*app_entry)(void) = (void (*)(void))app_reset_handler;
    
    // Ensure the address has bit 0 set (Thumb mode on Cortex-M)
    if ((app_reset_handler & 1) == 0) {
        // This should never happen for a correctly built app
        LOG_ERROR("Application entry point does not have Thumb bit set!");
        bootloader_enter_dfu();
        while (1);
    }
    
    // 8. Go!
    app_entry();
    
    // Should never reach here
    while (1);
}
```

## Brick-Proof Design Patterns

### Pattern 1: Bootloader Never Erases Itself

```
The bootloader flash region MUST be write-protected:
- MPU or flash controller write-protect the bootloader pages
- If a corrupt OTA image tries to overwrite the bootloader → flash error → bootloader catches it
- Even if the application goes rogue, the bootloader survives
```

### Pattern 2: Watchdog from Power-On

```c
// Enable the watchdog in the bootloader BEFORE any flash operations.
// If an erase or write hangs, the watchdog resets and the bootloader
// retries (or falls back to the known-good image).

void bootloader_init_watchdog(void) {
    // Configure independent watchdog (IWDG) — separate clock from system
    // Short timeout during bootloader: ~5 seconds
    IWDG->KR = 0x5555;   // Enable register access
    IWDG->PR = 0x04;     // Prescaler: ~1 second at LSI=32kHz (check your LSI freq)
    IWDG->RLR = 0x0FFF;  // Reload value: ~5 seconds
    IWDG->KR = 0xCCCC;   // Start watchdog
    IWDG->KR = 0xAAAA;   // Refresh
}

// Before every flash erase/write operation:
//   IWDG->KR = 0xAAAA;  // Pet the watchdog
// Flash operations can take 10s of milliseconds per page — keep petting.
```

### Pattern 3: Power-Loss Safe Writes

```c
// Flash writes must survive power loss at any point.
// Strategy: write metadata LAST, after all data is verified.

ota_err_t ota_write_chunk(uint32_t offset, const uint8_t* data, size_t len) {
    ota_metadata_t* meta = ota_metadata_load();
    
    // 1. Write data to flash first
    for (size_t i = 0; i < len; i += FLASH_PAGE_SIZE) {
        size_t chunk = min(FLASH_PAGE_SIZE, len - i);
        IWDG->KR = 0xAAAA;  // Pet watchdog
        flash_write_page(meta->update_partition_addr + offset + i,
                         &data[i], chunk);
    }
    
    // 2. Update bytes_received
    meta->bytes_received += len;
    
    // 3. DON'T mark DOWNLOAD_COMPLETE yet — verify CRC first
    ota_metadata_save(meta);
    
    return OTA_OK;
}

// Only mark download complete AFTER full CRC verification:
ota_err_t ota_finish_download(void) {
    ota_metadata_t* meta = ota_metadata_load();
    
    // Verify the full image CRC
    const image_header_t* header = (const image_header_t*)meta->update_partition_addr;
    uint32_t computed = crc32_calculate(meta->update_partition_addr, 
                                         header->code_size,
                                         offsetof(image_header_t, crc32));
    if (computed != header->crc32) {
        LOG_ERROR("Download CRC mismatch — image corrupted");
        flash_erase_pages(meta->update_partition_addr, meta->total_bytes);
        meta->state = OTA_STATE_IDLE;
        ota_metadata_save(meta);
        return OTA_ERR_CRC;
    }
    
    // CRC passes — NOW mark download complete
    meta->state = OTA_STATE_DOWNLOAD_COMPLETE;
    ota_metadata_save(meta);
    
    // Reboot to try the new image
    NVIC_SystemReset();
    
    return OTA_OK;  // Never reached
}
```

### Pattern 4: Three-Finger Salute (Forced Recovery)

```c
// If all else fails, the user must be able to force recovery mode.
// Options: hold a button during boot, short two test points, send a
// magic sequence over UART.

void bootloader_check_recovery_mode(void) {
    // Method 1: GPIO button held at boot
    gpio_init(BOOT_BUTTON_PIN, GPIO_MODE_INPUT_PULLUP);
    rtos_delay_ms(10);  // Debounce
    if (gpio_read(BOOT_BUTTON_PIN) == GPIO_LOW) {
        LOG_INFO("Recovery button held — entering DFU mode");
        bootloader_enter_dfu();
    }
    
    // Method 2: Magic byte on UART within 500ms of boot
    uart_init(DEBUG_UART, 115200);
    uint32_t start = system_tick_ms();
    while (system_tick_ms() - start < 500) {
        if (uart_byte_available(DEBUG_UART)) {
            uint8_t byte = uart_read(DEBUG_UART);
            if (byte == 0x7F) {  // Magic byte
                LOG_INFO("Magic byte received — entering DFU mode");
                bootloader_enter_dfu();
            }
        }
    }
    
    // Method 3: Check if both application images are invalid
    if (bootloader_validate_image(APP_PARTITION_A_ADDR) != IMAGE_VALID_OK &&
        bootloader_validate_image(APP_PARTITION_B_ADDR) != IMAGE_VALID_OK) {
        LOG_WARN("No valid application image found — entering DFU mode");
        bootloader_enter_dfu();
    }
}
```

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll just use the vendor bootloader" | Vendor bootloaders are generic. They don't know about your A/B partitions, your OTA state machine, or your anti-rollback policy. They don't watch your watchdog. Use them as a reference, not as-is. |
| "CRC is enough, I don't need signatures" | CRC protects against accidental corruption (flash bit flips). It does NOT protect against malicious firmware. If your device has any connectivity (BLE, WiFi, UART), anyone can flash their own firmware if you only check CRC. |
| "The bootloader is small, I'll test it later" | The bootloader has the highest blast radius. A bootloader bug bricks every device in the field. Test it more thoroughly than your application. |
| "A/B partition wastes half my flash" | The wasted flash is insurance against bricking. Compare: 256KB wasted vs. entire fleet bricked by a bad OTA. The insurance is cheap. If you absolutely can't spare the space, use a minimal recovery image instead of full A/B. |
| "I'll write the metadata after the flash write completes" | What about power loss during the metadata write? Write data first, then metadata. If power is lost after data is written but before metadata is updated, the old metadata points to the old image — safe. |
| "I'll put the bootloader in RAM during OTA" | RAM-based bootloaders are lost on power cycle. If power fails during update, RAM is gone and so is the bootloader. Flash-based bootloader is the only recovery-safe approach. |

## Red Flags

- Bootloader and application share the same flash page (erasing app data can corrupt bootloader)
- No watchdog enabled during flash erase/write operations
- OTA metadata stored in the same flash sector as the image being updated (erased during update → brick)
- Bootloader jumps to application without disabling interrupts first
- No anti-rollback protection — old vulnerable firmware can be re-flashed
- Bootloader trusts the image header without verifying it's not all 0xFF (erased flash)
- Recovery/DFU mode only accessible via software command (if app is broken, you can't get to DFU)
- Magic byte recovery trigger accepts any byte sequence without timeout
- Flash write functions don't verify after write (read-back and compare)
- OTA download resumes without re-validating previously written chunks

## Verification

After designing the bootloader:

- [ ] Bootloader validates image before jumping; rejects corrupt images and falls back
- [ ] Power-loss during flash write: power cycle mid-update, verify bootloader recovers correctly
- [ ] Power-loss during metadata write: power cycle mid-metadata, verify system boots last-known-good image
- [ ] A/B rollback test: flash bad image to partition B, set PENDING_VERIFY, reboot 3+ times, verify fallback to A
- [ ] Application self-test: inject a failure, verify app does NOT call ota_confirm_image, watchdog triggers, bootloader rolls back
- [ ] Watchdog fires during flash erase → bootloader recovers and retries or falls back
- [ ] Recovery mode accessible: hold button at boot, verify DFU mode activates
- [ ] Factory reset: erase both partitions, verify bootloader enters DFU and accepts new firmware
- [ ] Secure boot: sign image with valid key → boots; tamper with one byte → signature check fails, image rejected
- [ ] Bootloader itself is write-protected: attempt to overwrite bootloader region → flash error, bootloader unharmed
- [ ] Bootloader region CRC check: if bootloader flash is corrupt, enter failsafe DFU mode (requires 2nd-stage recovery bootloader)
- [ ] Interrupt hygiene: app boots and all peripherals work correctly (no stale interrupts from bootloader)

## After This Skill

Once bootloader design is verified:

| Next Step | Skill | What It Produces |
|-----------|-------|-----------------|
| Secure boot key management | `security-and-hardening` | Key generation, OTP programming, signing infrastructure |
| Memory protection for bootloader | `memory-protection` | MPU write-protect bootloader region, TrustZone split |
| Failsafe recovery | `board-bringup` | Hardware recovery pin, serial recovery protocol |
| OTA transport | `api-and-interface-design` | Firmware update protocol over BLE/WiFi/UART |
| System integration | `software-architecture-design` | Bootloader as a firmware architecture component |
