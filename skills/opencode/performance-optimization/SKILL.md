---
name: performance-optimization
description: Optimizes embedded firmware performance. Use when running into memory limits, power budget constraints, real-time deadlines, or code size limits. Use when profiling reveals bottlenecks on an MCU. Covers stack/heap analysis, interrupt latency, power modes, and compiler optimization strategies.
---

# Embedded Performance Optimization

## Overview

Measure before optimizing. Performance work without measurement is guessing — and guessing in embedded systems leads to premature optimization that adds complexity without improving what actually matters. Profile first, identify the actual bottleneck, fix it, measure again.

In embedded systems, "performance" has four independent dimensions:
- **Memory** — stack depth, heap fragmentation, static allocation sizing
- **Power** — sleep current, wake latency, duty cycle optimization
- **Real-time** — interrupt latency, worst-case execution time, task deadlines
- **Code size** — flash footprint, link-time optimization, dead code elimination

Optimize only the dimension that measurements prove is the bottleneck. A device that's within its power budget doesn't need power optimization. A device with 200KB of free flash doesn't need code size optimization.

## When to Use

- Firmware doesn't fit in available flash or RAM
- Power consumption exceeds budget (battery life too short)
- Real-time deadlines are missed (interrupts not serviced in time)
- System behaves sluggishly under load
- Building features that push MCU limits
- After adding a feature that caused a regression in any of the four dimensions

**When NOT to use:** Don't optimize before you have evidence of a problem. Don't optimize code that isn't on the critical path. Don't trade correctness for performance.

## The Optimization Workflow

```
1. MEASURE   → Establish baseline with real data from the target
2. IDENTIFY  → Find the actual bottleneck (not assumed)
3. FIX       → Address the specific bottleneck
4. VERIFY    → Measure again on target, confirm improvement
5. GUARD     → Add assertion or CI check to prevent regression
```

### Where to Start Measuring

```
What's the symptom?
├── Firmware doesn't fit in flash
│   ├── Check: map file for largest sections and objects
│   ├── Check: is debug info being included in release build?
│   └── Check: are unused functions being linked in?
├── Stack overflow or near-overflow
│   ├── Check: fill stack with known pattern, inspect after runtime
│   ├── Check: ISR stack usage (nested interrupts double the usage)
│   └── Check: recursive functions, large local arrays
├── Heap fragmentation or exhaustion
│   ├── Check: are you allocating? In embedded, the answer should usually be "no"
│   └── Check: malloc/free call sites — are sizes predictable?
├── Missed real-time deadlines
│   ├── Check: worst-case ISR execution time (oscilloscope on a GPIO toggle)
│   ├── Check: longest critical section duration (interrupts disabled time)
│   └── Check: highest-priority task response time
├── Battery drains too fast
│   ├── Check: sleep current vs datasheet spec (is the MCU actually sleeping?)
│   ├── Check: wake-up frequency (are you waking more often than needed?)
│   └── Check: peripheral clocks — are unused peripherals clocked?
└── Code size growing
    ├── Check: map file for new contributors (which functions/objects grew?)
    └── Check: are unused functions being linked in? Check: are macro expansions causing code bloat?
```

## Dimension 1: Memory Optimization

### Stack Analysis

The stack is silent — overflow symptoms appear as random crashes, corrupted globals, or HardFaults. Don't guess; measure:

```c
// Stack watermark pattern (at startup, before RTOS starts)
#define STACK_FILL_PATTERN 0xDEADBEEF

// Fill the entire stack space with a known pattern
extern uint32_t _stack_bottom;  // From linker script
extern uint32_t _stack_top;     // From linker script

void stack_fill_watermark(void) {
    uint32_t* p = &_stack_bottom;
    while (p < &_stack_top) {
        *p++ = STACK_FILL_PATTERN;
    }
}

// After running the system under worst-case load, inspect:
size_t stack_used(void) {
    uint32_t* p = &_stack_bottom;
    size_t used = 0;
    // Check bounds FIRST, then dereference — short-circuit evaluation prevents OOB read
    while (p < &_stack_top && *p == STACK_FILL_PATTERN) {
        p++;
        used += 4;
    }
    return (&_stack_top - &_stack_bottom) * 4 - used;
}

// Rule: stack_used() should be < 70% of total stack in worst case.
// If it's 85%+, you're one nested interrupt away from overflow.
```

### Common Stack Killers

```c
// BAD: Large local arrays on the stack
void process_data(void) {
    uint8_t buffer[2048];  // This comes from the stack!
    // ...
}

// GOOD: Static allocation (if single-context) or pool allocation
static uint8_t buffer[2048];  // In .bss, accounted for at link time
void process_data(void) {
    // Use static buffer (with mutual exclusion if multi-context)
}

// BAD: Recursive functions without depth limit
int parse_config_object(char* data) {
    // ... recursion unbounded
}

// GOOD: Iterative with explicit depth limit
#define MAX_PARSE_DEPTH 8
int parse_config_object(char* data, int depth) {
    if (depth > MAX_PARSE_DEPTH) return ERR_TOO_DEEP;
    // ...
}
```

### Heap Strategy in Embedded

```
Decision tree for memory allocation:
├── Is the allocation size known at compile time?
│   └── YES → Static allocation or pool. Never malloc.
├── Does it need to persist across function calls?
│   └── NO → Stack (if small). Move to static if large.
├── Is it allocated once at boot and never freed?
│   └── YES → Static allocation initialized at startup.
├── Does it genuinely need dynamic lifetime?
│   └── YES → Use a fixed-size pool, not general-purpose heap.
│       ├── Pool of N fixed-size blocks (no fragmentation)
│       ├── Bounded freelist
│       └── Worst-case exhaustion is predictable
└── Avoid general-purpose malloc/free in production firmware.
    Fragmentation is cumulative and non-deterministic.
```

```c
// Pool allocator pattern (simple, deterministic, no fragmentation)
#define POOL_BLOCK_SIZE 64
#define POOL_BLOCK_COUNT 16

static uint8_t pool_memory[POOL_BLOCK_COUNT][POOL_BLOCK_SIZE];
static uint32_t pool_bitmap;  // One bit per block: 0 = free, 1 = allocated

void* pool_alloc(void) {
    int block = __builtin_ctz(~pool_bitmap);  // Find first free block
    if (block >= POOL_BLOCK_COUNT) return NULL;
    pool_bitmap |= (1 << block);
    return pool_memory[block];
}

void pool_free(void* ptr) {
    // Determine block index from pointer, clear bit
    int block = ((uint8_t*)ptr - (uint8_t*)pool_memory) / POOL_BLOCK_SIZE;
    pool_bitmap &= ~(1 << block);
}
```

## Dimension 2: Power Optimization

### Low-Power Mode Selection

| Mode | Wake Latency | Current (typical Cortex-M) | RAM Retained | When |
|------|-------------|---------------------------|-------------|------|
| **Run** | N/A | ~mA | Yes | CPU actively processing |
| **Sleep** | ~1 µs | ~µA to mA | Yes | Waiting for peripheral interrupt, short idle |
| **Deep Sleep** | ~10-100 µs | ~µA | Yes (if powered) | Longer idle periods, BLE advertising intervals |
| **Standby/Shutdown** | ~100 µs – ms | ~nA to µA | No (or small backup region) | Long idle, battery-powered sensors |

### Power Profiling Pattern

```c
// Instrument your idle loop to measure duty cycle
// Method: toggle a GPIO before/after sleep, measure with oscilloscope

#define POWER_PROFILE_PIN  GPIO_PIN_13  // Connect to scope or logic analyzer

void idle_loop(void) {
    while (1) {
        // GPIO HIGH = CPU awake
        gpio_set(POWER_PROFILE_PIN);
        
        // Do the work
        process_sensors();
        update_state();
        check_timers();
        
        // GPIO LOW = CPU sleeping
        gpio_clear(POWER_PROFILE_PIN);
        
        // Calculate sleep duration until next deadline
        uint32_t sleep_ms = time_until_next_event();
        if (sleep_ms > 0) {
            enter_sleep_mode(sleep_ms);  // Deepest sleep that meets wake latency
        }
    }
}

// On the scope: duty cycle = (HIGH time) / (HIGH + LOW time)
// Average current ≈ duty_cycle * I_run + (1 - duty_cycle) * I_sleep
// If duty cycle is 5% and you wanted 1%, you know where to focus.
```

### Common Power Wasters

- **Unused peripherals left clocked** — disable clocks to ADC, UART, SPI blocks not in use
- **Unnecessary wake-ups** — a 10ms tick waking the CPU when the next event is 500ms away
- **Busy-waiting instead of interrupt-driven** — `while (!transfer_complete())` burns mA
- **GPIOs floating** — floating inputs oscillate and draw current; configure unused pins as output-low or input with pull
- **PLL running in sleep** — switch to a lower-frequency internal oscillator before sleeping

## Dimension 3: Real-Time Optimization

### Interrupt Latency Diagnosis

```c
// Measure actual ISR latency by toggling a GPIO:
// GPIO set at the start of the ISR, compare with the trigger event on another pin.
// Use an oscilloscope or logic analyzer with at least 10MHz sample rate.

// Measure worst-case interrupt-disable time:
// NOTE: CMSIS __disable_irq() returns the previous PRIMASK state.
// For nested critical sections, save and restore instead of unconditional enable:
//   uint32_t primask = __get_PRIMASK();
//   __disable_irq();
//   // ... critical section ...
//   __set_PRIMASK(primask);  // Restore previous state, don't unconditionally enable
uint32_t max_disable_time = 0;

void critical_section_enter(void) {
    __disable_irq();
    // Start a hardware timer or toggle a GPIO
}

void critical_section_exit(void) {
    // Stop timer / toggle GPIO, update max_disable_time if larger
    __enable_irq();  // Safe only if this is the outermost critical section
}
```

### ISR Design Rules for Real-Time

```c
// Rule 1: ISRs do minimal work. Defer processing to a task or bottom-half.
// BAD: Parsing a packet in the ISR
void UART_IRQHandler(void) {
    uint8_t byte = UART->DR;
    // ... parser state machine, checksum verification, buffer management
    // This ISR is 500 cycles long and blocks everything.
}

// GOOD: ISR buffers the byte, signals a task to process
void UART_IRQHandler(void) {
    uint8_t byte = UART->DR;
    ring_buffer_put(&uart_rx_ring, byte);
    rtos_signal_from_isr(uart_task_handle, UART_RX_SIGNAL);
    // ISR is < 20 cycles. Processing happens at task priority.
}

// Rule 2: All ISRs at the same priority level block each other.
// Assign priorities based on deadline urgency.

// Rule 3: No floating point in ISRs unless you save/restore FPU context
// (many MCUs don't auto-save FPU registers in ISR context).
```

### Priority Inversion and Mitigation

```
Scenario: Low-priority Task A holds a mutex.
          High-priority Task C preempts, tries to take the same mutex → blocks.
          Medium-priority Task B preempts and runs for a long time.
          Task C is stuck waiting for A, but A can't run because B has the CPU.
          Result: Task C's deadline is missed even though it has the highest priority.

Solution: Priority inheritance on the mutex.
          When C blocks on the mutex A holds, A's priority is temporarily raised
          to C's priority. B can't preempt A. A finishes, releases mutex, C runs.

Check: Does your RTOS support priority inheritance? (FreeRTOS: configUSE_MUTEXES must be enabled; priority inheritance is built into mutexes)
       Zephyr: enabled by default for priority-ceiling mutexes)
```

## Dimension 4: Code Size Optimization

### Linker Map File Analysis

The linker map file tells you exactly what's consuming flash:

```bash
# Build with map file output
arm-none-eabi-gcc -Wl,-Map=firmware.map ...

# Sort by size to find the biggest consumers
grep -E '^\s*\.[a-z]' firmware.map | sort -k3 -n -r | head -20

# Common culprits:
# - Large static lookup tables (sine wave, font data, calibration tables)
# - printf/scanf pulled in by a single debug call (adds 5-15KB!)
# - C++ exceptions/RTTI accidentally enabled
# - Unused functions from static libraries (check --gc-sections is on)
```

### Compiler Flags for Size

```makefile
# Essential size optimization flags for Arm GCC:
CFLAGS += -Os                    # Optimize for size (preferred over -O2 for most embedded)
CFLAGS += -ffunction-sections    # Each function in its own section
CFLAGS += -fdata-sections        # Each data object in its own section
CFLAGS += -flto                  # Link-Time Optimization (can reduce 5-15%)
LDFLAGS += -Wl,--gc-sections     # Garbage-collect unused sections (requires above flags)
LDFLAGS += -Wl,--print-gc-sections # See what was removed (debug builds only)

# Check what's being removed:
# arm-none-eabi-nm --size-sort firmware.elf | tail -20  # Largest symbols
# arm-none-eabi-size firmware.elf  # Section size summary
```

### Printf Is Huge — Replace It

```c
// printf() pulls in ~15KB of formatting code. For embedded debugging:
// Option 1: Use a tiny printf alternative (e.g., mpaland/printf — ~2KB)
// Option 2: Use the ARM semihosting printf (output goes to debugger, not UART)
// Option 3: Write your own minimal formatter for the types you actually need

// Minimal hex dump for debugging (replaces sprintf in many cases)
void hex_dump(const uint8_t* data, size_t len) {
    for (size_t i = 0; i < len; i++) {
        uart_putchar("0123456789ABCDEF"[data[i] >> 4]);
        uart_putchar("0123456789ABCDEF"[data[i] & 0xF]);
        uart_putchar(' ');
    }
    uart_putchar('\n');
}
```

## Performance Monitoring in Production

```c
// Embed runtime assertions that catch regressions without debugger attached

// Example: define your budget constants
#define STACK_TOTAL_BYTES 16384    // Total stack size from your linker script
#define MAX_CRITICAL_SECTION_US 20 // Max allowed interrupt-disable time
#define MIN_POOL_FREE_BLOCKS  4   // Minimum free blocks before warning
#define MIN_SLEEP_RATIO_PCT    80  // Minimum sleep percentage for power budget

// Stack guard: assert stack watermark is healthy
assert(stack_used() < STACK_TOTAL_BYTES * 0.7);

// Timing guard: assert critical section duration
uint32_t start = timer_get_us();
critical_section();
uint32_t elapsed = timer_get_us() - start;
assert(elapsed < MAX_CRITICAL_SECTION_US);

// Heap guard: assert no fragmentation (if using pools)
assert(pool_free_blocks() >= MIN_POOL_FREE_BLOCKS);

// Power guard: assert sleep duty cycle
assert(sleep_ratio_pct() >= MIN_SLEEP_RATIO_PCT);

// These assertions compile to nothing in release if you use a pattern like:
// #if CONFIG_PERFORMANCE_MONITORING
// #define PERF_ASSERT(x) assert(x)
// #else
// #define PERF_ASSERT(x) ((void)0)
// #endif
```

## Performance Budget Template

Set these budgets early and enforce in CI:

```
Stack usage:      < 70% of total in worst-case scenario
Heap:             No general-purpose heap. Pool exhaustion rate < 1%.
ISR max duration: < 50 µs (or whatever your system's deadline requires)
ISR disable max:  < 20 µs (worst-case critical section)
Sleep current:    < 50 µA (with BLE advertising, if applicable)
Wake-up rate:     < 10 Hz (unless application requires higher)
Flash used:       < 80% of available (headroom for OTA + future features)
RAM used:         < 80% of available (.data + .bss + heap + stack)
```

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "It fits, so memory is fine" | "It fits" today. The next feature pushes it over. Track headroom. |
| "I'll optimize when we hit the limit" | Optimizing from "over budget" is an emergency. Optimizing from a budget is a scheduled activity. |
| "The compiler handles optimization" | The compiler optimizes code, not architecture. It won't fix your stack-hungry recursive parser or your busy-wait loop. |
| "Power doesn't matter, we're plugged in" | Even plugged-in devices have thermal budgets and regulatory limits. Measure anyway. |
| "A few microseconds ISR latency doesn't matter" | Latency compounds. Five ISRs each taking "a few" extra microseconds = missed deadlines under load. |
| "I need printf for debugging" | Keep it in the debug build. Strip it from release. Conditional compilation exists for a reason. |

## Red Flags

- No stack watermarking or stack overflow detection in production firmware
- malloc/free in ISR context or in code that runs after boot
- Busy-wait loops (`while (!flag)`) instead of interrupt-driven or RTOS-blocking patterns
- printf in release builds
- No map file analysis as part of the build process
- "It works on my board" without worst-case profiling (all interrupts firing, max load)
- Floating GPIO pins in production configuration
- No power profiling data — optimizing based on assumptions
- Link-Time Optimization disabled without a specific reason

## Verification

After any performance-related change:

- [ ] Before and after measurements exist (stack depth, current draw, ISR latency, flash usage — specific numbers from the target, not estimates)
- [ ] The specific bottleneck is identified and addressed
- [ ] Map file shows section sizes within budget
- [ ] Stack watermark shows ≥ 30% headroom under worst-case load
- [ ] Power profile shows duty cycle is acceptable
- [ ] ISR max duration is below the system deadline
- [ ] `-Os` and `--gc-sections` enabled for release builds
- [ ] Existing tests still pass (optimization didn't change behavior)
- [ ] No printf or heavy formatting in release binary
