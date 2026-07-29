---
description: 生成板级bring-up计划：预上电检查、启动序列、时钟初始化、内存测试、外设冒烟测试、bring-up日志模板
agent: build
---
# /bringup — Board Bring-Up Plan Generator

## Overview

Generates a step-by-step board bring-up plan for a new PCB or board revision. Covers pre-power checklist, power-on sequencing, clock initialization, memory validation, peripheral smoke tests, and a reusable bring-up log template. Delegates the heavy analysis to the `@boot-bringup-specialist` agent.

## Usage

```
/bringup <board-name> <--datasheet path> <--schematic path>
```

## Workflow

### Phase 1 — Gather Inputs
Collect from the user or workspace:
- Board schematic (PDF or native format)
- BOM / component datasheets (PMIC, MCU/SoC, DDR, clocks, key peripherals)
- Power tree diagram (if available) or power architecture document
- Pinout table / connector map
- Any known constraints (lab power supply limits, probe access, isolation requirements)

### Phase 2 — Delegate to @boot-bringup-specialist
Spawn the specialist agent with all gathered inputs. The prompt must include:
- Board name and revision
- Reference to schematic and datasheet paths
- Specific deliverable: bring-up plan covering (1) pre-power checklist, (2) staged power-on sequence, (3) clock tree verification steps, (4) memory test procedure (DDR training, marching patterns, ECC), (5) peripheral smoke tests for each interface, (6) bring-up log template with pass/fail columns and timestamp fields

### Phase 3 — Review Plan
Once the specialist returns the plan, review it against:
- **Completeness** — every power rail has a measurement step; every clock has a frequency check; every memory interface has a test
- **Safety** — current limits are set before each power stage; isolation jumpers identified
- **Sequencing** — dependencies correct (clock before DDR, DDR before flash, etc.)
- **Loggability** — each step produces a measurable pass/fail result

### Phase 4 — Save Output
Save the final bring-up plan to:
```
docs/bringup/<board-name>-bringup-plan-<YYYY-MM-DD>.md
```

Include the log template as a separate appendix or companion file at:
```
docs/bringup/<board-name>-bringup-log-template.md
```

## Rules
1. Never skip the pre-power checklist — visual inspection and resistance checks are mandatory.
2. Every rail must be measured at the test point BEFORE enabling the next rail.
3. The current limit on the lab supply must be set to 1.5× expected max current for each stage.
4. Memory tests must run for at least 10 full passes before declaring success.
5. The bring-up log template must include: step number, description, expected result, actual result, pass/fail, timestamp, operator initials.
6. If any phase fails, the specialist must produce a fault-isolation sub-plan before continuing.
