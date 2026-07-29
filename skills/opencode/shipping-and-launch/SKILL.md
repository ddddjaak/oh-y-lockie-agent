---
name: shipping-and-launch
description: Prepares firmware releases and OTA deployments. Use when preparing to ship production firmware. Use when you need a pre-release checklist, setting up an OTA update pipeline, planning a staged firmware rollout, or preparing a rollback strategy for deployed devices.
---

# Firmware Release and OTA Deployments

## Overview

Ship firmware with confidence. The goal is not just to build a firmware image — it's to release it safely to devices in the field, with version tracking, a tested rollback mechanism, and clear visibility into what's running where. Every firmware release must be reversible, observable, and incremental.

In embedded systems, a bad firmware release bricks physical devices that require a truck roll (or a customer return) to recover. The cost of getting it wrong is materially higher than a server-side rollback.

## When to Use

- Shipping production firmware for the first time
- Releasing a firmware update to devices in the field
- Setting up an OTA (Over-the-Air) update pipeline
- Releasing a new hardware revision with firmware compatibility changes
- Migrating to a new bootloader or partition scheme
- Any firmware release that updates devices you can't physically touch

## The Pre-Release Checklist

### Firmware Quality

- [ ] All tests pass (host unit, HIL smoke test)
- [ ] Build succeeds for all supported targets with zero warnings
- [ ] Static analysis (cppcheck/MISRA-C) passes with no new findings
- [ ] Stack watermark test passes (≥ 30% headroom under worst-case load)
- [ ] Code reviewed and approved
- [ ] No debug-only code active in release build (`#ifdef DEBUG` blocks compiled out, debug UART disabled, `printf` stripped)
- [ ] Production build uses release optimization flags (`-Os`, not `-O0`/`-Og`)
- [ ] Version number embedded in firmware (readable via CLI/AT command)

### Security

- [ ] JTAG/SWD locked for production (attempt to connect with debug probe and confirm it's blocked)
- [ ] Debug UART disabled or authenticated
- [ ] Firmware image signed with release signing key
- [ ] Anti-rollback version counter set correctly
- [ ] No hardcoded keys, passwords, or test credentials in source
- [ ] Secure boot chain verified on production hardware (not just dev board)
- [ ] Production keys are different from development keys
- [ ] No engineering backdoors left in production build (hidden CLI commands, magic sequences)

### Stability

- [ ] 24-hour soak test passed (device running under normal load, no crashes, no watchdog resets)
- [ ] Power-cycle test passed (100 cycles, boots reliably every time)
- [ ] Brownout test passed (device recovers cleanly from power dips)
- [ ] Watchdog is enabled and tested (intentionally hang the system, confirm watchdog resets it)
- [ ] Memory leak test passed (heap free stable after 24h, or no heap used at all)
- [ ] BLE/Wi-Fi reconnection test passed (disconnect/reconnect loop, no persistent failures)

### Bootloader and OTA

- [ ] OTA update tested: download → verify → apply → reboot → confirm
- [ ] OTA rollback tested: simulate a bad image, confirm bootloader reverts to previous version
- [ ] A/B partition swap works correctly on the target hardware
- [ ] Firmware signature verification works on the bootloader side
- [ ] Bootloader fallback path tested (what happens if both slots are corrupted)

### Hardware Compatibility

- [ ] Tested on all hardware revisions that will receive this firmware
- [ ] Tested on both new and aged hardware (degraded flash, aged batteries)
- [ ] GPIO/pinmux configuration verified for production PCB (not just dev kit)
- [ ] Power consumption within spec under all operating modes

### Version Management

- [ ] Semantic version assigned (MAJOR.MINOR.PATCH)
- [ ] Hardware compatibility matrix updated (which FW version works on which HW rev)
- [ ] Changelog written (what changed, what's fixed, known issues)
- [ ] Previous release version archived and retrievable for rollback

## Firmware Version Management

### Semantic Versioning for Firmware

```
v2.1.3
│ │ │
│ │ └── PATCH: Bug fix, no new features. Safe to apply without
│ │            re-testing entire system. e.g., fix SPI timing bug.
│ │
│ ├──── MINOR: New feature, backward compatible. Requires testing.
│ │            e.g., add new sensor driver, new BLE service.
│ │
└────── MAJOR: Breaking change. New bootloader, new partition layout,
               incompatible config format. Devices on v1.x cannot OTA
               to v2.x without a migration path.
```

### Hardware Compatibility Matrix

```markdown
| Firmware | HW Rev A | HW Rev B | HW Rev C | Notes |
|----------|---------|---------|---------|-------|
| v2.1.x   | ✅      | ✅      | ✅      | Current release |
| v2.0.x   | ✅      | ✅      | ❌      | Rev C requires v2.1+ (new PMIC) |
| v1.x     | ✅      | ❌      | ❌      | Rev B/C require v2.0+ (new MCU variant) |

Rev A: Initial production (2024-Q3, nRF52840 QFN)
Rev B: MCU change to nRF52840 WLCSP (2025-Q1)
Rev C: PMIC changed to TPS63000 (2025-Q3)
```

**The compatibility matrix must be a living document** — updated with every release, committed alongside the firmware.

## OTA Update Strategy

### A/B Partition Scheme

```
Flash layout:
┌────────────────┐ 0x000000
│  Bootloader    │ 64KB  — Immutable factory bootloader (rarely updated)
├────────────────┤ 0x010000
│  App Slot A    │ 480KB — Currently active or fallback
├────────────────┤ 0x088000
│  App Slot B    │ 480KB — New image download target
├────────────────┤ 0x100000
│  Status Area   │ 4KB   — Active slot, versions, flags
├────────────────┤ 0x101000
│  NV Storage    │ 12KB — User data preserved across updates (adjust to your needs)
└────────────────┘
```

### Update Flow Decision Tree

```
OTA update received
    │
    ├── Is the firmware image signed by a trusted key?
    │   └── NO → Reject, log error, report to server
    │
    ├── Is the version > currently running version?
    │   └── NO → Reject (anti-rollback, unless explicit downgrade is authorized)
    │
    ├── Is this version compatible with this hardware revision?
    │   └── NO → Reject (wrong HW, could brick)
    │
    ├── Is the image hash correct after download?
    │   └── NO → Re-download (corrupted in transit)
    │
    └── All checks pass → Write to inactive slot
        │
        ├── Verify written image matches downloaded image
        │   └── FAIL → Mark slot bad, report error
        │
        └── Set "pending" flag → Schedule reboot
            │
            ├── Bootloader sees pending flag
            ├── Verifies image signature again (don't trust flash)
            ├── If valid: marks slot as active, boots new image
            └── If invalid: clears pending flag, boots previous image
```

### Bootloader Update Confirmation

```c
// Application must explicitly confirm successful boot
// If confirmation doesn't arrive within N seconds, bootloader reverts

void firmware_confirm(void) {
    // Called after: RTOS started, critical peripherals initialized,
    // basic self-test passed, BLE advertising started.
    
    bootloader_mark_image_valid();  // Write confirmation to status area
    
    LOG_INFO("Firmware v%d.%d.%d confirmed on HW Rev %c",
             FW_VERSION_MAJOR, FW_VERSION_MINOR, FW_VERSION_PATCH,
             hw_revision());
}

// Bootloader logic:
// if (pending_image_exists() && !image_confirmed_within(60_seconds)) {
//     revert_to_previous_image();
// }
```

### OTA Rollback Triggers

| Condition | Action |
|-----------|--------|
| Watchdog reset during first 60s of new image | Revert to previous slot |
| Image not confirmed within 60s (application hung before confirm) | Revert |
| Three consecutive boot failures (crash loop) | Revert and stay on previous |
| Explicit rollback command from cloud | Revert, notify user |

## Staged Rollout

Don't update the entire fleet at once:

```
1. INTERNAL TESTING
   └── Flash 5-10 devices in the engineering lab
   └── 48-hour monitoring window
   └── Check: crashes, power regression, BLE stability

2. BETA GROUP (1-5% of fleet)
   └── Push to opt-in beta testers or a small random cohort
   └── 72-hour monitoring window
   └── Monitor: crash rate, connection success rate, battery life reports
   └── Advance only if all thresholds pass (see below)

3. STAGED ROLLOUT (10% → 25% → 50% → 100%)
   └── Increase cohort size at each step
   └── 24-hour minimum between steps
   └── Ability to pause or roll back at any step

4. FULL ROLLOUT
   └── All devices updated
   └── Monitor for 1 week
   └── Clean up: remove OTA campaign, archive previous artifacts
```

### Rollout Decision Thresholds

| Metric | Advance (green) | Hold (yellow) | Roll back (red) |
|--------|-----------------|---------------|-----------------|
| Crash rate | Within baseline + 0.1% | 0.1-0.5% above baseline | >0.5% above baseline |
| BLE connection success | Within 1% of baseline | 1-5% below baseline | >5% below baseline |
| Battery life reports | No regression | <5% reduction reported | >5% reduction reported |
| OTA success rate | >98% | 95-98% | <95% |
| Support tickets | No spike | Slight increase | Significant spike |

## Production Firmware Signing

```bash
#!/bin/bash
# sign-release.sh — Production firmware signing (run only in secure CI environment)
set -euo pipefail

VERSION=$1
TARGET=$2
INPUT_BIN="build/${TARGET}/firmware.bin"
OUTPUT_DIR="releases/${VERSION}/${TARGET}"

mkdir -p "${OUTPUT_DIR}"

# 1. Generate version metadata
cat > "${OUTPUT_DIR}/manifest.json" <<EOF
{
  "version": "${VERSION}",
  "target": "${TARGET}",
  "hw_revisions": ["A", "B", "C"],
  "min_bootloader_version": "2.0",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "git_commit": "$(git rev-parse HEAD)"
}
EOF

# 2. Sign with production key (stored in HSM or CI secret)
openssl dgst -sha256 -sign "${SIGNING_KEY}" \
  -out "${OUTPUT_DIR}/firmware.sig" "${INPUT_BIN}"

# 3. Bundle: firmware + signature + manifest
cp "${INPUT_BIN}" "${OUTPUT_DIR}/firmware.bin"
cp "${OUTPUT_DIR}/manifest.json" "${OUTPUT_DIR}/"

# 4. Generate OTA package (application-specific)
# This might be a .zip, a proprietary format, or a raw concatenation
# depending on your OTA delivery mechanism
python3 tools/ota_packager.py \
  --firmware "${OUTPUT_DIR}/firmware.bin" \
  --signature "${OUTPUT_DIR}/firmware.sig" \
  --manifest "${OUTPUT_DIR}/manifest.json" \
  --output "${OUTPUT_DIR}/ota_package.bin"

# 5. Calculate checksums for verification
sha256sum "${OUTPUT_DIR}/firmware.bin" > "${OUTPUT_DIR}/checksums.txt"
sha256sum "${OUTPUT_DIR}/ota_package.bin" >> "${OUTPUT_DIR}/checksums.txt"

echo "Release ${VERSION} for ${TARGET} signed and packaged."
echo "Artifacts: ${OUTPUT_DIR}/"
```

## Rollback Plan Template

Every release needs a documented rollback plan before it ships:

```markdown
## Rollback Plan: Firmware v2.1.3 for nRF52840

### Trigger Conditions
- Crash rate exceeds 0.5% above baseline across the rollout cohort
- BLE connection success rate drops below 95%
- Battery life reports indicate >5% regression
- OTA success rate drops below 95%
- Any device bricking reports

### Rollback Steps
1. PAUSE OTA campaign in cloud console (stops new device updates immediately)
2. PUSH rollback command to already-updated devices:
   - Bootloader reverts to previous slot on next reboot
   - Previous firmware is already on device (A/B scheme)
   - No re-download needed
3. VERIFY: spot-check devices confirm reversion to v2.1.2
4. COMMUNICATE: notify internal team, update status page if customer-facing
5. INVESTIGATE: root-cause analysis before attempting re-release

### Time to Complete Rollback
- Campaign pause: < 1 minute (cloud console)
- Device reversion: device-dependent (next BLE connection, typically < 1 hour)
- Full fleet reversion: < 24 hours for always-connected devices

### Non-Recoverable Scenario
- If bootloader itself is corrupted: device requires physical re-flash via SWD
- Probability: extremely low (bootloader is rarely updated, signed separately)
- Mitigation: bootloader is in locked flash region, not writable by application
```

## Production Monitoring

### What to Monitor After Release

```
Device-side metrics (reported via BLE or cloud):
├── Crash count and type (HardFault, MemManage, BusFault, UsageFault, watchdog)
├── Boot count (excessive boots = crash loop)
├── OTA update success/failure rate
├── Last reset reason (power-on, watchdog, software, brownout, pin reset)
├── Stack high-water mark (is it close to the limit?)
├── Heap free (if using heap — is it stable?)
├── BLE disconnect reason (connection timeout, link loss, local termination)
├── Battery voltage under load (catching brownout-prone devices)
└── Firmware version running (fleet visibility)

Fleet-side metrics (cloud dashboard):
├── Active device count by firmware version
├── Crash rate by firmware version (is the new version crashing more?)
├── OTA campaign progress (% updated, % failed)
├── Average battery life by firmware version
└── Support ticket rate by firmware version
```

### Crash Telemetry Pattern

```c
// Store crash info in a no-init RAM region (survives warm reset)
// Report on next boot before clearing

typedef struct {
    uint32_t signature;      // Magic number to validate structure
    uint32_t reset_reason;   // MCU reset cause register
    uint32_t fault_type;     // HardFault, MemManage, etc.
    uint32_t fault_addr;     // Faulting address (if applicable)
    uint32_t pc;             // Program counter at fault
    uint32_t lr;             // Link register at fault
    uint32_t cfsr;           // Configurable Fault Status Register
    uint32_t hfsr;           // HardFault Status Register
    uint32_t ticks;          // System tick at fault
} crash_info_t;

// Place the variable in .noinit section so startup code does NOT zero it
crash_info_t crash_info __attribute__((section(".noinit")));

// Report on next boot:
void report_crash_on_boot(void) {
    if (crash_info.signature == CRASH_SIGNATURE) {
        LOG_ERROR("Previous reset was a crash: type=%lu, PC=0x%lx, LR=0x%lx",
                  crash_info.fault_type, crash_info.pc, crash_info.lr);
        // Queue for cloud reporting
        cloud_report_crash(&crash_info);
        // Clear for next boot — use volatile pointer to prevent compiler
        // from optimizing away the zeroization
        volatile uint32_t* p = (volatile uint32_t*)&crash_info;
        for (size_t i = 0; i < sizeof(crash_info) / sizeof(uint32_t); i++) {
            p[i] = 0;
        }
    }
}
```

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "It works on my dev kit, it'll work on all devices" | Production hardware has component variance, aging effects, and different PCB layouts. Test on production hardware. |
| "We don't need OTA, the firmware is final" | Firmware is never final. A bug found 6 months after launch is a recall if there's no OTA. OTA is insurance. |
| "We'll test the rollback path later" | If you haven't tested the rollback, you don't have a rollback. Test it on real hardware as part of the release process. |
| "The firmware is small, we don't need A/B partitions" | An in-place update that fails mid-write bricks the device. A/B partitioning prevents this. If flash is genuinely too small, document the risk explicitly. |
| "Version numbers are just for developers" | Support needs to know which firmware a customer is running. The device must report its version. |
| "Soak testing is overkill for a minor fix" | A "minor fix" can have unexpected interactions. A 24-hour soak catches memory leaks, slow crashes, and resource exhaustion that unit tests miss. |

## Red Flags

- Shipping firmware without testing the OTA update path on production hardware
- No documented rollback plan before release
- Production firmware signed with development keys
- Debug ports left unlocked on production build
- No version reporting mechanism in the firmware
- No crash telemetry or reset reason reporting
- Releasing to 100% of fleet without a staged rollout
- "It passed on my desk" as the only testing evidence
- No hardware compatibility matrix
- Friday afternoon releases (nobody monitors, nobody rolls back)

## Verification

Before releasing firmware:

- [ ] Pre-release checklist completed (all sections green)
- [ ] Firmware signed with production key and verified on target hardware
- [ ] OTA update tested end-to-end on production hardware
- [ ] OTA rollback (revert to previous version) tested and confirmed working
- [ ] 24-hour soak test passed with zero resets
- [ ] Rollback plan documented and accessible to the team
- [ ] Crash telemetry configured and reporting to cloud dashboard
- [ ] Staged rollout plan configured (1% → 10% → 50% → 100%)
- [ ] Hardware compatibility matrix updated
- [ ] Changelog written and committed

After releasing:

- [ ] Crash rate is within baseline (monitor for first 24 hours)
- [ ] OTA success rate > 98%
- [ ] No unexpected support ticket spike
- [ ] Battery life reports stable (if applicable)
- [ ] BLE/Wi-Fi connectivity stable (if applicable)
- [ ] Rollback mechanism verified ready (don't need it? test it anyway)
