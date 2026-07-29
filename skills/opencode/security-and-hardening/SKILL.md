---
name: security-and-hardening
description: Hardens embedded firmware against attacks. Use when implementing secure boot, firmware signing, debug port locking, wireless security, or handling secrets on an MCU. Use when building any feature that stores credentials, communicates over BLE/Wi-Fi, accepts OTA updates, or runs on a device an attacker can physically access.
---

# Embedded Security and Hardening

## Overview

Security-first development practices for embedded systems. Treat every external input as hostile, every secret as hardware-protected, every debug port as an attack surface, and every OTA update as a potential compromise vector. Security isn't a phase — it's a constraint on every line of firmware that stores credentials, communicates wirelessly, or runs on a device an attacker can physically possess.

Unlike server-side security, embedded security must account for **physical access**: an attacker can probe buses, desolder flash chips, attach a debugger, or sniff wireless traffic from across the room. Assume they will.

## When to Use

- Implementing secure boot or verified boot chains
- Signing or encrypting firmware images
- Locking debug ports (JTAG/SWD) for production
- Storing keys or credentials on an MCU
- Implementing BLE or Wi-Fi security (pairing, encryption)
- Designing OTA update mechanisms
- Using Memory Protection Unit (MPU) or TrustZone
- Handling sensor data that must be tamper-proof
- Working with any device that leaves your physical control

## The Three-Tier Boundary System

### Always Do (No Exceptions)

- **Lock debug ports in production firmware** — JTAG/SWD must be disabled or password-protected before shipping
- **Sign all firmware images** — never accept unsigned or unverified firmware via OTA or bootloader
- **Validate all external input at system boundaries** — UART, BLE, SPI slave, CAN bus data is untrusted
- **Use hardware crypto where available** — AES accelerators, TRNG, secure key storage (eFuse, secure element)
- **Enable MPU/TrustZone** — isolate critical code and secrets from application code
- **Zeroize sensitive data** after use — keys, PINs, temporary buffers must be cleared, not just freed
- **Use compile-time stack protection** — `-fstack-protector-strong` for GCC/Clang
- **Run static analysis** — MISRA-C checks, Coverity, or cppcheck on every build

### Ask First (Requires Human Approval)

- Changing secure boot keys or the root of trust
- Modifying OTA update protocol or rollback protection
- Adding new wireless communication channels
- Changing debug authentication or unlock procedures
- Storing new categories of sensitive data on the device
- Modifying MPU region configurations
- Adding third-party library dependencies (they become part of your attack surface)
- Disabling or relaxing any Always-Do rule for production

### Never Do

- **Never ship production firmware with debug ports enabled** — an unlocked JTAG gives full memory access
- **Never hardcode keys or credentials in source code** — they will end up in git history and binary strings output
- **Never use a global default key across devices** — every shipped device must have unique keys
- **Never implement your own crypto algorithm** — use proven libraries (mbedTLS, wolfSSL, TinyCrypt)
- **Never accept OTA updates over an unauthenticated channel** — no TLS = no OTA
- **Never leave sensitive data in RAM across reboots** — RAM may survive warm resets and be readable
- **Never trust the UART debug console in production** — disable or authenticate it
- **Never expose stack traces, register dumps, or memory addresses** in error output that reaches users or logs

## Secure Boot Chain

A secure boot chain establishes trust from the first instruction executed after reset:

```
ROM Bootloader (immutable, in mask ROM or locked flash)
    │  Verifies signature of...
    ▼
First-Stage Bootloader (minimal, signed)
    │  Verifies signature of...
    ▼
Application Firmware (signed, possibly encrypted)
    │  Initializes MPU, locks debug, starts RTOS
    ▼
Running System
```

### Implementation Checklist

```c
// Secure boot must verify:
// 1. Image signature (RSA-2048/3072 or ECDSA P-256)
// 2. Image version (anti-rollback — monotonic counter in eFuse/OTP)
// 3. Image integrity (hash over the entire image)
// 4. Image authenticity (signed by a trusted key)

// FAIL CLOSED: if any check fails, halt; do not fall through to the image
```

**Key decisions:**
- Where does the root of trust live? (ROM, eFuse, secure element)
- What signing algorithm? ECDSA P-256 is preferred for MCUs (smaller keys, faster than RSA)
- Is firmware encrypted or only signed? (IP protection requires encryption; integrity only requires signing)
- What anti-rollback mechanism? (eFuse monotonic counter, external secure element counter)

## Debug Port Security

JTAG and SWD give an attacker complete memory access and execution control. Lock them.

### Debug Lock Levels

| Level | Debug Access | Unlock Mechanism | When to Use |
|-------|-------------|-----------------|-------------|
| **Level 0** | Full debug | None | Development only |
| **Level 1** | No debug (flash locked) | Mass erase + unlock | Production: allows RMA with data destruction |
| **Level 2** | Permanent lock | None (fuse blown) | High-security: device is permanently locked |

### Debug Authentication (Newer MCUs)

```c
// Some MCUs (e.g., STM32H5/H7RS, NXP LPC55Sxx) support authenticated debug:
// - Debug port is locked but can be unlocked with a signed challenge
// - SOC generates a random challenge → you sign it with your private key
// - MCU verifies the signature against a stored public key hash
// - Unlock is temporary and auditable

// Pattern:
// 1. Device provides a random challenge via debug mailbox
// 2. Authorized engineer signs the challenge with the team private key
// 3. Device verifies signature against the key hash stored in eFuse
// 4. Debug port unlocks for this power cycle only
```

**Red flag:** A global "debug password" shared across all devices. If one leaks, every device in the field is compromised. Use per-device or per-batch keys with authenticated debug.

## Firmware Signing and Verification

### At Build Time (on the CI server)

```bash
# Generate signing keys (once, store private key in HSM or secure CI secret store)
openssl ecparam -genkey -name prime256v1 -out private_key.pem
openssl ec -in private_key.pem -pubout -out public_key.pem

# Sign the firmware binary directly with SHA-256 + ECDSA
openssl dgst -sha256 -sign private_key.pem -out firmware.sig firmware.bin

# The public key hash (not the full key) is embedded in the bootloader
# To verify on the device: compute SHA-256 of firmware.bin, then
# verify the signature against the embedded public key using ECDSA verify
```

### At Boot Time (on the device)

```c
// Pseudocode for bootloader verification
int verify_firmware(uint32_t image_addr, uint32_t image_size) {
    // 1. Check anti-rollback version
    uint32_t image_version = read_version_from_image(image_addr);
    uint32_t min_version = read_min_version_from_otp();
    if (image_version < min_version) {
        return ERR_ROLLBACK;  // Reject downgrade attack
    }
    
    // 2. Verify signature
    uint8_t hash[32];
    sha256((uint8_t*)image_addr, image_size, hash);
    
    int ret = ecdsa_verify(
        embedded_public_key,
        hash, sizeof(hash),
        read_signature_from_image(image_addr)
    );
    if (ret != 0) {
        return ERR_SIGNATURE;  // Tampered or corrupted image
    }
    
    // 3. (Optional) Decrypt if firmware is encrypted
    // aes_gcm_decrypt(...)
    
    return 0;
}
```

## BLE / Bluetooth Security

### Pairing Methods (from strongest to weakest)

| Method | Protection | When to Use |
|--------|-----------|-------------|
| **LE Secure Connections + Numeric Comparison** | MITM protection, ECDH key exchange | Devices with displays (display a 6-digit code for user confirmation) |
| **LE Secure Connections + Passkey Entry** | MITM protection | Devices with keypads (user enters a fixed passkey) |
| **LE Secure Connections + Just Works** | No MITM protection | Low-security, convenience pairing (be explicit about this trade-off) |
| **LE Legacy Pairing** | Weak key exchange, known attacks exist | Never for new designs |

### Firmware Checklist

```c
// BLE security must-haves in firmware:
// - Use LE Secure Connections only (BLE 4.2+), disable Legacy Pairing
// - Set I/O capabilities honestly (display? keyboard? none?) — 
//   misrepresenting capabilities downgrades security silently
// - Bond keys stored in secure storage, not in plaintext flash
// - Authenticate GATT characteristics — don't allow unpaired reads of
//   sensitive data or writes to control characteristics
// - Set GATT permissions: read/write need encryption/authorization as appropriate
// - Rate-limit pairing attempts (prevent brute-force PIN)
// - Implement connection parameter validation (reject unreasonable intervals)
```

### Common BLE Mistakes

- **Leaving the LTK (Long Term Key) in plaintext flash** — use secure key storage
- **Allowing unauthenticated GATT writes to control characteristics** — an attacker in radio range can toggle your device
- **Using "Just Works" when you have a display** — always use the strongest pairing your hardware supports
- **Not validating connection parameters** — extreme values can crash the BLE stack or lock up the radio

## MPU and Memory Isolation

The Memory Protection Unit (MPU) is your last line of defense when application code is compromised:

```
Memory map with MPU regions:
┌─────────────────────┐ 0xFFFFFFFF (system control space)
│ Privileged only     │ ← ISR vectors, system calls
├─────────────────────┤
│ Peripheral space    │ ← 0x40000000+ — only grant access to needed peripherals
├─────────────────────┤
│ Read-only data      │ ← Firmware image, keys (read-once)
├─────────────────────┤
│ Read-write data     │ ← Heap, .bss, .data (0x20000000+)
├─────────────────────┤
│ Executable code     │ ← .text (0x08000000+, execute-only if supported)
├─────────────────────┤
│ No-access guard     │ ← Gap between regions
└─────────────────────┘ 0x00000000 (start of code flash)
```

```c
// MPU configuration principles:
// 1. Default: no access. Explicitly grant what's needed.
// 2. Separate code (RX) from data (RW) — W^X policy: a region is 
//    either writable or executable, never both
// 3. Guard gaps between regions — catch buffer overflows
// 4. Application code does NOT get access to:
//    - Bootloader flash region
//    - Key storage
//    - Security-critical peripherals (CRP, option bytes)
// 5. ISR vectors in read-only privileged region
```

**Test that your MPU works:** Write a test that intentionally violates a region boundary and confirm it triggers a MemManage fault. An unconfigured or misconfigured MPU provides no protection.

## Secure Key Storage on MCUs

| Method | Security Level | Notes |
|--------|---------------|-------|
| **Secure Element** (ATECC608, SE050) | Highest | Tamper-resistant, hardware key storage, ECDH on-chip |
| **eFuse / OTP** | High | One-time programmable, physically hard to extract |
| **TrustZone / Secure Enclave** (Cortex-M23/M33) | High | Secure world separate from normal world |
| **PUF (Physically Unclonable Function)** | High | Keys derived from silicon variation, not stored |
| **Encrypted flash + unique device key** | Medium | Key in eFuse decrypts flash region |
| **Plaintext flash** | Low | Extractable via debugger, flash dump, or chip decap |

**The rule:** a key stored in plaintext flash on an unlocked device is not a secret. If your threat model includes physical access, you need hardware key storage.

```c
// Don't do this — strings live in flash and are extractable
static const uint8_t aes_key[16] = {0xAB, 0xCD, ...};

// Instead: use a secure element or key derivation
// Keys derived at runtime from a device-unique secret + hardware TRNG
```

## OTA Update Security

Secure boot is the foundation. OTA is the delivery mechanism — secure both.

```
OTA Security Requirements:
1. AUTHENTICATED CHANNEL — TLS 1.2+ (mbedTLS/wolfSSL) to the update server
2. IMAGE AUTHENTICATION — Signature verified before writing to flash
3. ANTI-ROLLBACK — Monotonic version counter, reject older versions
4. ATOMIC UPDATE — A/B partition scheme so a failed update doesn't brick the device
5. INTEGRITY — Check image hash after download and after flash write
6. CONFIRMATION — New image must confirm successful boot before being marked "good"
```

### A/B Partition Rollback

```
Flash layout:
┌──────────────┐
│  Bootloader  │ ← Immutable (or rarely updated, signed)
├──────────────┤
│  App Slot A  │ ← Currently running (or fallback)
├──────────────┤
│  App Slot B  │ ← New image downloaded here
├──────────────┤
│  Swap/Status │ ← Metadata: which slot is active, version, flags
├──────────────┤
│  User Data   │ ← Preserved across updates
└──────────────┘

Update flow:
1. Download new image to Slot B (the inactive slot)
2. Verify signature of image in Slot B
3. Set "pending" flag in status area
4. Reboot → Bootloader sees pending flag
5. Bootloader verifies Slot B signature again + checks version
6. If valid: swap active slot, boot Slot B
7. New firmware confirms successful boot → commit
8. If boot fails (watchdog timeout, assert): bootloader reverts to Slot A
```

## Side-Channel Awareness (Basic)

For most AE applications, side-channel is a concern, not a primary threat. Be aware:

- **Timing attacks on crypto:** Use constant-time comparison for key/material checks (`memcmp` is NOT constant-time on most implementations). mbedTLS and wolfSSL provide constant-time functions — use them.
- **Power analysis (SPA/DPA):** If your device handles high-value keys (payment, access control), a secure element is the right answer. Software countermeasures are brittle.
- **Fault injection (glitching):** Clock or voltage glitching can bypass security checks. Hardware security features (internal voltage monitoring, clock integrity checks) handle this; software cannot.

**When to escalate:** If your device processes payments, controls physical access, or stores credentials worth more than the device itself, bring in a hardware security specialist. Software security cannot fully mitigate physical attacks.

## Security Review Checklist

```markdown
### Boot and Firmware Integrity
- [ ] Secure boot chain verified (every stage signs the next)
- [ ] Anti-rollback counter in OTP/eFuse
- [ ] A/B partition with atomic update and revert
- [ ] Firmware signature verified before boot, not just before flash write

### Debug and Physical Access
- [ ] JTAG/SWD locked for production (Level 1 minimum)
- [ ] Debug authentication configured (if supported by MCU)
- [ ] UART debug console disabled or authenticated in production
- [ ] Sensitive pins not exposed on PCB/test points unnecessarily

### Wireless Security
- [ ] BLE uses LE Secure Connections, not Legacy Pairing
- [ ] GATT characteristics have appropriate read/write permissions
- [ ] Pairing attempts rate-limited
- [ ] LTK stored in secure key storage, not plaintext flash

### Key Management
- [ ] No hardcoded keys in source code or git history
- [ ] Per-device unique keys (not a global default)
- [ ] Keys stored in secure element, eFuse, or TrustZone (not plaintext flash)
- [ ] Sensitive buffers zeroized after use

### Memory Protection
- [ ] MPU configured with W^X policy
- [ ] Guard regions between memory sections
- [ ] Application code cannot access bootloader or key storage
- [ ] MemManage fault handler implemented and tested

### OTA Security
- [ ] Update server connection over TLS 1.2+
- [ ] Image signature verified before flash write
- [ ] Version anti-rollback enforced
- [ ] Confirmation mechanism before committing new image

### Build and Toolchain
- [ ] `-fstack-protector-strong` enabled
- [ ] MISRA-C or equivalent static analysis running in CI
- [ ] No compiler warnings in production build
- [ ] Third-party library dependencies audited and version-pinned
```

## See Also

For debugging firmware crashes that may be security-related, see `embedded-debugging`. For build-time security flags, see `embedded-build-and-toolchain`.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "Nobody will physically attack our device" | Physical access attacks are the most common embedded attack vector. Clones, grey-market repair, and firmware extraction happen routinely. |
| "We'll lock the debug port later" | "Later" means a separate firmware build, a separate test cycle, and risk of shipping unlocked units. Lock from first production build. |
| "Just Works pairing is fine for our product" | "Just Works" provides zero MITM protection. Anyone in radio range can intercept. If your device controls anything valuable, use Numeric Comparison or Passkey. |
| "Our firmware is proprietary, nobody can reverse it" | A $50 debug probe and Ghidra can disassemble your firmware in minutes. Security through obscurity is not security. |
| "We don't need secure boot, the flash is internal" | Internal flash can be read via debug port, glitching, or chip decap. Secure boot + debug lock is defense in depth. |
| "The crypto library handles timing attacks" | Not all do by default. Verify constant-time guarantees for the functions you call. |
| "MPU configuration is too complex for this project" | An unconfigured MPU means any code can access any memory. Even 2-3 regions (code RX, data RW, no-access guard) significantly raises the bar. |

## Red Flags

- Debug ports enabled on production firmware builds
- Global default keys or hardcoded keys in source code
- OTA updates over plaintext HTTP (no TLS) or without signature verification
- BLE Legacy Pairing in a new design
- No anti-rollback mechanism for firmware updates
- MPU disabled or unconfigured
- Sensitive data (keys, PINs) not zeroized after use
- Production firmware built without `-fstack-protector-strong`
- Using "Just Works" pairing when the hardware supports a display or keypad
- Crypto algorithms implemented in-house rather than using mbedTLS/wolfSSL
- No static analysis (MISRA-C, cppcheck) in CI pipeline

## Verification

After implementing security-critical firmware:

- [ ] Production firmware build has debug ports locked (verify by attempting to connect with a debug probe)
- [ ] Secure boot rejects an unsigned or incorrectly signed image (negative test)
- [ ] Anti-rollback rejects an older firmware version (negative test)
- [ ] MPU MemManage fault fires when a violating access is attempted (negative test)
- [ ] BLE pairing uses LE Secure Connections (verify with a BLE sniffer or nRF Connect)
- [ ] No hardcoded keys, passwords, or tokens in source code (`grep -r "key\|secret\|password" --include="*.c" --include="*.h"`)
- [ ] `-fstack-protector-strong` in compile flags for production build
- [ ] Static analysis passes with zero high-severity findings
- [ ] OTA update rejects an image with invalid signature (negative test)
- [ ] Sensitive buffers zeroized and not readable after free (verify with a memory dump if possible)
