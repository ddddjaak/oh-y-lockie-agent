---
name: pinmux
description: 引脚复用分配（Pin Multiplexing）：外设功能到引脚的映射、复用冲突检测、电气兼容性检查、备用功能（AF）表生成、未用引脚终止策略。Pin multiplexing assignment — peripheral-to-pin function mapping, alternate-function conflict detection, electrical compatibility verification, and alternate-function table generation. Use when the user says 引脚复用, pinmux, 引脚分配, 引脚映射, 复用冲突, 或需要从芯片数据手册生成 GPIO 初始化表与 AF 配置。
---

# Pin Multiplexing Assignment (引脚复用分配)

## Overview

Produces a complete pin multiplexing assignment for an MCU/SoC: peripheral-to-pin function mapping, conflict detection across alternative functions, electrical compatibility verification, and a generated alternate-function table. Delegates the assignment logic to the `@hw-domain-expert` agent.

## When to Use

- Starting a new board or board revision and need to assign every peripheral signal to a physical pin
- A data sheet pinout must be turned into a validated pin table + GPIO init configuration
- Two peripherals appear to want the same pin (real or potential conflict) and a resolution is needed
- Unused pins must get a safe, leakage-minimizing termination recommendation

## Workflow

### Phase 1 — Gather Inputs
Collect from the user or workspace:
- MCU/SoC datasheet: pinout chapter with alternate function tables per pin
- Reference manual: GPIO and alternate function chapters
- Required peripheral list: complete list of peripherals needed (UART, SPI, I2C, eSPI, QSPI, eMMC, PWM, ADC, timers, debug SWD/JTAG, etc.) with pin count per peripheral
- Any fixed pin constraints (package pin for USB D+/D-, crystal pins, power pins, boot mode pins, SWD pins)
- External connector pin maps (what's wired to each header/connector)
- PCB routing constraints (high-speed signals need specific pin groups, differential pairs)

### Phase 2 — Prepare Pin Table
Build a structured pin table input from the datasheet:
| Pin # | Pin Name | Default Function | AF0 | AF1 | AF2 | ... | AF15 | 5V-tolerant? | Max Drive (mA) | Notes |
|-------|----------|-----------------|-----|-----|-----|-----|------|--------------|----------------|-------|

Also compile the required peripheral list:
| Peripheral | Instance | Signal | Pin Count | Fixed Pins? | Priority |
|------------|----------|--------|-----------|-------------|----------|

### Phase 3 — Delegate to @hw-domain-expert
Spawn the hw-domain-expert with both tables and all constraints. The prompt must include:
- Complete pin alternate function table from datasheet
- Required peripheral list with priorities
- Any fixed/vetoed pin assignments
- Specific deliverables:
  1. **Pin Assignment Table** — every used pin: pin number, net name, peripheral function, direction (I/O/I/O), initial state (PU/PD/hi-Z), notes
  2. **Conflict Report** — any peripherals that could not be assigned due to pin conflicts; alternative solutions (swap UART instances, reduce SPI chip selects, etc.)
  3. **Electrical Compatibility Check** — for each assigned pin: is the peripheral's voltage standard compatible? (LVCMOS33 vs 1.8V domain), is drive strength adequate? does it need 5V tolerance?
  4. **Unused Pin Report** — all unused pins with recommended termination (input+PU, input+PD, output low, analog input) to minimize leakage
  5. **Alternate Function Summary Table** — final AF register values needed for GPIO initialization

### Phase 4 — Verify No Conflicts
Cross-check the specialist output:
- No two peripherals share a pin
- No pin assigned a function it does not support in its AF table
- Debug pins (SWDIO/SWCLK) are NOT reassigned unless the board has an isolation mechanism
- Boot mode pins have the correct default state for desired boot behavior
- High-speed interfaces (eSPI, QSPI) are on pins that support the required drive strength and slew rate
- Analog pins (ADC inputs) are on ADC-capable channels only

### Phase 5 — Save Output
Save the pinmux document to:
```
docs/pinmux/<mcu-part>-pinmux-<YYYY-MM-DD>.md
```

Save the GPIO initialization table as a separate reference:
```
docs/pinmux/<mcu-part>-gpio-init-table.md
```

## Rules
1. Every pin assignment must reference the exact AF number and datasheet page — never assign from memory.
2. SWD pins (SWDIO/SWCLK) are sacred — only reassign if the board has explicit isolation jumpers and the user confirms.
3. Analog signals (ADC, DAC, comparator, OPAMP) must use analog-capable pins. Digital AF on an analog pin disables the analog path.
4. 5V-tolerant pins must be explicitly identified for any signal that could see > VDD.
5. High-drive pins must be used for high-speed or long-trace signals. Check the maximum drive strength in the datasheet.
6. Every unused pin must have a termination recommendation. Floating CMOS inputs are a leakage and EMI problem.
7. If the required peripheral set exceeds available pins, surface options BEFORE picking a workaround — the user may prefer to reduce the peripheral set.
