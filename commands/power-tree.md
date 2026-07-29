---
description: 设计电源架构：电压域、上电时序、电流预算、去耦需求、热评估
agent: build
---
# /power-tree — Power Architecture Designer

## Overview

Produces a complete power architecture document for a PCB: voltage domain breakdown, power sequencing diagram, per-rail current budget, decoupling strategy, and thermal assessment. Delegates all analysis to the `@power-architect` agent.

## Usage

```
/power-tree <board-name> <--schematic path> <--pmic-datasheet path> <--mcu-datasheet path>
```

## Workflow

### Phase 1 — Gather Inputs
Collect from the user or workspace:
- Board schematic or block diagram showing all power consumers
- PMIC / voltage regulator datasheets (buck, LDO, load switches)
- MCU/SoC datasheet: power pins, voltage tolerances, current consumption per mode (S0/S3/S5)
- Major peripheral power requirements (DDR, flash, PHYs, sensors)
- System power states and target power budget
- Thermal constraints (ambient range, heatsink availability, board stack-up)

### Phase 2 — Delegate to @power-architect
Spawn the specialist with all gathered inputs. The prompt must include:
- Board name and revision
- All power consumer datasheets and their voltage/current requirements
- System power state definitions (S0 active, S3 sleep, S5 soft-off, etc.)
- Specific deliverables:
  1. **Voltage Domain Table** — every rail: nominal voltage, tolerance (±%), max current (static + transient), source regulator, power states where active
  2. **Power Sequencing Diagram** — time-ordered enable sequence with delay requirements between each rail, including power-good handshake dependencies
  3. **Per-Rail Current Budget** — worst-case current draw summed from all consumers on each rail, with a 20% margin
  4. **Decoupling Strategy** — bulk capacitance (per rail), high-frequency bypass (per IC power pin group), ferrite bead isolation where needed
  5. **Thermal Assessment** — identify hot spots (PMIC buck, SoC core, DDR), estimate junction temperatures, recommend heatsink/fill if needed

### Phase 3 — Verify Sequencing
Cross-check the specialist output:
- Sequencing order satisfies all IC datasheet requirements (no rail enabled before its prerequisite)
- Delay values meet minimums specified in datasheets (rise time + settling time)
- Power-good monitoring covers every sequenced rail
- Brown-out thresholds are set above minimum operating voltage with margin
- S3/S5 leakage current does not violate standby budget

### Phase 4 — Save Output
Save the power architecture document to:
```
docs/power/<board-name>-power-tree-<YYYY-MM-DD>.md
```

Include the sequencing diagram as an ASCII-art timing diagram or Mermaid Gantt chart inline.

## Rules
1. Every voltage rail must be specified with a numeric tolerance — "3.3V nominal" is insufficient; must be "3.3V ±5%".
2. Current budgets must use worst-case (maximum) values from datasheets, not typical.
3. Sequencing must account for both power-up AND power-down order. Reverse order on power-down unless the PMIC enforces otherwise.
4. Decoupling capacitors must be placed within 2mm of the power pin for high-frequency bypass; bulk capacitance within 10mm.
5. At least one spare test point per voltage rail for bring-up measurement.
6. If a PMIC has a configurable sequencer, the specialist must output the register settings.
7. Thermal headroom: Tj_max - estimated Tj ≥ 15°C at worst-case ambient.
