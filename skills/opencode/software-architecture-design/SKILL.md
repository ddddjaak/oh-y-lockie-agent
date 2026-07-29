---
name: software-architecture-design
description: 软件/固件架构设计：RTOS线程模型、内存预算、IPC设计、模块间数据流。Firmware/software architecture design — RTOS thread/ISR model, memory budget allocation, IPC design, and inter-module data flows. Use when the user says 软件架构, 固件架构, RTOS设计, firmware architecture, software architecture, memory budget, or when system architecture is confirmed and detailed firmware design can begin. NOT for system-level module decomposition (use architecture-design) or hardware board design (use hardware-architecture-design).
---

# Software Architecture Design

## Overview

System architecture says which modules exist and how they interface. Software architecture says how those modules run — which thread owns which module, how much stack each thread gets, which ISRs are latency-critical, and how data flows between modules without deadlocks or race conditions.

This skill transforms the software-domain slice of system requirements and system architecture into a concrete software architecture document — the contract between the SE and the firmware team. Every thread assignment traces to a timing requirement. Every memory allocation is justified. Every lock is documented. If the RTOS or framework imposes a constraint, this skill verifies it rather than assuming.

## When to Use

- System architecture is confirmed and software-domain requirements are extracted
- Starting firmware architecture design (thread model, memory map, IPC design)
- Evaluating RTOS selection or framework architecture alternatives
- A design review or downstream skill detects a software architecture gap
- The firmware team needs a formal software architecture document before module implementation

**When NOT to use:**

- System architecture is not yet designed (run `architecture-design` first)
- The change is a single function implementation with no module or interface impact
- Pure hardware architecture (use `hardware-architecture-design`)
- Writing actual firmware code (this skill produces architecture, not implementation)

## Context Boundary

**Read ONLY:**
- System architecture document (module decomposition, interface definitions)
- SW-domain system requirements (timing, throughput, reliability, memory constraints)
- RTOS / framework documentation (API reference, configuration limits, ISR architecture)
- Target MCU/SoC technical reference manual (memory map, interrupt controller, MPU/MMU)

**Do NOT read:** hardware specifications (pin assignments, voltage domains, PCB constraints), chip datasheets beyond the memory map section, test plans, or build system files.

If a software architecture decision requires hardware input (e.g., "does this MCU have a DMA engine for the SPI?"), check only the specific TRM chapter — do not read the full hardware design. If the answer is not in the TRM, surface an Open Item with the HW team as owner.

## The Process

```
INPUT-GATE → THREAD-MODEL → IPC-DESIGN → MEMORY-BUDGET → DATA-FLOW → DOCUMENT
     │            │             │             │             │           │
     ▼            ▼             ▼             ▼             ▼           ▼
  Verify      Assign        Design        Allocate      Map data     Produce
  inputs &    modules to    inter-module  RAM/ROM/      flows        software
  versions    threads/ISRs  communication stack budget  between      architecture
                                                  modules      document
```

### Step 1: INPUT-GATE — Verify inputs and RTOS constraints

Confirm input artifacts are available and version-aligned before proceeding. This is a hard gate — do not design against stale or unconfirmed inputs.

```
INPUT VERIFICATION:
1. System Architecture: [path, version, date]
2. SW-Domain System Requirements: [path, version, date]
3. RTOS / Framework: [name, version, documentation path]
4. Target MCU/SoC: [part number, datasheet rev]
→ Confirm: Are these the correct versions? Any missing?
```

**RTOS capability verification (CRITICAL — do NOT skip):** Do NOT assume RTOS capabilities from memory. Verify against the RTOS documentation:
- Maximum number of threads supported
- Maximum number of priority levels
- ISR latency (worst-case entry + exit in CPU cycles and μs)
- Context switch time (same-priority yield and preemption)
- Queue/message size limits, event group width, semaphore max count
- Memory protection support (MPU/MMU regions available)
- Tick resolution (default and configurable range)

If the RTOS documentation is unavailable, surface an Open Item and stop. If a required RTOS capability is absent (e.g., you need 16 priority levels but the RTOS only supports 8), that is a CONSTRAINT VIOLATION — surface immediately.

### Step 2: THREAD-MODEL — Assign every module to a thread or ISR

Every module from the System Architecture module table must be assigned to exactly one execution context. "It runs somewhere" is not an assignment.

**Thread Assignment Table:**

```markdown
| Thread / ISR | Priority | Modules Assigned | Stack Size | Blocking? | Wake-up Trigger | Deadline |
|-------------|----------|-----------------|------------|-----------|-----------------|----------|
| ISR_GPT0 (50μs tick) | IRQ 10 | System Tick, Scheduler | — (ISR stack) | Never | 50μs HW timer | ≤ 10μs execution |
| THD_SensorHub | 3 (high) | SEN-01 IMU Fusion, SEN-02 Temp Monitor | 4 KB | Yes (k_msgq) | Sensor data-ready ISR | ≤ 1ms processing |
| THD_CommsMgr | 4 | COM-01 eSPI Slave, COM-02 I2C Host | 6 KB | Yes (k_sem, k_msgq) | eSPI transaction ISR | ≤ 100μs response |
| THD_PwrMgr | 5 | PWR-01 Rail Monitor, PWR-02 Seq Engine | 2 KB | Yes (k_event) | GPIO interrupts | ≤ 500μs state change |
| THD_Logger | 6 (low) | LOG-01 Flash Journal | 3 KB | Yes (k_msgq) | Message queued from any thread | None (best-effort) |
```

**Rules:**
- Two modules assigned to the same thread: document the execution order. Module A → Module B, or round-robin, or priority-queue.
- ISRs must NOT call blocking RTOS functions (`k_msgq_get` with timeout, `k_sem_take` with timeout). ISRs may call `k_msgq_put`, `k_sem_give`, `k_event_post` (non-blocking signaling only).
- Every thread priority must be justified against a timing requirement. "Priority 3 because it's important" is not justification. Priority 3 because "SYS-REQ-014 requires ≤ 1ms sensor processing" is.

### Step 3: IPC-DESIGN — Design inter-module communication

For every dependency arrow (→) in the System Architecture module table, define the software communication mechanism. Every named interface (IF-XXX) from System Architecture must have a corresponding IPC mechanism defined here. "They communicate somehow" is not a design.

**IPC Mechanism Table:**

```markdown
| IF-ID | From (Thread) | To (Thread) | Mechanism | Object Name | Data Direction | Blocking Policy | Message Size |
|-------|--------------|-------------|-----------|-------------|---------------|-----------------|-------------|
| IF-001 | ISR_GPT0 | THD_SensorHub | k_event | evt_sensor_tick | Publish | Non-blocking (ISR post) | 4 bits (event flags) |
| IF-002 | THD_CommsMgr | THD_PwrMgr | k_msgq | mq_cmd_power | Command | TX: k_msgq_put (100ms timeout); RX: k_msgq_get (K_FOREVER) | 64 bytes |
| IF-003 | THD_SensorHub | THD_Logger | k_msgq | mq_log_data | Data | TX: k_msgq_put (non-blocking, drop oldest if full); RX: k_msgq_get (K_FOREVER) | 128 bytes |
| IF-004 | THD_PwrMgr | THD_CommsMgr | k_msgq | mq_pwr_status | Status | TX: k_msgq_put (100ms); RX: k_msgq_get (K_FOREVER) | 32 bytes |
| IF-005 | THD_SensorHub (internal) | THD_SensorHub (internal) | mutex | mtx_sensor_data | Shared memory guard | k_mutex_lock (1ms timeout) | — (protects sensor_data_t) |
```

**Synchronization documentation — for every shared resource:**

```markdown
### Lock: mtx_sensor_data
| Property | Value |
|----------|-------|
| Protects | sensor_data_t g_sensor (global struct) |
| Owner(s) | THD_SensorHub (write), THD_CommsMgr (read) |
| Lock order | mtx_sensor_data before mq_log_data (if both held) |
| Max hold time | ≤ 50μs (critical section: copy struct to local) |
| Deadlock prevention | Single global lock ordering: mtx_sensor_data → mtx_flash_journal → mtx_power_state. All threads follow this order. |
```

### Step 4: MEMORY-BUDGET — Allocate SRAM, Flash, and stack

Allocate physical memory and verify the budget closes. Numbers, not adjectives.

```markdown
## SRAM Budget (total: 256 KB)

| Allocation | Size | Justification |
|-----------|------|---------------|
| .bss / .data (globals) | 12 KB | All global structs (see appendix) |
| THD_SensorHub stack | 4 KB | Worst-case call chain: IMU driver → fusion → queue TX (1.8 KB) + ISR frame (0.5 KB) + margin (1.7 KB) |
| THD_CommsMgr stack | 6 KB | eSPI driver deep stack (4.2 KB measured) + margin |
| THD_PwrMgr stack | 2 KB | Shallow call chain (0.8 KB) + margin |
| THD_Logger stack | 3 KB | Flash driver stack (1.5 KB) + margin |
| System heap | 32 KB | k_msgq buffers (18 KB: 6 queues × avg 3 KB) + driver DMA buffers (14 KB) |
| DMA buffers (USB, eSPI) | 64 KB | USB EP0 (4 KB) + USB EP1 (32 KB) + eSPI channel (28 KB) |
| MPU guard regions | 4 KB | 8 × 32-byte guard regions per MPU spec |
| Reserved (future) | 16 KB | Headroom for additional features per SYS-REQ-030 |
| **Remaining free** | 113 KB | — |
```

If `total_allocated > total_physical`, that is a CONSTRAINT VIOLATION — surface immediately with options (reduce buffers, renegotiate requirements, or add external SRAM).

### Step 5: DATA-FLOW — Map timing-critical data paths

For every timing-critical data path identified in system requirements, trace the complete flow through all modules, threads, ISRs, and IPC objects. Calculate end-to-end latency and compare to the timing constraint.

```markdown
### Critical Path: Sensor Sample → Host Notification

| Step | Context | Action | Latency (μs) | Cumulative (μs) |
|------|---------|--------|-------------|-----------------|
| 1 | IMU (HW) | Sample ready, fires GPIO IRQ | — | 0 |
| 2 | ISR_GPT0 | ISR entry, post k_event to THD_SensorHub | 2 (ISR latency) | 2 |
| 3 | THD_SensorHub | Wakes on event, reads IMU FIFO via SPI | 15 (SPI DMA) | 17 |
| 4 | THD_SensorHub | Sensor fusion computation | 80 (measured @ 200 MHz) | 97 |
| 5 | THD_SensorHub | k_msgq_put to THD_Logger + THD_CommsMgr | 5 (context switch) | 102 |
| 6 | THD_CommsMgr | Wakes, formats eSPI packet, posts to HW FIFO | 30 | 132 |
| 7 | eSPI (HW) | Packet transmitted to host | 8 (eSPI @ 66 MHz) | 140 |

**Result:** End-to-end 140 μs ≤ SYS-REQ-014 (≤ 200 μs) → PASS
```

For every timing-critical path that exceeds its constraint, surface as a TIMING VIOLATION with options: optimize the slowest step, raise the deadline, or accept the violation with documented rationale.

### Step 6: DOCUMENT — Produce the software architecture document

Assemble all outputs into a structured document. Present to user for confirmation. Do NOT proceed to `software-detailed-design` until the human has explicitly confirmed that every thread assignment, IPC mechanism, memory allocation, and data flow is correct.

## Output

A software architecture document saved to `docs/architecture/[project]-software-architecture.md`:

```markdown
# Software Architecture Design: [Project/Board Name]

## Document Control
| Field | Value |
|-------|-------|
| Version | [semver] |
| Date | [YYYY-MM-DD] |
| Author | [SE name] |
| System Architecture Reference | [path, version] |
| SW Requirements Reference | [path, version] |
| RTOS / Framework | [name, version] |
| Target MCU/SoC | [part number] |

## Scope
### What This Document Covers
[One paragraph: this software architecture design covers the RTOS thread model, IPC mechanisms, memory budget, timing-critical data flows, and firmware configuration for [Project Name]. Reference the system architecture document and its MOD-ID / IF-ID range.]

### What This Document Does NOT Cover
[Explicit exclusions. "This document does not cover: system-level module decomposition (see architecture-design), detailed hardware pin assignments (see hardware-architecture-design), per-module function signatures and state machines (see software-detailed-design), hardware schematics or PCB layout rules (see hardware-detailed-design)."]

## 1. Execution Context Model

### Thread Assignment Table
[Table from Step 2: every module → exactly one thread/ISR, with priority, stack, blocking behavior, wake-up trigger, deadline]

### ISR Inventory
| ISR | Vector | Priority | Max Execution Time | Blocking Calls? | What It Signals |
|-----|--------|----------|-------------------|-----------------|-----------------|
| ... | ... | ... | ... | Never | ... |

### Priority Justification
[For every thread: which timing requirement (REQ-XXX) drives this priority?]

## 2. Inter-Module Communication Design

### IPC Mechanism Table
[Table from Step 3: every IF-XXX → mechanism, object name, direction, blocking policy, message size]

### Synchronization Specification
[For every shared resource: lock, what it protects, owners, lock order, max hold time, deadlock prevention]

### Message Format Definitions
[For every message queue: struct definition, field descriptions, valid ranges, version field]

## 3. Memory Budget

### SRAM Allocation
[Table from Step 4: every allocation, size, justification. Verified: total ≤ physical.]

### Flash Allocation
| Region | Size | Content |
|--------|------|---------|
| Bootloader | [N] KB | [Bootloader name/version] |
| Application | [N] KB | Firmware image |
| Configuration | [N] KB | Persistent settings, calibration data |
| File System | [N] KB | LittleFS / FAT / custom |
| Reserved | [N] KB | OTA dual-bank, future |

### Stack Depth Analysis
| Thread | Allocated | Worst-Case Measured/Estimated | Margin | Status |
|--------|-----------|------------------------------|--------|--------|
| ... | ... | ... | ... | OK / RISK |

## 4. Timing-Critical Data Flows

### Critical Path Analysis
[Table from Step 5: step-by-step latency breakdown for every deadline-bound path, cumulative vs. limit]

### Timing Violations
| Path | Calculated | Constraint | Violation | Options |
|------|-----------|------------|-----------|---------|
| ... | ... | ... | ... | ... |

## 5. RTOS Configuration
| Parameter | Value | Justification |
|-----------|-------|---------------|
| Tick Rate | [Hz] | Resolution required by shortest deadline |
| Max Threads | [N] | Current count + headroom |
| Max Priorities | [N] | Distinct deadline classes |
| ... | ... | ... |

## 6. Risk Register
| Risk ID | Risk | Likelihood | Impact | Mitigation | Owner |
|---------|------|-----------|--------|------------|-------|
| SRISK-001 | Stack overflow in THD_CommsMgr | Medium | High | Runtime stack guard + MPU region; stress test with max eSPI throughput | SW Lead |
| SRISK-002 | Deadlock between mq_cmd_power and mtx_sensor_data | Low | Critical | Lock-order documentation + static analysis; deadlock detection timer | SW Lead |

## 7. Open Items
| ID | Question | Blocker For | Owner | Due |
|----|----------|-------------|-------|-----|
| SOI-001 | Does the RTOS support MPU per-thread regions? | Stack protection design | SW Lead | Sprint 1 |
| SOI-002 | eSPI DMA requires 64-byte alignment — confirmed? | mq_cmd_power buffer design | HW Team | Sprint 1 |
```

## Interaction with Other Skills

- **`architecture-design`**: Pre-requisite. Produces system-level module decomposition and interface definitions.
- **`requirements-decompose`**: Provides SW-domain requirements.
- **`software-detailed-design`**: Downstream consumer. Produces per-module function signatures and data structures.
- **`design-review`**: Can review the software architecture through the SW lens.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The firmware team can figure out the thread model during implementation" | Thread models designed during implementation optimize for the first module written. Thread models designed in architecture optimize for all modules. The difference is deadlocks discovered during integration. |
| "Memory budget is premature — we will optimize later" | Memory is finite. "We will optimize later" means "we will discover we are out of memory during integration." An SRAM overrun is not a compiler warning — it is silent corruption. |
| "IPC is just function calls — do not over-engineer it" | Function calls work when caller and callee share a thread. When they do not — and in an RTOS they often do not — you need queues, events, and locks. "Keep it simple" that ignores concurrency is simplicity that causes heisenbugs. |
| "Stack sizes are the RTOS default — it is fine" | RTOS defaults are for hello-world. A thread that calls into a driver stack, a filesystem, and a logging framework needs 4-8x the default. Under-sized stacks cause silent corruption — the stack overflows into the next thread's memory and neither thread knows. |
| "We will measure stack usage on the prototype" | Measurement on one code path tells you the depth of that path. It does not tell you the depth of the error-recovery path, the worst-case interrupt nesting path, or the path that only triggers at -40°C. Design stacks for worst case; measure to confirm. |
| "The RTOS handles all synchronization — we just use its APIs" | The RTOS provides mutexes, semaphores, and queues. It does not prevent you from using them incorrectly. Lock ordering, priority inversion, and deadlock are design problems, not API problems. |

## Red Flags

- Modules without execution context assignment (a module not assigned to a thread will not run)
- IPC mechanisms not specified for interface dependencies (an IF-ID without a mechanism is a contract without a delivery method)
- Memory budget that exceeds physical SRAM or flash — surface, do not assume "we will find savings later"
- Stack size specified as "RTOS default" without verification against actual call depth
- Data flow latency not calculated for timing-critical paths ("probably fast enough" is not a calculation)
- Thread priorities not justified against timing requirements (priority is a budget, not a preference)
- ISRs calling blocking functions (this works in testing until it doesn't — and it fails silently)
- Lock ordering not documented when more than one lock exists in the system
- "We will use the reference design thread model" — reference designs optimize for demonstration, not your requirements
- No stack overflow detection mechanism specified (MPU guard, canary, or static analysis)

## Verification

Before handing off to software-detailed-design, confirm:

- [ ] All input artifacts version-verified (Step 1 input gate passed; RTOS capabilities confirmed against documentation)
- [ ] Every module assigned to exactly one execution context with priority, stack size, and wake-up trigger
- [ ] Every thread priority justified against a timing requirement ID (REQ-XXX)
- [ ] Every architecture interface (IF-XXX) has a corresponding IPC mechanism with object name, direction, blocking policy, and message size
- [ ] ISR latency budgets verified against RTOS and CPU specifications; ISRs never call blocking functions
- [ ] Memory budget accounts for all allocations (SRAM + Flash); total ≤ physical limit with remaining headroom documented
- [ ] Stack sizes trace to worst-case call chain analysis — not RTOS defaults, not guesses
- [ ] Every timing-critical data flow has end-to-end latency calculated step-by-step and compared to its constraint
- [ ] Every timing violation surfaced with specific options (optimize, relax constraint, or accept with rationale)
- [ ] Lock ordering documented for every lock; deadlock prevention strategy specified
- [ ] Stack overflow detection mechanism specified (MPU guard region or runtime canary)
- [ ] Open items have owners and due dates; no naked TBDs
- [ ] The human has explicitly confirmed the software architecture document
- [ ] The document is saved to a version-controlled location under `docs/architecture/`

## After This Skill

Once software architecture is confirmed and saved to `docs/architecture/`:

| Next Step | Skill | What It Produces |
|-----------|-------|-----------------|
| **Natural next** | `software-detailed-design` | Function signatures, data structures, state machines per firmware module |
| System integration | `spec-authoring` | Generate Software Outline Design (SOD) for the firmware team |
| Quality check | `traceability-matrix` | Verify requirements → SW architecture traceability |

**Pipeline mode**: After this skill completes, the conductor will detect `docs/architecture/` and offer Document-phase options automatically.

## See Also

- For software architecture design review criteria, see `references/software-architecture-design-checklist.md`
- For software high-level design review criteria, see `references/solution-software-high-level-design-checklist.md`
- For tool high-level design review criteria, see `references/solution-tool-high-level-design-checklist.md`
