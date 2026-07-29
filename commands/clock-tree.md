---
description: 设计时钟树：时钟源选择、PLL配置、分频器链、外设时钟验证、抖动预算分析
agent: build
---
# /clock-tree — Clock Tree Designer

## Overview

Produces a complete clock tree design: oscillator/crystal selection, PLL configuration, divider chains, peripheral clock frequency verification, and jitter budget analysis. Delegates all analysis to the `@timing-analyst` agent.

## Usage

```
/clock-tree <mcu-part-number> <--datasheet path> <--rm path>
```

## Workflow

### Phase 1 — Gather Inputs
Collect from the user or workspace:
- MCU/SoC reference manual (RCC / clock chapter) and datasheet
- Required peripheral clock frequencies (CPU core, bus matrix, DDR, eSPI, QSPI, UART, I2C, SPI, timers, ADC)
- External clock sources: HSE crystal frequency & ppm, LSE crystal, external oscillator, clock input pin
- PLL constraints: VCO input frequency range, output frequency range, PFD frequency limits
- Any fixed-ratio clocks (USB 48MHz, audio I2S MCLK, Ethernet 25/50/125MHz)
- Jitter-sensitive interfaces and their tolerance specifications

### Phase 2 — Delegate to @timing-analyst
Spawn the specialist with all gathered inputs. The prompt must include:
- MCU part number and clock system specifications
- All peripheral clock frequency requirements (target frequency + tolerance)
- External oscillator/crystal specifications
- Specific deliverables:
  1. **Clock Source Selection** — HSE crystal justification (why this frequency?), LSE selection, any auxiliary oscillators
  2. **PLL Configuration** — for each PLL: input source, M/N/P/Q divider values, VCO output frequency, lock time
  3. **Divider Chain Diagram** — tree structure from source to every peripheral clock, showing each divider stage and its output frequency
  4. **Peripheral Clock Verification** — table: peripheral → clock source → divider chain → actual frequency → error vs. target → within tolerance? (yes/no)
  5. **Jitter Budget Analysis** — for each jitter-sensitive interface (USB, Ethernet, eSPI, DDR PHY): total jitter budget allocation, PLL contribution, crystal contribution, margin remaining

### Phase 3 — Verify Frequencies
Cross-check the specialist output:
- Every peripheral clock actual frequency is within the tolerance specified in the peripheral's datasheet
- USB 48MHz is within ±0.25% (±2500 ppm) for full-speed, ±500 ppm recommended
- UART baud rate error ≤ ±2% for all target baud rates (use the formula with the actual clock)
- No divider produces a frequency that violates a peripheral's minimum or maximum clock spec
- PLL VCO frequency is within the datasheet range across all PVT corners
- Lock time after PLL reconfiguration is accounted for in startup sequence

### Phase 4 — Save Output
Save the clock tree document to:
```
docs/timing/<mcu-part>-clock-tree-<YYYY-MM-DD>.md
```

Include the divider chain as an ASCII tree diagram inline. Save PLL register configuration values as a separate code block or table.

## Rules
1. Every clock frequency must be verified against the peripheral datasheet's specified range — no "close enough."
2. PLL divider values must be legal per the reference manual. Many MCUs have restricted ranges for M/N dividers.
3. Crystal load capacitance must match the crystal manufacturer's specification. Include Cstray estimation.
4. For jitter-sensitive interfaces, calculate the total accumulated jitter through the chain, not just the PLL contribution.
5. If a peripheral requires an exact frequency but cannot be achieved with the available dividers, surface it as a blocking issue — do not ship with a "close" frequency.
6. Document the clock enable sequence: which clocks must be enabled before which dependencies.
7. If clock security (CSS / clock failure detection) is available, include the configuration.
