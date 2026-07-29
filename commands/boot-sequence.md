---
description: 启动序列设计：Boot ROM行为、Bootloader架构、安全启动链、固件验证、回退策略
agent: build
---
# /boot-sequence — Boot Sequence Designer

## Overview

Designs a complete boot sequence for an embedded MCU/SoC: boot ROM behavior analysis, bootloader architecture (primary + secondary), secure boot chain definition, firmware image verification, and rollback / fallback strategy. Delegates analysis and design to the `@boot-bringup-specialist` agent.

## Usage

```
/boot-sequence <mcu-part-number> <--datasheet path> <--rm path> [--secure-boot] [--ota]
```

## Workflow

### Phase 1 — Gather Boot Requirements
Collect from the user or workspace:
- MCU/SoC datasheet: Boot chapter (boot pins, boot ROM behavior, option bytes, boot sources)
- Reference manual: Flash controller, system configuration, option byte programming
- Boot source(s): internal flash, external QSPI flash, SD/eMMC, USB DFU, UART ISP
- Security requirements: secure boot (yes/no), image signing (ECDSA/RSA), encrypted images, anti-rollback
- OTA requirements: single-bank, dual-bank, A/B swap, external flash staging
- Boot time budget (maximum allowed from reset to application start)
- Bootloader size constraint (if sharing flash with application)
- Any required bootloader features: firmware verification, factory reset, recovery mode, debug unlock

### Phase 2 — Delegate to @boot-bringup-specialist
Spawn the specialist with all gathered requirements. The prompt must include:
- MCU boot system specifications from datasheet/reference manual
- Functional requirements: secure boot, OTA, recovery
- Timing and size constraints
- Specific deliverables:
  1. **Boot ROM Behavior Analysis** — what the hardware boot ROM does: boot pin sampling, option byte reading, initial SP/PC loading, any built-in bootloader (USB DFU, UART ISP), fallback paths
  2. **Bootloader Architecture** — block diagram: Boot ROM → Primary Bootloader → Secondary Bootloader → Application. State machine for each stage
  3. **Secure Boot Chain** (if applicable) — root of trust (boot ROM / eFuse key), image signing flow, verification at each stage, public key storage, signature format
  4. **Firmware Verification** — hash algorithm (SHA-256), signature verification (ECDSA-P256 or RSA-2048), what to verify (full image or critical sections only), verification failure behavior
  5. **Fallback / Rollback Strategy** — what happens if verification fails: fallback to previous image, enter recovery mode, brick? Anti-rollback counter management
  6. **Boot Flow Timing Budget** — breakdown: boot ROM → primary bootloader init → image verification → application jump, with target times for each stage

### Phase 3 — Verify Boot Chain Integrity
Cross-check the specialist output:
- The boot chain has no gaps — every transition is defined (Boot ROM → BL1, BL1 → BL2, BL2 → App)
- If secure boot is enabled, the root of trust is immutable (eFuse / OTP / ROM) — not stored in erasable flash
- Image verification covers the entire application image, including interrupt vector table
- The fallback strategy handles corrupt images gracefully: if the primary image fails, the secondary must boot
- The boot mode pin configuration matches the intended boot source
- Option byte programming sequence is documented and verified against the reference manual
- If OTA is supported, the bootloader must be capable of receiving, verifying, and flashing a new image while the application runs (or during a dedicated OTA mode)

### Phase 4 — Save Output
Save the boot sequence document to:
```
docs/boot/<mcu-part>-boot-sequence-<YYYY-MM-DD>.md
```

Include the boot flow state machine as a Mermaid diagram inline. Save the option byte configuration table as a separate appendix.

## Rules
1. Boot ROM behavior must be documented from the datasheet, not assumed. Different MCU families have different boot ROM behaviors.
2. The boot chain must be self-contained: no stage may depend on the application to be running.
3. If secure boot is used, the root of trust must be in immutable storage. A key in erasable flash that can be overwritten is not a root of trust.
4. Every boot stage must have a defined timeout and a defined failure mode. Undefined behavior on failure is a security and reliability gap.
5. Anti-rollback counters must be in OTP or write-protected flash regions. An erasable rollback counter defeats the purpose.
6. The interrupt vector table relocation (VTOR) must be configured at each stage boundary if the application uses its own vector table.
7. The bootloader must not rely on any application-initialized hardware (clocks, PLL, external memory). It must be self-sufficient.
8. If OTA is implemented, the bootloader must validate the new image BEFORE committing it as the active image. A corrupt OTA image that replaces a working one is a brick.
