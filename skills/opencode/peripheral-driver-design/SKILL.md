---
name: peripheral-driver-design
description: Guides embedded peripheral driver design — HAL layering, DMA/interrupt/polling trade-offs, power-aware drivers, error handling, and configuration patterns. Use when writing drivers for I2C, SPI, UART, GPIO, ADC, PWM, or any MCU peripheral. Use when designing a Hardware Abstraction Layer that ports across MCU families.
---

# Peripheral Driver Design

## Overview

Design peripheral drivers that are correct, portable, testable, and efficient. A good driver abstracts the hardware without hiding it — the caller controls *what* happens without needing to know *which registers* to write. The driver handles the mechanics; the caller controls the policy.

This skill covers the patterns that appear in every peripheral driver: HAL layering, transfer mode selection (DMA/interrupt/polling), error handling, power awareness, and configuration design. It applies to I2C, SPI, UART, GPIO, ADC, PWM, I2S, CAN, and any other MCU peripheral.

## When to Use

- Writing a new peripheral driver from scratch
- Wrapping a vendor HAL behind your own interface
- Porting a driver between MCU families
- Deciding between DMA, interrupt, and polling for a specific use case
- Designing a driver that must work across multiple hardware revisions
- Adding power management to existing drivers

## The HAL Layering Principle

A well-layered driver stack separates concerns cleanly:

```
┌──────────────────────────────────────────────┐
│ Application Code                              │
│ → sensor_read(), display_update()             │
│   No hardware knowledge. Uses HAL API.        │
├──────────────────────────────────────────────┤
│ MCU-Independent HAL                           │
│ → uart_send(), i2c_transfer(), gpio_write()   │
│   Same API across all MCUs. Testable on host. │
├──────────────────────────────────────────────┤
│ MCU-Dependent HAL (implementation)            │
│ → STM32 UART vs NXP LPUART register-level     │
│   This is where the datasheet lives.          │
├──────────────────────────────────────────────┤
│ Board Support Package (BSP)                   │
│ → Pinmux, clock tree, external components     │
│   "On this board, UART0 TX is PA9."           │
└──────────────────────────────────────────────┘
```

### Layer Responsibility

| Layer | Knows About | Does NOT Know About |
|-------|------------|-------------------|
| **Application** | HAL API, data formats, business logic | Register addresses, MCU family, pin assignments |
| **MCU-Independent HAL** | Interface contract, error codes, transfer semantics | MCU-specific registers, clock configuration |
| **MCU-Dependent HAL** | Register maps, clock trees, DMA channels, interrupt numbers | Application logic, board-level wiring |
| **BSP** | Pin assignments, external component addresses, PCB-specific config | Register implementation details, application logic |

## Transfer Mode Selection

Every data-transfer peripheral (UART, SPI, I2C) faces the same choice:

| Mode | CPU Load | Latency | Best For |
|------|---------|---------|----------|
| **Polling** | 100% (blocks) | Lowest per-byte | Short transfers (< 10 bytes), boot code, emergency output |
| **Interrupt** | Low per-byte, high per-transfer (context switch) | ~1-10 µs | Medium transfers, sporadic data, UART debug console |
| **DMA** | ~0% during transfer | Setup overhead (~1 µs), then zero | Large transfers, continuous streaming, background operations |

### Decision Logic

```
How to choose:
├── Transfer < ~16 bytes AND caller can block?
│   └── → Polling. Setup overhead of DMA/ISR > transfer time.
├── Transfer is large (> 32 bytes) AND continuous?
│   └── → DMA. Zero CPU overhead during transfer, only setup/teardown.
├── Sporadic, variable-length data (UART RX, command responses)?
│   └── → Interrupt. DMA doesn't know message boundaries without help.
├── Need to sleep during transfer (RTOS)?
│   └── → DMA + semaphore (task sleeps, DMA completion ISR wakes it)
└── Combined? (e.g., UART TX = DMA, UART RX = interrupt for framing)
    └── → Mix modes. Different directions can use different mechanisms.
```

### Driver API for Multiple Modes

```c
// Let the caller select the mode at init time
typedef enum {
    UART_MODE_POLLING,
    UART_MODE_INTERRUPT,
    UART_MODE_DMA,
} uart_mode_t;

typedef struct {
    uart_mode_t  mode;
    uint32_t     baudrate;
    void*        rx_buffer;       // Required for interrupt/DMA modes
    size_t       rx_buffer_size;
    uart_rx_callback_t rx_callback;  // Called when data arrives (interrupt/DMA)
} uart_config_t;

// The driver handles mode switching internally.
// Caller selects mode based on their use case, not on driver internals.
```

## Power-Aware Driver Design

Peripherals consume power even when idle. A power-aware driver manages this:

```c
// Driver states with power implications:
typedef enum {
    DRIVER_STATE_UNINIT,     // Not initialized, no power
    DRIVER_STATE_STOPPED,    // Initialized but clock gated, pins in low-power state
    DRIVER_STATE_IDLE,       // Clocked, ready for operation
    DRIVER_STATE_ACTIVE,     // Transferring data
    DRIVER_STATE_SUSPENDED,  // Sleep mode: state saved, peripheral off
} driver_state_t;

// Power transitions:
// SUSPENDED ←→ STOPPED ←→ IDLE ←→ ACTIVE
// │                                │
// └── Entering deep sleep ─────────┘
//     (save config, disable clock, set pins to analog/low-power)

hal_err_t uart_suspend(uart_dev_t* dev);   // Save state, power off
hal_err_t uart_resume(uart_dev_t* dev);    // Restore state, power on
```

**Rule:** When the MCU enters deep sleep, every driver must either be suspended (state saved) or explicitly declared as a wake-up source. A driver left in ACTIVE while its clock is gated will cause a bus fault on the first register access.

## Error Handling Strategy

Peripheral errors are multi-layered. The driver must handle all levels:

```c
// Error taxonomy for peripheral drivers
typedef enum {
    // Communication errors (peripheral-specific)
    I2C_ERR_NACK,           // Slave didn't acknowledge
    I2C_ERR_ARBITRATION,    // Lost bus arbitration (multi-master)
    I2C_ERR_BUS_BUSY,       // Bus stuck (SDA held low)
    
    SPI_ERR_MODE_FAULT,     // Multi-master conflict
    SPI_ERR_OVERRUN,        // RX data lost (not read fast enough)
    
    UART_ERR_FRAMING,       // Stop bit not found
    UART_ERR_PARITY,        // Parity mismatch
    UART_ERR_OVERRUN,       // RX buffer full before read
    
    // Universal errors (all peripherals)
    HAL_ERR_TIMEOUT,        // Operation didn't complete in time
    HAL_ERR_DMA,            // DMA transfer error
    HAL_ERR_NO_DEVICE,      // Device not responding (I2C address scan failed)
    HAL_ERR_BUS_FAULT,      // Bus fault on register access (clock gated?)
} hal_err_t;
```

### Retry Strategy (Peripheral-Specific)

```c
// I2C: NACK may be transient (slave busy), retry a few times
hal_err_t i2c_write_with_retry(i2c_dev_t* dev, uint8_t addr, 
                                const uint8_t* data, size_t len) {
    for (int attempt = 0; attempt < 3; attempt++) {
        hal_err_t err = i2c_write(dev, addr, data, len);
        if (err == HAL_OK) return HAL_OK;
        if (err != I2C_ERR_NACK) return err;  // Don't retry non-NACK errors
        
        // NACK: slave likely busy. Small fixed delay before retry.
        rtos_delay_ms(2);  // 2ms is standard for I2C slave recovery
    }
    return I2C_ERR_NACK;  // Exhausted retries
}

// SPI: No inherent error detection. At minimum, check for overrun.
// UART: Framing/parity errors suggest baudrate mismatch or noise. Check config.
```

### Bus Stuck Recovery (I2C)

```c
// I2C SDA stuck low (slave holding bus after partial transaction):
void i2c_bus_recovery(i2c_dev_t* dev) {
    // 1. Configure SCL as GPIO output
    // 2. Toggle SCL 9 times (clock out any partial byte)
    for (int i = 0; i < 9; i++) {
        gpio_write(SCL_PIN, 0);
        delay_us(5);
        gpio_write(SCL_PIN, 1);
        delay_us(5);
    }
    // 3. Generate STOP condition: SDA low → SCL high → SDA high
    gpio_write(SDA_PIN, 0);
    gpio_write(SCL_PIN, 1);
    delay_us(5);
    gpio_write(SDA_PIN, 1);
    // 4. Reinitialize peripheral
    i2c_reinit(dev);
}
```

## Configuration Patterns

### Declarative Configuration

```c
// The caller describes WHAT they want. The driver figures out HOW.

// SPI configuration — declarative:
spi_config_t spi_cfg = {
    .mode       = SPI_MODE_MASTER,
    .clock_hz   = 8000000,          // 8 MHz — driver calculates prescaler
    .data_width = SPI_DATA_8BIT,
    .bit_order  = SPI_MSB_FIRST,
    .cpol       = SPI_CPOL_0,       // Clock polarity
    .cpha       = SPI_CPHA_0,       // Clock phase
    .cs_mode    = SPI_CS_AUTO,      // Driver manages CS
};

// GPIO configuration — declarative:
gpio_config_t gpio_cfg = {
    .pin        = GPIO_PIN_13,
    .mode       = GPIO_MODE_OUTPUT_PUSH_PULL,
    .pull       = GPIO_PULL_NONE,
    .speed      = GPIO_SPEED_LOW,     // For LEDs, don't need high speed
    .init_state = GPIO_STATE_LOW,     // Initial output level
};

// What the config struct does NOT contain:
// ✗ Register values (SPI_CR1 = 0x034C)
// ✗ Prescaler values (BRR = 2)
// ✗ MCU-specific flags
// Those are computed by the driver from the declarative values.
```

### Versioned Configuration for Backward Compatibility

```c
typedef struct {
    uint32_t version;     // Always first. V1=0x0100, V2=0x0200
    uint32_t baudrate;
    uint8_t  data_bits;
    uint8_t  stop_bits;
    // V2 added:
    uint8_t  flow_control;  // Driver checks: if (cfg->version >= 0x0200) use this
} uart_config_t;
```

## DMA Driver Patterns

### Double Buffering (Ping-Pong)

```c
// For continuous streaming (ADC, audio, UART RX), use ping-pong buffers:
// While DMA fills buffer A, the CPU processes buffer B. Then swap.

typedef struct {
    uint8_t buffer_a[DMA_BUF_SIZE];
    uint8_t buffer_b[DMA_BUF_SIZE];
    volatile uint8_t active_buffer;  // 0 = A being filled by DMA, 1 = B
    volatile bool    buffer_ready;   // Non-active buffer has data to process
} dma_pingpong_t;

void DMA_TransferComplete_IRQHandler(void) {
    dma_pingpong_t* pp = get_pingpong_ctx();
    
    // Swap buffers
    pp->active_buffer = !pp->active_buffer;
    pp->buffer_ready = true;
    
    // Reconfigure DMA to fill the now-free buffer
    uint8_t* next_buf = pp->active_buffer ? pp->buffer_a : pp->buffer_b;
    DMA->DST = (uint32_t)next_buf;
    DMA->CNT = DMA_BUF_SIZE;
    DMA->CR |= DMA_CR_EN;
    
    // Signal task to process the full buffer
    signal_processing_task();
}
```

### DMA Alignment Requirements

```c
// Common DMA alignment pitfalls:
// - DMA source/destination must be aligned to data width (word = 4-byte aligned)
// - DMA buffer must be in non-cacheable memory or cache must be managed
// - Some MCUs: DMA cannot access certain memory regions (e.g., CCM RAM on STM32)

// Check alignment at init time:
hal_err_t dma_init(void* src, void* dst, size_t size) {
    if (((uint32_t)src & 0x3) || ((uint32_t)dst & 0x3)) {
        return HAL_ERR_ALIGN;  // DMA requires word alignment
    }
    // ...
}
```

## GPIO Interrupt Debouncing

```c
// Hardware debouncing: a button press produces dozens of edges in ~10ms.
// Software approach: read the pin state after a delay, not on the first edge.

// Simple debounce (read after settling delay):
bool gpio_read_debounced(gpio_pin_t pin, uint32_t debounce_ms) {
    for (int attempt = 0; attempt < 4; attempt++) {
        bool initial = gpio_read(pin);
        rtos_delay_ms(debounce_ms);   // Wait for bouncing to settle
        bool settled = gpio_read(pin);
        if (initial == settled) {
            return initial;  // Stable reading
        }
        // Still bouncing — retry with a bit more time
        debounce_ms += 5;
    }
    // After 4 attempts, return the last reading (noisy button, but don't loop forever)
    return gpio_read(pin);
}

// Non-blocking debounce (preferred, especially in RTOS):
// For FreeRTOS:
void button_isr_handler(void) {
    // Schedule a software timer to read the pin after debounce period
    xTimerStartFromISR(debounce_timer, NULL);
}

void debounce_timer_callback(TimerHandle_t timer) {
    bool stable_state = gpio_read(BUTTON_PIN);
    if (stable_state == LOW) {
        button_event_t event = { .type = BUTTON_PRESS, .timestamp = now() };
        xQueueSend(button_queue, &event, 0);
    }
}

// For Zephyr:
// Use k_timer or k_delayed_work for debounce instead
```

## Driver Testing Without Hardware

If your HAL layer is properly separated, the MCU-independent layer can be tested on a host machine:

```c
// Mock the MCU-dependent layer for host testing
// In test file:
#include "hal_uart.h"

// Fake register-level implementation for testing
static uint8_t fake_tx_buffer[256];
static size_t fake_tx_len;

hal_err_t uart_send(uart_dev_t* dev, const uint8_t* data, 
                     size_t len, uint32_t timeout) {
    // Copy to fake buffer instead of writing to hardware
    memcpy(fake_tx_buffer, data, len);
    fake_tx_len = len;
    return HAL_OK;
}

// Now test the HAL contract:
void test_uart_rejects_null_buffer() {
    uart_dev_t* dev;
    uart_init(&dev, &default_config);
    assert(uart_send(dev, NULL, 10, 100) == HAL_ERR_PARAM);
}

void test_uart_rejects_zero_length() {
    uart_dev_t* dev;
    uart_init(&dev, &default_config);
    uint8_t data[] = "test";
    assert(uart_send(dev, data, 0, 100) == HAL_ERR_PARAM);
}

void test_uart_rejects_before_init() {
    uart_dev_t* dev = NULL;
    uint8_t data[] = "test";
    assert(uart_send(dev, data, 4, 100) == HAL_ERR_NOT_INITIALIZED);
}
```

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll use the vendor HAL as-is" | Vendor HALs work for demos. For production, their error handling is often minimal (return HAL_ERROR with no details), they're bloated, and the API is inconsistent across peripherals. Wrap them. |
| "Polling is simpler, I'll just poll" | Polling blocks the CPU. In an RTOS, a polling driver blocks the calling task. If the transfer takes 1ms, that's 1ms lost for everything else. |
| "DMA is always faster" | For transfers under ~16 bytes, DMA setup overhead exceeds the transfer time. Polling is faster for tiny transfers. |
| "Error handling is noise, the hardware doesn't fail" | I2C NACKs are routine (slave busy). SPI overruns happen under load. UART gets framing errors from noise. Hardware fails all the time — the driver must handle it. |
| "I don't need power management in the driver" | A driver that can't sleep means the MCU can't sleep. Power management is a driver-level concern, not an application-level one. |
| "The driver works, I don't need tests" | Peripheral drivers have complex state machines. Host-based testing catches 80% of bugs without hardware. The remaining 20% (timing, signal integrity) needs hardware — but that's 20%, not 100%. |

## Red Flags

- Register-level code in application files (e.g., `USART1->DR = byte` in main.c)
- Driver with no deinit/suspend functionality (resources and power can't be released)
- Busy-wait loops in driver code (`while (!(SPI->SR & SPI_SR_RXNE))`)
- Return codes are just 0 or -1 (no information about what failed)
- Config struct contains register values or prescaler numbers (not portable)
- Driver assumes a specific DMA channel (hardcoded, not configurable)
- Same driver code copy-pasted for each peripheral instance with slight modifications (template it or parameterize it)
- No timeout on blocking operations (a stuck I2C slave hangs the driver forever)

## Verification

After writing a peripheral driver:

- [ ] Driver compiles and runs on host machine for contract testing
- [ ] init()/deinit() pair works correctly (deinit → init again → driver functional)
- [ ] Error conditions tested: null pointers, zero length, uninitialized handle, timeout
- [ ] timeout_ms = 0 correctly means non-blocking; timeout_ms = HAL_MAX_DELAY blocks forever
- [ ] DMA mode: buffer alignment requirements documented and enforced
- [ ] ISR-safe functions documented and actually ISR-safe
- [ ] Power management: suspend/resume preserves and restores full driver state
- [ ] Negative test: access driver after deinit → returns HAL_ERR_NOT_INITIALIZED
- [ ] Negative test: I2C driver handles NACK, arbitration lost, and bus stuck
- [ ] Config struct versioned for backward compatibility
