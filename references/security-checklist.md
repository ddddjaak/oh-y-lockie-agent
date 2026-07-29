# Embedded Security Checklist

Quick reference for embedded firmware security verification. Use alongside `security-and-hardening`.

## Boot and Firmware Integrity

- [ ] Secure boot chain active (every stage verifies the next)
- [ ] All firmware images signed with production signing key
- [ ] Anti-rollback version counter in eFuse/OTP
- [ ] A/B partition scheme tested (update + rollback)
- [ ] Firmware encryption enabled if IP protection is required

## Debug and Physical Access

- [ ] JTAG/SWD locked for production (Level 1 minimum)
- [ ] Debug authentication configured if supported by MCU
- [ ] UART debug console disabled or authenticated in production build
- [ ] Sensitive test points not exposed on production PCB

## Wireless Security

- [ ] BLE uses LE Secure Connections (not Legacy Pairing)
- [ ] Device I/O capabilities set honestly
- [ ] BLE pairing attempts rate-limited
- [ ] LTK stored in secure element or encrypted flash
- [ ] GATT characteristics have appropriate read/write permissions

## Key Management

- [ ] No hardcoded keys in source code or git history
- [ ] Production keys different from development keys
- [ ] Per-device unique keys (not a global default)
- [ ] Keys stored in secure element, eFuse, or TrustZone
- [ ] Sensitive data zeroized after use (volatile pointer to prevent compiler DSE)

## Memory Protection

- [ ] MPU configured with W^X policy
- [ ] Guard regions between memory sections
- [ ] Application code cannot access bootloader region
- [ ] MemManage fault handler implemented and tested
- [ ] `-fstack-protector-strong` enabled in production build

## OTA Security

- [ ] Update server connection over TLS 1.2+ (mbedTLS/wolfSSL)
- [ ] Firmware signature verified before flash write
- [ ] Image integrity checked after download and after flash
- [ ] Version anti-rollback enforced
- [ ] Confirmation mechanism before committing new image

## Build and Toolchain

- [ ] Production build uses `-Os` (not `-O0`)
- [ ] Static analysis (cppcheck/MISRA-C) runs in CI
- [ ] No compiler warnings in production build
- [ ] Third-party library versions pinned and audited
- [ ] Debug info stripped or minimal in release binary

## Pre-Release Negative Tests

- [ ] Debug probe connection → rejected (JTAG lock confirmed)
- [ ] Flash unsigned image → bootloader rejects it
- [ ] Flash older version → anti-rollback rejects it
- [ ] MPU violation → fault handler fires correctly
- [ ] `grep -r "key\|secret\|password" src/` → clean
- [ ] No engineering backdoor commands in production build
