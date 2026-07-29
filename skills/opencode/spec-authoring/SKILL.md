---
name: spec-authoring
description: 规格文档编写：生成软件概要设计(SOD)、软硬件接口规格(HW-SW IF Spec)、测试方案(Test Plan)。Specification authoring — produces Software Outline Design (SOD), Hardware-Software Interface Specification, and Test Plan from architecture and requirements. Use when the user says 规格编写, 概要设计, 接口规格, 测试方案, SOD, HW-SW IF Spec, spec authoring, or when architecture is confirmed and formal specifications are needed for implementation teams.
---

# Spec Authoring

## Overview

Architecture design says how the system fits together. Specifications say how to implement each piece. They are the contract between the SE (who designed the system) and the engineers (who build and test it). A specification that is missing a section — error handling, concurrency model, timing budget — silently communicates that those aspects were not designed.

This skill produces three specification types from a common base of requirements and architecture: the Software Outline Design (软件概要设计), the Hardware-Software Interface Specification (软硬件接口规格), and the Test Plan (测试方案). Each has a different audience and a different structure, but all draw from the same upstream artifacts and all enforce the same standard: every claim traces to a requirement, every interface is fully defined, every test case has quantified pass/fail criteria.

Spec authoring is to SE what specification-driven development is to software development — but for chip-vendor specification formats rather than software feature specs.

## When to Use

- Architecture design is complete and confirmed, and formal specification documents are needed
- Need to produce the Software Outline Design (软件概要设计) for the firmware team
- Need to produce the Hardware-Software Interface Specification for cross-department alignment
- Need to produce the Test Plan (测试方案) for the validation team
- A specific specification document is requested by a downstream team
- Adding a new module to an existing system that needs its own specification section

**When NOT to use:**

- Architecture is not yet designed or confirmed (run `architecture-design` first, or invoke it inline)
- The document already exists and needs only a minor text update (edit the document directly)
- Pure documentation formatting (this skill generates content; template styling is a separate concern)
- The request is for a one-page interface memo, not a full formal specification

## The Process

```
SELECT ──→ GATHER ──→ GENERATE ──→ CROSS-CHECK ──→ FINALIZE
  │          │           │             │              │
  ▼          ▼           ▼             ▼              ▼
 Choose    Collect     Author       Verify          Human
 which     all input   the spec     internal        review &
 spec(s)   artifacts   content      consistency     sign-off
```

### Step 1: SELECT — Choose which specification(s) to generate

This skill supports three specification types. Ask the user which to produce:

| Spec Type | Chinese Name | Primary Audience | Content Focus |
|-----------|-------------|-----------------|---------------|
| Software Outline Design | 软件概要设计 | Firmware team, SW architects | Module functional description, data structures, APIs, state machines, thread model, error handling |
| HW-SW Interface Spec | 软硬件接口规格 | HW team, FW team, Validation team | Pin assignments, register maps, timing diagrams, interrupt routing, power-domain crossings |
| Test Plan | 测试方案 | Test team, Validation engineers | Test cases mapped to requirements, test environment setup, test procedures, pass/fail criteria |

If the user requests all three, generate sequentially in this order: SOD → HW-SW IF Spec → Test Plan. Later documents reference earlier ones, and serial generation ensures consistency.

### Step 2: GATHER — Collect and verify all input artifacts

Assemble the complete input set and surface it to the user for confirmation:

```
INPUT ARTIFACTS FOR [Spec Type]:
- System Requirements:  [doc path, version, date]    ← from requirements-decompose
- Architecture Design:  [doc path, version, date]     ← from architecture-design
- Chip Datasheet:       [doc, revision, sections]
- Chip Reference Manual:[doc, revision, sections]
- Company Template:     [template path, version]
- Already-completed specs this one references:
  [list other spec docs that are inputs to this one]
→ Confirm: are these the right versions? Any additional inputs?
```

**Version verification is load-bearing.** If the System Requirements document is v1.2 but the Architecture Design was built against v1.0, the specifications will inherit inconsistencies. Verify version alignment before generating content. If versions are misaligned, surface and resolve before proceeding.

**If an input is missing or outdated**, invoke the upstream skill inline (with user confirmation) or surface the gap. Do not silently generate spec content from stale inputs.

### Step 3: GENERATE — Author the specification content

Each spec type has a defined structure. Generate content following these structures, referencing input artifacts by their IDs for every claim.

#### 3A. Software Outline Design (SOD)

The SOD is the firmware team's primary reference for module implementation. It answers: what does this module do, what are its interfaces, what data does it manage, what states does it go through, and how does it handle errors?

```markdown
# Software Outline Design: [Module/System Name]

## 1. Document Control
| Field | Value |
|-------|-------|
| Version | [X.Y] |
| Date | [YYYY-MM-DD] |
| Author | [Name] |
| References | System Requirements v[X.Y] (ref: docs/requirements/...), Architecture Design v[X.Y] (ref: docs/architecture/...) |
| Change History | [Date, Version, Author, Change description] |

## 2. Scope
### 2.1 What This Document Covers
[One paragraph defining the module(s) this SOD describes. Reference the architecture module IDs (MOD-XXX).]

### 2.2 What This Document Does NOT Cover
[Explicit exclusions. "This document does not cover: detailed register-level programming (see chip reference manual §X), MCU Core firmware (see MCU SOD), manufacturing test firmware."]

## 3. Module Overview
[Module's role in the system, from architecture-design §2. Reference MOD-IDs.]
[One-paragraph summary of module responsibility.]
[Position in the system block diagram — what feeds it, what it feeds.]

## 4. Functional Description
### 4.1 Feature List
| Feature ID | Feature Description | Requirement Trace | Priority |
|------------|--------------------|--------------------|----------|
| FEAT-001 | [Feature] | SYS-REQ-XXX, SYS-REQ-YYY | P0 |
| FEAT-002 | [Feature] | SYS-REQ-ZZZ | P1 |
| ... | ... | ... | ... |

### 4.2 State Machine
[If the module has stateful behavior, provide:]
- State transition diagram (ASCII art or reference)
- State transition table:

| Current State | Trigger | Next State | Action | Requirement Trace |
|---------------|---------|------------|--------|--------------------|
| S0_READY | SLP_S3# asserted | S3_ENTERING | Begin rail shutdown sequence | SYS-REQ-001 |
| S3_ENTERING | All rails off | S3_STABLE | Notify SMCHost (EVENT_PWR_S3_ENTERED) | SYS-REQ-001 |
| ... | ... | ... | ... | ... |

### 4.3 Data Flow
[Description or diagram of: inputs → processing → outputs.]
[For each data path: source module, data format, trigger condition, timing budget.]

## 5. Interface Specification
### 5.1 External Interfaces
[Reference every interface from architecture-design §3 that involves this module.]
[For each interface: expand the architecture IF spec into the implementation detail
the firmware team needs — exact function signatures, struct definitions, event constants.]

```c
// Example: Power State Event (IF-PWRSEQ-SMCHOST-001)
// Source: Architecture Design §3.2
struct power_state_event {
    uint8_t  prev_state;     // S0=0, S3=3, S5=5
    uint8_t  new_state;      // S0=0, S3=3, S5=5
    uint32_t timestamp_ms;   // system uptime when transition completed
    uint8_t  fault_code;     // 0 = normal, see §7 for fault codes
};
```

### 5.2 Internal Data Structures
[Key data structures internal to the module — not exposed on external interfaces.]
[For each struct: field name, type, valid range, description.]

### 5.3 API / Function Signatures
| Function | Signature | Precondition | Postcondition | Caller | Context | Blocking? |
|----------|-----------|-------------|---------------|--------|---------|-----------|
| pwrseq_init | `int pwrseq_init(void)` | GPIO initialized, timer ready | Sequencer in S5_STABLE, ready for commands | app.c (init sequence) | Thread | Yes (waits for rail check) |
| pwrseq_transition | `int pwrseq_transition(uint8_t target_state)` | Sequencer in stable state | Transition started or error returned | smchost (on host command) | Thread | No (async, result via event) |
| ... | ... | ... | ... | ... | ... | ... |

## 6. Design Constraints
### 6.1 Timing Constraints
| Constraint | Value | Source | Verification Method |
|------------|-------|--------|-------------------|
| S0→S3 total transition time | ≤ 10ms | CON-007 | Oscilloscope measurement on rail waveforms |
| Event notification latency | ≤ 100μs from last rail stable | IF-PWRSEQ-SMCHOST-001 | GPIO toggle + logic analyzer |
| ... | ... | ... | ... |

### 6.2 Memory Constraints
| Region | Size | Purpose | Allocation Strategy |
|--------|------|---------|-------------------|
| .bss (state structs) | ≤ 2KB | Power state, rail config, sequencing tables | Static allocation at compile time |
| Stack (pwrseq thread) | 2048 bytes | Local variables, ISR context save | Zephyr K_THREAD_STACK_SIZEOF |
| ... | ... | ... | ... |

### 6.3 Concurrency Model
- **Thread assignment:** pwrseq thread (priority 1, cooperative)
- **Locking strategy:** No external locks — all state mutations happen in pwrseq thread context. External readers access state via `k_event` notifications + shared read-only struct.
- **ISR interactions:** GPIO interrupts for SLP_S3#, SLP_S5# are latency-critical. ISR posts to pwrseq thread via k_event; no processing in ISR context beyond GPIO read + event post.
- **Reentrancy:** Not required — single threaded by design.

## 7. Error Handling
| Error Condition | Detection | Response | Recovery | Requirement Trace |
|----------------|-----------|----------|----------|--------------------|
| Rail fails to reach target voltage within timeout | ADC reading outside ±5% window after ramp time | Abort sequence, assert FAULT signal, notify SMCHost (EVENT_PWR_FAULT) | System enters S5. Manual intervention required. | SYS-REQ-012 |
| Host asserts SLP_S3# during S0→S3 transition already in progress | GPIO interrupt during transition state | Queue the request; complete current transition first, then process new request | Transition serialization | SYS-REQ-015 |
| SPI flash unresponsive during state table load | SPI timeout (100ms) | Retry 3 times. If all fail, load defaults from internal flash and raise warning event. | Degraded mode with default sequencing | CON-009, RISK-003 |
| ... | ... | ... | ... | ... |

## 8. Open Items
| ID | Question | Blocker For | Owner | Due |
|----|----------|-------------|-------|-----|
| ... | ... | ... | ... | ... |
```

#### 3B. Hardware-Software Interface Specification

The HW-SW IF Spec is the contract between the EE team and the FW team. It answers: which pins are used for what, what are the register addresses, what are the interrupt assignments, and what are the timing requirements at the hardware-software boundary?

```markdown
# Hardware-Software Interface Specification: [System/Subsystem Name]

## 1. Document Control
[Same format as SOD §1]

## 2. Scope
[What hardware-software interfaces this document covers.]
[Explicit exclusions: "This document does not cover: internal chip register definitions
 (see chip reference manual), PCB-level signal integrity requirements."]

## 3. Pin / Signal Assignment
| Signal Name | Package Pin | GPIO Bank | Direction | Voltage Domain | Pull | Initial State (after reset) | SW Access API | Used By (MOD-ID) |
|-------------|------------|-----------|-----------|---------------|------|---------------------------|---------------|-------------------|
| PWRBTN_IN | B3 | GPIOA_3 | Input | VDD_3V3 | PU (100k) | High (inactive) | `gpio_pin_get(dt, PIN)` | MOD-02 (SMCHost) |
| SLP_S3_N | C7 | GPIOB_1 | Input | VDD_3V3 | None (host driven) | High (inactive) | `gpio_pin_get_interrupt()` | MOD-01 (Power Seq) |
| PWR_OK | D2 | GPIOB_5 | Output (OD) | VDD_3V3 | PU (external 10k) | Low (not OK) | `gpio_pin_set(dt, PIN, val)` | MOD-01 (Power Seq) |
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

## 4. Register Map
[For memory-mapped peripherals, provide the complete register map visible to firmware.]

| Peripheral | Base Address | Register Name | Offset | Bits | Access | Reset Value | Description |
|------------|-------------|---------------|--------|------|--------|-------------|-------------|
| eSPI Controller | 0x4000_1000 | ESPI_CTRL | 0x00 | [31:0] | R/W | 0x0000_0000 | Control register: [0] enable, [1] alert mode, [3:2] freq select |
| eSPI Controller | 0x4000_1000 | ESPI_STATUS | 0x04 | [31:0] | R | 0x0000_0000 | Status: [0] bus ready, [1] channel 0 active, ... |
| ... | ... | ... | ... | ... | ... | ... | ... |

## 5. Interrupt Map
| IRQ # | NVIC Priority | Peripheral Source | Handler Function | Latency Budget | Context | MOD-ID |
|-------|--------------|------------------|-----------------|---------------|---------|--------|
| 16 | 1 | GPIOB — SLP_S3# edge detect | `slp_s3_isr()` | ≤ 10μs from edge to ISR entry | ISR (posts event, returns) | MOD-01 |
| 24 | 2 | SPI0 — DMA transfer complete | `spi0_dma_isr()` | ≤ 50μs from DMA done | ISR (unlocks semaphore) | MOD-04 |
| ... | ... | ... | ... | ... | ... | ... |

## 6. Timing Diagrams
[For critical HW-SW interaction sequences. Use ASCII art or reference waveform documents.]

```
Power-On Sequence (Cold Boot):

Vcore  : ___/‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾ (ramp 0→1.1V, ≤ 2ms per CON-005)
Vio    : ____/‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾ (ramp after Vcore stable + 100μs)
POR_N  : ____/‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾ (released after Vio stable + 500μs)
FW     : _________/‾‾‾‾‾‾‾‾‾‾‾ (boot starts after POR_N released)
PWR_OK : ____________/‾‾‾‾‾‾‾‾ (asserted after FW signals ready)
        |<-- HW domain -->|<---- FW domain ---->|
```

## 7. Power Domain Crossings
| Signal Name | From Domain | To Domain | Level Shifter Required? | Isolation Required? | Isolation Control |
|-------------|------------|-----------|------------------------|--------------------|--------------------|
| I2C_SDA (host) | VDD_3V3 (always-on) | VDD_1V8 (S0 only) | Yes (TXB0104) | No (I2C is open-drain, safe when powered down) | N/A |
| UART_TX (debug) | VDD_1V8 (S0/S3) | VDD_EXT (debug connector) | Yes (SN74LVC) | Yes — must not drive debug connector in S5 | GPIO-controlled buffer enable |
| ... | ... | ... | ... | ... | ... |

## 8. Open Items
```

#### 3C. Test Plan

The Test Plan is the validation team's playbook. It answers: what must be tested, how is each test performed, what equipment is needed, and what exactly constitutes a pass?

```markdown
# Test Plan: [System/Module Name]

## 1. Document Control
[Same format as SOD §1]

## 2. Scope
### 2.1 Test Scope
[What is tested: system level, module level, integration, regression.]
[Reference the specific software version(s) under test.]

### 2.2 Out of Scope
[Explicitly excluded: "Manufacturing test (see MFG-TEST-001), reliability stress test,
 EMC compliance test (handled by compliance team)."]

## 3. Test Environment
### 3.1 Hardware Requirements
| Equipment | Model / Spec | Quantity | Purpose |
|-----------|-------------|----------|---------|
| Oscilloscope | ≥ 200MHz, 4-channel | 1 | Rail sequencing timing measurement |
| Logic Analyzer | ≥ 100MHz, 16-channel | 1 | eSPI bus protocol verification |
| Digital Multimeter | 6.5 digit | 1 | Voltage accuracy measurement |
| Electronic Load | Programmable, 0-5A | 2 | Power rail load testing |
| J-Link Debug Probe | Segger J-Link Plus | 1 | Firmware download, RTT logging |
| ... | ... | ... | ... |

### 3.2 Software Requirements
| Tool | Version | Purpose |
|------|---------|---------|
| Segger Ozone | ≥ 3.30 | Debugger, RTT viewer |
| Python | ≥ 3.10 | Test automation scripts |
| pytest | ≥ 7.0 | Test framework |
| eSPI Protocol Analyzer SW | v2.1 | eSPI transaction decoding |
| ... | ... | ... |

### 3.3 Test Setup
[Block diagram showing: DUT (Device Under Test), test equipment connections,
 power supplies, host simulator, monitoring points.]

## 4. Test Case Matrix
| TC-ID | Requirement Trace | Test Description | Setup | Input / Stimulus | Expected Output | Pass Criteria | Priority | Automated? |
|-------|-------------------|-----------------|-------|------------------|-----------------|---------------|----------|-----------|
| TC-001 | SYS-REQ-001 | Verify S0→S3 transition on SLP_S3# assertion | Full system in S0, oscilloscope on all rails | Assert SLP_S3# low via GPIO toggle from test fixture | All rails power down in reverse order of power-on sequence | Sequence matches Table X; total time ≤ 10ms; no rail glitches > 50mV | P0 | Yes (script: `test_power_s0_s3.py`) |
| TC-002 | SYS-REQ-002 | Verify S3→S0 within 500μs | System in S3, logic analyzer on SLP_S3# and PWR_OK | De-assert SLP_S3# (high) | PWR_OK asserted within 500μs of SLP_S3# rising edge | Measured interval ≤ 500μs across 100 trials | P0 | Yes |
| TC-003 | SYS-REQ-012 | Verify power fault handling — rail fails to reach target | System, with one rail load disabled (simulate open circuit) | Initiate S0 transition | System enters S5; FAULT signal asserted; EVENT_PWR_FAULT logged | FAULT asserted within 100ms of timeout; no damage to other rails | P1 | Partial (manual fault injection) |
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

## 5. Test Procedures
[Detailed step-by-step for each test case, especially manual or partially-automated tests.]

### TC-001: S0→S3 Transition Test
**Preconditions:**
1. DUT in S0, all rails verified stable (within ±5% of nominal)
2. Oscilloscope probes connected to: Vcore, Vio, Vddr, PWR_OK
3. Test fixture connected to SLP_S3# GPIO control
4. Firmware version: [version] built with debug.conf

**Procedure:**
1. Start oscilloscope capture (trigger on SLP_S3# falling edge)
2. Assert SLP_S3# low via test fixture GPIO
3. Wait for PWR_OK de-assertion or 100ms timeout
4. Stop oscilloscope capture
5. Verify: (a) rail sequence order matches Table X, (b) total time from SLP_S3# low to all rails off ≤ 10ms, (c) no rail glitches > 50mV during transition
6. Run 10 iterations and record min/max/avg transition time

**Postconditions:**
- System in S3 (verify: PWR_OK low, all switchable rails off, always-on rails nominal)
- No error events logged

## 6. Coverage Analysis
| Requirement ID | Test Case(s) | Coverage | Notes |
|----------------|-------------|----------|-------|
| SYS-REQ-001 | TC-001 | Full | |
| SYS-REQ-002 | TC-002 | Full | |
| SYS-REQ-012 | TC-003 | Partial | Fault injection for all rail types not automated |
| SYS-REQ-015 | — | **GAP** | No test case covers queued transition behavior |
| ... | ... | ... | ... |

## 7. Open Items
```

#### Content Generation Rules

For all three spec types, enforce these rules during generation:

1. **Every claim traces to something.** A feature description without a requirement reference is unmoored. An interface definition without an architecture reference is invented. A test case without a requirement reference is unvalidated.
2. **Empty sections are errors.** If a section of the template does not apply, write "Not applicable — [reason]" rather than leaving it blank. A blank section communicates ambiguity; an explicit "N/A" communicates a decision.
3. **Numbers, not adjectives.** "Fast" is an adjective; "≤ 500μs" is a requirement. "Robust" is an adjective; "survives 1000 transitions without state corruption" is a requirement. Replace every adjective with a number or remove the claim.
4. **"TBD" must have an owner and a due date.** An unresolved parameter is acceptable during design. An unresolved parameter with no owner is a project risk. Every TBD gets: `TBD — Owner: [name], Due: [date]`.

### Step 4: CROSS-CHECK — Verify internal consistency

Before presenting to the user, verify that the generated specification is internally consistent and consistent with its inputs:

```
CROSS-CHECK RESULTS:
✅ 23/23 requirements referenced in SOD have corresponding entries in the requirements document
✅ All 12 interface definitions in SOD match architecture design §3
⚠️  SOD §6.1 references CON-012 which was removed in architecture design v1.3
❌ Test Plan TC-015 references SYS-REQ-099 which does not exist in requirements v1.2
❌ SOD §5.2 defines `struct power_rail_cfg` with 8 fields, but architecture IF-PWRSEQ-DRIVER-003 defines 10 fields
→ Fix these before finalizing.
```

Surface all issues to the user with proposed fixes. Do not silently correct — the user may know something about the inconsistency that you do not (e.g., CON-012 was renamed, not removed).

### Step 5: FINALIZE — Human review and sign-off

Present the complete specification document to the user. The gate is explicit confirmation. These documents will be distributed to multiple departments — errors here propagate to implementation and test.

## Output

One or more specification documents, saved under `docs/spec/` after user confirmation:

```
docs/spec/[project]-sod-[module].md           # Software Outline Design
docs/spec/[project]-hwsw-if-[subsystem].md    # HW-SW Interface Spec
docs/spec/[project]-test-plan-[scope].md      # Test Plan
```

## Interaction with Other Skills

- **`architecture-design`**: Pre-requisite. If architecture decisions needed for the specification are missing or ambiguous, this skill invokes `architecture-design` inline. For example, if the SOD template requires a state machine but the architecture only says "module manages power states" without defining the states, architecture-design is invoked to fill the gap.
- **`requirements-decompose`**: Two hops upstream. If a specification references a requirement ID that does not resolve, or a requirement is too vague to specify against, invoke `requirements-decompose` inline.
- **`design-review`**: Downstream. After the spec is finalized, `design-review` can adversarially review it through department lenses before distribution to the broader team.
- **`traceability-matrix`**: Consumes this skill's output to populate the Design Element and Test Case columns of the matrix.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The spec is just the architecture doc with more words" | The architecture doc answers "how does the system fit together" for the system design team. The spec answers "how do I implement this specific module" for the engineer writing code. Different audiences, different granularity, different questions. |
| "I'll write the spec after implementation — it'll be more accurate" | That is documentation, not specification. A specification written after implementation validates the implementation, not the design. The value of the spec is in forcing design clarity *before* code is written. |
| "The template structure is boilerplate — just fill in what matters" | A section you skip silently communicates that the topic was not designed. If error handling is not specified, the implementer assumes no error handling is needed. If concurrency is not specified, the implementer picks a model that may be wrong. |
| "Test cases can be derived by the test team — that's their job" | If the SE cannot describe how to test a requirement, the requirement is not testable. Testability is a requirement quality, not a test-team discovery process. |
| "One person can write all the specs — they all come from the same architecture" | The SOD, HW-SW IF Spec, and Test Plan have different audiences, different vocabularies, and different assumptions. Writing all three forces the SE to think through the system from three perspectives. Skimping on one leaves that perspective unexamined. |

## Red Flags

- Generating specification content that does not reference specific requirement IDs or architecture interface IDs
- Interface specifications without timing bounds, error handling, or concurrency models
- Test cases without quantified pass/fail criteria ("verify it works" is not a test case)
- Skipping the cross-check (Step 4) — an inconsistency caught here costs a correction; caught during implementation costs a re-spin
- Using "TBD" as a permanent placeholder (TBD without owner and due date)
- Empty sections in the generated spec (see content generation rule #2)
- Adjectives in place of numbers ("fast," "robust," "reliable" — replace or remove)
- Generating all three spec types in parallel when the user asked for all three (they reference each other; serial generation prevents version skew)

## Verification

Before finalizing, confirm:

- [ ] Spec type(s) explicitly confirmed by user before content generation
- [ ] All input artifacts referenced with correct version numbers and dates
- [ ] Version alignment verified across all input artifacts
- [ ] Every section of every generated spec is populated (no empty sections — only explicit "N/A" with reasons)
- [ ] Every claim in every spec traces to a requirement ID, architecture interface ID, or constraint ID
- [ ] Every interface definition includes: data format, timing, error handling, concurrency model
- [ ] Every test case has quantified pass/fail criteria
- [ ] Test plan covers every P0 requirement (gaps documented with owners)
- [ ] Cross-check passed — no unresolved inconsistencies between the spec and its inputs
- [ ] All TBDs have owners and due dates
- [ ] The human has explicitly confirmed each specification document
- [ ] Documents saved under `docs/spec/`

## After This Skill

Once specifications are authored and saved to `docs/spec/`:

| Next Step | Skill | What It Produces |
|-----------|-------|-----------------|
| **Natural next** | `design-review` | Four-lens adversarial review (HW/SW/Test/System) of the spec artifacts |
| Targeted review | `requirements-review` | If you want to verify requirements→spec traceability specifically |
| Quality check | `traceability-matrix` | Verify REQ→SPEC→TEST coverage before review |

**Pipeline mode**: After this skill completes, the conductor will detect `docs/spec/` and offer Verify-phase options automatically.

## See Also

- For solution specification review criteria, see `references/solution-specification-checklist.md`
