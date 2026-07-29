---
description: 设计内存映射：Flash分区、SRAM分配、外设地址布局、MPU配置、链接脚本片段
agent: build
---
# /memory-map — Memory Map Designer

## Overview

Produces a complete memory map for an embedded system: Flash partition layout, SRAM region allocation, peripheral address space, MPU region configuration, and linker script fragments. Delegates analysis and generation to the `@memory-map-specialist` agent.

## Usage

```
/memory-map <mcu-part-number> <--datasheet path> [--bootloader-size <KB>] [--app-size <KB>]
```

## Workflow

### Phase 1 — Gather Inputs
Collect from the user or workspace:
- MCU/SoC datasheet and reference manual (memory chapter)
- Flash total size and sector/block erase granularity
- SRAM total size, any tightly-coupled memory (TCM), retention RAM regions
- Bootloader requirements (secure boot? OTA? dual-bank?)
- Application requirements (RTOS heap, stack sizes, data buffers)
- Any fixed-address peripherals or external memory (QSPI PSRAM, SDRAM, NVRAM)

### Phase 2 — Delegate to @memory-map-specialist
Spawn the specialist with all gathered inputs. The prompt must include:
- MCU part number and memory specifications
- Bootloader and application constraints
- Specific deliverables:
  1. **Flash Map** — partition table: bootloader, application, OTA slot (if dual-bank), persistent storage, calibration data, option bytes
  2. **SRAM Map** — region allocation: vector table, .data/.bss, heap, main stack, process stack, IPC shared memory, DMA buffers
  3. **Peripheral Address Map** — base addresses for all peripherals used, gap verification, reserved region documentation
  4. **MPU Configuration** — region definitions with access permissions (read/write/execute) per privilege level, subregion disable bits if needed
  5. **Linker Script Fragment** — synthesized MEMORY{} and basic SECTIONS{} blocks

### Phase 3 — Verify Against Datasheet
Cross-check the specialist output against the datasheet:
- Flash start/end addresses match the datasheet
- SRAM start/end addresses match; retention RAM identified if present
- No peripheral address overlaps; reserved gaps respected
- MPU region size constraints satisfied (must be power-of-2 for most Cortex-M MPUs)
- Linker script addresses are within valid ranges

### Phase 4 — Save Output
Save the memory map document to:
```
docs/memory/<mcu-part>-memory-map-<YYYY-MM-DD>.md
```

Save the linker script fragment to:
```
docs/memory/<mcu-part>-linker-fragment.ld
```

## Rules
1. All addresses must be verified against the authoritative datasheet, not memory.
2. Flash partitions must be aligned to the erase sector boundary of the target device.
3. MPU region sizes must be power-of-2 and naturally aligned unless the MPU supports subregion disable.
4. Stack sizes must include a 25% safety margin above worst-case measured usage.
5. Reserved address ranges must be explicitly documented — no "unused" regions that are actually aliased or fault-generating.
6. If dual-bank OTA is used, both banks must have identical partition layouts.
