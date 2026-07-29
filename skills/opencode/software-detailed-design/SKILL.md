---
name: software-detailed-design
description: 软件详细设计：函数签名、数据结构、状态机、错误处理、线程安全模式。Firmware module detailed design — function signatures, data structures, state machines, error handling logic, and thread-safe design patterns for each firmware module. Use when the user says 软件详细设计, 函数设计, 状态机设计, software detailed design, function specification, or when software architecture is confirmed and firmware implementation can begin. NOT for system-level specification (use spec-authoring) or hardware detailed design (use hardware-detailed-design).
---

# Software Detailed Design

## Overview

Software architecture says which module runs in which thread at what priority. Software detailed design says exactly how each module works — the function you call, the struct you pass, the state you transition through, the error you handle, and the lock you hold while doing it.

This skill takes one module at a time from the software architecture document and produces a detailed design that a firmware engineer can implement without asking questions. Every function signature is defined and references its architecture interface ID. Every state transition traces to a requirement. Every error path has a recovery strategy. Memory, stack, and timing budgets are quantified per module — not estimated later, but designed now. If the architecture leaves something ambiguous, this skill surfaces it before code is written.

**Context boundary:** This skill reads ONLY the software architecture document. It does NOT read hardware specifications, chip datasheets, or test plans. If a detailed design need (register address, timing constraint, power-domain detail) is not in the architecture document, the gap belongs to architecture — surface it and return to `architecture-design` or `software-architecture-design`.

## When to Use

- Software architecture is confirmed and a module is ready for detailed design
- Adding a new module to an existing firmware codebase
- The firmware team needs formal module specifications before sprint planning
- A module interface has changed and the detailed design must be updated
- A design review found that a module internal design was underspecified

**When NOT to use:**

- Software architecture is not yet designed (run `software-architecture-design` first)
- The module already has a detailed design document and only needs a minor update (edit directly)
- The change is a single-line bug fix with no design impact
- Hardware detailed design (use `hardware-detailed-design`)
- Algorithm design without a firmware module context (use `algorithm-design`)

## Context Boundary

**Read ONLY:** the software architecture document for the target module. This skill does NOT read hardware specifications, chip datasheets, test plans, or requirements documents directly. If the architecture document is missing information needed for detailed design, that is an architecture gap — surface it, do not fill it by reading upstream documents.

**Scope per invocation:** Design ONE module at a time. Bounded context is intentional — one module's detailed design deserves full attention. If multiple modules need design, invoke this skill once per module.

## The Process

```
SELECT-MODULE → FUNCTION-SPEC → STATE-MACHINE → DATA-STRUCTURES → ERROR-HANDLING → DOCUMENT
       │              │               │               │                │            │
       ▼              ▼               ▼               ▼                ▼            ▼
   Confirm        Define all     Design state    Define all       Define every    Produce
   which module   public &       transitions     internal &       error path      detailed
   to design      private APIs   for stateful    shared data      & recovery      design doc
                                 modules         structures
```

### Step 1: INPUT-GATE — Confirm scope and verify architecture completeness

Confirm which module to design. Surface the software architecture version and date explicitly. Extract the full interface inventory for the target module.

```
MODULE DESIGN SCOPE:
Module Name:       [from software architecture module table]
Architecture Doc:  [path, version, date]
Module ID:         [MOD-XX]
Assigned Thread:   [from thread assignment table]
Priority:          [from thread assignment table]
Stack Allocation:  [from thread assignment table]

Interfaces to this module:
  IF-XXX: [direction (in/out/both), data format, timing bound, error specification]
  IF-YYY: [...]

Internal complexity signals:
  [ ] Stateful (≥ 3 distinct behavioral states)
  [ ] Timing-critical (any operation with a deadline)
  [ ] Shared data (accesses structures shared across threads)
  [ ] Error recovery (must handle ≥ 3 distinct error conditions)
→ Confirm: Is this the correct module? All interfaces complete?
```

**Gate:** Verify every interface for the target module is complete in the architecture. An interface is complete when it specifies: data format (struct or primitive with field types), direction, timing bound, and error handling contract. If any interface lacks these, invoke `architecture-design` or `software-architecture-design` before proceeding. Detailed design on incomplete interfaces is guessing.

### Step 2: FUNCTION-SPEC — Define all function signatures

For every function in the module, specify the complete signature with preconditions, postconditions, return values, error codes, and calling context. Every public function must reference the architecture interface ID it satisfies.

```markdown
### API: [Module Name]

#### Public Functions (trace to IF-XXX)

##### `int32_t <module>_init(const <module>_cfg_t *cfg);`
| Aspect | Specification |
|--------|---------------|
| Traces to | IF-XXX (initialization interface) |
| Precondition | `cfg != NULL`, `cfg->sample_rate_hz ∈ {100, 200, 500, 1000}`, ISR not yet enabled for this module |
| Postcondition | Module state = INITIALIZED, internal buffers allocated, HW in reset state |
| Calling context | Thread only (not ISR) — allocates from heap |
| Blocks? | No (returns immediately after HW config) |
| Returns | `0` on success |
| Error codes | `-EINVAL` if `cfg == NULL` or invalid sample_rate; `-ENOMEM` if buffer allocation fails; `-EBUSY` if already initialized |
| Side effects | Allocates `cfg->fifo_depth * sizeof(sample_t)` bytes from heap; configures IMU registers described in dt-IMU.md §3.2 |

##### `int32_t <module>_read(sample_t *buf, size_t count, uint32_t timeout_ms);`
[Complete specification as above...]

#### Internal (Private) Functions

##### `static void process_sample(const sample_t *raw, fused_data_t *out);` (internal)
[Specification — no IF-ID reference needed but still fully defined]
```

**Anti-hallucination rules for function specs:**
- If the architecture does not specify whether a function can be called from ISR context, surface the question — do not assume.
- If a return value's meaning is not documented in the architecture, propose an enum and ask for confirmation.
- "Returns 0 on success, negative on error" without enumerating error codes is insufficient. Every error code must have a documented meaning and recovery path.

### Step 3: STATE-MACHINE — Design stateful behavior

If the module has ≥ 3 distinct behavioral states (from Step 1 complexity signals), define the complete state machine. If < 3 states, describe state transitions inline in the function specs and skip the formal state machine — not every module needs one.

```markdown
## Module State Machine: [Module Name]

### States
| State | Description | Entry Action | Exit Action |
|-------|-------------|-------------|-------------|
| UNINIT | Module not initialized | — | — |
| IDLE | Initialized, waiting for trigger | Start idle timer (TIM-XX) | Stop idle timer |
| ACTIVE | Processing data | Enable DMA channel N | Disable DMA, flush FIFO |
| ERROR | Fault condition, awaiting recovery | Set error flag, notify THD_Logger | Clear error flag |
| RECOVERY | Attempting error recovery | Start recovery watchdog (WDT) | Stop watchdog |

### Transitions
| From | To | Trigger | Guard | Action | Deadline |
|------|----|---------|-------|--------|----------|
| UNINIT | IDLE | `<module>_init()` called | cfg valid, heap available | HW init sequence (see §2.1) | ≤ 5ms |
| IDLE | ACTIVE | Sensor data-ready ISR | — | Read FIFO, start processing | ≤ 50μs from ISR fire |
| ACTIVE | IDLE | FIFO empty after processing | — | Stop DMA, report sample count | — |
| ACTIVE | ERROR | DMA transfer error | — | Log error code, abort current sample | — |
| ERROR | RECOVERY | Error handler invoked | Recovery count < 3 | Reset HW block, re-init | ≤ 100ms |
| RECOVERY | IDLE | Recovery successful | — | Clear error counters, resume normal operation | — |
| RECOVERY | ERROR | Recovery failed | Recovery count ≥ 3 | Escalate to system fault (k_event FAULT_CRITICAL) | — |
| ANY_STATE | UNINIT | `<module>_deinit()` called | — | Free buffers, reset HW to POR state | ≤ 10ms |
```

**Rules:**
- `ANY_STATE` rows must be deliberate — they represent transitions that are valid from every state. If you only need it from two states, list them explicitly.
- Every timed transition must have a deadline. "Eventually" is not a timing specification.
- Recovery loops must have a bounded retry count — infinite retry is a watchdog trigger, not a design.

### Step 4: DATA-STRUCTURES — Define internal and shared data

Define every data structure with field type, valid range, units, and description. Shared data must specify which thread writes it, which threads read it, and what synchronization protects it.

```markdown
### Configuration Structure
```c
typedef struct {
    uint32_t sample_rate_hz;    // [100, 200, 500, 1000] Hz — from IF-XXX
    uint16_t fifo_depth;        // [1..256] samples — drives buffer allocation size
    uint8_t  gain_db;           // [0..48] dB, step 6dB — applied in HW register
    bool     low_power_mode;    // If true, use 10 Hz sampling in IDLE state
} sensor_cfg_t;                 // sizeof = 12 bytes (4+2+1+1 align)
```

### Runtime State Structure
```c
typedef struct {
    sensor_state_t state;          // Current state machine state
    uint32_t       sample_count;   // Total samples processed (wraps at 2^32)
    int32_t        last_error;     // 0 = no error, or negative errno
    uint8_t        recovery_count; // [0..3]
    sample_t       *fifo;          // Heap-allocated; size = cfg.fifo_depth * sizeof(sample_t)
} sensor_ctx_t;                    // sizeof = 24 bytes (4+4+4+1+8 align)
```

### Shared Data Documentation
| Variable | Type | Writer (Thread) | Readers (Thread(s)) | Synchronization | Max Contention |
|----------|------|-----------------|---------------------|-----------------|----------------|
| g_sensor_data | fused_data_t | THD_SensorHub | THD_CommsMgr, THD_Logger | mtx_sensor_data | ≤ 50μs (copy to local) |
```

**Resource quantification:** Verify `sizeof(state struct)` + internal arrays ≤ architecture SRAM constraint. Include compile-time assertion:
```c
STATIC_ASSERT(sizeof(sensor_ctx_t) <= CON_SENSOR_SRAM_BUDGET, "Sensor context exceeds SRAM budget");
```

### Step 5: ERROR-HANDLING — Define every error path

For every error condition the module can encounter, define detection method, response, recovery path, and logging strategy.

```markdown
## Error Handling Matrix

| Error Condition | Detection | Response | Recovery | Logging | Testable? |
|----------------|-----------|----------|----------|---------|-----------|
| SPI bus timeout | DMA TC flag not set within 1ms | Abort transfer, reset SPI peripheral | Re-init SPI, retry once. If retry fails → ERROR state | Log via THD_Logger (ERR_SPI_TIMEOUT) | Yes (inject timeout in test fixture) |
| FIFO overflow | IMU status register OVF bit | Flush FIFO, discard oldest samples | Continue with fresh samples; increment overflow counter | Log warning (WARN_FIFO_OVF) per occurrence, capped at 1/min | Yes (reduce read rate in test) |
| Invalid config | sample_rate_hz out of valid range | Return -EINVAL, do not modify state | Caller must retry with valid config | No log — caller's responsibility | Yes (unit test: boundary values) |
| DMA descriptor error | DMA error ISR fires | Abort current transfer, set ERROR state | Follow state machine recovery path | Log critical (ERR_DMA_DESC, channel N, error code) | Partial (HW fault injection limited) |
| Heap allocation failure | malloc() returns NULL | Return -ENOMEM, module stays UNINIT | Caller may retry with smaller fifo_depth | Log critical (ERR_HEAP_EXHAUSTED, requested bytes) | Yes (mock malloc returning NULL) |
```

**Flag untestable errors.** If an error path cannot be tested in the current test environment (e.g., DMA descriptor corruption), flag it explicitly. Untestable error paths are documentation, not verification — they need a different validation strategy.

### Step 6: DOCUMENT — Produce the detailed design document

Present to user for confirmation. The firmware engineer implementing this module should have zero unanswered questions about what the module does, how it does it, and how it fails.

## Output

A software detailed design document saved to `docs/spec/[project]-sdd-[module-name].md`:

```markdown
# Software Detailed Design: [Module Name]

## Document Control
| Field | Value |
|-------|-------|
| Version | [semver] |
| Date | [YYYY-MM-DD] |
| Author | [SE/FW name] |
| Software Architecture Reference | [path, version, date] |
| Module ID | MOD-XX |
| Assigned Thread | [Thread name, priority] |
| Stateful? | [Yes (N states) / No] |

## 1. API Specification
[Complete function signatures from Step 2 — every public function references IF-XXX, every private function marked "(internal)"]

## 2. State Machine
[State transition diagram + table from Step 3 — if stateful. Otherwise: "This module is stateless — behavior depends only on input parameters."]

## 3. Data Structures
[Struct definitions with field ranges + shared data table from Step 4]

## 4. Resource Budget
| Resource | Allocation | Used | Margin | Verified? |
|----------|-----------|------|--------|-----------|
| SRAM (context struct) | CON-XXX: [N] bytes | sizeof(sensor_ctx_t) = 24 bytes | [N-24] bytes | ✅ PASS |
| SRAM (heap buffers) | CON-XXX: [N] bytes | cfg.fifo_depth × sizeof(sample_t) = [M] bytes | [N-M] bytes | ✅ PASS |
| Stack | [N] bytes per thread allocation | Worst-case call chain [M] bytes | [N-M] bytes | ✅ PASS |
| Flash | — | [N] bytes | — | — |

## 5. Error Handling Matrix
[Table from Step 5 — every error: detection → response → recovery → logging → testable?]

## 6. Timing Budgets
| Operation | Trigger | Deadline | Estimated | Method | Status |
|-----------|---------|----------|-----------|--------|--------|
| Init sequence | <module>_init() | ≤ 5ms | ~3ms (measured @ 200MHz) | Prototype measurement | ✅ PASS |
| FIFO read + process | Data-ready ISR | ≤ 50μs | ~35μs (instruction count) | Static analysis | ✅ PASS |
| Error recovery | DMA error | ≤ 100ms | ~80ms (includes HW reset) | Datasheet worst-case | ✅ PASS |

## 7. Compile-Time Assertions
```c
STATIC_ASSERT(sizeof(sensor_ctx_t) <= CON_SENSOR_SRAM_BUDGET, "...");
STATIC_ASSERT(SENSOR_FIFO_DEPTH_MAX <= 256, "...");
// ... all budget-critical constraints verified at compile time
```

## 8. Open Items
| ID | Question | Blocker For | Owner | Due |
|----|----------|-------------|-------|-----|
| ... | ... | ... | ... | ... |
```

## Interaction with Other Skills

- **`software-architecture-design`**: Pre-requisite. Provides thread model, IPC design, and memory budget.
- **`architecture-design`**: Provides system-level interface definitions that function signatures must satisfy.
- **`design-review`**: Can review the detailed design before implementation.
- **`traceability-matrix`**: Verifies every function traces to a requirement.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The function signatures will be obvious once I start coding" | Signatures defined during coding are optimized for the first use case. Signatures defined during design are optimized for all use cases. The difference is API breaking changes during sprint 3. |
| "Error handling is implementation detail" | The most expensive firmware bugs are error paths that were never designed. "What happens when flash is busy?" is a design question, not an implementation one. Error recovery without design is reboot-by-watchdog. |
| "State machines are overkill for simple modules" | If a module's behavior depends on what happened before, it is stateful. A module that is "simple" but has 3 implicit states is not simple — it is underspecified. The state machine diagram surfaces transitions the developer did not know existed. |
| "The struct definitions will evolve during implementation" | They will. But starting with a defined structure means changes are deliberate and versioned. Starting without one means the first implementation becomes the de facto specification — and the next developer interprets it as intentional design. |
| "Stack usage is the RTOS's problem — we have MPU guards" | MPU guards prevent corruption from spreading. They do not prevent the stack overflow itself. An MPU fault in the field is a crash. A correctly sized stack is not. |
| "Timing budgets can be measured later on the prototype" | Measurement confirms a design. It does not replace one. If the measurement shows a violation, you are re-designing during bring-up. Budget first, measure to confirm. |
| "I'll design all the modules at once — it's more efficient" | Context for one module (~5-10 functions, one state machine, one struct set) fits in a single focused review. All modules at once exhausts reviewer attention and misses per-module edge cases. One module at a time is not inefficiency — it is thoroughness. |

## Red Flags

- Function signatures without error return codes or without architecture IF-ID reference
- State machines with implicit states (behavior depends on flags that are not part of the state enum)
- Shared data structures without thread-safety documentation (which thread writes, which reads, which lock)
- Error paths without recovery strategy ("log and return error" is not recovery) or with infinite retry loops
- Struct sizes, stack budgets, or timing budgets not quantified against architecture constraints
- Adjectives in place of numbers ("fast", "small", "briefly", "quickly")
- Reading hardware specs or test plans to fill gaps in the architecture (context boundary violation — surface the gap instead)
- "TBD" without owner and due date
- Return values documented as "0 on success, negative on error" without enumerating specific error codes
- State machine with ANY_STATE transitions that should be explicit (lazy design, not deliberate coverage)
- Error paths flagged as "untestable" with no alternative validation strategy documented
- Designing more than one module in a single invocation (scope creep — bounded context is intentional)

## Verification

Before handing off to implementation, confirm:

- [ ] Software architecture version confirmed; all module interfaces complete (Step 1 input gate passed)
- [ ] Context boundary preserved — no hardware specs or test plans read; only software architecture document consulted
- [ ] Every public function references an architecture IF-ID (or marked "(internal)"); every return value has enumerated error codes with documented meanings
- [ ] Every state in the state machine has defined entry/exit actions and valid transitions with quantified timing
- [ ] ANY_STATE transitions are deliberate (each reviewed); recovery loops have bounded retry counts
- [ ] Every data structure field has type, range, units, and description; shared data has thread-safety documentation with writer/reader/lock specified
- [ ] Every error condition has: detection method, response, recovery path, and logging strategy
- [ ] Untestable error paths flagged with alternative validation strategy documented
- [ ] Memory budget: sizeof(state struct) + internal arrays quantified and ≤ architecture SRAM constraint; compile-time assertion written
- [ ] Stack budget includes worst-case call chain + ISR frame + safety margin; verified against architecture thread allocation
- [ ] Timing budgets quantified for every deadline-bound operation; estimation method documented (instruction count, prototype measurement, or datasheet)
- [ ] All TBDs have owners and due dates
- [ ] The human has explicitly confirmed the detailed design document
- [ ] The document is saved to a version-controlled location under `docs/spec/`

## After This Skill

Once software detailed design is saved to `docs/spec/`:

| Next Step | Skill | What It Produces |
|-----------|-------|-----------------|
| **Natural next** | `design-review` | Four-lens adversarial review of the software detailed design |
| Code review | `code-static-review` | Static analysis of source code against company coding standards |
| Quality check | `traceability-matrix` | Verify SW architecture → detailed design traceability |

**Pipeline mode**: After this skill completes, the conductor will detect `docs/spec/` and offer Verify-phase options automatically.

## See Also

- For software module detailed design review criteria, see `references/software-detailed-design-checklist.md`
- For solution-level software detailed design review criteria, see `references/solution-software-detailed-design-checklist.md`
