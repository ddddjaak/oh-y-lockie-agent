---
name: architecture-design
description: 系统级架构设计：将结构化需求分解为模块、定义接口、分析约束、记录权衡决策。System-level architecture design — decomposes system requirements into modules, defines every interface, analyzes cross-cutting constraints, and documents trade-off decisions. Use when the user says 系统架构, 架构设计, 模块划分, system architecture, module decomposition, or when you need to design the module breakdown from confirmed requirements. NOT for firmware/software architecture (use software-architecture-design) or hardware board architecture (use hardware-architecture-design).
---

# Architecture Design

## Overview

System requirements say *what* the system must do. Architecture design says *how* the system will be built to do it. This skill bridges the gap between requirements and implementation — decomposing the system into modules, defining every interface, analyzing cross-cutting constraints, and documenting the trade-offs behind every non-trivial decision.

A good architecture document is the answer key for every downstream question: "which module owns this feature?", "what does module A promise to module B?", "why did we choose this protocol over that one?". Without it, every implementer answers these differently, and integration becomes a discovery process instead of an execution plan.

Architecture design is to SE what task-breakdown planning is to software development — but for hardware-software system architecture rather than implementation tasks.

## When to Use

- Structured system requirements exist (output of `requirements-decompose`) and are confirmed
- Starting a new chip application design from scratch
- Adding a major subsystem (new power domain, new communication interface, new safety feature) to an existing design
- Evaluating architecture alternatives against a set of quantified requirements
- A downstream skill (`spec-authoring`) detects an architecture decision that was assumed but never documented
- A design review surfaces interface or module-boundary issues that require architectural resolution

**When NOT to use:**

- Requirements are not yet decomposed and confirmed (run `requirements-decompose` first)
- The change is limited to a single module's internal implementation with no interface impact
- Pure implementation task ("write the driver for this already-specified interface")
- The architecture document already exists and only needs a small clarification (edit the document directly)

## The Process

```
DECOMPOSE ──→ INTERFACE ──→ CONSTRAINT ──→ TRADE-OFF ──→ DOCUMENT
    │             │             │              │              │
    ▼             ▼             ▼              ▼              ▼
  Module       Define        Analyze        Evaluate       Produce
  breakdown    every IF     cross-cutting   alternatives   architecture
               precisely    constraints     & decide        document
```

### Step 1: DECOMPOSE — Module breakdown

From the system requirements, identify the major functional blocks. Each module must satisfy these rules:

1. **Single responsibility** — the module does one thing and does it completely. If you describe a module's purpose with "and" in the sentence, it is probably two modules.
2. **Natural boundaries** — module boundaries follow hardware buses, voltage domains, reset domains, clock domains. Crossing these boundaries in software creates hidden coupling.
3. **Change isolation** — modules that change for the same reason stay together; modules that change for different reasons are separate. A power sequencing change should not require modifying the thermal module.
4. **Hardware abstraction** — hardware-dependent logic is isolated from hardware-independent logic. The state machine for power sequencing should not know which GPIO pin maps to which rail.

**Output — Module Definition Table:**

```markdown
| Module ID | Module Name | Responsibility | Depends On | Provides To |
|-----------|-------------|---------------|------------|-------------|
| MOD-01 | Power Sequencer | Power state machine (S0/S3/S5), rail sequencing, fault detection | GPIO driver, Timer, ADC driver | SMCHost, Thermal, LED |
| MOD-02 | SMCHost | Host interface (eSPI/LPC), Port 62/66/68/6C, KCS, SCI | eSPI driver, Power Seq | Peripheral, Sensor |
| MOD-03 | Thermal Engine | Temperature monitoring, fan PID control, thermal shutdown | ADC driver, PWM driver | Power Seq (thermal shutdown trigger) |
| MOD-04 | CABI Adapter | SPI-based IPC protocol with MCU Core, k_event + K_MSGQ | SPI driver, DMA | All inter-core communication modules |
| ... | ... | ... | ... | ... |
```

**Anti-pattern:** A module table that maps 1:1 to the chip's IP block list. That is a block diagram, not an architecture. Architecture is about how blocks interact to satisfy system requirements, not which IP blocks exist.

### Step 2: INTERFACE — Define every interface

For every dependency arrow in the module decomposition table, define the interface precisely. "They communicate over I2C" is not an interface definition. An interface definition tells an implementer everything they need to know to write code against it without asking questions.

**Interface Definition Template:**

```markdown
### Interface: [Module A] ↔ [Module B]

| Property | Specification |
|----------|--------------|
| ID | IF-[ModuleA]-[ModuleB]-[NNN] |
| Type | Event-driven / Message-passing / Shared-memory / Register-based / GPIO |
| Direction | Unidirectional (A→B) / Bidirectional |
| Initiator | [Which module initiates communication] |
| Protocol | [Protocol name and version, e.g., "sysevent k_event bus v2"] |
| Data Format | [Struct name, encoding, endianness, alignment requirements] |
| Commands / Events | [Enumerated list of all messages/events/signals] |
| Timing | [Latency budget, throughput requirement, polling interval] |
| Concurrency | [Thread context, ISR context, blocking/non-blocking, locking strategy] |
| Error Handling | [What happens on timeout, CRC failure, protocol violation, buffer overflow] |
| Initialization | [Which side initializes first, handshake sequence, default state] |
| Power States | [Interface behavior in S0/S3/S5 — active, suspended, disabled] |
| Version | [Interface version for compatibility tracking] |
```

**Example — a complete interface:**

```markdown
### Interface: Power Sequencer → SMCHost (State Change Notification)

| Property | Specification |
|----------|--------------|
| ID | IF-PWRSEQ-SMCHOST-001 |
| Type | Event-driven (Zephyr k_event) |
| Direction | Unidirectional (Power Seq → SMCHost) |
| Initiator | Power Sequencer (on state transition complete) |
| Protocol | sysevent event bus (system/sysevent.h v1.3) |
| Data Format | `struct power_state_event { uint8_t prev_state; uint8_t new_state; uint32_t timestamp_ms; }` |
| Events | EVENT_PWR_S0_ENTERED, EVENT_PWR_S3_ENTERED, EVENT_PWR_S5_ENTERED, EVENT_PWR_FAULT |
| Timing | Notification within 100μs of last rail stable |
| Concurrency | Called from pwrseq thread (priority 1). SMCHost handler runs in smchost thread (priority 1). No shared lock needed — event struct is passed by value. |
| Error Handling | If SMCHost misses an event (event queue full), it reads `current_power_state` from shared state on next wake. Power Seq does not retry — event is best-effort, state is authoritative. |
| Initialization | SMCHost registers event listener before Power Seq starts. Power Seq asserts ready bit in `sys_state` after registration confirmed. |
| Power States | Interface is active in all power states. In S5, only EVENT_PWR_S0_ENTERED is monitored (wake trigger). |
| Version | v1.0 |
```

**Interface completeness checklist.** For every interface, confirm:
- [ ] Data format and encoding defined (not "standard I2C" — address, speed, byte order)
- [ ] Timing bounds specified (not "fast enough" — a number with units)
- [ ] Error handling defined for every failure mode (timeout, corruption, peer gone)
- [ ] Concurrency model explicit (which thread/context, what locks, reentrancy)
- [ ] Power-state behavior defined (active in which states, what happens on state transition)

### Step 3: CONSTRAINT — Analyze cross-cutting constraints

Extract every constraint from the requirements document and assign each to the modules it affects. Constraints by themselves are trivia; constraints mapped to modules are design.

```markdown
| Constraint ID | Constraint | Source | Affected Modules | Impact |
|---------------|------------|--------|-----------------|--------|
| CON-001 | Total boot < 500ms cold, < 100ms warm | SYS-REQ-005 | MOD-01 (power seq init 50ms), MOD-02 (eSPI init 200ms), MOD-04 (SPI init 300ms) | **CONFLICT** — MOD-04 alone consumes 300ms; see resolution below |
| CON-002 | SPI flash read ≥ 50MB/s sustained | HW-REQ-012 | MOD-04 (must use quad-SPI + DMA), MOD-02 (must not stall SPI bus during eSPI transactions) | Shared SPI bus arbitration required |
| CON-003 | Total power < 2W in S0, < 50mW in S5 | SYS-REQ-008 | MOD-01 (rail gating), MOD-03 (fan PWM reduces power), all SW modules (clock gating) | Per-module power budget TBD |
| CON-004 | SRAM budget: 256KB total, 128KB for FW | HW-REQ-015 | All SW modules | Static analysis tool to verify at build time |
```

**Conflict surfacing.** When two constraints cannot both be satisfied, surface immediately:

```
CONSTRAINT CONFLICT:
CON-001 requires boot < 500ms, but CON-002 requires SPI flash init +
calibration that takes 300ms, leaving 200ms for power sequencing (50ms),
eSPI init (200ms), and all other boot tasks.
→ Over-committed by 350ms. Options:
  A) Relax CON-001 to 850ms
  B) Optimize SPI init (hardware change to faster flash part)
  C) Parallelize eSPI init and SPI init (adds complexity, risks bus contention)
→ GUESS: Option C is lowest cost and acceptable complexity. Parallel init
  requires adding a SPI arbitration layer (new module or MOD-04 extension).
  Confirm?
```

### Step 4: TRADE-OFF — Evaluate alternatives and decide

For every non-trivial architecture decision — one where a credible alternative existed and was rejected — document what was considered and why the chosen path was selected.

**Decision documentation template:**

```markdown
### Decision [D-NNN]: [Short Title]

**Context:** [What problem is this decision solving? Reference specific requirements.]

**Alternatives considered:**

| Option | Description | Strengths | Weaknesses | Verdict |
|--------|-------------|-----------|------------|---------|
| A | [Chosen option] | [Why good] | [Trade-offs accepted] | ✅ SELECTED |
| B | [Alternative 1] | [Why appealing] | [Why rejected] | Rejected |
| C | [Alternative 2] | [Why appealing] | [Why rejected] | Rejected |

**Rationale:** [2-3 sentences referencing specific requirements or constraints.
Not "Option A is the best" — explain WHY given THIS system's constraints.]

**Downsides accepted:** [Every good decision has downsides. Name them explicitly
so the next person knows they were considered, not overlooked.]

**Re-evaluation trigger:** [Under what conditions should this decision be revisited?
E.g., "If SPI flash read drops below 40MB/s in testing" or "If MCU Core adds Linux."]
```

**Trade-off documentation rules:**
- If only one option was considered, ask yourself: did you actually explore the design space, or did you take the first answer? Revisit Step 1 and generate alternatives.
- The rationale must cite specific requirement IDs or constraint IDs, not vague preferences ("better performance" is vague; "satisfies CON-002 (50MB/s) with 30% margin" is specific).
- "Downsides accepted" is the hardest and most valuable field. It prevents the next engineer from "discovering" the downside and re-litigating the decision.

### Step 5: DOCUMENT — Produce the complete architecture document

Assemble all outputs into the architecture design document. Present to the user for review. Do not proceed to `spec-authoring` until confirmed.

## Output

An architecture design document saved to `docs/architecture/[project]-architecture-design.md` after user confirmation:

```markdown
# Architecture Design: [Project/Chip Name]

## Document Control
- Version, Date, Author
- References: [System Requirements doc path + version, Datasheet rev, Standards]

## Scope
### What This Document Covers
[One paragraph: this architecture design covers the system-level module decomposition, interface definitions, cross-cutting constraint analysis, and design trade-off decisions for [Project Name]. Reference the system requirements document and its REQ-ID range.]

### What This Document Does NOT Cover
[Explicit exclusions. "This document does not cover: detailed firmware thread models and memory budgets (see software-architecture-design), detailed hardware pin assignments and PCB constraints (see hardware-architecture-design), module-level function signatures and state machines (see software-detailed-design), test plans and test procedures (see spec-authoring)."]

## 1. System Block Diagram
[ASCII art block diagram or reference to external diagram file]
[Show: all modules from the decomposition, their dependency arrows,
 major external interfaces (host, MCU, peripherals), and domain boundaries]

## 2. Module Definitions
[Module table from Step 1 — every module with ID, responsibility, dependencies]

## 3. Interface Specifications
[Per-interface definitions from Step 2]
[Organized by: internal interfaces (between modules) and external interfaces
 (to host, to MCU, to peripherals)]

## 4. Constraint Analysis
[Constraint table from Step 3]
[Constraint conflicts and their resolutions]
[Per-module budget allocations for shared resources (SRAM, flash, cpu time)]

## 5. Design Decisions
[Decision records from Step 4 — one per non-trivial decision]
[Organized by: communication architecture, power architecture, boot architecture,
 safety/security architecture]

## 6. Risk Register
| Risk ID | Risk | Likelihood | Impact | Mitigation | Owner | Trigger |
|---------|------|-----------|--------|------------|-------|---------|
| RISK-001 | SPI arbitration adds latency that violates boot time | Medium | High | Prototype arbitration in Sprint 2; fall back to relaxed boot time if > 50μs overhead | SE | If prototype shows > 50μs overhead |

## 7. Open Items
| ID | Question | Blocker For | Owner | Due |
|----|----------|-------------|-------|-----|
| OI-001 | Is the SPI flash quad-mode capable? | MOD-04 interface definition | HW Team | Sprint 1 |
```

## Interaction with Other Skills

- **`requirements-decompose`**: Pre-requisite. If the input requirements document is missing, incomplete, or has unresolved conflicts, this skill invokes `requirements-decompose` inline rather than proceeding on unstable requirements. Architecture built on incomplete requirements is guessing, not design.
- **Third-party IP and standard verification**: When the architecture references third-party IP cores, standard protocol specifications (I2C, SPI, eSPI, etc.), or framework constraints, verify every claim against authoritative sources (chip datasheet, reference manual, protocol specification). Claims like "I2C runs at 400kHz" or "SPI flash responds within 10ms" must be confirmed against the relevant documentation chapter — not recited from memory or assumption.
- **`spec-authoring`**: Downstream consumer. Every module in the architecture decomposition becomes a section in the Software Outline Design. Every interface definition becomes a detailed interface specification.
- **`design-review`**: Can review the architecture document through HW, SW, Test, and System lenses before it is handed off to spec-authoring.
- **`traceability-matrix`**: Populates the Architecture Element column, linking each module and interface to its source requirements.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The architecture is obvious from the reference design" | Reference designs answer "what worked for the evaluation board." Your product has different peripherals, different cost targets, different thermal constraints, and different safety requirements. Copying the reference design without analyzing the differences is the most common source of late-stage architecture changes. |
| "We'll define interfaces during implementation — it's more agile" | Interfaces defined during implementation are defined by the first person who writes code against them. They optimize for their own module, not for all consumers. Interfaces defined in architecture are designed for the system. |
| "Trade-off documentation is paperwork overhead" | Six months from now, a new team member will ask "why didn't we use OpenAMP for inter-core communication?" If you cannot answer from the document, you will re-litigate the decision with less context than you have now. Documenting trade-offs is preserving institutional memory. |
| "Constraints are the HW team's problem — SW just adapts" | Every constraint that HW owns, SW inherits. A 300ms flash init time is a HW constraint that becomes a SW boot-time budget problem. Partitioning ownership of constraints is the SE's core job. |
| "One person can hold the whole architecture in their head" | That person goes on vacation, changes teams, or gets assigned to a different project. The architecture document is the team's insurance policy against bus-factor-1. |

## Red Flags

- Module decomposition that maps 1:1 to the chip's IP block list (that is a block diagram, not an architecture — architecture describes how blocks interact, not what blocks exist)
- Interfaces described only as "I2C" or "SPI" without address, speed, byte order, IRQ, or locking strategy
- Interfaces with no error handling defined (every interface fails; the question is whether the failure mode was designed or discovered)
- Zero documented trade-offs in the design decisions section (means either the design space was not explored, or decisions were made without recording why)
- Constraints listed without affected modules or impact analysis (a constraint without a module is an unassigned problem)
- All modules are the same size / complexity (real systems have modules of different weights; uniform decomposition suggests superficial thinking)
- The architecture document has no "Downsides accepted" sections (every decision has downsides; not naming them means not considering them)

## Verification

Before handing off to spec-authoring, confirm:

- [ ] Every P0 system requirement is addressed by at least one module or design decision
- [ ] Every dependency arrow in the module table has a corresponding interface definition (Step 2)
- [ ] Every interface definition passes the completeness checklist (data format, timing, error handling, concurrency, power states)
- [ ] All cross-cutting constraints are analyzed and assigned to affected modules
- [ ] Every constraint conflict has a documented resolution
- [ ] Every non-trivial design decision has documented alternatives, rationale, and accepted downsides
- [ ] The risk register covers key technical uncertainties with mitigations and owners
- [ ] Open items have owners and due dates (not just "TBD")
- [ ] The human has explicitly confirmed the architecture document
- [ ] The document is saved to a version-controlled location under `docs/architecture/`

## After This Skill

Once system architecture is confirmed and saved to `docs/architecture/`:

| Next Step | Skill | What It Produces |
|-----------|-------|-----------------|
| **Natural next** | `spec-authoring` | SOD, HW-SW IF Spec, Test Plan — formal specs for implementation teams |
| HW detailed path | `hardware-detailed-design` | Schematic guidance, BOM constraints, PCB layout rules |
| SW detailed path | `software-detailed-design` | Function signatures, data structures, state machines per module |
| Algorithm path | `algorithm-design` | Signal processing chains, control loops, calibration routines |
| Quality check | `traceability-matrix` | Verify REQ→MOD coverage, catch orphaned modules |

**Pipeline mode**: After this skill completes, the conductor will detect `docs/architecture/` and offer Document-phase options automatically.

## See Also

- For system-level architecture design review criteria, see `references/solution-architecture-design-checklist.md`
