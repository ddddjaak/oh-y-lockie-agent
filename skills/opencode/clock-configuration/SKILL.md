---
name: clock-configuration
description: 时钟配置设计：PLL配置（M/N/P分频器计算）、时钟树设计、时钟门控、时钟源选择（HSI/HSE/LSI/LSE/PLL）、RC振荡器校准、时钟安全系统（CSS）、时钟输出（MCO）。Clock configuration design — PLL configuration (M/N/P divider calculation), clock tree design, clock gating, clock source selection (HSI/HSE/LSI/LSE/PLL), RC oscillator calibration, clock security system, and clock output (MCO). Use when the user says 时钟树, PLL配置, clock configuration, HSE, HSI, 时钟配置, or when designing the firmware clock tree for an MCU.
---
# Clock Configuration Design

## Overview

The clock tree is the cardiovascular system of an MCU — every peripheral, every bus, every CPU cycle depends on it. A clock configuration error doesn't cause a compile error or a crash: it causes a peripheral to silently run at the wrong baud rate, a timer to drift, or an ADC to sample at half the expected rate. Getting the clock tree right means understanding the PLL divider chain, selecting the right oscillators, and gating clocks to save power — all while ensuring the clock security system catches failures before they cause data corruption.

This skill covers the full clock configuration lifecycle: clock tree analysis, PLL parameter calculation, oscillator selection, clock gating strategy, MCO output configuration, and clock failure recovery.

## When to Use

- Setting up the system clock (HCLK, SYSCLK) for a new MCU project
- Configuring PLLs with the correct M/N/P/Q/R divider values for target frequencies
- Selecting between internal (HSI/LSI) and external (HSE/LSE) oscillators
- Implementing clock gating to reduce power consumption in idle peripherals
- Configuring peripheral clocks (USART, SPI, I2C, ADC, TIM) with correct prescalers
- Debugging baud rate mismatches, timer inaccuracies, or USB enumeration failures
- Enabling the Clock Security System (CSS) for fail-safe operation
- Calibrating the internal RC oscillator against a more accurate reference

**When NOT to use:** Crystal/oscillator hardware selection (that's board-level design — use `hardware-architecture-design`), debugging a single peripheral's register-level timing issue (use datasheet directly), or pure PCB layout concerns for clock traces.

## Clock Tree Analysis Methodology

### The Standard Cortex-M Clock Architecture

```
                     ┌─────────────┐
                     │   HSI RC    │  16 MHz (typical, ±1%)
                     │   (internal)│
                     └──────┬──────┘
                            │
  ┌─────────────┐     ┌─────┴──────┐     ┌─────────────┐
  │   HSE OSC   │────→│   PLL      │────→│  SYSCLK     │
  │  (external) │     │  xN /M /P  │     │  (max freq) │
  └─────────────┘     └─────┬──────┘     └──────┬──────┘
                            │                    │
                     ┌──────┴──────┐      ┌──────┴──────┐
                     │  PLL48CLK   │      │  AHB Presc  │
                     │  (USB/RNG)  │      │  /1, /2.../512│
                     └─────────────┘      └──────┬──────┘
                                                 │
                    ┌────────────────────────────┼────────────────────────────┐
                    │                            │                            │
              ┌─────┴─────┐              ┌──────┴──────┐             ┌──────┴──────┐
              │  HCLK     │              │  APB1 Presc │             │  APB2 Presc │
              │  (CPU,    │              │  /1, /2...  │             │  /1, /2...  │
              │   DMA,    │              │  /16        │             │  /16        │
              │   Memory) │              └──────┬──────┘             └──────┬──────┘
              └───────────┘                     │                            │
                                          APB1 Peripherals             APB2 Peripherals
                                          (TIM2-7, USART2-3,          (TIM1, USART1,
                                           SPI2-3, I2C1-2)             SPI1, ADC1)
```

### PLL Parameter Calculation

The most error-prone part of clock configuration is PLL divider calculation. The formula is consistent across STM32, NXP, and most Cortex-M MCUs:

```
PLL Output = (Input Frequency × N) / (M × P)

Where:
  Input  = HSE or HSI frequency (in Hz)
  M      = Input divider (PLLM): divides input to 1-2 MHz for the VCO
  N      = Multiplication factor (PLLN): VCO = input/M × N
  P      = Main output divider (PLLP): SYSCLK = VCO / P
  Q      = USB/SAI output divider (PLLQ): 48 MHz for USB, typically
  R      = Additional output divider (PLLR) — MCU-specific
```

```c
// PLL parameter calculator with validation.
// This is automated math — hand-calculating these is error-prone.

typedef struct {
    uint32_t input_freq_hz;      // HSE or HSI frequency
    uint32_t target_sysclk_hz;   // Desired SYSCLK (must be ≤ max for MCU)
    uint32_t target_usb_hz;      // Usually 48 MHz if USB is used, else 0
    uint32_t vco_input_min_hz;   // VCO input range minimum (from datasheet)
    uint32_t vco_input_max_hz;   // VCO input range maximum (from datasheet)
    uint32_t vco_output_min_hz;  // VCO output range minimum (from datasheet)
    uint32_t vco_output_max_hz;  // VCO output range maximum (from datasheet)
} pll_input_params_t;

typedef struct {
    uint32_t m;             // PLLM divider (input ÷ M)
    uint32_t n;             // PLLN multiplier (VCO = input/M × N)
    uint32_t p;             // PLLP divider (SYSCLK = VCO/P)
    uint32_t q;             // PLLQ divider (USB = VCO/Q)
    uint32_t vco_freq_hz;   // Actual VCO frequency
    uint32_t sysclk_hz;     // Actual SYSCLK
    uint32_t usb_hz;        // Actual USB clock
    uint32_t error_sysclk_ppm; // Deviation from target in PPM
} pll_solution_t;

hal_err_t pll_find_solution(const pll_input_params_t* params, 
                             pll_solution_t* solution) {
    uint32_t best_error = UINT32_MAX;
    pll_solution_t best = {0};
    bool found = false;
    
    // Brute-force search within datasheet constraints.
    // For an MCU with M=[2..63], N=[50..432], P={2,4,6,8}:
    //   This searches ~3800 combinations. At 80MHz, that's <1ms in firmware.
    //   If that's too slow, pre-compute offline and store the result.
    
    for (uint32_t m = 2; m <= 63; m++) {
        uint32_t vco_input = params->input_freq_hz / m;
        
        // VCO input must be in valid range
        if (vco_input < params->vco_input_min_hz || 
            vco_input > params->vco_input_max_hz) {
            continue;
        }
        
        for (uint32_t n = 50; n <= 432; n++) {
            uint32_t vco = vco_input * n;
            
            // VCO output must be in valid range
            if (vco < params->vco_output_min_hz || 
                vco > params->vco_output_max_hz) {
                continue;
            }
            
            // P dividers are typically only specific values
            uint32_t p_values[] = {2, 4, 6, 8};
            for (int pi = 0; pi < 4; pi++) {
                uint32_t p = p_values[pi];
                uint32_t sysclk = vco / p;
                
                // SYSCLK must not exceed MCU max
                if (sysclk > params->target_sysclk_hz) continue;
                
                uint32_t error = abs((int32_t)(sysclk - params->target_sysclk_hz));
                
                // If USB is needed, Q must produce exactly 48 MHz
                if (params->target_usb_hz > 0) {
                    uint32_t q = vco / params->target_usb_hz;
                    uint32_t usb = vco / q;
                    if (usb != params->target_usb_hz) continue;
                    // USB clock must be within USB spec: 48 MHz ±0.25% (2500 PPM)
                    if (abs((int32_t)(usb - params->target_usb_hz)) > 
                        params->target_usb_hz * 2500 / 1000000) continue;
                }
                
                if (error < best_error) {
                    best.m = m;
                    best.n = n;
                    best.p = p;
                    best.q = (params->target_usb_hz > 0) ? vco / params->target_usb_hz : 0;
                    best.vco_freq_hz = vco;
                    best.sysclk_hz = sysclk;
                    best.usb_hz = params->target_usb_hz > 0 ? 
                                  vco / best.q : 0;
                    best.error_sysclk_ppm = (error * 1000000ULL) / params->target_sysclk_hz;
                    best_error = error;
                    found = true;
                    
                    // Exact match — stop searching
                    if (error == 0) goto found;
                }
            }
        }
    }
    
found:
    if (!found) {
        return HAL_ERR_NO_SOLUTION;
    }
    *solution = best;
    return HAL_OK;
}
```

### Clock Configuration Execution Order

```c
// The order of clock register writes MATTERS.
// Wrong order → bus fault (switching clock source while bus is running)
//               or undefined intermediate states.

hal_err_t clock_configure_system(const pll_solution_t* pll) {
    // CRITICAL: Clock configuration sequence — DO NOT REORDER:
    
    // 1. Enable the clock source (HSE or HSI)
    RCC->CR |= RCC_CR_HSEON;
    while (!(RCC->CR & RCC_CR_HSERDY)) {
        if (timeout_expired()) return HAL_ERR_TIMEOUT;
    }
    
    // 2. Configure flash latency for the target frequency BEFORE switching
    //    For STM32F4: ≤30MHz → 0WS, ≤60MHz → 1WS, ≤90MHz → 2WS, ≤120MHz → 3WS
    //    etc. Check YOUR MCU's reference manual for the flash wait state table.
    uint32_t ws = flash_required_wait_states(pll->sysclk_hz);
    FLASH->ACR = (FLASH->ACR & ~FLASH_ACR_LATENCY_Msk) | ws;
    // Verify it was written correctly
    if ((FLASH->ACR & FLASH_ACR_LATENCY_Msk) != ws) {
        return HAL_ERR_FLASH_CONFIG;
    }
    
    // 3. Configure PLL (while still running on HSI/HSE directly)
    //    Disable PLL before changing parameters
    RCC->CR &= ~RCC_CR_PLLON;
    while (RCC->CR & RCC_CR_PLLRDY);  // Wait for PLL to stop
    
    RCC->PLLCFGR = (pll->m << RCC_PLLCFGR_PLLM_Pos)
                 | (pll->n << RCC_PLLCFGR_PLLN_Pos)
                 | (pll_p_to_reg(pll->p) << RCC_PLLCFGR_PLLP_Pos)
                 | (pll->q << RCC_PLLCFGR_PLLQ_Pos)
                 | RCC_PLLCFGR_PLLSRC_HSE;  // Source selection
    
    // 4. Enable PLL and wait for lock
    RCC->CR |= RCC_CR_PLLON;
    while (!(RCC->CR & RCC_CR_PLLRDY)) {
        if (timeout_expired()) return HAL_ERR_TIMEOUT;
    }
    
    // 5. Configure bus prescalers BEFORE switching SYSCLK to PLL
    RCC->CFGR &= ~(RCC_CFGR_HPRE | RCC_CFGR_PPRE1 | RCC_CFGR_PPRE2);
    RCC->CFGR |= (AHB_PRESCALER << RCC_CFGR_HPRE_Pos)
               | (APB1_PRESCALER << RCC_CFGR_PPRE1_Pos)
               | (APB2_PRESCALER << RCC_CFGR_PPRE2_Pos);
    
    // 6. Switch SYSCLK to PLL
    RCC->CFGR = (RCC->CFGR & ~RCC_CFGR_SW) | RCC_CFGR_SW_PLL;
    while ((RCC->CFGR & RCC_CFGR_SWS) != RCC_CFGR_SWS_PLL) {
        if (timeout_expired()) return HAL_ERR_TIMEOUT;
    }
    
    // 7. Update SystemCoreClock variable for HAL timing functions
    SystemCoreClock = pll->sysclk_hz;
    
    // 8. Optional: Disable HSI if it was only used as a startup clock
    if (use_hsi == STARTUP_ONLY) {
        RCC->CR &= ~RCC_CR_HSION;
    }
    
    return HAL_OK;
}
```

## Oscillator Selection Strategy

### Internal vs External: Decision Guide

```
Which oscillator to use?

SYSCLK source:
├── Require ±50 PPM or better frequency accuracy?
│   ├── YES → HSE (external crystal/oscillator)
│   │   └── Mandatory for: USB (needs ±2500 PPM), CAN (needs ±X PPM per standard),
│   │       UART at >115200 baud, precision timing
│   └── NO → HSI (internal RC, ±1% typical)
│       └── Fine for: GPIO toggling, most SPI, non-precision timing
│
├── Need fast wake-up from deep sleep?
│   └── HSI is ready in microseconds. HSE takes milliseconds to stabilize.
│       Use HSI for the wake-up clock, switch to HSE after.
│
└── Cost-sensitive, board space limited?
    └── HSI saves a crystal, two capacitors, and PCB area.

RTC/LPTIM source:
├── Need accurate timekeeping across temperature?
│   └── LSE (32.768 kHz crystal): ±20 PPM = ±1.7 seconds/day
├── OK with ±5% accuracy?
│   └── LSI (internal ~32 kHz RC): ±5% = ±72 minutes/day — unacceptable for clocks
└── Absolute worst-case: LSI for watchdog only
```

### RC Oscillator Calibration

```c
// Internal RC oscillators drift with temperature and voltage.
// Calibrate against a known-accurate reference (HSE, LSE, or external signal).

// Method: Use a timer input capture from the reference clock.
// Measure how many HSI cycles fit in one reference cycle.
// Adjust the HSI trim register to match.

typedef struct {
    uint32_t hsi_target_hz;
    uint32_t reference_hz;    // e.g., LSE = 32768 Hz
    uint32_t tolerance_ppm;   // Acceptable error, e.g., 5000 = 0.5%
} rc_calibration_params_t;

hal_err_t calibrate_hsi_against_lse(const rc_calibration_params_t* params) {
    // Configuration:
    //   - TIM channel in input capture mode, clocked by HSI
    //   - LSE connected to the timer's external trigger or another capture channel
    //   - Measure HSI ticks per LSE period
    
    // Simplified: read calibration value from factory if available
    // STM32 stores HSI calibration in option bytes or system memory
    
    // 1. Read factory calibration (if available)
    uint16_t factory_trim = *((uint16_t*)HSI_CALIBRATION_ADDR);
    
    // 2. Apply factory trim
    RCC->HSITRIM = factory_trim & 0x1F;
    
    // 3. Fine-tune: measure actual frequency using LSE as reference
    for (int trim = -16; trim <= 15; trim++) {
        int16_t new_trim = (int16_t)(factory_trim & 0x1F) + trim;
        if (new_trim < 0 || new_trim > 63) continue;
        
        RCC->HSITRIM = (uint32_t)new_trim;
        
        // Measure: count HSI cycles during one LSE period
        uint32_t hsi_count = measure_hsi_cycles_during_lse_period();
        uint32_t expected = params->hsi_target_hz / params->reference_hz;
        int32_t error_ppm = (int32_t)(hsi_count - expected) * 1000000L / (int32_t)expected;
        
        if (abs(error_ppm) < (int32_t)params->tolerance_ppm) {
            return HAL_OK;  // Within tolerance
        }
    }
    
    return HAL_ERR_CALIBRATION;  // Could not reach target tolerance
}
```

## Clock Gating Strategy

### Per-Peripheral Clock Enable

```c
// Clock gating: disable the clock to any peripheral that isn't actively
// in use. The power savings are real: each gated peripheral saves its
// entire dynamic power consumption.

// Strategy: Enable on init, disable on deinit. Never leave clocks
// running for peripherals you haven't initialized.

typedef struct {
    uint32_t ahb_enr_bit;    // Bit in AHBxENR register
    uint32_t apb_enr_bit;    // Bit in APBxENR register
    volatile uint32_t* ahb_enr_reg;
    volatile uint32_t* apb_enr_reg;
    bool clocked;
} peripheral_clock_t;

void peripheral_clock_enable(peripheral_clock_t* clk) {
    if (!clk->clocked) {
        *clk->ahb_enr_reg |= clk->ahb_enr_bit;
        *clk->apb_enr_reg |= clk->apb_enr_bit;
        __DSB();  // Data synchronization barrier — ensure write completes
        clk->clocked = true;
    }
}

void peripheral_clock_disable(peripheral_clock_t* clk) {
    if (clk->clocked) {
        *clk->apb_enr_reg &= ~clk->apb_enr_bit;
        *clk->ahb_enr_reg &= ~clk->ahb_enr_bit;
        clk->clocked = false;
    }
}

// Rule: After enabling a peripheral clock, insert a small delay before
// accessing its registers. The clock must propagate through the bus fabric.
// 2-3 DSB cycles is enough on most MCUs. Skipping this causes bus faults.
```

### Sleep Mode Clock Gating

```markdown
| Sleep Mode    | HSI | HSE | PLL | AHB Clocks | APB Clocks | Wake Latency |
|---------------|-----|-----|-----|------------|------------|--------------|
| SLEEP         | ON  | ON  | ON  | ON         | ON         | 0 (instant)  |
| DEEPSLEEP     | OFF | OFF | OFF | OFF        | OFF        | ~20 µs       |
| DEEPSLEEP+LSE | OFF | OFF | OFF | OFF        | LSE only   | ~20 µs       |
```

## Clock Security System (CSS)

### Failure Detection and Recovery

```c
// The CSS detects HSE failure (crystal broken, oscillator dead) and
// automatically switches to HSI. Without CSS, HSE failure → system freeze.

void clock_security_system_init(void) {
    // Enable CSS interrupt in NVIC
    NVIC_EnableIRQ(HSE_FAULT_IRQn);
    
    // Enable CSS: monitors HSE, triggers NMI on failure
    RCC->CR |= RCC_CR_CSSHSEON;  // Clock Security System on HSE
    
    // CSS is also available for LSE on some MCUs:
    // RCC->CR |= RCC_CR_CSSLSEON;
}

void NMI_Handler(void) {
    // Check if this is a CSS fault
    if (RCC->CIR & RCC_CIR_CSSF) {
        // HSE has failed! The hardware has already:
        //   1. Switched SYSCLK to HSI automatically
        //   2. Disabled the HSE oscillator
        //   3. Disabled the PLL
        //   4. Set the CSSF flag
        
        // Clear the interrupt flag
        RCC->CIR |= RCC_CIR_CSSC;
        
        // Log the failure
        LOG_CRITICAL("HSE failure detected! System running on HSI.");
        
        // System is running on HSI at this point.
        // HSI is typically 16 MHz (vs HSE 8-25 MHz + PLL).
        // Peripherals may be running at wrong baud rates.
        
        // Recovery options:
        // 1. Stay on HSI at reduced performance — safe, degraded mode
        // 2. Attempt HSE recovery: re-enable, wait for stable, re-init PLL
        //    Only attempt once — if HSE fails again, stay on HSI
        
        // Option 1: Accept degraded mode, notify application
        system_clock_source = CLOCK_SOURCE_HSI;
        SystemCoreClock = HSI_FREQUENCY;
        
        // Option 2: Attempt HSE recovery (once)
        if (hse_recovery_attempts < 1) {
            hse_recovery_attempts++;
            if (clock_attempt_hse_recovery() == HAL_OK) {
                system_clock_source = CLOCK_SOURCE_PLL;
                return;
            }
        }
        
        // Notify application of persistent HSE failure
        pm_post_event(PM_EVENT_CLOCK_FAILURE);
    }
}
```

## Clock Output (MCO) Configuration

```c
// MCO (Microcontroller Clock Output) lets you route internal clocks to
// an external pin for measurement. Essential for debugging and verification.

typedef enum {
    MCO_SRC_HSI,
    MCO_SRC_HSE,
    MCO_SRC_PLL,
    MCO_SRC_SYSCLK,
    MCO_SRC_LSE,
} mco_source_t;

typedef struct {
    mco_source_t source;
    uint8_t      prescaler;  // /1, /2, /3, /4, /5
} mco_config_t;

hal_err_t mco_configure(const mco_config_t* cfg) {
    // Configure MCO output pin (typically PA8 on STM32)
    // Pin must be in alternate function mode, high speed
    
    // Set MCO source and prescaler
    RCC->CFGR = (RCC->CFGR & ~(RCC_CFGR_MCOSRC_Msk | RCC_CFGR_MCOPRE_Msk))
              | (cfg->source << RCC_CFGR_MCOSRC_Pos)
              | (cfg->prescaler << RCC_CFGR_MCOPRE_Pos);
    
    // Now measure with an oscilloscope or frequency counter on the MCO pin.
    // Verify: actual frequency = source frequency / prescaler
    
    return HAL_OK;
}

// Usage: Verify SYSCLK is 168 MHz as configured
//   mco_config_t cfg = { .source = MCO_SRC_SYSCLK, .prescaler = 5 };
//   mco_configure(&cfg);
//   // Expect 168 MHz / 5 = 33.6 MHz on MCO pin
```

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll just use the default clock configuration" | The default is usually HSI at 8-16 MHz with no PLL. If you need USB, CAN, or high-speed UART, the default won't work. If you need low power, HSI wastes current compared to a sleep-calibrated configuration. |
| "PLL calculation is one-time, I'll do it manually" | PLL dividers have interdependent constraints (VCO range, USB=48MHz, maximum SYSCLK). One wrong divider and your UART baud rate is off by 3% — enough to cause framing errors. Automate the calculation. |
| "HSI is accurate enough for UART" | HSI tolerance is ±1% at 25°C, but ±3% or worse across -40 to +85°C and voltage variation. UART tolerates about ±2% baud mismatch before errors occur. At 85°C, HSI may be out of spec for UART. |
| "I don't need clock gating, there's plenty of power budget" | An idle UART peripheral draws 100-300 µA. Ten idle peripherals = 1-3 mA wasted. Over the life of a battery-powered device, that's months of runtime lost. |
| "The PLL locked, so the clock is correct" | PLL lock only means the VCO is phase-locked to the reference — it says nothing about the output divider chain. Your PLLP divider could still be wrong, producing the wrong SYSCLK. Verify with MCO. |
| "Clock failure is a hardware problem, firmware can't fix it" | CSS + HSI fallback lets firmware continue in degraded mode instead of locking up. A broken crystal shouldn't brick your device — it should trigger a safe fallback. |

## Red Flags

- PLL dividers calculated manually without cross-checking VCO input/output range against the datasheet
- Flash wait states not updated when changing SYSCLK frequency
- CLOCK SOURCE SWITCHED BEFORE CONFIGURING THE NEW SOURCE (e.g., switching to PLL before PLL is locked)
- APB1/APB2 timer clocks doubled without realizing the prescaler ≠ 1 causes TIMCLK = APBCLK × 2
- UART baud rate computed assuming the wrong APB clock frequency
- USB never enumerates because PLLQ doesn't produce exactly 48 MHz
- Clock gating disabled peripherals while forgetting to disable their interrupts first
- CSS not enabled on HSE in production firmware
- HSE startup timeout set too short for the crystal (some crystals need 2-5 ms to stabilize; check crystal datasheet)
- MCO enabled and left on in production (pin toggling at RF frequencies = EMI nightmare)

## Verification

After configuring the clock tree:

- [ ] SYSCLK frequency verified with MCO output + oscilloscope (or frequency counter)
- [ ] HCLK, APB1, APB2 frequencies match intended values (read back from RCC registers and cross-check)
- [ ] PLL lock confirmed (PLLRDY flag set); PLL VCO within datasheet range
- [ ] Flash wait states set correctly for target SYSCLK frequency
- [ ] USB clock (if used) verified at exactly 48 MHz (measure or test with USB enumeration)
- [ ] UART loopback test at max baud rate passes (proves clock accuracy for serial comms)
- [ ] Clock Security System tested: disconnect/damage HSE, verify system falls back to HSI and continues operating
- [ ] Every peripheral's clock source traced: what clock does this USART use? Show the full path from SYSCLK.
- [ ] Clock gating verified: after deinit, the peripheral's clock enable bit is cleared in RCC registers
- [ ] Deep sleep entry/exit: verify HSE and PLL are stopped in deep sleep, restarted on wake-up
- [ ] Negative test: switch SYSCLK to PLL before PLL is enabled → verify function returns error, not a bus fault
- [ ] Negative test: disable a peripheral's clock, then access its registers → verify driver returns error, not a bus fault

## After This Skill

Once clock configuration is designed and verified:

| Next Step | Skill | What It Produces |
|-----------|-------|-----------------|
| Peripheral driver init | `peripheral-driver-design` | Each driver enables its clock at init, disables at deinit |
| Power management | `power-management` | Clock gating per power state; wake-up clock strategy |
| Board-level oscillator selection | `hardware-architecture-design` | Crystal specs, load capacitors, PCB routing constraints |
| System timing analysis | `rtos-and-concurrency` | SysTick configuration for RTOS tick, timer allocation |
