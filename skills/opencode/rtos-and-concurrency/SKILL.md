---
name: rtos-and-concurrency
description: Guides RTOS-based firmware design and concurrency patterns. Use when designing tasks/threads, implementing ISR bottom-halves, choosing between synchronization primitives, or debugging priority inversion and deadlocks. Use when working with FreeRTOS, Zephyr, ThreadX, or any RTOS. Covers task decomposition, ISR design, IPC mechanisms, and common RTOS pitfalls.
---

# RTOS and Concurrency Design

## Overview

Design concurrent firmware that is correct, predictable, and debuggable. RTOS-based firmware introduces concurrency challenges that don't exist in bare-metal code: race conditions, priority inversion, deadlocks, and non-deterministic scheduling. Good RTOS design makes these problems structurally impossible rather than relying on developer vigilance.

This skill is RTOS-agnostic. Patterns apply to FreeRTOS, Zephyr, ThreadX, RIOT, and others. Specific API examples use FreeRTOS and Zephyr as the most common references.

## When to Use

- Designing a new RTOS-based firmware architecture
- Decomposing system behavior into tasks/threads
- Implementing ISR-to-task communication (bottom-half patterns)
- Choosing synchronization primitives (mutex vs semaphore vs queue)
- Debugging priority inversion, deadlocks, or missed deadlines
- Converting bare-metal firmware to RTOS-based
- Evaluating whether a problem actually needs an RTOS

## Do You Need an RTOS?

Not every project does. Ask these questions first:

```
├── Do you have more than 2-3 independent async event sources?
│   └── YES → RTOS likely beneficial
├── Do any operations take >1ms that can't be split?
│   └── YES → RTOS lets other work continue during long operations
├── Is the control flow complex (state machines with many states)?
│   └── YES → RTOS tasks are often simpler than a giant state machine
├── Do you need to prioritize work (BLE radio > sensor > UI)?
│   └── YES → RTOS preemptive scheduler handles this naturally
├── Is flash/RAM extremely constrained (<32KB flash, <4KB RAM)?
│   └── YES → Bare-metal superloop may be the only option
└── Are you only doing one thing at a time?
    └── YES → Superloop is simpler and sufficient
```

**Superloop pattern (no RTOS) for comparison:**
```c
while (1) {
    read_sensors();      // Must complete before anything else runs
    process_data();
    update_display();
    check_buttons();
    // Everything is sequential. If one function blocks, everything blocks.
}
```

## Task/Thread Design

### The Task Decomposition Principle

A task should have **one clear reason to exist and one clear reason to wake up**:

```
Bad: One task that does everything
  └── sensor_task: reads sensors AND updates BLE AND drives display AND logs data
      → Hard to prioritize, hard to debug, blocks everything together

Good: One task per concern
  ├── sensor_task:     Reads I2C sensors every 100ms, queues data
  ├── ble_task:        Processes BLE events, sends queued sensor data
  ├── display_task:    Updates display when data changes (lowest priority)
  └── logger_task:     Writes to flash (lowest priority, longest operation)
```

### Task Prioritization

```
Priority assignment (higher number = higher priority in FreeRTOS, configurable in Zephyr):

HIGHEST:
  ├── Radio/Protocol timers (BLE LL, 802.15.4 MAC) — hard real-time
  ├── Motor control / safety critical — hard real-time, must meet deadlines
  ├── Audio streaming — soft real-time, small jitter budget
  │
MEDIUM:
  ├── Sensor fusion / data processing — responsive but not critical
  ├── UI/Button handling — human interface, 50ms latency is fine
  │
LOWEST:
  ├── Flash logging / storage — can take seconds
  ├── Diagnostics / telemetry — best-effort
  └── Idle task — runs when nothing else wants the CPU
```

### Task Sizing

A task should have a **clean, obvious trigger condition**:

```c
// FreeRTOS example: Sensor task with clean trigger
void sensor_task(void* params) {
    TickType_t last_wake = xTaskGetTickCount();
    
    while (1) {
        // Wait for the trigger: 100ms period
        vTaskDelayUntil(&last_wake, pdMS_TO_TICKS(100));
        
        // Do the work (must complete within the period)
        sensor_data_t data;
        read_temperature(&data.temp);
        read_humidity(&data.humidity);
        
        // Pass data to the next stage (queue to processing task)
        xQueueSend(sensor_queue, &data, 0);
    }
}

// Zephyr example:
void sensor_thread(void* p1, void* p2, void* p3) {
    while (1) {
        k_sleep(K_MSEC(100));
        // ... read sensors, send to queue
    }
}
```

**Signs a task is too big:**
- It waits on multiple different events (split into multiple tasks)
- It has internal state machine with more than 3-4 states (consider splitting)
- It takes longer than its period to execute (budget violated)

## ISR Design Patterns

### The Golden Rule

```
ISR: do the minimum work. Defer the rest.

What belongs in an ISR:
  ✓ Read/write hardware registers (clear interrupt flag, read data register)
  ✓ Copy data into a buffer (ring buffer, not complex alloc)
  ✓ Signal a task (give semaphore, send to queue, set event flag)
  ✓ Set a GPIO (for timing/latency measurement)

What does NOT belong in an ISR:
  ✗ Memory allocation (malloc, new, pool_alloc from non-ISR-safe pool)
  ✗ Blocking operations (take mutex with timeout, wait on semaphore, delay)
  ✗ Complex computation (sensor fusion, packet parsing, crypto)
  ✗ printf or logging (slow, may block, re-entrancy issues)
  ✗ Accessing non-ISR-safe data structures without protection
  ✗ Floating point (on MCUs without automatic FPU context save in ISR)
```

### Bottom-Half Pattern: Deferred Work

```c
// Pattern: ISR captures data, signals task, task does the work

// FreeRTOS variant:
static TaskHandle_t uart_rx_task_handle;

void UART_RX_IRQHandler(void) {
    BaseType_t higher_priority_woken = pdFALSE;
    uint8_t byte = UART->DR;
    
    // Ring buffer is ISR-safe (no locks, just head/tail indices)
    ring_buffer_put_from_isr(&uart_rx_ring, byte);
    
    // Signal the task — it will run as soon as ISR returns
    vTaskNotifyGiveFromISR(uart_rx_task_handle, &higher_priority_woken);
    
    portYIELD_FROM_ISR(higher_priority_woken);  // Context switch if needed
}

void uart_rx_task(void* params) {
    uint8_t buf[64];
    while (1) {
        // Wait for ISR to signal us
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        
        // Now in task context — safe to parse, allocate, log, etc.
        size_t len = ring_buffer_get(&uart_rx_ring, buf, sizeof(buf));
        parse_packet(buf, len);
    }
}

// Zephyr variant:
static struct k_sem uart_rx_sem;

void UART_RX_IRQHandler(void) {
    uint8_t byte = UART->DR;
    ring_buf_put(&uart_rx_ring, &byte, 1);
    k_sem_give(&uart_rx_sem);  // ISR-safe in Zephyr
}

void uart_rx_thread(void* p1, void* p2, void* p3) {
    uint8_t buf[64];
    while (1) {
        k_sem_take(&uart_rx_sem, K_FOREVER);
        size_t len = ring_buf_get(&uart_rx_ring, buf, sizeof(buf));
        parse_packet(buf, len);
        // Can safely sleep, allocate, log from thread context
    }
}
```

## Synchronization Primitives — Decision Guide

### When to Use What

```
Synchronization choice decision tree:

Need to protect shared data from concurrent access?
├── Short critical section (< few µs)?
│   └── → Disable interrupts (__disable_irq / __enable_irq)
│       Fastest, but blocks all interrupts. Keep very short.
├── Longer critical section, multiple tasks?
│   ├── Only one task accesses the data at a time?
│   │   └── → Mutex (priority inheritance enabled for real-time systems)
│   └── Reader-writer pattern (many readers, rare writers)?
│       └── → Read-write lock (rare) or message passing (preferred)

Need to signal between ISR and task?
├── Simple wake-up (ISR did something, task should run)?
│   └── → Semaphore (binary) or Task Notification (FreeRTOS)
├── Data to transfer?
│   └── → Queue (copies data) or ring buffer + semaphore

Need to signal between tasks?
├── One task waiting for another to complete?
│   └── → Semaphore (binary) or Event Group
├── Data pipeline (producer → consumer)?
│   └── → Queue (small items) or message queue (larger items)
├── Multiple conditions to wait on?
│   └── → Event Group / Event Bits

Need to coordinate multiple tasks?
├── All tasks must reach a point before any proceeds?
│   └── → Barrier (rare in embedded; use Event Group)
└── Complex async operation chaining?
    └── → Message queue with state machine (avoids nested callbacks)
```

### Mutex vs Semaphore

```c
// MUTEX: for mutual exclusion (ownership)
// - Only the task that took the mutex can give it back
// - Supports priority inheritance (prevents priority inversion)
// - Can be recursive (same task takes multiple times) if configured

// FreeRTOS:
SemaphoreHandle_t mutex = xSemaphoreCreateMutex();
xSemaphoreTake(mutex, portMAX_DELAY);  // Lock
// ... protected section ...
xSemaphoreGive(mutex);                  // Unlock

// SEMAPHORE: for signaling (no ownership)
// - Any task or ISR can give the semaphore
// - No priority inheritance (it's a signal, not a lock)
// - Binary semaphore: "event happened" (0 or 1)
// - Counting semaphore: "N resources available"

// FreeRTOS:
SemaphoreHandle_t sem = xSemaphoreCreateBinary();
xSemaphoreGiveFromISR(sem, &woken);  // ISR signals task
xSemaphoreTake(sem, portMAX_DELAY);  // Task waits for signal

// Don't use a semaphore as a mutex:
// - Semaphore gives no priority inheritance → priority inversion possible
// - Semaphore can be given by a different task → no ownership tracking
// - Harder to debug: who "owns" the lock?
```

### Queue/Message Passing (Preferred for Data Flow)

```c
// Queues are the safest IPC primitive: they copy data, no shared memory

// FreeRTOS queue:
typedef struct {
    uint32_t sensor_id;
    float    value;
    uint32_t timestamp;
} sensor_sample_t;

QueueHandle_t sensor_queue = xQueueCreate(10, sizeof(sensor_sample_t));

// Producer (can be from ISR with FromISR variant):
sensor_sample_t sample = { .sensor_id = 1, .value = 23.5, .timestamp = now };
xQueueSend(sensor_queue, &sample, 0);  // Non-blocking send

// Consumer:
sensor_sample_t received;
if (xQueueReceive(sensor_queue, &received, pdMS_TO_TICKS(100))) {
    process_sample(&received);
}

// Zephyr message queue:
K_MSGQ_DEFINE(sensor_msgq, sizeof(sensor_sample_t), 10, 4);
k_msgq_put(&sensor_msgq, &sample, K_NO_WAIT);
k_msgq_get(&sensor_msgq, &received, K_MSEC(100));
```

## Priority Inversion and Mitigation

### The Classic Scenario

```
1. Low-priority Task L takes a mutex
2. High-priority Task H preempts L, tries to take the same mutex → blocks
3. Medium-priority Task M preempts L (H is blocked, M is higher than L)
4. M runs for a long time. H is stuck waiting for L, 
   but L can't run because M has the CPU.
5. Result: H's deadline is missed, even though H has "highest priority"

Fix: PRIORITY INHERITANCE
When H blocks on the mutex owned by L, L's priority is temporarily raised
to H's priority. M can no longer preempt L. L finishes, releases mutex,
priority drops back to low. H runs.
```

```c
// FreeRTOS: Enable priority inheritance
// #define configUSE_MUTEXES 1            (in FreeRTOSConfig.h — mutexes inherently support priority inheritance)
SemaphoreHandle_t mutex = xSemaphoreCreateMutex();
// Mutex now supports priority inheritance

// Zephyr: Mutexes always have priority inheritance
struct k_mutex my_mutex;
k_mutex_init(&my_mutex);
k_mutex_lock(&my_mutex, K_FOREVER);  // With priority inheritance
```

## Common RTOS Pitfalls

### 1. Deadlock
```
Task A: take(mutex1) → take(mutex2) → ... → give(mutex2) → give(mutex1)
Task B: take(mutex2) → take(mutex1) → ... → give(mutex1) → give(mutex2)

If A gets mutex1 and B gets mutex2 simultaneously:
→ A waits for mutex2 (held by B)
→ B waits for mutex1 (held by A)
→ Both stuck forever.

Prevention:
- Always take mutexes in the same order across all tasks
- Use try-lock + timeout, never wait forever
- Use a single mutex for related data (don't over-fragment locks)
```

### 2. Starvation
```
Task L (low priority): ready to run, but never gets CPU
because Tasks H and M (higher priority) never yield.

Prevention:
- Ensure high-priority tasks block (delay, wait on queue, etc.)
- Don't write high-priority tasks that spin in tight loops
```

### 3. ISR Stack Usage

On Cortex-M, when an RTOS uses PSP for tasks, ISRs automatically use MSP
(the hardware switches to MSP on exception entry). This provides separate stacks:
tasks use PSP, ISRs use MSP. Ensure both stacks are sized appropriately.

If a task is near its stack limit, an ISR (which uses MSP) won't overflow
the task stack. However, nested interrupts increase MSP usage, so the MSP/ISR
stack must be sized for worst-case nesting depth.

Configurable ISR stack in some RTOSes:
- Zephyr: CONFIG_ISR_STACK_SIZE
- FreeRTOS on Cortex-M: ISRs use MSP (separate from task PSP stacks)

### 4. Tick Frequency Mismatch
```
FreeRTOS default tick: 1000 Hz (1ms)
→ Task delay granularity is limited to 1ms
→ A task at 1000 Hz priority with 1ms work → system starves idle task

Set tick rate to match system needs:
- 100 Hz (10ms): Low power, coarse delays
- 1000 Hz (1ms): General purpose
- 10000 Hz (100µs): Motor control, audio DSP
→ Higher tick = more timer interrupts = more power consumption
```

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll just disable interrupts to protect this data" | Fine for a few instructions. Disabling interrupts for >10 µs increases worst-case latency for everything else. Use a mutex for longer sections. |
| "Semaphores and mutexes are the same thing" | A mutex has ownership and priority inheritance. A semaphore is a signal. Misusing one as the other creates subtle bugs. |
| "Priority inversion won't happen to me" | Every system with >2 priorities and shared mutexes is vulnerable. Enable priority inheritance or prove it's not needed. |
| "I can hold a mutex across a delay" | Never hold a mutex across a blocking call (delay, queue receive, semaphore wait). The mutex should protect a data access, not a workflow. |
| "ISRs can do whatever they want, they're fast" | ISRs block all equal and lower-priority interrupts. An ISR that takes 100 µs adds 100 µs to every interrupt's worst-case latency. |
| "I'll add more task priorities to fix scheduling" | More priorities = harder to reason about. Most systems need only 3-4 priority levels. If you need more, reconsider task decomposition. |

## Red Flags

- ISR doing more than reading a register + signaling a task
- Mutex held across a delay, queue receive, or semaphore wait
- Semaphore being used as a mutex (no ownership, no priority inheritance)
- Tasks at the same priority that don't yield fairly (use round-robin time slicing or explicit yields)
- Priority inversion not addressed (no priority inheritance on shared mutexes)
- Task stack sized by guesswork (use stack watermark + 50% margin)
- Tasks that never block — they monopolize the CPU and starve everything below them
- Interrupts disabled for more than a few microseconds in application code
- Deadlock potential: mutexes taken in different orders across tasks

## Verification

After designing RTOS-based firmware:

- [ ] Each task has one clear trigger condition (periodic timer, queue, semaphore, event)
- [ ] ISRs do minimal work (register read + signal to task)
- [ ] Mutexes used for mutual exclusion; semaphores used for signaling (not mixed)
- [ ] Priority inheritance enabled on shared mutexes
- [ ] All mutexes taken in consistent order across tasks (deadlock prevention)
- [ ] Stack high-water mark monitored for every task (≥ 50% headroom initially)
- [ ] No mutex held across a blocking call (delay, queue receive, semaphore take)
- [ ] Task priority assignment documented with rationale
- [ ] Negative test: simulate crash with task stack overflow, confirm detection
- [ ] Negative test: hold the highest-priority task in a busy-loop, confirm watchdog fires (not infinite hang)
