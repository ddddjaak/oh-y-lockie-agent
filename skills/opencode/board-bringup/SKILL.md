---
name: board-bringup
description: 板级bring-up方法：最小BSP构建、UART控制台优先策略、时钟树bring-up顺序、DRAM/SDRAM初始化、逐外设上电验证、调试策略与仪表化、bring-up日志管理。Board bring-up methodology — minimal BSP construction, UART console first approach, clock tree bring-up sequence, DRAM/SDRAM initialization, peripheral-by-peripheral power-on verification, debug strategy and instrumentation, and bring-up log management. Use when the user says bringup, 上电调试, board bring-up, 首次上电, BSP, first boot, or when bringing up a new embedded hardware board.
---
# Board Bring-Up Methodology

## Overview

Board bring-up is the process of taking a newly assembled PCB from "unknown state" to "running application firmware reliably." It is fundamentally a debugging exercise disguised as a software task. Every step verifies a hardware assumption. A bring-up that takes two days instead of two weeks is one where every assumption was tested methodically, from power rails to clock trees to peripheral-by-peripheral smoke tests.

This skill covers the systematic bring-up methodology: pre-power checklist, first-signs-of-life verification, clock tree bring-up sequence, DRAM initialization, peripheral-by-peripheral power-on, debug strategy, and bring-up log management. The golden rule: change ONE thing at a time, verify it works, then move on. Changing two things at once means you don't know which one broke when it fails.

## When to Use

- First power-on of a newly assembled prototype PCB
- Bringing up a new board revision with hardware changes
- Porting firmware to a new MCU on a known board design
- Debugging a board that "worked before but doesn't now"
- Validating that all peripherals on a production board are functional
- Creating a factory test/programming procedure

**When NOT to use:** Writing the application firmware (that comes after bring-up), designing the PCB (use `hardware-architecture-design`), debugging a single software bug on a known-working board (use `embedded-debugging`), or writing peripheral drivers from scratch (use `peripheral-driver-design`).

## Pre-Power Checklist

### What to Check Before Applying Power

```
BEFORE connecting power to a new board:

1. ☐ VISUAL INSPECTION
   - Solder bridges between adjacent pins (especially QFN/BGA)
   - Tombstoned components (one end lifted off pad)
   - Correct component orientation (diodes, capacitors, ICs)
   - Missing components (compare to BOM and assembly drawing)
   - Solder balls/splatter causing shorts

2. ☐ RESISTANCE CHECKS (multimeter, board UNPOWERED)
   - Power rail to ground: should be >100Ω on low-voltage rails,
     >1kΩ on high-voltage rails. <10Ω = hard short — STOP, don't power.
   - Adjacent pins on connectors: no short between power and ground
   - Decoupling capacitors: no short across any cap (indicates IC internal short)
   - Measure VDD_CORE to GND, VDD_IO to GND, VDDA to GND separately.
     Each rail's impedance tells you if that domain is healthy.

3. ☐ POWER SEQUENCING CHECK (if PMIC on board)
   - Verify PMIC is not pre-programmed with wrong voltages.
     Many PMICs ship with default output that may exceed your SoC's max.
   - If PMIC has I2C, connect a bus analyzer BEFORE powering on
     and monitor the default register values on first power-up.

4. ☐ DEBUG HEADER CHECK
   - SWD/JTAG connector: verify SWCLK, SWDIO, NRST, GND are connected
   - UART console: verify TX, RX, GND are connected to the correct pins
   - No short between SWD pins and adjacent connector pins

5. ☐ POWER SUPPLY SETUP
   - Set current limit to ~100mA above expected idle current.
     If the board normally draws 50mA, set limit to 150mA.
     A short will trip immediately instead of burning traces.
   - Start at nominal voltage (3.3V or whatever the board expects).
   - Have a thermal camera or finger ready — hot components = short circuit.
```

### First Power-On Procedure

```c
// The first firmware to flash: a minimal LED blink or UART "hello world."
// This proves: CPU runs, clock works, GPIO works, debugger connects.
// NOTHING else. No RTOS, no drivers, no init beyond the bare minimum.

void minimal_startup(void) {
    // 1. Configure the system clock to a known-safe frequency
    //    Run from HSI (internal RC) — it always works if the chip has power.
    //    Don't touch PLL or HSE yet — we haven't verified the crystal.
    
    // 2. Enable the GPIO port for the LED pin
    // 3. Configure LED pin as push-pull output
    // 4. Blink the LED in an infinite loop
    
    while (1) {
        gpio_toggle(LED_PIN);
        for (volatile uint32_t i = 0; i < 1000000; i++);  // Simple delay
    }
}

// If this works, you've verified:
//   ✓ Power rails are up and stable
//   ✓ MCU is running (clock, reset, core)
//   ✓ Debugger can connect, flash, and debug
//   ✓ At least one GPIO pin works
//   ✓ The board is not dead on arrival
```

## Bring-Up Execution Plan

### Phase 1: First Signs of Life

```markdown
## Bring-Up Phase 1: First Signs of Life

Goal: Prove the MCU is alive and the debug interface works.

| Step | Action | Success Criteria | Time Est. |
|------|--------|-----------------|-----------|
| 1.1 | Power on board with current limit | Current < limit, no smoke | 1 min |
| 1.2 | Measure all voltage rails | All rails within ±5% of nominal | 5 min |
| 1.3 | Connect debugger (SWD/JTAG) | Debugger detects target MCU | 5 min |
| 1.4 | Flash minimal blink firmware | LED blinks at expected rate | 10 min |
| 1.5 | Verify reset button works | LED pattern restarts on reset | 2 min |

STOP HERE if any step fails. DO NOT proceed to Phase 2 without a
verified MCU, power rails, and debug interface.
```

### Phase 2: Console and Clock Tree

```markdown
## Bring-Up Phase 2: Console and Clock Tree

Goal: Get a UART console working and verify the clock tree.

| Step | Action | Success Criteria | Time Est. |
|------|--------|-----------------|-----------|
| 2.1 | Configure UART TX pin (simplest peripheral) | Oscilloscope shows UART signal on TX pin | 15 min |
| 2.2 | Output "Hello World" via UART (polling mode) | Text appears on terminal | 15 min |
| 2.3 | Enable HSE oscillator | HSE ready flag set within timeout | 10 min |
| 2.4 | Configure PLL and switch SYSCLK | MCO output confirms target frequency | 15 min |
| 2.5 | Verify peripheral clocks (APB1, APB2) | Register read-back matches config | 10 min |
| 2.6 | Enable UART RX (interrupt mode) | Characters echoed back correctly | 15 min |

The UART console is your lifeline. Get it working before ANYTHING else.
With a console, you have printf debugging. Without it, you're blind.
```

### Phase 3: Memory and Storage

```markdown
## Bring-Up Phase 3: Memory and Storage

Goal: Verify all memory works correctly.

| Step | Action | Success Criteria | Time Est. |
|------|--------|-----------------|-----------|
| 3.1 | SRAM march test (walking 1s, walking 0s, address test) | No errors across full SRAM | 15 min |
| 3.2 | External SDRAM/DRAM init (if present) | Init sequence completes, no timeout | 30 min |
| 3.3 | SDRAM march test | No errors across full SDRAM | 10 min/GB |
| 3.4 | Flash read test (read known pattern) | Pattern matches expected | 5 min |
| 3.5 | Flash erase + write + verify (one sector) | Written data reads back correctly | 10 min |
| 3.6 | ECC memory test (if enabled) | Single-bit errors corrected, double-bit handled | 15 min |
```

### Phase 4: Peripheral Smoke Tests

```markdown
## Bring-Up Phase 4: Peripheral-by-Peripheral Verification

Goal: Verify every peripheral works. ONE at a time.

| Step | Peripheral | Smoke Test | Success Criteria |
|------|-----------|------------|-----------------|
| 4.1 | GPIO (all) | Loopback: output high → read input high | All GPIOs read back correctly |
| 4.2 | I2C | Scan bus for devices (address 0x00-0x7F) | Expected devices respond, no ghost devices |
| 4.3 | SPI | Loopback: MOSI → MISO (wire jumper) | Sent data matches received data |
| 4.4 | UART (all channels) | Loopback: TX → RX (wire jumper) | Echo test at all baud rates |
| 4.5 | ADC | Read known voltage (VREF or GND) | Reading within ±5 LSB of expected |
| 4.6 | PWM | Output to scope | Correct frequency and duty cycle |
| 4.7 | Timer | Measure known interval | Drift < 100 ppm vs reference |
| 4.8 | RTC | Set time, power cycle, read time | Time matches elapsed time ±1 second |
| 4.9 | Watchdog | Enable, don't pet, verify reset | System resets within expected timeout |
| 4.10 | DMA | Memory-to-memory transfer | Data transferred correctly |
| 4.11 | USB (if present) | Enumerate as test device | Host recognizes device |
| 4.12 | Ethernet/WiFi/BLE | Ping or scan test | Network connectivity verified |
```

## DRAM/SDRAM Initialization

### The Bring-Up Sequence

```c
// DRAM initialization is often the hardest part of bring-up.
// It involves a complex sequence of controller register writes.
// The vendor usually provides reference code — USE IT, but verify.

typedef enum {
    DRAM_INIT_RESULT_OK,
    DRAM_INIT_TIMEOUT,
    DRAM_INIT_CALIBRATION_FAIL,
    DRAM_INIT_TRAINING_FAIL,
    DRAM_INIT_NO_DEVICE_DETECTED,
} dram_init_result_t;

dram_init_result_t dram_bring_up(void) {
    // 1. Configure DRAM controller clock (usually from PLL)
    // 2. Configure DRAM controller I/O timing (from DRAM datasheet)
    // 3. Bring DRAM out of self-refresh / power-up sequence
    // 4. Send initialization commands: Precharge All → Auto Refresh → Mode Register Set
    // 5. Perform ZQ calibration (impedance calibration)
    // 6. Run DQS gate training (align DQS strobe to DQ data window)
    // 7. Run write leveling (align CLK to DQS across multiple DRAM chips)
    
    // CRITICAL: The timing values (tRFC, tRCD, tRP, tWR, etc.) come from 
    // YOUR DRAM chip's datasheet, not from the MCU reference manual.
    // Wrong timing = DRAM appears to work but silently corrupts data.
    
    // After initialization, ALWAYS run a memory test:
    return dram_memory_test();
}

// Simplified march test — catches most DRAM issues:
dram_init_result_t dram_memory_test(void) {
    volatile uint32_t* base = (volatile uint32_t*)SDRAM_BASE;
    const size_t test_size = SDRAM_SIZE / sizeof(uint32_t);
    
    // Pattern 1: Walking 1s (data bus test)
    for (size_t i = 0; i < test_size; i++) {
        base[i] = 1u << (i % 32);
    }
    for (size_t i = 0; i < test_size; i++) {
        if (base[i] != (1u << (i % 32))) {
            LOG_ERROR("DRAM data bus error at offset 0x%zx: expected=0x%08lx, got=0x%08lx",
                      i, 1u << (i % 32), base[i]);
            return DRAM_INIT_TRAINING_FAIL;
        }
    }
    
    // Pattern 2: Walking 0s (inverse)
    for (size_t i = 0; i < test_size; i++) {
        base[i] = ~(1u << (i % 32));
    }
    for (size_t i = 0; i < test_size; i++) {
        if (base[i] != ~(1u << (i % 32))) {
            LOG_ERROR("DRAM data bus error at offset 0x%zx", i);
            return DRAM_INIT_TRAINING_FAIL;
        }
    }
    
    // Pattern 3: Address uniqueness test
    for (size_t i = 0; i < test_size; i++) {
        base[i] = (uint32_t)i;
    }
    for (size_t i = 0; i < test_size; i++) {
        if (base[i] != (uint32_t)i) {
            LOG_ERROR("DRAM address uniqueness error at offset 0x%zx: "
                      "expected=0x%08zx, got=0x%08lx", i, i, base[i]);
            return DRAM_INIT_TRAINING_FAIL;
        }
    }
    
    return DRAM_INIT_RESULT_OK;
}
```

## Debug Strategy and Instrumentation

### The Bring-Up Debug Hierarchy

```
Debug methods in order of cost and information:

1. LED blinks (cost: 0)
   → Proves: CPU runs, GPIO works, timing is in the ballpark.
   → Good for: "Is the board alive at all?"

2. GPIO toggles + oscilloscope (cost: one scope probe)
   → Proves: timing accuracy, ISR latency, function execution time.
   → Good for: "Is this ISR taking 5us or 50us?"

3. UART printf (cost: one GPIO pin + UART init)
   → Proves: UART works, clock is correct (baud rate).
   → Good for: state machine debugging, "what value is this variable?"
   → WARNING: printf changes timing. Don't use for timing-sensitive bugs.

4. Semi-hosting (cost: debugger connected)
   → printf to debugger console. No UART needed.
   → Good for: boards without UART available, early bring-up.
   → WARNING: changes timing even more than UART printf.

5. SWO / ITM trace (cost: one GPIO pin + debugger)
   → Hardware trace output. Minimal CPU overhead.
   → Good for: performance profiling, interrupt tracing.
   → Required: SWO pin connected on PCB.

6. ETM trace (cost: 4 GPIO pins + expensive debugger)
   → Full instruction trace. Every branch, every instruction.
   → Good for: "What happened in the 100us before the crash?"
   → Required: ETM pins connected on PCB.
```

### GPIO Toggle for Timing

```c
// Pin toggling is the embedded engineer's oscilloscope trigger.
// Reserve one GPIO (solder a test point!) for profiling.

#define PROFILE_PIN_SET()    (GPIOB->BSRR = (1 << 0))
#define PROFILE_PIN_CLEAR()  (GPIOB->BSRR = (1 << (0 + 16)))

// Usage: wrap functions to measure execution time
void measure_dram_init_time(void) {
    PROFILE_PIN_SET();
    dram_init();
    PROFILE_PIN_CLEAR();
    // Read pulse width on scope
}

void measure_isr_latency(void) {
    // In main loop:
    PROFILE_PIN_SET();
    trigger_software_interrupt();
    // In ISR:
    void ISR_Handler(void) {
        PROFILE_PIN_CLEAR();
        // Scope shows: time between pin set (main) and pin clear (ISR)
    }
}
```

### Bring-Up Log

```markdown
## Bring-Up Log Template

| Date | Phase | Step | Status | Duration | Notes |
|------|-------|------|--------|----------|-------|
| 2026-01-15 | 1.1 | Power-on | PASS | 5 min | All rails nominal. 3.3V=3.29, 1.2V=1.19. |
| 2026-01-15 | 1.4 | LED blink | FAIL | 30 min | No LED. Checked: LED polarity reversed. Fixed. |
| 2026-01-15 | 1.4 | LED blink | PASS | 5 min | LED blinks at ~1Hz. CPU alive! |
| 2026-01-15 | 2.2 | UART hello | FAIL | 1 hr | No output. TX pin = PA9 but connected to PA10 on board. Re-soldered jumper. |
| ... | ... | ... | ... | ... | ... |

Every failure and its root cause documented. This log becomes the basis
for the factory test procedure and serves as institutional memory for
the NEXT board bring-up.
```

## Peripheral Smoke Tests Detail

### I2C Bus Scan

```c
// First test: scan the I2C bus. Don't try to talk to specific devices
// until you know they're at the addresses you expect.

void i2c_bus_scan(uint8_t i2c_bus_num) {
    printf("Scanning I2C bus %d...\n", i2c_bus_num);
    
    int found = 0;
    for (uint8_t addr = 0x08; addr < 0x78; addr++) {
        // Send I2C start + address + write bit. Check for ACK.
        hal_err_t err = i2c_probe_address(i2c_bus_num, addr);
        if (err == HAL_OK) {
            printf("  Device found at 0x%02X (7-bit)\n", addr);
            found++;
        }
    }
    
    printf("Scan complete: %d devices found.\n", found);
    
    // Cross-reference with schematic:
    // Did you find every device you expected?
    // Did you find devices you DIDN'T expect (address conflicts)?
    // Any devices missing? Check power, I2C pull-ups, pin connections.
}
```

### SPI Loopback Test

```c
// Loopback: physically connect MOSI to MISO with a jumper wire.
// This tests everything from the SPI peripheral through the pins.
// If it works, the SPI peripheral and pin configuration are correct.

hal_err_t spi_loopback_test(spi_dev_t* dev) {
    uint8_t test_pattern[] = {0x00, 0xFF, 0x55, 0xAA, 0xA5, 0x5A};
    uint8_t rx_buffer[sizeof(test_pattern)];
    
    // Send and receive simultaneously (SPI is full-duplex)
    spi_transfer(dev, test_pattern, rx_buffer, sizeof(test_pattern), 100);
    
    // Verify received matches sent
    for (size_t i = 0; i < sizeof(test_pattern); i++) {
        if (rx_buffer[i] != test_pattern[i]) {
            LOG_ERROR("SPI loopback failed at byte %zu: sent=0x%02X, received=0x%02X",
                      i, test_pattern[i], rx_buffer[i]);
            return HAL_ERR_LOOPBACK;
        }
    }
    
    LOG_INFO("SPI loopback test PASSED");
    return HAL_OK;
}

// Without loopback: if the test fails, you don't know if it's TX, RX,
// pin mux, clock polarity, or clock phase. With loopback, if it passes,
// the peripheral is configured correctly — the issue is downstream.
```

### ADC Sanity Check

```c
// Read known voltages to verify ADC linearity and reference.
void adc_sanity_check(adc_dev_t* dev) {
    // 1. Read internal VREF channel (if available, e.g., 1.2V bandgap)
    uint16_t vref_raw = adc_read(dev, ADC_CHANNEL_VREFINT);
    printf("VREFINT raw: %u\n", vref_raw);
    
    // 2. Read a known-external-voltage channel (e.g., VDD/3 or GND)
    uint16_t gnd_raw = adc_read(dev, ADC_CHANNEL_GND);
    printf("GND raw: %u (should be near 0)\n", gnd_raw);
    
    // 3. Verify ADC values are within expected range
    if (gnd_raw > 50) {
        LOG_ERROR("ADC GND reading too high: %u — check reference voltage", gnd_raw);
    }
    
    // 4. Calculate VREF from factory calibration data (STM32 example)
    uint16_t vref_cal = *((uint16_t*)VREFINT_CAL_ADDR);
    uint32_t vdda_mv = 3300UL * vref_cal / vref_raw;
    printf("VDDA estimated: %lumV (nominal 3300mV)\n", vdda_mv);
    
    if (vdda_mv < 3100 || vdda_mv > 3500) {
        LOG_ERROR("VDDA out of range — check power supply");
    }
}
```

## Bring-Up Issue Escalation Process

```
When a bring-up step fails, follow this escalation:

1. CHECK YOUR ASSUMPTIONS (15 min)
   - Is the power rail up? Measure with multimeter.
   - Is the clock enabled? Check RCC registers.
   - Is the pin correctly assigned? Check schematic vs pinctrl.
   - Is the peripheral reset released? Check RCC reset registers.
   80% of bring-up issues are found here.

2. CHECK THE PHYSICAL CONNECTION (15 min)
   - Continuity test: buzz out each pin from MCU to peripheral.
   - Oscilloscope: probe the signal at BOTH ends (MCU pin and peripheral pin).
   - Check for solder bridges, cold joints, wrong component values.
   - Is the pull-up/pull-down resistor the right value?

3. SIMPLIFY THE TEST (30 min)
   - Remove the peripheral from the equation.
     Example: UART not working? Loopback TX to RX.
     Example: I2C device not responding? Try a different address or device.
   - Use the simplest possible configuration.
     Example: SPI at 1 MHz, not 50 MHz. Polling, not DMA.
   - Compare to a known-good board if available.

4. CONSULT DATASHEET AND ERRATA (30 min)
   - Check the silicon errata for your MCU revision.
   - Check the peripheral reference manual for "gotcha" notes.
   - Search for "Known Issues" in the vendor's forum/knowledge base.

5. ISOLATE WITH A MINIMAL TEST CASE (1 hr)
   - Write a test that ONLY tests this peripheral.
     No RTOS, no other drivers, no application logic.
     Bare-metal, superloop, one peripheral.
   - If the minimal test works but your full firmware doesn't,
     the issue is in your firmware integration, not the hardware.

6. ESCALATE TO HARDWARE TEAM (if all above fails)
   - Provide: schematic page, PCB layout snippet, oscilloscope captures,
     register dumps, and exactly what you've tried.
   - NEVER say "it doesn't work." Say: "I2C address 0x50 does not ACK.
     SDA and SCL are at 3.3V. I2C pull-ups are 4.7kΩ. Register dump shows
     I2C peripheral is enabled and clocked."
```

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll test all peripherals at once to save time" | If three peripherals don't work, you have no idea which is the root cause. Is it the I2C mux? The PMIC? The clock gating? Test one at a time. |
| "The board worked on the bench, it's fine" | Bench testing at 25°C with a lab power supply proves nothing about production at -20°C with a battery. The bring-up is the START of testing, not the end. |
| "I'll skip the memory test, DRAM init doesn't fail" | DRAM init can succeed with marginal timing and fail at temperature extremes. The first DRAM test catches these before they become field failures. |
| "The schematic is correct, the pin configuration must be wrong" | Schematics have errors. Pin assignments get swapped. Assemblers place the wrong value resistor. Check the board, not just your code. |
| "I don't need a bring-up log, I'll remember what I did" | Six months later, when board rev 2 has the same issue, you won't remember. The bring-up log is the most important deliverable of the bring-up. |
| "The UART is working at 115200, the clock must be correct" | UART at 115200 tolerates ±2% baud rate error. Your clock could be off by 1.9% and UART works fine, but USB or CAN might fail. Verify the clock with MCO + oscilloscope. |

## Red Flags

- Power applied to a new board without first checking resistance on power rails
- Proceeding to Phase 2 without a working LED blink or UART console
- Testing multiple new peripherals simultaneously (can't isolate failures)
- Not measuring actual voltages on the board (trusting the power supply display)
- DRAM init without running at least a walking-1s and address uniqueness test
- USB enumeration attempted before verifying the 48 MHz clock is correct
- No soldered test point for a spare GPIO (bring-up without a scope trigger is blind)
- Bring-up log that only has "PASS" entries (if everything passed, you weren't testing thoroughly)
- Clock tree not verified with MCO output — register values assume correct PLL lock
- Factory defaults not checked on PMIC before first power-on

## Verification

After board bring-up is complete:

- [ ] Pre-power checklist completed and documented (visual inspection, resistance checks, power sequencing)
- [ ] All voltage rails measured and within ±5% of nominal
- [ ] LED blink or UART "Hello World" on first power-on
- [ ] Clock tree verified with MCO + oscilloscope at target frequency
- [ ] SRAM march test passed (walking 1s, walking 0s, address uniqueness)
- [ ] External DRAM (if present) initialized and passed memory test
- [ ] Flash erase/write/verify passed on one sector
- [ ] Every peripheral listed in the schematic has been tested and results documented
- [ ] I2C bus scan matches expected devices from schematic
- [ ] SPI and UART loopback tests passed for all instances
- [ ] ADC reading known voltages within expected tolerance
- [ ] Watchdog test: system resets correctly when not petted
- [ ] Power consumption measured and within expected range for each operating mode
- [ ] Board operates for 1 hour continuously without unexpected resets or anomalies
- [ ] Bring-up log complete with all steps, results, timestamps, and root causes of failures
- [ ] Known issues documented: what doesn't work yet, why, and the plan to fix it

## After This Skill

Once board bring-up is complete:

| Next Step | Skill | What It Produces |
|-----------|-------|-----------------|
| Peripheral driver writing | `peripheral-driver-design` | Production-quality drivers for verified hardware |
| Application firmware | `software-architecture-design` | Full firmware architecture on verified BSP |
| Power optimization | `power-management` | Power profiling on real hardware |
| Factory test procedure | `test-plan-review` | Test plan derived from bring-up results |
| Production programming | `bootloader-design` | Secure boot + OTA on verified flash |
