---
name: api-and-interface-design
description: Guides stable embedded interface design — HAL layers, peripheral driver APIs, SDK contracts. Use when designing driver interfaces, defining module boundaries, creating configuration structs, or establishing contracts between firmware components. Use when designing APIs that downstream developers (SDK consumers) will call.
---

# Embedded Interface and HAL Design

## Overview

Design stable, well-documented interfaces for embedded systems that are hard to misuse. Good interfaces make the right thing easy and the wrong thing hard. This applies to HAL (Hardware Abstraction Layer) design, peripheral driver APIs, SDK contracts, and any boundary where one piece of firmware talks to another.

In embedded systems, interface design has unique constraints: memory allocation strategy must be explicit, ISR safety must be declared, blocking vs non-blocking must be clear, and the interface must work across toolchains and optimization levels.

## When to Use

- Designing a new HAL layer or peripheral driver API
- Defining module boundaries between firmware components
- Creating SDK APIs for downstream developers
- Establishing contracts between bootloader and application
- Designing configuration structs for peripherals (I2C, SPI, UART, GPIO, ADC)
- Changing existing public interfaces

## Core Principles

### Hyrum's Law (Embedded Edition)

> With a sufficient number of firmware images in the field, all observable behaviors of your driver will be depended on by somebody — including undocumented timing, register side-effects, and the order your init function touches hardware.

This means:
- **Every observable behavior is a potential commitment.** If `spi_transfer()` toggles a CS pin between words today, someone's code depends on that timing tomorrow.
- **Don't leak implementation details.** If users can observe the internal state machine, they will depend on it.
- **Plan for deprecation at design time.** See `deprecation-and-migration` for how to safely remove things.
- **Tests are not enough for embedded.** A function that works on your eval board may fail on a different board due to timing, voltage, or layout differences. Contract the behavior; test the contract on multiple targets.

### The HAL Layering Principle

```
┌─────────────────────────────────────┐
│  Application Logic                  │  ← Your business logic
├─────────────────────────────────────┤
│  MCU-Independent HAL (abstract)     │  ← uart_send(), gpio_write() — same API across MCUs
├─────────────────────────────────────┤
│  MCU-Dependent HAL (concrete)       │  ← STM32 UART vs NXP LPUART register-level impl
├─────────────────────────────────────┤
│  Board-Level (BSP)                  │  ← Pinmux, clock tree, external components
└─────────────────────────────────────┘
```

**Design rule:** The MCU-independent layer must be compilable and testable on a host machine. If you need hardware to test your HAL interface, the interface is too coupled to the implementation.

### 1. Contract First

Define the interface before implementing it. The header file is the contract — implementation follows:

```c
// hal_uart.h — THE CONTRACT (define this first)

// Opaque handle: caller never accesses internals
typedef struct uart_dev uart_dev_t;

// Configuration: all parameters the driver needs at init time
typedef struct {
    uint32_t baudrate;
    uint8_t  data_bits;       // 7, 8, 9
    uint8_t  stop_bits;       // 1, 2
    uint8_t  parity;          // UART_PARITY_NONE, _EVEN, _ODD
    uint8_t  flow_control;    // UART_FLOW_NONE, _RTS_CTS
    uint32_t rx_buffer_size;  // 0 = driver allocates default
    void*    rx_buffer;       // NULL = driver allocates; non-NULL = caller provides
} uart_config_t;

// Error codes: one consistent enum across the entire HAL
typedef enum {
    HAL_OK = 0,
    HAL_ERR_BUSY,
    HAL_ERR_TIMEOUT,
    HAL_ERR_PARAM,
    HAL_ERR_NOMEM,
    HAL_ERR_NOT_INITIALIZED,
    HAL_ERR_ALREADY_INITIALIZED,
    HAL_ERR_HW_FAULT,
} hal_err_t;

// API: verbs, consistent naming, clear ownership
hal_err_t uart_init(uart_dev_t** dev, const uart_config_t* config);
hal_err_t uart_send(uart_dev_t* dev, const uint8_t* data, size_t len, uint32_t timeout_ms);
hal_err_t uart_recv(uart_dev_t* dev, uint8_t* buf, size_t len, size_t* received, uint32_t timeout_ms);
hal_err_t uart_deinit(uart_dev_t* dev);  // Returns resources, powers down peripheral
```

**The contract answers these questions before a single line of implementation:**
- Who allocates memory? (caller provides buffer vs driver allocates)
- What blocks and what doesn't? (timeout_ms = 0 for non-blocking, HAL_MAX_DELAY for forever)
- What is ISR-safe and what isn't? (documented per function)
- What happens on error? (return code, not side-effect magic)

### 2. Opaque Handles — Hide Implementation

The caller never accesses the struct internals. This enforces the contract and allows the implementation to change without breaking callers:

```c
// In the public header (hal_uart.h):
typedef struct uart_dev uart_dev_t;  // Forward declaration only
hal_err_t uart_init(uart_dev_t** dev, const uart_config_t* config);

// In the implementation file (hal_uart.c):
struct uart_dev {
    USART_TypeDef* regs;         // MCU-specific register base
    uint8_t*       rx_buffer;
    uint32_t       rx_buffer_size;
    volatile bool  tx_busy;      // Internal state, invisible to caller
    // ... more private fields
};
```

**Why this matters for embedded:**
- Callers can't depend on register addresses or internal state
- Implementation can change between MCUs without changing the header
- Prevents the pattern: `dev->regs->DR = data;` appearing in application code

### 3. Consistent Error Semantics

Pick one error strategy and use it everywhere:

```c
// Option A: Return code + output parameters (preferred for embedded)
hal_err_t spi_transfer(spi_dev_t* dev, const uint8_t* tx, uint8_t* rx, size_t len);

// Option B: Error code in a status field (for complex peripherals)
hal_err_t adc_read(adc_dev_t* dev, uint16_t* value);
hal_err_t adc_get_status(adc_dev_t* dev, adc_status_t* status);

// Whatever you choose, be consistent. Don't have some functions return the error
// and others return the data with an error sentinel. A HAL with mixed error patterns
// is a HAL that callers get wrong.
```

**Error code design rules:**
- `0` = success (every time, across every function in the HAL)
- One enum for the entire HAL (not per-module enums that drift)
- Reserve ranges for module-specific errors if needed: `HAL_ERR_UART_BASE + 1`
- Never use `-1` or `NULL` as an error — they don't tell the caller what went wrong

### 4. ISR Safety Must Be Explicit

In embedded systems, a function might be called from main loop, thread context, or ISR. The contract must say which:

```c
/**
 * @brief Queue data for transmission. Starts DMA if idle.
 * 
 * @note ISR-SAFE: Yes. May be called from interrupt context.
 *       Does not block. Does not allocate memory.
 */
hal_err_t uart_send_async(uart_dev_t* dev, const uint8_t* data, size_t len);

/**
 * @brief Wait for transmission to complete.
 *
 * @note ISR-SAFE: No. Blocks caller. Must only be called from thread context.
 *       timeout_ms = 0 returns immediately.
 */
hal_err_t uart_send_sync(uart_dev_t* dev, const uint8_t* data, size_t len, uint32_t timeout_ms);
```

**ISR safety contract rules:**
- If a function is ISR-safe, say so explicitly in the doc comment and never change it
- ISR-safe functions: no blocking, no dynamic allocation, no mutex/semaphore take with wait
- If you must make an ISR-safe version of a blocking function, provide both (`_async` / `_sync` suffix convention)

### 5. Prefer Addition Over Modification

Extend interfaces without breaking existing firmware:

```c
// Step 1: Original config struct
typedef struct {
    uint32_t baudrate;
} uart_config_v1_t;  // or use a version field

// Step 2: Add a version field from the start (even if you think you won't need it)
typedef struct {
    uint32_t version;       // Always first field. v1 = 0x0100, v2 = 0x0200...
    uint32_t baudrate;
    uint8_t  data_bits;     // Added in v2 — driver checks version >= 0x0200
} uart_config_t;

// Step 3: The init function is version-aware
hal_err_t uart_init(uart_dev_t** dev, const uart_config_t* config) {
    if (config->version >= 0x0200) {
        // Use data_bits
    } else {
        // Default to 8 data bits for v1 callers
    }
}
```

**Compatibility rules:**
- Never change the size or layout of an existing config struct (add to the end, gated by version)
- Never change the meaning of an existing error code
- Never make a previously ISR-safe function blocking
- Never remove a public function — deprecate it with a migration path

### 6. Predictable Naming Conventions

| Pattern | Convention | Example |
|---------|-----------|---------|
| Module prefix | Lowercase, module name | `uart_`, `spi_`, `adc_` |
| Init/Deinit | `_init()`, `_deinit()` | `uart_init()`, `uart_deinit()` |
| Verbs | Action-oriented | `uart_send()`, `gpio_write()`, `adc_read()` |
| Non-blocking suffix | `_async` | `uart_send_async()` |
| Blocking suffix | `_sync` or default + timeout param | `uart_send(..., timeout_ms)` |
| ISR callback | `_callback_t` | `typedef void (*uart_rx_callback_t)(...)` |
| Config struct | `_config_t` | `uart_config_t`, `spi_config_t` |
| Error enum | `_err_t` | `hal_err_t` |
| Handle type | `_t` or `_dev_t` | `uart_dev_t` |

**Don't do:**
```c
// Bad: Inconsistent naming across modules, no prefix
void InitUART(...);
int SPISend(...);
uint16_t read_adc_value(...);  // Read vs read? ADC vs adc? no prefix = collision risk
MyDriverError error;            // What module? What convention?
```

## Peripheral Configuration Pattern

Configuration should be declarative — the caller describes what they want, not how to set registers:

```c
// Good: Declarative — what the caller wants
spi_config_t spi_cfg = {
    .version = SPI_CONFIG_VERSION,
    .mode = SPI_MODE_MASTER,
    .clock_hz = 10000000,       // 10 MHz — driver figures out prescaler
    .data_width = SPI_DATA_8BIT,
    .bit_order = SPI_MSB_FIRST,
    .cs_polarity = SPI_CS_ACTIVE_LOW,
    .dma_enable = true,
};
spi_init(&spi_dev, &spi_cfg);

// Bad: Imperative — tells the driver HOW to configure registers
// (leaks implementation, doesn't port across MCUs, fragile)
spi_dev->regs->CR1 = 0x034C;  // Magic number, MCU-specific, untestable
```

## Callback Registration Patterns

```c
// Callback type: clear signature, void* context for user data
typedef void (*uart_rx_callback_t)(uart_dev_t* dev, const uint8_t* data, 
                                    size_t len, void* user_context);

// Register callback with context (preferred — allows one callback per instance)
hal_err_t uart_set_rx_callback(uart_dev_t* dev, uart_rx_callback_t cb, void* context);

// The context pattern lets the caller pass a pointer to their own struct
// without needing globals:
typedef struct {
    uint8_t buffer[256];
    size_t  write_idx;
} my_app_data_t;

my_app_data_t app_data;
uart_set_rx_callback(uart, my_uart_rx_handler, &app_data);
```

**Callback rules:**
- Callbacks must be ISR-safe if the peripheral fires them from ISR context
- Document who owns data passed to the callback (caller frees? callback copies? driver persists?)
- Provide a way to unregister (`uart_set_rx_callback(dev, NULL, NULL)`)
- Never call a NULL callback — check before invoking

## DMA vs Interrupt vs Polling — Interface Implications

The choice of transfer mechanism affects the interface. Make it explicit:

```c
// Explicit transfer mode in config:
typedef enum {
    UART_MODE_POLLING,     // uart_send() blocks until done
    UART_MODE_INTERRUPT,   // uart_send_async() + callback on completion
    UART_MODE_DMA,         // uart_send_async() + DMA completion callback, zero CPU overhead
} uart_transfer_mode_t;

// The driver implementation handles the complexity internally.
// The caller only selects the mode at init time.
// This is the right abstraction — the mode is a configuration choice,
// not a different API surface.
```

## Testing the Interface on Host

If your HAL layer is properly abstracted, you can test it without hardware:

```c
// In tests/hal_uart_test.c — compiled and run on your dev machine
void test_uart_init_rejects_null_config() {
    uart_dev_t* dev = NULL;
    hal_err_t err = uart_init(&dev, NULL);
    assert(err == HAL_ERR_PARAM);
}

void test_uart_send_before_init() {
    uart_dev_t* dev = NULL;
    hal_err_t err = uart_send(dev, (uint8_t*)"hello", 5, 100);
    assert(err == HAL_ERR_NOT_INITIALIZED);
}

// The MCU-dependent layer is mocked/faked at this level.
// This catches contract violations before they hit hardware.
```

**If you can't test the interface on a host machine, the interface is too coupled to hardware.**

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "It's just a driver, the API doesn't matter" | Drivers live for years. A bad driver API creates bugs in every project that uses it. Design the interface as carefully as a public SDK. |
| "I'll use the vendor HAL as-is" | Vendor HALs are designed for breadth, not quality. Their APIs are often inconsistent across peripherals and bloated. Wrap them behind your own interface. |
| "Config structs don't need version fields" | You will add fields. Without a version field, you can't tell if the caller is using the old or new layout. Add version from day one. |
| "Everyone knows which functions are ISR-safe" | "Everyone knows" degrades to "nobody remembers" within months. Document ISR safety per function. |
| "Returning error codes is tedious, just return -1" | "-1" tells the caller nothing. Was it a timeout? A bad parameter? A hardware fault? Each needs different handling. Use an error enum. |
| "Opaque handles are over-engineering for a simple driver" | Transparent structs become permanent API. Every field is now a contract. Opaque handles cost one extra pointer dereference and save years of compatibility pain. |

## Red Flags

- Drivers exposing register-level details in public headers (USART_TypeDef* visible to application code)
- Inconsistent error handling (some functions return `int`, others return `hal_err_t`, others return `NULL`)
- Config structs without version fields
- Functions whose ISR safety is undocumented
- "You can't test it without the hardware" — indicates the interface is too coupled
- Peripheral names in the MCU-independent layer (e.g., `stm32_uart_init` instead of `uart_init`)
- `init()` without corresponding `deinit()` (resource leaks, power waste)
- Magic numbers in config struct initialization (use named constants from the HAL header)
- Callbacks without a `void* context` parameter (forces callers to use globals)

## Verification

After designing an embedded interface:

- [ ] Header file compiles on host machine without any MCU-specific headers
- [ ] Every function has documented: ISR-safety, blocking behavior, memory ownership
- [ ] Error codes use a single consistent enum across the HAL
- [ ] Config structs include a version field
- [ ] New fields are additive and gated by version checks
- [ ] Naming follows consistent conventions across all modules
- [ ] Opaque handles prevent caller access to internal struct fields
- [ ] init()/deinit() pairs exist for every resource-acquiring module
- [ ] Callbacks include a `void* context` parameter
- [ ] Interface tested on host for contract violations (null pointers, bad params, order violations)
