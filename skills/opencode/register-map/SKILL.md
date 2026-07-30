---
name: register-map
description: 寄存器映射生成（Register Map）：从芯片数据手册/参考手册提取寄存器与位域定义、校验地址对齐、检查保留位、生成 C 头文件/Markdown/JSON 结构化文档。Register map generation — extract register definitions from a datasheet or reference manual, verify address alignment, audit reserved bit fields, and generate structured register documentation (C header, Markdown, JSON). Use when the user says 寄存器映射, register map, 位域, 寄存器表, 生成寄存器头文件, 或需要从数据手册生成寄存器定义。
---

# Register Map Generator (寄存器映射生成)

## Overview

Extracts register definitions from a chip datasheet or reference manual, verifies address alignment, checks reserved bit fields, and generates structured register documentation suitable for header files and firmware reference. Delegates extraction and verification to the `@register-map-generator` agent.

## When to Use

- A peripheral's register set must be turned into a C header, Markdown reference, or JSON machine-readable definition
- An existing register map must be validated against a datasheet revision
- Generated headers must enforce read-only / write-only / W1C semantics from the datasheet

## Workflow

### Phase 1 — Gather Inputs
Collect from the user or workspace:
- MCU/SoC reference manual or datasheet (PDF, HTML, or markdown extract)
- Target peripheral name(s) — can be a single peripheral (e.g., "UART0") or a peripheral class (e.g., "all GPIO registers")
- Base address of the peripheral from the memory map
- Output format preference: C header (#define macros), Markdown reference table, or JSON machine-readable

### Phase 2 — Delegate to @register-map-generator
Spawn the specialist with the datasheet and target specification. The prompt must include:
- Peripheral name and base address
- Datasheet page range or section covering the register map
- Output format
- Specific deliverables:
  1. **Register Address Table** — offset, register name, width (8/16/32-bit), access type (R/W/RW/RC_W1/W1C/etc.), reset value
  2. **Bit Field Definitions** — for each register: bit range, field name, access type, description, enumerated values if applicable
  3. **Address Alignment Check** — verify all registers are aligned to their width boundary (32-bit registers at 4-byte boundaries, 16-bit at 2-byte)
  4. **Reserved Bit Audit** — identify all reserved bits/fields; verify the datasheet-specified behavior (read-as-zero? write-ignore? read-undefined?)
  5. **Inter-Register Gap Report** — any gaps in the address space that are not documented; flag as potential undocumented registers or reserved space

### Phase 3 — Verify Alignment and Gaps
Cross-check the specialist output:
- Every register offset is a multiple of its access width (byte = any, halfword = 2, word = 4)
- No two registers overlap in the address space
- Read-only registers are not marked as writable, write-only not readable
- Write-1-to-clear (W1C) registers are correctly identified — writing 0 has no effect
- Read-clear (RC) registers are correctly identified — reading clears the value
- Reserved bits documented as "must be written as 0" or "preserved" per the datasheet
- Any undocumented address gaps are explicitly noted for further investigation

### Phase 4 — Save Output
Save the register map document to:
```
docs/registers/<mcu-part>-<peripheral>-register-map-<YYYY-MM-DD>.md
```

For C header output, also save to:
```
docs/registers/<peripheral>_reg.h
```

## Register Map Template (Markdown)

```
## <Peripheral Name> (Base: 0x4000_0000)

| Offset | Register | Width | Access | Reset | Description |
|--------|----------|-------|--------|-------|-------------|
| 0x00   | CTRL     | 32    | RW     | 0x0000_0000 | Control register |
| 0x04   | STATUS   | 32    | RO     | 0x0000_0001 | Status register |
| ...    | ...      | ...   | ...    | ...   | ...         |

### CTRL (0x00) — Control Register

| Bits | Field | Access | Reset | Description |
|------|-------|--------|-------|-------------|
| 0    | EN    | RW    | 0     | Peripheral enable: 0=disabled, 1=enabled |
| 1    | IE    | RW    | 0     | Interrupt enable |
| 7:2  | —     | —      | 0x00  | Reserved, must be kept at reset value |
| ...  | ...   | ...    | ...   | ...         |
```

## Rules
1. All register addresses and bit field definitions must be extracted verbatim from the datasheet — never fabricate or guess.
2. 32-bit registers must be aligned on 4-byte boundaries; unaligned registers are a datasheet error — flag them.
3. Reserved bits must be explicitly documented. If the datasheet says "reserved, must be written as 0," the generated code must enforce that.
4. Read-only registers: writing to them in the generated header must either be impossible (separate RO-only define) or have a compile-time warning.
5. Write-only registers: reading from them in the generated header must either be impossible or have a compile-time error.
6. Write-1-to-clear registers: the header must include a comment warning that reading-modifying-writing risks clearing status bits. Use atomic set/clear macros.
7. Reserved address gaps larger than 0x100 bytes must be reported as potential undocumented register banks.
