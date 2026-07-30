---
name: memory-map
description: 内存映射设计（Memory Map）：Flash 分区、SRAM 分配、外设地址布局、存储保护区域与访问权限配置、链接脚本片段生成。Memory map design — Flash partition layout, SRAM region allocation, peripheral address space, memory-protection region configuration, and linker script fragment synthesis. Use when the user says 内存映射, memory map, 链接脚本, 内存布局, 地址空间, Flash分区, 或需要为嵌入式系统生成内存映射与链接器片段。
---

# Memory Map Designer (内存映射设计)

## Overview

Produces a complete memory map for an embedded system: Flash partition layout, SRAM region allocation, peripheral address space, memory-protection region configuration, and linker script fragments. Delegates analysis and generation to the `@memory-map-specialist` agent.

## When to Use

- A new MCU/SoC project needs its Flash and SRAM carved up into bootloader / application / storage regions
- A linker script (MEMORY / SECTIONS) must be synthesized from the memory map
- MPU regions with per-privilege access permissions must be defined
- A dual-bank OTA layout requires both banks to share an identical partition map

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
  4. **Memory-Protection Region Configuration** — region definitions with access permissions (read/write/execute) per privilege level, subregion disable bits if needed
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
