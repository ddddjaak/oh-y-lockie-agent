# Embedded Testing Patterns

Quick reference for embedded firmware testing. Use alongside `test-driven-development`.

## Table of Contents

- [Host-Based Unit Testing](#host-based-unit-testing)
- [HIL Testing](#hil-testing)
- [On-Target Testing](#on-target-testing)
- [Test Anti-Patterns](#test-anti-patterns)
- [Test Commands](#test-commands)

## Host-Based Unit Testing

### Framework: Ceedling + Unity + CMock

```bash
# Setup
gem install ceedling
ceedling new my_project

# Project structure
tests/
  test_uart_driver.c
  test_spi_driver.c
src/
  uart_driver.c
  spi_driver.c
```

### Test Structure

```c
// tests/test_uart_driver.c
#include "unity.h"
#include "mock_hal.h"
#include "uart_driver.h"

void setUp(void) { }
void tearDown(void) { }

void test_uart_init_sets_correct_baudrate(void) {
    uart_config_t cfg = {
        .version = UART_CONFIG_VERSION,
        .baudrate = 115200,
    };
    hal_mock_expect_clock_enable(UART1_CLOCK);
    
    uart_dev_t* dev;
    hal_err_t err = uart_init(&dev, &cfg);
    
    TEST_ASSERT_EQUAL(HAL_OK, err);
    TEST_ASSERT_NOT_NULL(dev);
}

void test_uart_init_rejects_null_config(void) {
    uart_dev_t* dev;
    hal_err_t err = uart_init(&dev, NULL);
    TEST_ASSERT_EQUAL(HAL_ERR_PARAM, err);
}

void test_uart_send_rejects_before_init(void) {
    hal_err_t err = uart_send(NULL, (uint8_t*)"hello", 5, 100);
    TEST_ASSERT_EQUAL(HAL_ERR_NOT_INITIALIZED, err);
}
```

### Mocking Pattern (CMock)

```c
// CMock generates mocks from headers
void test_i2c_read_retries_on_nack(void) {
    i2c_dev_t dev;
    uint8_t data;
    
    // First attempt: NACK, second: success
    hal_mock_i2c_read_ExpectAndReturn(&dev, 0x50, &data, 1, I2C_ERR_NACK);
    hal_mock_i2c_read_ExpectAndReturn(&dev, 0x50, &data, 1, HAL_OK);
    
    hal_err_t err = i2c_read_with_retry(&dev, 0x50, &data, 1);
    TEST_ASSERT_EQUAL(HAL_OK, err);
}
```

## HIL Testing

### Smoke Test (Python + pyOCD)

```python
# tests/hil/smoke_test.py
import serial, time

def test_boot_message():
    ser = serial.Serial('/dev/ttyACM0', 115200, timeout=5)
    line = ser.readline().decode().strip()
    assert "System ready" in line, f"Unexpected: {line}"

def test_led_toggle():
    # Use GPIO read-back or external measurement
    pass
```

### On-Target Self-Test

```c
void self_test(void) {
    // RAM test
    volatile uint32_t* test_addr = (uint32_t*)0x20001000;
    *test_addr = 0xAA55AA55;
    if (*test_addr != 0xAA55AA55) fault_handler();
    
    // Stack overflow guard
    assert(stack_used() < STACK_TOTAL * 0.7);
}
```

## Test Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| Testing on target only | Slow, expensive | Host tests for 80% of code |
| Mocking everything | Tests pass, HW fails | Mock only HW boundaries |
| No negative tests | Only happy paths | Test NULL params, timeouts, bad inputs |
| Flaky HIL tests | Erode trust | Add retries, log failures for post-mortem |
| Testing driver internals | Break on refactor | Test contract, not register writes |

## Test Commands

```bash
# Ceedling
ceedling test:all              # Run all tests
ceedling test:specific_test    # Run one test file

# CppUTest
make check                     # Build and run tests

# HIL (Python)
pytest tests/hil/ -v           # All HIL tests

# Size and stack check
make TARGET=all && make report
```
