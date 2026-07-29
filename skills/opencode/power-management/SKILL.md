---
name: power-management
description: 电源管理设计：DVFS、电源状态机（Run/Sleep/DeepSleep/Standby/Shutdown）、PMIC配置、电压调节、功耗预算、电源域分区、电池寿命估算、功耗剖析方法。Power management design — DVFS, power state machines (Run/Sleep/DeepSleep/Standby/Shutdown), PMIC configuration, voltage regulation, power budget calculation, power domain partitioning, battery life estimation, and power profiling methodology. Use when the user says 电源管理, 低功耗, DVFS, PMIC, power management, sleep mode, power budget, 功耗预算, or when designing power-aware embedded firmware.
---
# Power Management Design

## Overview

Power management in embedded systems is not an afterthought — it is a first-class architectural concern that determines battery life, thermal envelope, and system reliability. Every microamp saved in sleep mode extends battery life by hours. Every voltage rail sequenced incorrectly risks latch-up. This skill covers the full power management stack: DVFS algorithm design, PMIC communication, power state machines, power domain partitioning, power budgeting, and profiling methodology.

A well-designed power management system answers these questions before any code is written: What is the power budget for each operating mode? Which peripherals are clocked in each sleep state? What is the wake-up latency from each state? How does the PMIC handle brown-out and over-current?

## When to Use

- Designing power management for a battery-powered embedded device
- Configuring a PMIC (I2C-controlled or pin-strapped voltage regulators)
- Implementing DVFS (Dynamic Voltage and Frequency Scaling) on Cortex-M or Cortex-A
- Defining power state transitions (Run → Sleep → DeepSleep → Standby → Shutdown)
- Partitioning the SoC into independently-gated power domains
- Estimating battery life from firmware power budgets
- Debugging unexpected power consumption (device drains battery too fast, regulator overheating)
- Responding to brown-out detection or power-good failure events

**When NOT to use:** Selecting a PMIC part number (that's hardware selection, see `hardware-architecture-design`), debugging a single peripheral's register-level clock gating (use datasheet directly), or designing AC-DC power supplies (this skill covers embedded firmware-side power management, not power electronics).

## Power State Machine Design

### The Standard Five-State Model

Every embedded power management system should define a clear state machine. The names vary by vendor, but the semantics are universal:

```
Power State Transition Diagram:

    ┌──────────────────────────────────────────────────────────┐
    │                                                          │
    ▼                                                          │
 ┌──────┐   WFI/WFE    ┌───────┐   SLEEPDEEP   ┌───────────┐
 │ RUN  │ ───────────→ │ SLEEP │ ────────────→ │ DEEPSLEEP │
 │      │ ←─────────── │       │ ←──────────── │           │
 └──────┘  ISR event   └───────┘  wake source   └───────────┘
    │                       │                       │
    │                       │                       │
    │    ┌──────────────────┼───────────────────────┘
    │    │                  │
    ▼    ▼                  ▼
 ┌──────────┐         ┌──────────┐
 │ STANDBY  │         │ SHUTDOWN │
 │ (SRAM     │         │ (RTC-only │
 │  retained)│         │  or OFF)  │
 └──────────┘         └──────────┘
```

### State Definition Template

```c
typedef enum {
    POWER_STATE_RUN,         // CPU running, all clocks on, full performance
    POWER_STATE_SLEEP,       // CPU halted (WFI/WFE), peripherals clocked, fast wake
    POWER_STATE_DEEPSLEEP,   // High-speed clocks off, only LSI/LSE running, SRAM retained
    POWER_STATE_STANDBY,     // Core power off, SRAM retained in backup domain, RTC running
    POWER_STATE_SHUTDOWN,    // All power domains off except RTC backup (or fully off)
} power_state_t;

typedef struct {
    power_state_t state;
    uint32_t      entry_latency_us;    // Time to enter this state
    uint32_t      exit_latency_us;     // Time to wake up from this state
    uint32_t      current_consumption_ua; // Typical current at 3.3V
    const char*   wake_sources;        // What can wake from this state
} power_state_descriptor_t;

// Define for each state on your MCU:
// NOTE: These are EXAMPLE values for STM32L4 @ 3.3V, 25°C, flash off in sleep.
// ALWAYS check YOUR MCU's datasheet for actual numbers.
// Actual currents vary with voltage, temperature, flash wait states, and enabled peripherals.
const power_state_descriptor_t power_states[] = {
    [POWER_STATE_RUN]       = { RUN,        0,      0,   5500, "N/A (active)" },
    [POWER_STATE_SLEEP]     = { SLEEP,      2,      3,   1800, "Any interrupt" },
    [POWER_STATE_DEEPSLEEP] = { DEEPSLEEP, 10,     20,    120, "EXTI, RTC, LPUART, LPTIM" },
    [POWER_STATE_STANDBY]   = { STANDBY,   50,     80,      2, "WKUP pin, RTC alarm" },
    [POWER_STATE_SHUTDOWN]  = { SHUTDOWN,  80,    300,     0.3, "WKUP pin, RTC" },
};
```

### State Transition Implementation

```c
// Central power state manager — ONE place that decides which state to enter.
// Scattered pm_sleep() calls in driver code = unpredictable behavior.

power_state_t pm_get_target_state(void) {
    // Decision logic: what's the deepest state we can enter?
    
    // Check if any task holds a "stay awake" lock
    if (pm_wake_lock_count() > 0) {
        return POWER_STATE_RUN;
    }
    
    // Check pending work
    uint32_t next_deadline_us = scheduler_get_next_deadline();
    
    if (next_deadline_us < SLEEP_MIN_DURATION_US) {
        return POWER_STATE_SLEEP;  // Quick nap — something due soon
    }
    
    if (next_deadline_us < DEEPSLEEP_MIN_DURATION_US) {
        // Check if deepsleep wake sources can meet the deadline
        if (pm_can_wake_in_time(POWER_STATE_DEEPSLEEP, next_deadline_us)) {
            return POWER_STATE_DEEPSLEEP;
        }
        return POWER_STATE_SLEEP;
    }
    
    // Long idle period — consider deeper states
    if (!pm_peripherals_need_retention()) {
        return POWER_STATE_STANDBY;
    }
    
    return POWER_STATE_DEEPSLEEP;
}

hal_err_t pm_enter_state(power_state_t target) {
    power_state_t current = pm_get_current_state();
    
    // 1. PRE-SLEEP: Notify drivers
    for (int i = 0; i < num_pm_clients; i++) {
        pm_clients[i]->pre_sleep_callback(target);
    }
    
    // 2. Configure wake sources for target state
    pm_configure_wake_sources(target);
    
    // 3. Gate clocks based on target state
    pm_configure_clock_gating(target);
    
    // 4. Configure voltage regulator (if PMIC available)
    pmic_configure_for_state(target);
    
    // 5. Enter the hardware sleep mode
    hal_err_t err = HAL_PWR_EnterSleepMode(target);
    
    // 6. POST-WAKE: Restore clocks and notify drivers
    pm_restore_clocks();
    for (int i = 0; i < num_pm_clients; i++) {
        pm_clients[i]->post_wake_callback(target);
    }
    
    return err;
}
```

### Wake Lock Pattern

```c
// Prevent the system from entering deep sleep when critical operations
// are in progress. Every lock MUST have a matching unlock.

typedef uint32_t pm_wake_lock_t;

pm_wake_lock_t pm_wake_lock_acquire(const char* reason);
void pm_wake_lock_release(pm_wake_lock_t lock);

// Usage:
void critical_spi_transfer(void) {
    pm_wake_lock_t lock = pm_wake_lock_acquire("SPI flash write");
    flash_write_page(addr, data);
    pm_wake_lock_release(lock);
    // Now the system can sleep again
}

// NEVER: hold a wake lock indefinitely. Set a timeout.
// If a lock is held > 5 seconds, log a warning — it's a bug.
```

## PMIC Communication and Configuration

### I2C Command Sequences

```c
// PMIC communication via I2C — the most common interface.
// PMICs are register-mapped devices. Every voltage rail, every LDO,
// every power-good threshold is a register.

typedef struct {
    uint8_t i2c_addr;        // 7-bit address
    uint8_t reg_voltage;     // Register for voltage setting (e.g., 0x20 for BUCK1)
    uint8_t reg_enable;      // Register for enable/disable control
    uint8_t reg_status;      // Register for fault status
    uint8_t reg_pgood;       // Register for power-good indicators
} pmic_rail_config_t;

// Configure a voltage rail:
hal_err_t pmic_set_voltage(uint8_t i2c_addr, uint8_t rail_reg, 
                            uint32_t voltage_mv) {
    // Convert mV to register value using PMIC's voltage step
    // Example: MP2143DJ step = 10mV, VREF = 600mV
    // VOUT = VREF * (1 + R1/R2) — check your PMIC's formula
    uint8_t reg_val = voltage_mv_to_reg(voltage_mv);
    return i2c_write_reg(i2c_addr, rail_reg, reg_val);
}

// Power-on sequence — ORDER MATTERS:
hal_err_t pmic_power_on_sequence(void) {
    // Sequence defined by SoC datasheet, NOT by firmware preference.
    // Wrong sequence → latch-up or unreliable boot.
    
    hal_err_t err;
    
    // Step 1: Enable always-on rails (RTC, backup domain)
    err = pmic_enable_rail(RAIL_VDD_RTC);
    if (err) return err;
    rtos_delay_ms(1);  // Rail stabilization time from PMIC datasheet
    
    // Step 2: Core voltage before I/O voltage
    err = pmic_set_and_enable(RAIL_VDD_CORE, CORE_VOLTAGE_MV);
    if (err) return err;
    rtos_delay_ms(2);
    
    // Step 3: I/O rails
    err = pmic_set_and_enable(RAIL_VDD_IO, IO_VOLTAGE_MV);
    if (err) return err;
    rtos_delay_ms(1);
    
    // Step 4: Analog rails (ADC, DAC, PLL)
    err = pmic_set_and_enable(RAIL_VDDA, ANALOG_VOLTAGE_MV);
    if (err) return err;
    rtos_delay_ms(1);
    
    // Step 5: Verify all power-good signals
    for (int i = 0; i < NUM_RAILS; i++) {
        if (!pmic_read_power_good(rails[i])) {
            LOG_ERROR("Power-good failed for rail %d", i);
            return HAL_ERR_POWER_FAIL;
        }
    }
    
    return HAL_OK;
}
```

### Brown-Out and Over-Current Handling

```c
// PMIC fault interrupt handler — must be fast, must be safe
void PMIC_FAULT_IRQHandler(void) {
    uint8_t fault_status;
    i2c_read_reg(PMIC_I2C_ADDR, PMIC_REG_FAULT, &fault_status, 1);
    
    if (fault_status & PMIC_FAULT_BROWNOUT) {
        // Input voltage sagged below threshold.
        // Save critical state immediately — shutdown coming.
        pm_save_critical_state();
        // Optional: If brown-out is transient, wait and check again
        rtos_delay_ms(10);
        if (pmic_still_brownout()) {
            pm_shutdown_system();
        }
    }
    
    if (fault_status & PMIC_FAULT_OVERCURRENT) {
        // A rail is drawing too much current.
        // Identify which rail and disable it if not safety-critical.
        uint8_t oc_rail = pmic_get_overcurrent_rail();
        LOG_CRITICAL("Over-current on rail %d", oc_rail);
        if (oc_rail != RAIL_VDD_CORE) {  // Never disable core rail
            pmic_disable_rail(oc_rail);
        }
    }
    
    if (fault_status & PMIC_FAULT_OVERTEMP) {
        // PMIC overheating. Throttle or shutdown.
        LOG_CRITICAL("PMIC over-temperature!");
        pm_thermal_throttle();
    }
}
```

## DVFS (Dynamic Voltage and Frequency Scaling)

### Algorithm Design

```c
// DVFS is a feedback control loop: measure CPU load → adjust frequency/voltage.
// Simpler than it sounds on Cortex-M: you typically switch between a few
// pre-characterized operating points rather than continuous scaling.

typedef struct {
    uint32_t cpu_freq_hz;     // HCLK frequency
    uint32_t voltage_mv;      // VDD_CORE voltage at this frequency
    uint32_t max_current_ma;  // Current draw at this point
} dvfs_operating_point_t;

// Pre-characterized operating points (from SoC datasheet or characterization):
const dvfs_operating_point_t dvfs_table[] = {
    { .cpu_freq_hz = 160000000, .voltage_mv = 1400, .max_current_ma = 45 },  // OP0: full speed
    { .cpu_freq_hz = 80000000,  .voltage_mv = 1200, .max_current_ma = 25 },  // OP1: medium
    { .cpu_freq_hz = 26000000,  .voltage_mv = 1000, .max_current_ma = 8  },  // OP2: low power
    { .cpu_freq_hz = 4000000,   .voltage_mv = 900,  .max_current_ma = 2  },  // OP3: ultra-low
};

// DVFS state machine:
typedef enum {
    DVFS_POLICY_PERFORMANCE,  // Always highest frequency
    DVFS_POLICY_BALANCED,     // Scale based on load
    DVFS_POLICY_POWERSAVE,    // Always lowest viable frequency
    DVFS_POLICY_ADAPTIVE,     // Learn workload patterns
} dvfs_policy_t;

hal_err_t dvfs_set_operating_point(uint8_t op_index) {
    const dvfs_operating_point_t* target = &dvfs_table[op_index];
    const dvfs_operating_point_t* current = dvfs_get_current();
    
    // DVFS transition order is CRITICAL:
    //   SCALE UP:   voltage first, then frequency
    //   SCALE DOWN: frequency first, then voltage
    // Wrong order → core runs at insufficient voltage → undefined behavior.
    
    if (target->cpu_freq_hz > current->cpu_freq_hz) {
        // Scaling UP: raise voltage first
        pmic_set_voltage(PMIC_ADDR, RAIL_VDD_CORE, target->voltage_mv);
        rtos_delay_us(100);  // Voltage ramp time from PMIC datasheet
        clock_set_hclk(target->cpu_freq_hz);
    } else {
        // Scaling DOWN: lower frequency first
        clock_set_hclk(target->cpu_freq_hz);
        rtos_delay_us(10);   // Clock stabilization
        pmic_set_voltage(PMIC_ADDR, RAIL_VDD_CORE, target->voltage_mv);
    }
    
    // Verify the transition
    uint32_t actual_freq = clock_get_hclk();
    uint32_t actual_mv = pmic_read_voltage(PMIC_ADDR, RAIL_VDD_CORE);
    
    if (actual_freq != target->cpu_freq_hz || actual_mv != target->voltage_mv) {
        LOG_ERROR("DVFS transition failed: freq=%lu (expected %lu), V=%lumV (expected %lumV)",
                  actual_freq, target->cpu_freq_hz, actual_mv, target->voltage_mv);
        return HAL_ERR_DVFS_FAIL;
    }
    
    return HAL_OK;
}
```

### Load Monitoring for Adaptive DVFS

```c
// Use the RTOS idle task's idle counter to estimate CPU load.
// Simple and effective — no additional hardware needed.

typedef struct {
    uint32_t idle_ticks_total;
    uint32_t measurement_period_ticks;
    uint8_t  current_op;
    uint8_t  high_load_count;   // Consecutive periods above threshold
    uint8_t  low_load_count;    // Consecutive periods below threshold
} dvfs_monitor_t;

// Called from the idle task hook:
void dvfs_idle_hook(void) {
    dvfs_ctx.idle_ticks_total++;
}

// Called periodically (e.g., every 100ms timer tick):
void dvfs_evaluate(void) {
    uint32_t total = dvfs_ctx.measurement_period_ticks;
    uint32_t busy = total - dvfs_ctx.idle_ticks_total;
    uint32_t load_pct = (busy * 100) / total;
    
    // Hysteresis: only change OP if load is consistently high/low
    if (load_pct > DVFS_UP_THRESHOLD_PCT) {
        dvfs_ctx.high_load_count++;
        dvfs_ctx.low_load_count = 0;
        if (dvfs_ctx.high_load_count >= DVFS_HYSTERESIS_COUNT) {
            dvfs_scale_up();
            dvfs_ctx.high_load_count = 0;
        }
    } else if (load_pct < DVFS_DOWN_THRESHOLD_PCT) {
        dvfs_ctx.low_load_count++;
        dvfs_ctx.high_load_count = 0;
        if (dvfs_ctx.low_load_count >= DVFS_HYSTERESIS_COUNT) {
            dvfs_scale_down();
            dvfs_ctx.low_load_count = 0;
        }
    } else {
        dvfs_ctx.high_load_count = 0;
        dvfs_ctx.low_load_count = 0;
    }
    
    // Reset for next period
    dvfs_ctx.idle_ticks_total = 0;
}
```

## Power Domain Partitioning

### Domain Design Strategy

```c
// Power domains let you turn off whole subsystems independently.
// Partition by FUNCTION, not by chip layout.

typedef enum {
    PD_ALWAYS_ON,       // RTC, PMIC I2C, wake-up logic — NEVER powered off
    PD_CPU_CORE,        // CPU, NVIC, SysTick — off in standby
    PD_HIGH_SPEED,      // PLL, high-speed oscillators, DDR PHY — off in deep sleep
    PD_PERIPHERAL,      // GPIO, UART, I2C, SPI — independently gated per peripheral
    PD_ANALOG,          // ADC, DAC, comparators, op-amps — high leakage, gate aggressively
    PD_RADIO,           // BLE/WiFi MAC+PHY — huge power draw, gate whenever idle
    PD_SRAM_RETENTION,  // SRAM in low-power retention mode — standby domain
} power_domain_t;

typedef struct {
    power_domain_t domain;
    bool           is_on;           // Current power state
    uint32_t       on_current_ua;   // Current draw when active
    uint32_t       off_leakage_na;  // Leakage even when "off"
    uint32_t       ramp_up_time_us; // Time to power up from off state
    void         (*pre_power_down)(void);   // Save state before power removal
    void         (*post_power_up)(void);    // Restore state after power restored
} power_domain_config_t;
```

### Power Budget Template

```markdown
## Power Budget: [Device Name / Operating Mode]

| Power Domain | Component | Voltage (V) | Active Current (mA) | Sleep Current (uA) | Duty Cycle (%) | Average Power (mW) |
|-------------|-----------|-------------|--------------------|--------------------|----------------|--------------------|--------------------|
| PD_CPU_CORE | Cortex-M4 @ 80MHz | 1.2 | 15.0 | 1.2* | 10% | 1.80 |
| PD_HIGH_SPEED | PLL + HSE | 1.2 / 3.3 | 3.0 | 0.0 | 10% | 0.36 |
| PD_PERIPHERAL | UART (idle) | 3.3 | 0.3 | 0.005 | 100% | 0.99 |
| PD_PERIPHERAL | I2C (active, 400kHz) | 3.3 | 2.0 | 0.001 | 5% | 0.33 |
| PD_RADIO | BLE TX (+0dBm) | 1.8 | 8.0 | 0.001 | 1% | 0.14 |
| PD_ANALOG | ADC (sampling) | 3.3 | 1.5 | 0.0 | 5% | 0.25 |
| PD_ALWAYS_ON | RTC + LSE | 1.2 | 0.001 | 0.001 | 100% | 0.001 |
| **TOTAL** | | | **29.8** | **1.2*** | | **3.87** |

*Sleep current assumes device in DEEPSLEEP with RTC wake-up.
**Battery life at 3.87mW average with 2000mAh Li-Po (3.7V nominal): ~1913 hours (~80 days)
```

## Power Profiling Methodology

### Instrumentation

```c
// Profile power consumption by instrumenting state transitions.
// For precision measurement, use an external power analyzer (Joulescope, Otii, Nordic PPK2).
// Software profiling gives relative comparisons, not absolute accuracy.

typedef struct {
    uint32_t timestamp_ms;    // When the state was entered
    uint32_t duration_ms;     // How long we stayed in this state
    power_state_t state;      // Which state
    uint32_t wake_reason;     // What woke us up
} power_trace_entry_t;

#define POWER_TRACE_SIZE 256
static power_trace_entry_t power_trace[POWER_TRACE_SIZE];
static volatile uint32_t trace_index;

void pm_trace_state_entry(power_state_t state) {
    uint32_t idx = trace_index++ % POWER_TRACE_SIZE;
    power_trace[idx].timestamp_ms = system_tick_ms();
    power_trace[idx].state = state;
}

void pm_trace_state_exit(uint32_t wake_reason) {
    uint32_t idx = (trace_index - 1) % POWER_TRACE_SIZE;
    power_trace[idx].duration_ms = system_tick_ms() - power_trace[idx].timestamp_ms;
    power_trace[idx].wake_reason = wake_reason;
}

// After a profiling run, analyze:
void pm_print_power_profile(void) {
    for (int i = 0; i < POWER_TRACE_SIZE && i < trace_index; i++) {
        printf("[%lu] State: %d, Duration: %lums, Wake: 0x%lx\n",
               power_trace[i].timestamp_ms,
               power_trace[i].state,
               power_trace[i].duration_ms,
               power_trace[i].wake_reason);
    }
    
    // Calculate duty cycle per state:
    //   state_pct = sum(duration for state) / total_time * 100
    //   avg_current = sum(state_pct * state_current) / 100
}
```

### Profiling Checklist

1. **Baseline measurement**: Measure idle current with nothing running. This is your floor.
2. **Per-peripheral measurement**: Enable one peripheral at a time, measure the delta. Build a current-per-peripheral table.
3. **State transition time**: Measure time to enter and exit each sleep state. This determines minimum sleep duration.
4. **Burst profiling**: Run a full operation cycle (sensor read → BLE TX → sleep), measure total charge consumed.
5. **Long-duration soak**: Run device for 24 hours, measure total energy used. Compare to power budget.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll optimize power consumption later" | Power management affects architecture (which oscillators to use, which sleep modes exist, wake-up latency budgets). Retro-fitting it means re-architecting. Design for it from day one. |
| "Sleep mode saves power, so I'll always go to the deepest sleep" | Every sleep state has entry/exit latency and energy cost. A 100us wake-up with 50us entry costs 150us. If your idle period is 200us, you save only 50us — and may use MORE energy due to state save/restore. Shallow sleep exists for a reason. |
| "The MCU datasheet says X uA in sleep, so I'll get X uA" | Datasheet numbers assume: all GPIOs are analog mode (no pull-ups leaking), all peripherals are clock-gated, no debugger is attached, temperature is 25°C. Your board has pull-ups, an active debugger, and runs at 60°C. Measure, don't trust. |
| "The PMIC reference schematic handles everything" | The PMIC powers up in its default configuration. Your SoC may need a different voltage, a different sequence, or different fault thresholds. Configuration is done in firmware — if you skip it, you're running on defaults. |
| "DVFS is only for application processors" | Cortex-M4 and M7 have run mode current scaling with frequency. Reducing from 160MHz to 80MHz can halve active current. If your device runs at full speed all the time, check if you actually need to. |
| "I'll use the watchdog as a wake-up timer" | Watchdog in sleep mode? Most MCUs gate the watchdog clock in deep sleep. Use RTC or LPTIM instead — they're designed as low-power wake-up sources. |

## Red Flags

- No power state machine defined — scattered `__WFI()` calls in random places
- Wake locks held for longer than a few seconds without logging
- Power-on sequence hardcoded with fixed delays instead of checking power-good signals
- DVFS transition that changes voltage and frequency simultaneously (order violation)
- Sleep current measurement taken with debugger attached (debugger keeps core alive)
- GPIO left as input with pull-up when board has no external pull-up (floating input = high leakage)
- PMIC faults ignored or treated as fatal without trying recovery
- No power profiling infrastructure — you don't know where the energy goes
- Power budget sums to "typical" datasheet values instead of measured values with margin
- Entering deep sleep without checking if DMA transfers are in progress

## Verification

After implementing power management:

- [ ] Power state machine diagram documented with entry/exit latencies and current per state
- [ ] Every power state transition verified: enter state, verify current drops to expected range, wake up, resume correctly
- [ ] Wake lock mechanism in place; all locks have matching unlocks
- [ ] PMIC power-on sequence matches SoC datasheet requirements (core before I/O; power-good verified per rail)
- [ ] DVFS transitions tested: scale up, scale down, verify voltage and frequency at each point
- [ ] Brown-out triggers orderly shutdown (not a crash)
- [ ] All GPIOs configured for minimum leakage in deep sleep (analog mode for unused pins, no floating inputs)
- [ ] Power budget matches measured consumption within ±20%
- [ ] Device survives a 24-hour soak test at worst-case ambient temperature
- [ ] Negative test: remove a wake lock intentionally, confirm system enters deep sleep after release
- [ ] Negative test: trigger PMIC over-current, confirm fault handler disables non-critical rail without crash
- [ ] Negative test: enter deep sleep while DMA is running, confirm DMA completes or is safely aborted

## After This Skill

Once power management is designed and verified:

| Next Step | Skill | What It Produces |
|-----------|-------|-----------------|
| Peripheral power control | `peripheral-driver-design` | Suspend/resume functions for each driver |
| Clock gating strategy | `clock-configuration` | Clock tree with gating points per power state |
| Board-level power | `hardware-architecture-design` | Power tree, PMIC selection, rail budgeting |
| System integration | `software-architecture-design` | Power manager module in firmware architecture |
