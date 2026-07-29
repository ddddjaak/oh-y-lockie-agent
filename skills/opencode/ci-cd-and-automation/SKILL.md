---
name: ci-cd-and-automation
description: Automates embedded CI/CD pipelines. Use when setting up cross-compilation build matrices, automated firmware testing, HIL integration, or flashing pipelines. Use when you need to automate static analysis (cppcheck/MISRA-C), unit tests, or build artifact management for embedded projects.
---

# Embedded CI/CD and Automation

## Overview

Automate quality gates so that no firmware change reaches production without passing static analysis, host-based unit tests, cross-compilation for all targets, and HIL verification where applicable. CI/CD in embedded systems has unique challenges: cross-compilation toolchains, target-specific build flags, hardware-in-the-loop testing, and artifact management for firmware images.

**Shift Left:** Catch problems as early in the pipeline as possible. A bug caught in static analysis costs minutes; the same bug caught during HIL testing costs hours; the same bug shipped in production firmware costs a recall.

## When to Use

- Setting up a new embedded project's CI pipeline
- Adding automated static analysis or MISRA-C checks
- Configuring multi-target build matrices
- Automating firmware flashing or HIL testing
- Debugging CI failures in an embedded context
- Setting up firmware artifact storage and versioning

## The Embedded Quality Gate Pipeline

Every change goes through these gates before merge:

```
Pull Request Opened
    │
    ▼
┌─────────────────────────┐
│  STATIC ANALYSIS         │  cppcheck, MISRA-C, clang-tidy
│  ↓ pass                  │
│  HOST UNIT TESTS         │  Ceedling/Unity, CMock, CppUTest
│  ↓ pass                  │
│  CROSS-COMPILE MATRIX    │  arm-gcc → target-a, target-b, target-c
│  ↓ pass                  │
│  SIZE CHECK              │  flash/RAM budget enforcement
│  ↓ pass                  │
│  STACK ANALYSIS          │  Stack usage estimate (GCC -fstack-usage)
│  ↓ pass                  │
│  HIL TESTS (if available)│  Real hardware or QEMU/Renode simulator
│  ↓ pass                  │
│  FIRMWARE ARTIFACTS      │  Build .hex/.bin/.elf, sign, archive
└─────────────────────────┘
    │
    ▼
  Ready for review
```

**No gate can be skipped.** If static analysis fails, fix it — don't suppress the warning without a documented reason. If a target won't compile, fix it — don't drop the target from the matrix.

## GitHub Actions: Cross-Compilation Matrix

```yaml
name: Firmware CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  static-analysis:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install cppcheck
        run: sudo apt-get install -y cppcheck
      - name: Run cppcheck
        run: |
          cppcheck --enable=all --inconclusive --error-exitcode=1 \
            --suppressions-list=.cppcheck-suppress \
            src/ include/
      - name: MISRA-C check (optional, requires commercial tool or cppcheck addon)
        run: |
          # If using cppcheck MISRA addon:
          # cppcheck --addon=misra.json src/
          echo "MISRA-C check: configure your toolchain here"
  
  host-unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install Ruby (for Ceedling)
        run: sudo apt-get install -y ruby gcc
      - name: Install Ceedling
        run: gem install ceedling
      - name: Run unit tests
        run: |
          cd tests
          ceedling test:all
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-results
          path: tests/build/artifacts/**/results.xml
  
  cross-compile:
    needs: [static-analysis, host-unit-tests]
    runs-on: ubuntu-latest
    strategy:
      matrix:
        target:
          - name: nrf52840
            cpu: cortex-m4
            flags: -mcpu=cortex-m4 -mthumb -mfloat-abi=hard -mfpu=fpv4-sp-d16
            linker: nrf52840.ld
          - name: stm32f407
            cpu: cortex-m4
            flags: -mcpu=cortex-m4 -mthumb -mfloat-abi=hard -mfpu=fpv4-sp-d16
            linker: stm32f407.ld
          - name: stm32f103
            cpu: cortex-m3
            flags: -mcpu=cortex-m3 -mthumb
            linker: stm32f103.ld
          - name: rp2040
            cpu: cortex-m0plus
            flags: -mcpu=cortex-m0plus -mthumb
            linker: rp2040.ld
    
    steps:
      - uses: actions/checkout@v4
      - name: Install Arm GNU Toolchain
        run: |
          wget -q https://developer.arm.com/-/media/Files/downloads/gnu/13.2/binrel/arm-gnu-toolchain-13.2.rel1-x86_64-arm-none-eabi.tar.xz
          tar -xf arm-gnu-toolchain-*.tar.xz
          echo "$PWD/arm-gnu-toolchain-13.2.rel1-x86_64-arm-none-eabi/bin" >> $GITHUB_PATH
      
      - name: Build for ${{ matrix.target.name }}
        run: |
          make clean
          make TARGET=${{ matrix.target.name }} \
               CFLAGS_EXTRA="${{ matrix.target.flags }}" \
               LINKER_SCRIPT=ld/${{ matrix.target.linker }}
      
      - name: Check binary size
        run: |
          SIZE=$(arm-none-eabi-size build/firmware.elf | tail -1 | awk '{print $1+$2}')
          echo "Flash+RW: $SIZE bytes"
          MAX_SIZE=${{ matrix.target.name == 'nrf52840' && 1048576 || 
                      matrix.target.name == 'stm32f407' && 1048576 ||
                      matrix.target.name == 'stm32f103' && 262144 ||
                      matrix.target.name == 'rp2040' && 2097152 }}
          if [ "$SIZE" -gt "$MAX_SIZE" ]; then
            echo "ERROR: firmware exceeds $MAX_SIZE bytes for ${{ matrix.target.name }}"
            exit 1
          fi
      
      - name: Check stack usage
        run: |
          # GCC -fstack-usage generates .su files with per-function stack estimates
          # Sum the call-tree max stack for worst-case analysis
          python3 tools/stack_analyzer.py build/
      
      - name: Upload firmware artifacts
        uses: actions/upload-artifact@v4
        with:
          name: firmware-${{ matrix.target.name }}
          path: |
            build/firmware.hex
            build/firmware.bin
            build/firmware.elf
            build/firmware.map
  
  hil-smoke-test:
    needs: cross-compile
    runs-on: [self-hosted, embedded-runner]  # Runner with physical hardware
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    strategy:
      matrix:
        device: [nrf52840-dk, stm32f407-discovery]  # Add more as hardware runners become available
    steps:
      - name: Download firmware artifact
        uses: actions/download-artifact@v4
        with:
          name: firmware-${{ matrix.device }}
      
      - name: Flash firmware to device
        run: |
          # Using pyOCD or OpenOCD for flashing
          pyocd flash -t ${{ matrix.device }} firmware.hex
      
      - name: Run HIL smoke test
        run: |
          python3 tests/hil/smoke_test.py --device ${{ matrix.device }} --timeout 30
      
      - name: Verify boot
        run: |
          # Read serial output for boot confirmation
          python3 tests/hil/verify_boot.py --device ${{ matrix.device }} --expected "System ready"
```

## Static Analysis Configuration

### cppcheck

```bash
# .cppcheck-suppress — project-wide suppressions with reasons
# Format: category:file:line
# Every suppression MUST have a comment explaining why

# False positive: cppcheck doesn't recognize our custom assert as noreturn
knownConditionTrueFalse:src/assert.c:42  # Custom assert macro, intentional

# Third-party code we don't control
*:third_party/*  # Vendor SDK, not our code to fix
```

### MISRA-C Essentials for CI

Focus on the rules that catch real bugs. Running all MISRA-C:2012 rules in CI generates noise. Start with these:

```
MISRA-C:2012 rules that catch the most embedded bugs:
- Rule 8.3:  All declarations of an object/function shall use the same names and type qualifiers
- Rule 11.3: A cast shall not be performed between a pointer to object type and a pointer to a different object type
- Rule 13.2: The value of an expression and its persistent side effects shall be the same under all permitted evaluation orders
- Rule 14.1: A loop counter shall not have essentially floating type
- Rule 17.7: The value returned by a function having non-void return type shall be used
- Rule 21.6: Standard library input/output functions shall not be used (printf, etc.)
- Dir 4.7: If a function returns error information, that error information shall be tested
```

## Build System Patterns

### Makefile for Multi-Target Builds

```makefile
# Project Makefile — supports multiple targets
TARGET ?= nrf52840

# Target-specific configurations
include mk/$(TARGET).mk

# Common flags
CFLAGS += -Os -ffunction-sections -fdata-sections
CFLAGS += -fstack-usage  # Generates .su files for stack analysis
CFLAGS += -Wall -Wextra -Werror  # Warnings are errors in CI
CFLAGS += $(TARGET_CFLAGS)

LDFLAGS += -Wl,--gc-sections -Wl,-Map=$(BUILD_DIR)/firmware.map
LDFLAGS += -T $(TARGET_LINKER_SCRIPT)
LDFLAGS += $(TARGET_LDFLAGS)

# Build
$(BUILD_DIR)/firmware.elf: $(OBJS)
	$(CC) $(CFLAGS) $(OBJS) $(LDFLAGS) -o $@

$(BUILD_DIR)/firmware.hex: $(BUILD_DIR)/firmware.elf
	$(OBJCOPY) -O ihex $< $@

$(BUILD_DIR)/firmware.bin: $(BUILD_DIR)/firmware.elf
	$(OBJCOPY) -O binary $< $@

# Size report
size: $(BUILD_DIR)/firmware.elf
	$(SIZE) $<
	@echo "---"
	@python3 tools/size_report.py $(BUILD_DIR)/firmware.map

# Stack report
stack-report: $(BUILD_DIR)/firmware.elf
	@python3 tools/stack_analyzer.py $(BUILD_DIR)
```

## Firmware Artifact Management

Every CI build should produce versioned, traceable artifacts:

```bash
# Artifact naming convention: <project>-<target>-<version>-<commit>.{hex,bin,elf}
FIRMWARE_FILE="firmware-${TARGET}-${VERSION}-${SHORT_SHA}"

# Store in CI artifacts with metadata
cat > build/build-info.json <<EOF
{
  "version": "${VERSION}",
  "commit": "${GITHUB_SHA}",
  "target": "${TARGET}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "compiler": "$(arm-none-eabi-gcc --version | head -1)",
  "size": {
    "text": $(arm-none-eabi-size build/firmware.elf | tail -1 | awk '{print $1}'),
    "data": $(arm-none-eabi-size build/firmware.elf | tail -1 | awk '{print $2}'),
    "bss":  $(arm-none-eabi-size build/firmware.elf | tail -1 | awk '{print $3}')
  }
}
EOF

# Sign the firmware artifact (for later OTA distribution)
# Use the CI secret: ${{ secrets.FIRMWARE_SIGNING_KEY }}
openssl dgst -sha256 -sign signing_key.pem -out build/${FIRMWARE_FILE}.sig build/${FIRMWARE_FILE}.bin
```

## Simulator-Based Testing (No Hardware CI Runner)

When physical hardware isn't available in CI, use simulators:

| Simulator | Use Case |
|-----------|----------|
| **QEMU** (`qemu-system-arm`) | Cortex-M system emulation — run firmware in CI, test UART output, GPIO, timers |
| **Renode** | Multi-node embedded system simulation — test multi-MCU systems, full peripheral models |
| **Zephyr `native_sim`** | Build Zephyr app as a Linux executable — fast, CI-native, full Zephyr API surface |

```yaml
# QEMU smoke test in CI (no hardware required)
qemu-test:
  runs-on: ubuntu-latest
  steps:
    - name: Install QEMU
      run: sudo apt-get install -y qemu-system-arm
    - name: Run firmware in QEMU
      run: |
        # -M: machine type. Example uses lm3s6965evb (Cortex-M3) or netduinoplus2 (STM32F4)
        # Check `qemu-system-arm -M help` for available machines for your target
        timeout 10 qemu-system-arm \
          -M netduinoplus2 \
          -cpu cortex-m4 \
          -nographic \
          -semihosting \
          -kernel build/firmware.elf \
          -serial stdio | tee qemu_output.txt
    - name: Verify boot message
      run: grep -q "System ready" qemu_output.txt
```

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "CI for embedded is too hard to set up" | A cross-compile + unit test pipeline takes an afternoon. Not having it costs weeks of debugging integration issues. |
| "We can't test without hardware" | Host-based unit tests, QEMU, and Renode cover 80% of bugs. The remaining 20% needs hardware, but 80% coverage in CI is vastly better than 0%. |
| "Static analysis generates too many false positives" | Tune the ruleset. Start with the rules that catch real bugs (see MISRA-C essentials above). Suppress the rest with documented reasons. |
| "Build matrix is overkill, we only have one target" | You will add a second target. The matrix makes it trivial. Without it, the second target bitrots. |
| "Firmware artifacts don't need signing in CI" | Unsigned firmware can't be verified. CI signing ensures every artifact is traceable to its source commit. |

## Red Flags

- No CI pipeline at all for an embedded project
- CI that only compiles but doesn't run tests or static analysis
- A single "it compiles on my machine" as the quality gate
- Build warnings enabled but not treated as errors (`-Werror`)
- Firmware artifacts not versioned or traceable to source commit
- Stack analysis not part of CI (the single most common embedded crash cause, unmonitored)
- HIL tests that "sometimes fail" and are ignored — flaky HIL erodes trust in the pipeline
- CI caching toolchain downloads every run (wastes minutes; cache the toolchain tarball)

## Verification

After setting up an embedded CI pipeline:

- [ ] Every PR triggers: static analysis, host unit tests, cross-compile matrix, size check
- [ ] Push to main triggers: all of the above + HIL smoke test (if hardware available)
- [ ] Build failures block merge (branch protection rules)
- [ ] Static analysis runs and has a documented suppression file
- [ ] Firmware artifacts are versioned and include build metadata
- [ ] Size budget enforced for each target (build fails if exceeded)
- [ ] Stack analysis runs and reports worst-case stack depth
- [ ] CI pipeline completes in under 15 minutes (fast feedback loop)
