---
name: embedded-build-and-toolchain
description: Guides embedded build system and toolchain configuration. Use when setting up cross-compilation, writing linker scripts, configuring CMake/Make for multi-target builds, choosing compiler optimization flags, or understanding firmware image formats (.hex/.bin/.elf). Use when designing a build system that supports multiple MCU targets and toolchains.
---

# Embedded Build and Toolchain

## Overview

An embedded build system is not just "compile and link." It must handle cross-compilation for multiple targets, custom linker scripts, compile-time configuration (Kconfig), firmware image generation, and post-build steps (signing, checksums, size reporting). A well-designed build system makes adding a new target trivial; a bad one makes every board bring-up a multi-day exercise.

## When to Use

- Setting up a new embedded project's build system
- Porting firmware to a new MCU or toolchain
- Writing or modifying linker scripts (.ld files)
- Debugging "works in debug build, crashes in release" problems (optimization flag issues)
- Setting up multi-target builds (one codebase, multiple boards/MCUs)
- Understanding firmware image formats (.elf vs .hex vs .bin) for production

## Toolchain Selection

| Toolchain | Compiler | Use Case |
|-----------|---------|----------|
| **Arm GNU Toolchain** | `arm-none-eabi-gcc` | Most Arm Cortex-M projects. Free, open source, widely supported. |
| **Arm Compiler for Embedded (AC6)** | `armclang` | Commercial projects needing best code size/performance on Arm. License required. |
| **IAR Embedded Workbench** | `iccarm` | High-end commercial projects. Best optimizations for some architectures. License. |
| **RISC-V GNU Toolchain** | `riscv-none-elf-gcc` | RISC-V MCUs. Free, open source. |
| **Xtensa GCC** | `xtensa-esp-elf-gcc` | ESP32 family. Fork of GCC with Xtensa-specific extensions. |

**Default recommendation for AE work:** Arm GNU Toolchain. It's free, well-tested, and used by the majority of the embedded ecosystem (Zephyr, FreeRTOS, mbed OS all use it). Only switch to a commercial toolchain when you have a specific code size or performance gap that Arm GNU can't close.

### Installing the Toolchain

```bash
# Arm GNU Toolchain (Linux/WSL)
wget https://developer.arm.com/-/media/Files/downloads/gnu/13.2.rel1/binrel/arm-gnu-toolchain-13.2.rel1-x86_64-arm-none-eabi.tar.xz
tar -xf arm-gnu-toolchain-*.tar.xz
export PATH="$PWD/arm-gnu-toolchain-13.2.rel1-x86_64-arm-none-eabi/bin:$PATH"
arm-none-eabi-gcc --version

# macOS
brew install arm-none-eabi-gcc

# Verify installation
arm-none-eabi-gcc -mcpu=cortex-m4 -mthumb -E - < /dev/null
# Should succeed with no errors.
```

## Compiler Optimization Flags

### The Essential Flag Set

```makefile
# Architecture flags (target-specific)
ARCH_FLAGS  = -mcpu=cortex-m4           # CPU core
ARCH_FLAGS += -mthumb                   # Thumb instruction set (always for Cortex-M)
ARCH_FLAGS += -mfloat-abi=hard          # Hardware FPU (or soft/softfp)
ARCH_FLAGS += -mfpu=fpv4-sp-d16         # FPU type (match your MCU)

# Optimization flags
OPT_FLAGS   = -Os                       # Optimize for size (preferred for most embedded)
# OPT_FLAGS = -O2                       # Optimize for speed (use when speed-critical)
# OPT_FLAGS = -Og                       # Optimize for debug (use in debug builds only)
# OPT_FLAGS = -O0                       # No optimization (slowest, largest, use only for debugging)

# Warning flags (treat warnings as errors in CI)
WARN_FLAGS  = -Wall -Wextra -Werror
WARN_FLAGS += -Wshadow                  # Variable shadowing
WARN_FLAGS += -Wundef                   # Undefined identifiers in #if
WARN_FLAGS += -Wmissing-prototypes      # Missing function declarations
WARN_FLAGS += -Wstrict-prototypes       # Function prototype strictness
WARN_FLAGS += -Wcast-align              # Cast alignment warnings

# Debug and analysis flags
DBG_FLAGS   = -g3                       # Max debug info (stripped for production)
DBG_FLAGS  += -fstack-usage             # Generate .su files for stack analysis
DBG_FLAGS  += -fno-omit-frame-pointer   # Better stack traces in GDB

# Code generation flags
CODE_FLAGS  = -ffunction-sections       # Each function in its own section (for --gc-sections)
CODE_FLAGS += -fdata-sections           # Each data object in its own section
CODE_FLAGS += -fno-common               # Don't put uninitialized globals in COMMON
CODE_FLAGS += -fstack-protector-strong  # Stack canary (security, catches overflows)
CODE_FLAGS += -flto                     # Link-Time Optimization (5-15% size reduction)

# Linker flags
LINK_FLAGS  = -Wl,--gc-sections         # Garbage-collect unused sections
LINK_FLAGS += -Wl,-Map=$(BUILD_DIR)/firmware.map  # Map file for size analysis
LINK_FLAGS += -T $(LINKER_SCRIPT)       # Custom linker script
LINK_FLAGS += -nostartfiles             # We provide our own startup code
LINK_FLAGS += -specs=nano.specs        # Newlib-nano (smaller C library) — must come before nosys.specs
LINK_FLAGS += -specs=nosys.specs        # Minimal system calls stubs (after nano.specs)
LINK_FLAGS += -Wl,--print-memory-usage  # Print flash/RAM usage after link

# Combine
CFLAGS   = $(ARCH_FLAGS) $(OPT_FLAGS) $(WARN_FLAGS) $(DBG_FLAGS) $(CODE_FLAGS) $(DEFINES)
LDFLAGS  = $(ARCH_FLAGS) $(LINK_FLAGS)
```

### Optimization Flag Decision Guide

```
Which optimization level?
├── Release build (factory firmware, OTA image)?
│   └── -Os (size) is the right default. Flash is usually the binding constraint.
├── Release build, but a specific hot path is too slow?
│   └── -Os for most code, #pragma GCC optimize("O2") on the hot function.
│       Don't -O2 the whole binary just to speed up one loop.
├── Debug build during development?
│   └── -Og (optimize for debug). Variables are preserved, stepping works.
│       Don't use -O0 — it generates massive code and hides optimization-exposed bugs.
├── Debugging a bug that only appears with -Os/-O2?
│   └── The optimizer is exposing undefined behavior (uninitialized variable,
│       missing volatile, strict aliasing violation). The bug exists at -O0 too,
│       just silently. Fix the UB, don't change the optimization level.
└── Need to reduce code size by another 5-15%?
    └── Enable -flto (Link-Time Optimization). Caveat: increases link time,
        may require adjusting linker script and startup code.
```

## Linker Script Design

The linker script defines the memory layout. It's the single most important file for an embedded build — every byte of flash and RAM is allocated here.

### Anatomy of a Linker Script

```ld
/* firmware.ld — Linker script for STM32F407VG */

MEMORY
{
    /* Define memory regions from the datasheet */
    FLASH  (rx)  : ORIGIN = 0x08000000, LENGTH = 1024K
    RAM    (rwx) : ORIGIN = 0x20000000, LENGTH = 128K
    CCMRAM (rwx) : ORIGIN = 0x10000000, LENGTH = 64K   /* Core-Coupled Memory */
}

/* Stack and heap sizes (can be overridden at link time) */
_stack_size = DEFINED(_stack_size) ? _stack_size : 0x1000;  /* 4KB default */
_heap_size = DEFINED(_heap_size) ? _heap_size : 0;           /* No heap by default */

SECTIONS
{
    /* ---- CODE AND CONSTANTS IN FLASH ---- */
    
    /* Vector table: must be at the very start */
    .vectors : ALIGN(4)
    {
        KEEP(*(.vectors))           /* KEEP prevents --gc-sections from removing */
    } > FLASH
    
    /* Code */
    .text : ALIGN(4)
    {
        *(.text)                    /* All .text sections from all object files */
        *(.text.*)                  /* Subsection .text.function_name from -ffunction-sections */
        *(.rodata)                  /* Read-only data (const variables, string literals) */
        *(.rodata.*)
        
        /* Constructors/destructors (C++ static objects) */
        . = ALIGN(4);
        KEEP(*(.init))
        KEEP(*(.fini))
        
        . = ALIGN(4);
        _etext = .;                 /* End of text section */
    } > FLASH
    
    /* ---- INITIALIZED DATA IN FLASH, LOADED TO RAM AT STARTUP ---- */
    
    .data : ALIGN(4)
    {
        _sdata = .;                 /* Start of data in RAM */
        *(.data)
        *(.data.*)
        . = ALIGN(4);
        _edata = .;                 /* End of data in RAM */
    } > RAM AT > FLASH              /* VMA = RAM, LMA = FLASH */
    
    _sidata = LOADADDR(.data);     /* Where .data is loaded from in flash */
    
    /* ---- UNINITIALIZED DATA IN RAM ---- */
    
    .bss (NOLOAD) : ALIGN(4)
    {
        _sbss = .;
        *(.bss)
        *(.bss.*)
        *(COMMON)
        . = ALIGN(4);
        _ebss = .;
    } > RAM
    
    /* ---- NO-INIT DATA (SURVIVES RESET) ---- */
    
    .noinit (NOLOAD) : ALIGN(4)
    {
        *(.noinit)
        *(.noinit.*)
    } > RAM
    
    /* ---- STACK AND HEAP (at the end of RAM) ---- */
    
    /* Stack grows downward from end of RAM.
     * Heap grows upward from _sheap. If they meet: silent corruption.
     * Mitigation: monitor stack high-water mark, size heap conservatively,
     * or use an MPU guard region between them. */
    _estack = ORIGIN(RAM) + LENGTH(RAM);
    
    /* Heap starts after .bss, grows upward toward stack */
    .heap (NOLOAD) : ALIGN(8)
    {
        _sheap = .;
        . = . + _heap_size;
        . = ALIGN(8);
        _eheap = .;
    } > RAM
    
    /* ---- DISCARD UNNEEDED SECTIONS ---- */
    
    /DISCARD/ :
    {
        *(.ARM.exidx)       /* Exception unwind tables */
        *(.ARM.attributes)  /* Build attributes */
        *(.comment)         /* Compiler version strings */
    }
}

/* Export symbols for startup code and debugging */
PROVIDE(_flash_start   = ORIGIN(FLASH));
PROVIDE(_flash_end     = ORIGIN(FLASH) + LENGTH(FLASH));
PROVIDE(_ram_start     = ORIGIN(RAM));
PROVIDE(_ram_end       = ORIGIN(RAM) + LENGTH(RAM));
```

### Common Linker Script Mistakes

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Missing `ALIGN(4)` between sections | Unaligned access faults, especially with FPU/64-bit types | Add `. = ALIGN(4);` between each section |
| `.data` VMA = LMA (no AT>FLASH) | Initialized variables have garbage values at boot | `> RAM AT > FLASH` so startup code can copy initial values |
| Forgot `.bss` clearing in startup | Uninitialized globals have random values (whatever was in RAM) | startup code must zero `.bss`: `memset(_sbss, 0, _ebss - _sbss)` |
| `KEEP` missing on `.vectors` | `--gc-sections` removes the vector table → boot fails with no error | `KEEP(*(.vectors))` |
| Stack and heap overlap | Silent corruption when stack grows into heap (or vice versa) | Monitor both; place heap before stack, add MPU guard |
| Using `ENTRY(Reset_Handler)` without defining it | Linker warning, but boot may still work if vector table is correct | Define `Reset_Handler` in startup code, or omit ENTRY and rely on vector table |

### Startup Code (Minimal)

```c
// startup.c — Minimal startup for Cortex-M
#include <stdint.h>

// Symbols from linker script
extern uint32_t _sdata, _edata, _sidata;
extern uint32_t _sbss, _ebss;
extern uint32_t _estack;
extern void main(void);

// Default handler for unused interrupts
void Default_Handler(void) {
    while (1);  // Or trigger a HardFault for debugging
}

/* Vector table (placed in .vectors section)
 * On Cortex-M with GCC -mthumb, function pointers have bit 0 set to indicate
 * Thumb mode. The (uint32_t) cast preserves this bit. This relies on GCC's
 * Thumb function pointer convention — verify if using a different compiler.
 */
__attribute__((section(".vectors"))) 
const uint32_t vector_table[] = {
    (uint32_t)&_estack,               // Initial SP value
    (uint32_t)Reset_Handler,          // Reset
    (uint32_t)Default_Handler,        // NMI
    (uint32_t)Default_Handler,        // HardFault
    (uint32_t)Default_Handler,        // MemManage
    (uint32_t)Default_Handler,        // BusFault
    (uint32_t)Default_Handler,        // UsageFault
    // ... remaining vectors for your MCU
};

void Reset_Handler(void) {
    // Copy .data section from flash to RAM
    uint32_t* src = &_sidata;
    uint32_t* dst = &_sdata;
    while (dst < &_edata) {
        *dst++ = *src++;
    }
    
    // Zero .bss section
    for (dst = &_sbss; dst < &_ebss; dst++) {
        *dst = 0;
    }
    
    // Enable FPU if present (Cortex-M4/M7)
    // SCB->CPACR |= (0xF << 20);  // Enable CP10 and CP11
    
    // Jump to main
    main();
    
    // main should never return
    while (1);
}
```

## Multi-Target Build Systems

### Make-based Multi-Target Build

```makefile
# Makefile supporting multiple targets

# Default target (override with TARGET=nrf52840 make)
TARGET ?= stm32f407

# Target-specific configurations
include mk/$(TARGET).mk

BUILD_DIR = build/$(TARGET)

# ... rest of build rules using $(TARGET_CFLAGS), $(TARGET_LINKER_SCRIPT), etc.
```

```makefile
# mk/stm32f407.mk — Target-specific configuration
TARGET_CFLAGS  = -mcpu=cortex-m4 -mthumb -mfloat-abi=hard -mfpu=fpv4-sp-d16
TARGET_CFLAGS += -DSTM32F407xx -DHSE_VALUE=8000000
TARGET_LINKER_SCRIPT = ld/stm32f407.ld
TARGET_OPENOCD_CFG   = openocd/stm32f4discovery.cfg
```

### CMake with Kconfig (Zephyr Pattern)

```cmake
# CMakeLists.txt — Zephyr-style multi-target CMake
cmake_minimum_required(VERSION 3.20)

# Board is set via command line or Kconfig
# cmake -DBOARD=nrf52840dk_nrf52840 ..

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})

project(firmware)

target_sources(app PRIVATE
    src/main.c
    src/sensors.c
    src/ble_service.c
)

# Sources conditional on Kconfig:
# if(CONFIG_BMS_ENABLED)
#     target_sources(app PRIVATE src/bms.c)
# endif()
```

## Firmware Image Formats

| Format | Contents | Use |
|--------|---------|-----|
| **ELF** (`.elf`) | Full binary with debug symbols, section headers, relocation info | Debugging, GDB, size analysis. Not for flashing. |
| **HEX** (`.hex`) | Intel HEX format: ASCII with addresses and checksums | Flashing tools (J-Flash, pyOCD, OpenOCD). Human-readable. |
| **BIN** (`.bin`) | Raw binary, no metadata | Bootloaders, OTA packages. Smallest, but no address info. |

### Generating Images

```bash
# From ELF to HEX
arm-none-eabi-objcopy -O ihex firmware.elf firmware.hex

# From ELF to BIN
arm-none-eabi-objcopy -O binary firmware.elf firmware.bin

# From HEX to BIN (extract raw binary, discarding address info)
arm-none-eabi-objcopy -I ihex -O binary firmware.hex firmware.bin

# Inspect ELF sections
arm-none-eabi-objdump -h firmware.elf

# Disassemble (useful for checking what the compiler generated)
arm-none-eabi-objdump -d firmware.elf > firmware.disasm

# List all symbols with sizes (find the biggest functions/data)
arm-none-eabi-nm --size-sort firmware.elf | tail -20
```

## Post-Build Automation

```makefile
# Post-build steps in Makefile
.PHONY: all size report sign

all: $(BUILD_DIR)/firmware.elf $(BUILD_DIR)/firmware.hex $(BUILD_DIR)/firmware.bin size report

size: $(BUILD_DIR)/firmware.elf
	@echo "=== Size Report ==="
	@$(SIZE) $<
	@echo ""
	@python3 tools/size_check.py $(BUILD_DIR)/firmware.map $(MAX_FLASH) $(MAX_RAM)

report: $(BUILD_DIR)/firmware.elf
	@python3 tools/stack_analyzer.py $(BUILD_DIR)
	@python3 tools/build_info.py $(TARGET) $(VERSION) > $(BUILD_DIR)/build-info.json

sign: $(BUILD_DIR)/firmware.bin
	@echo "Signing firmware..."
	openssl dgst -sha256 -sign $(SIGNING_KEY) -out $(BUILD_DIR)/firmware.sig $(BUILD_DIR)/firmware.bin

flash: $(BUILD_DIR)/firmware.hex
	pyocd flash -t $(TARGET) $<

erase:
	pyocd erase -t $(TARGET) --chip

# Clean build artifacts for one target
clean:
	rm -rf $(BUILD_DIR)

# Deep clean — all targets
clean-all:
	rm -rf build/
```

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll just use the vendor's default Makefile" | Vendor Makefiles are often IDE-specific, assume one target, and don't handle multi-target well. Invest in your own build system. |
| "Linker scripts are too complicated, I'll use the default" | The default linker script may not define `.noinit`, may put the stack in the wrong place, or may allocate a heap you don't need. Understand your linker script. |
| "-O0 is fine for production if it fits" | -O0 produces 2-5x larger, 2-10x slower code. It also hides undefined behavior that -Os/-O2 will expose. Never ship -O0. |
| "I'll add the optimization flag later" | Build system flags compound. Adding -flto later may require linker script changes you didn't anticipate. Set up the release build from day one. |
| "HEX and BIN are interchangeable" | HEX contains addresses; BIN doesn't. Flashing a BIN at the wrong address bricks the device. Know which format your tool expects. |
| "Stack analysis is just for safety-critical" | Stack overflow is the #1 cause of mysterious crashes in embedded firmware. Every project benefits from stack analysis in CI. |

## Red Flags

- Using the vendor IDE's default linker script without reading it
- Production builds with `-O0` or `-Og`
- No `-Wall -Wextra -Werror` in CI builds
- Linker script with heap allocated but no heap usage (wasted RAM)
- `--gc-sections` not enabled (dead code bloating flash)
- No map file analysis in CI (you don't know what's consuming your flash)
- `.hex` and `.bin` artifacts built differently (should come from the same ELF)
- Toolchain installed ad-hoc (version not pinned, not cached in CI)
- Stack and heap overlapping without MPU protection

## Verification

After setting up an embedded build system:

- [ ] `make` (or `cmake --build`) produces firmware.elf, firmware.hex, and firmware.bin
- [ ] `make TARGET=<different_board>` builds for at least 2 targets
- [ ] Clean build is reproducible (two consecutive builds produce identical .bin)
- [ ] `arm-none-eabi-size` report shows flash/RAM usage within budget
- [ ] Map file generated and parseable by automated size check tool
- [ ] Stack usage report generated from `.su` files
- [ ] `-Wall -Wextra -Werror` enabled and build passes with zero warnings
- [ ] Release build uses `-Os` (not `-O0`/`-Og`), debug info stripped or minimal
- [ ] Start-up code correctly copies `.data` and zeros `.bss` (verified by checking initialized globals at main entry)
- [ ] Firmware boots on target hardware after a clean build
- [ ] Post-build signing step works (if applicable)
