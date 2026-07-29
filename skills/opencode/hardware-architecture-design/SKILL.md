---
name: hardware-architecture-design
description: 硬件板级架构设计：引脚分配、电压域、电源树、PCB叠层约束、信号完整性、器件选型。Hardware board-level architecture — pin assignments, voltage domains, power tree, PCB stack-up constraints, signal integrity analysis, and component selection criteria. Use when the user says 硬件架构, 引脚分配, 电源树, PCB约束, hardware architecture, pin assignment, power tree, or when system architecture and HW requirements are confirmed and board-level design can begin. NOT for system-level architecture (use architecture-design) or firmware architecture (use software-architecture-design).
---

# Hardware Architecture Design

## Overview

System architecture says *how* modules interact. Hardware architecture says *what the PCB looks like* to make those interactions physically real — decomposing the system into power domains, assigning every pin, defining every voltage rail, analyzing signal integrity, selecting critical components, and documenting the PCB constraints the layout engineer needs.

A good hardware architecture document answers every question a PCB designer will ask: "what voltage does this rail need?", "which pins connect to which?", "what trace impedance must this differential pair maintain?", "why did we choose this PMIC over that one?". Without it, board bring-up becomes a debugging marathon instead of a verification checklist.

Hardware architecture design is the hardware counterpart to `architecture-design` — where that skill decomposes into software modules and message-passing interfaces, this skill decomposes into power domains, physical interconnects, and electrical constraints.

## When to Use

- Structured system requirements exist (output of `requirements-decompose`), HW-domain confirmed
- System architecture exists (output of `architecture-design`), module/block decomposition defined
- Starting a new board or board revision from scratch
- Adding a major hardware subsystem (new power domain, high-speed interface, sensor array)
- Evaluating component alternatives against quantified electrical and thermal requirements
- A design review surfaces pin-assignment conflicts, power sequencing gaps, or SI concerns

**When NOT to use:**

- Requirements not yet decomposed (run `requirements-decompose` first) or system architecture not yet defined (run `architecture-design` first)
- Single component swap with identical footprint/electrical — no architecture impact
- Pure PCB layout task or existing architecture doc needing only minor clarification
- Purely software/firmware with no hardware design impact

## Context Boundary
**Read ONLY:**
- System architecture document (module decomposition, interface definitions)
- HW-domain system requirements (power, thermal, mechanical, EMC, SI, reliability)
- Chip datasheets, reference manuals, application notes for MCU/SoC
- Industry standards referenced by requirements (PCIe CEM, USB-IF, DDR JEDEC)

**Do NOT read:** software specifications, firmware design documents, driver APIs, software-only constraints (RAM budget, RTOS tick rate, task priorities), build system, CI/CD, or toolchain files.

If a hardware decision requires software input (e.g., "which GPIOs does firmware need for debug UART?"), surface it as an Open Item with the SW team as owner — do not read software specs to answer it yourself.

## The Process

```
DECOMPOSE ──→ INTERFACE ──→ CONSTRAINT ──→ TRADE-OFF ──→ DOCUMENT
    │             │             │              │              │
    ▼             ▼             ▼              ▼              ▼
  Power        Assign        Analyze        Evaluate       Produce
  domains      every pin     PCB/thermal/   component      hardware
  & blocks     & define      SI/EMC         alternatives   architecture
               electrical    constraints    & decide       document
```

### Step 1: DECOMPOSE — Hardware block and power domain breakdown

From system architecture and HW requirements, identify hardware functional blocks and power domains. Every block satisfies:

1. **Power domain boundary** — blocks in the same voltage domain may share a rail; different domains require separate regulation.
2. **Signal grouping** — high-speed (PCIe, DDR, USB 3.x) and low-speed (I2C, GPIO, UART) signals group separately, driving stack-up and impedance.
3. **Physical locality** — components that must be close (bypass caps, crystals, termination resistors) drive placement constraints.
4. **Isolation requirements** — galvanic isolation, chassis-ground separation, ESD protection zones are explicit block boundaries.

**Input gate (anti-hallucination) — for every hardware block, verify:**
- [ ] Every pin assignment traces to a specific requirement ID or system architecture interface ID. No pin is assigned "because it was free."
- [ ] Every electrical specification is quantified with a number and unit (voltage tolerance ±%, current draw in mA, rise time in ns). No "nominal 3.3V" — specify "3.3V ±5%."
- [ ] Every component claim is verified against its datasheet (not memory). If the datasheet is not available, surface an Open Item. **If uncertain about a component specification, stop and ask the HW team — do not guess.**
- [ ] Every "typical value" from a datasheet has been cross-checked against the worst-case column. Design to worst-case, not typical.

**Output — Hardware Block Table:**

```markdown
| Block ID | Block Name | Power Domain | Voltage Rail | Max Current | Key Interfaces | Sensitive Signals |
|----------|------------|--------------|--------------|-------------|----------------|-------------------|
| HWB-01 | Core SoC | VDD_CORE (S0) | 1.1V ±5%, 2.5A | 2.5A | DDR4, PCIe Gen3 x4, eSPI, QSPI | DDR CLK/DQS (Z₀=40Ω ±10%) |
| HWB-02 | DDR4 Subsystem | VDD_DDR (S0) | 1.2V ±5%, 3.0A | 3.0A | 2x DDR4 x16 (fly-by) | DQS[1:0], CLK[1:0] (Z_diff=80Ω) |
| HWB-03 | PMIC + Power Tree | VIN_12V → Multiple | Multiple | Per-rail | I2C (PMBus), EN pins | Power-good handshake |
| HWB-04 | External I/O Protection | — (passive) | — | — | All external connectors | ESD clamp, TVS array |
| ... | ... | ... | ... | ... | ... | ... |
```

**Anti-pattern:** A block table that is just the chip's pin list grouped by function — that is a pin mux spreadsheet, not hardware architecture.

### Step 2: INTERFACE — Define every physical interface and pin assignment

For every connection between hardware blocks and every external connector, define the electrical interface precisely. "Connected via SPI" is not an interface definition. A hardware interface definition tells a PCB designer exact electrical parameters, pin mapping, and layout constraints.

**Interface Definition Template:**

```markdown
### Hardware Interface: [Block A] ↔ [Block B]

| Property | Specification |
|----------|--------------|
| ID | HIF-[BlockA]-[BlockB]-[NNN] |
| Signal Type + Pin Count | Single-ended / Differential / Power / Ground; [N pins] |
| Pin Mapping | [Chip A pin → Chip B pin table with net names] |
| Voltage Standard | [LVCMOS33, LVDS, SSTL-15, HCSL, etc.] |
| V_IH / V_IL / V_OH / V_OL | [Explicit levels with tolerances] |
| Drive Strength | [mA, configurable range if applicable] |
| Impedance + Termination | [Z₀ and Z_diff in Ω with tolerance; on-die/external, values, placement] |
| Max Data Rate | [Clock rate, data rate per lane] |
| Trace Constraints | [Max length (mm/mils), length matching skew tolerance] |
| Topology | [Point-to-point / multi-drop / fly-by — draw ASCII] |
| Signal Integrity Critical? | [Yes/No — if Yes, detail target eye diagram requirements] |
| ESD / Protection | [TVS part number, clamping voltage, placement constraint] |
| Power States | [S0/S3/S5 behavior: driven, tri-stated, pulled, or disabled] |
```

**Example — DDR4 interface:**

```markdown
| ID | HIF-SOC-DDR4-CH-A-001 |
| Signal Type + Pin Count | Mixed (diff CLK, SE A/C, SE DQ with diff DQS); 64 signals |
| Voltage Standard | SSTL-12 (JEDEC JESD79-4B) |
| V_IH / V_IL | VREFCA ± 100mV (AC), VREFCA ± 75mV (DC) |
| Impedance + Termination | SE 40Ω ±10%, diff CLK/DQS 80Ω ±10%; ODT RTT_PARK 60Ω |
| Max Data Rate | DDR4-3200 (1600 MHz, 3200 MT/s) |
| Trace Constraints | CLK ≤ 2.5 inch, DQ ≤ 1.8 inch; DQS-DQ skew ≤ ±5 mils |
| Topology | Fly-by (CLK → DRAM0 → DRAM1) |
| Signal Integrity Critical? | Yes — pre-layout IBIS + post-layout S-param. Eye ≥ 85mV, ≥ 0.35 UI @ BER 1e-16 |
| Power States | S0: Active; S3: Self-refresh (CKE low); S5: Off |
```

**Interface completeness checklist:**
- [ ] Every pin traced to a requirement ID (no floating/spare pins without justification)
- [ ] Voltage levels and tolerances quantified (V_IH min, V_IL max, V_OH min, V_OL max)
- [ ] Impedance and termination values specified with tolerances
- [ ] Length matching and skew tolerances specified where applicable
- [ ] Power-state behavior defined for every supported power state
- [ ] ESD/TVS protection specified for every external-facing connector

### Step 3: CONSTRAINT — Analyze PCB, power, thermal, and SI constraints

Extract every hardware constraint from requirements and datasheets. Assign each to affected blocks and interfaces.

```markdown
| Constraint ID | Constraint | Source | Affected Blocks | Impact |
|---------------|------------|--------|-----------------|--------|
| HCON-001 | PCB: 6-layer, 1.6mm, FR4 | HW-REQ-003 (cost), HW-REQ-004 (mech) | All high-speed IFs | SIG-GND-SIG-PWR-GND-SIG. DDR L1/L6, PCIe L1/L3. Verify 90Ω diff on FR4. |
| HCON-002 | DDR4 3200 MT/s eye ≥ 85mV, ≥ 0.35 UI | HW-REQ-007, JESD79-4B | HWB-01, HWB-02 | Pre-layout SI sim mandatory. Budget: 0.5 UI TX, 0.15 UI RX jitter. |
| HCON-003 | Board power ≤ 15W S0, ≤ 500mW S5 | SYS-REQ-008, HW-REQ-009 | HWB-01 (8W), HWB-02 (4W), HWB-03 (1.5W), HWB-04 (2W) | 15.5W over-budget by 0.5W — see conflict below |
| HCON-004 | Ambient temp -40°C to +85°C | HW-REQ-011 | All components | Industrial grade required. PMIC shutdown ≥ 105°C. |
```

**Conflict surfacing — surface immediately:**

```
HARDWARE CONSTRAINT CONFLICT:
HCON-003: HWB-01(8W) + HWB-02(4W) + HWB-03(1.5W) + HWB-04(2W) = 15.5W
→ Exceeds 15W budget by 0.5W. Options:
  A) Relax to 16W (thermal re-evaluation)
  B) DDR4 at 2666 MT/s (saves ~1.2W, perf impact)
  C) Lower-power USB Hub alternative (saves ~0.5W, pin-compatible)
→ GUESS: Option C — lowest risk. Confirm with HW team and procurement?
```

### Step 4: TRADE-OFF — Evaluate component alternatives and decide

For every non-trivial hardware decision — component selection, power architecture, connector choice, layer count, stack-up — document alternatives considered and why the chosen path was selected.

**Decision template:**

```markdown
### Decision [HD-NNN]: [Short Title]

**Context:** [Which requirement/constraint drives this? Reference IDs.]

**Alternatives considered:**

| Option | Part / Approach | Strengths | Weaknesses | Cost (1ku) | Lead Time | Verdict |
|--------|----------------|-----------|------------|------------|-----------|---------|
| A | [Chosen] | [Why good] | [Trade-offs accepted] | $X.XX | N wks | ✅ SELECTED |
| B | [Alt 1] | [Why appealing] | [Why rejected] | $X.XX | N wks | Rejected |
| C | [Alt 2] | [Why appealing] | [Why rejected] | $X.XX | N wks | Rejected |

**Rationale:** [2-3 sentences citing specific requirement IDs or quantified electrical parameters.]

**Downsides accepted:** [Every decision has downsides — name them explicitly.]

**Re-evaluation trigger:** [When to revisit, e.g., "If DDR4 fails SI sim at 3200 MT/s."]
```

**Hardware-specific decision categories:**
- Power: Regulator type (LDO vs. DC-DC vs. PMIC), sequencer, rail count
- High-speed PHY: Equalization, ref clock (crystal vs. oscillator vs. buffer), AC coupling cap
- Connector: Type, pin count, locking, IP rating, mating cycles
- PCB: Layer count, material (FR4 vs. Megtron vs. Rogers), stack-up, via type
- Protection: TVS clamp voltage vs. signal margin, fuse type (PTC vs. eFuse vs. one-time)

**Rules:**
- Every active component must have at least one documented alternate (or justified sole-source). Every passive must have an alternate package/tolerance considered.
- Rationale must cite specific requirement IDs or quantified parameters — not "better performance."
- "Downsides accepted" prevents re-litigation during board bring-up.

### Step 5: DOCUMENT — Produce the complete hardware architecture document

Assemble all outputs. Present for review. Do not proceed to `spec-authoring` until confirmed.

## Output

A hardware architecture document saved to `docs/architecture/[project]-hardware-architecture-design.md`:

```markdown
# Hardware Architecture Design: [Project/Board Name]

## Document Control
- Version, Date, Author
- References: [System Requirements doc, System Architecture doc, Chip Datasheet rev, Reference Manual rev, Industry Standards, Mechanical Envelope Drawing]

## Scope
### What This Document Covers
[One paragraph: this hardware architecture design covers the power tree, pin assignments, physical interface specifications, signal integrity requirements, component selection decisions, and PCB constraints for [Project/Board Name]. Reference the system architecture document and its relevant block and interface IDs.]

### What This Document Does NOT Cover
[Explicit exclusions. "This document does not cover: system-level module decomposition (see architecture-design), firmware thread models and memory budgets (see software-architecture-design), detailed component part numbers and BOM cost analysis (see hardware-detailed-design), test procedures and validation plans (see spec-authoring)."]

## 1. Hardware Block Diagram
[ASCII block diagram: functional blocks, power rails, high-speed vs. low-speed paths, connectors, isolation, protection zones]

## 2. Power Architecture
[Power tree: input → regulation → output rails, with sequencing diagram]
| Rail Name | Voltage | Tolerance | Max Current | Source | Sequencing Group | S0 | S3 | S5 |
|-----------|---------|-----------|-------------|--------|-----------------|----|----|----|
| VDD_CORE | 1.1V | ±5% | 2.5A | PMIC Buck1 | Group A (first on, last off) | ON | ON (0.9V) | OFF |
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

## 3. Hardware Block Definitions
[Block table from Step 1: power domain, current budget, key interfaces, sensitive signals]

## 4. Interface Specifications and Pin Assignments
[Per-interface definitions from Step 2, organized by: SoC-to-memory, SoC-to-peripheral, board-to-board, external I/O, power distribution, debug/programming headers]

## 5. Signal Integrity Analysis
| Interface | Data Rate | Topology | Pre-Layout Sim | Post-Layout Sim | Target Eye | Status |
|-----------|-----------|----------|----------------|-----------------|------------|--------|
| DDR4 CH-A | 3200 MT/s | Fly-by, 2 ranks | Yes (IBIS) | Yes (S-param) | EH ≥ 85mV, EW ≥ 0.35 UI @ 1e-16 | Pending |
| PCIe Gen3 x4 | 8 GT/s | P2P, AC coupled | Yes (IBIS-AMI) | Yes | EH ≥ 25mV, EW ≥ 0.30 UI @ 1e-12 | Pending |
[Stack-up: layer count, material, thickness, copper weight, prepreg type]

## 6. Constraint Analysis
[Constraint table, conflict resolutions, per-rail power budget, per-interface SI budget]

## 7. Component Selection and Design Decisions
[Decision records from Step 4, organized by: power, high-speed interfaces, connectors, protection, PCB]

## 8. Risk Register
| Risk ID | Risk | Likelihood | Impact | Mitigation | Owner | Trigger |
|---------|------|-----------|--------|------------|-------|---------|
| HRISK-001 | DDR4 3200 SI fails at 85°C corner case | Medium | High | Pre-layout SI at all PVT; 2666 MT/s fallback | HW Lead | Eye margin < 10% at 85°C slow-slow |
| HRISK-002 | PMIC lead time > 26 weeks | Medium | High | Qualify 2nd-source PMIC in parallel | Procurement | Lead time > 20 wks at order |

## 9. Open Items
| ID | Question | Blocker For | Owner | Due |
|----|----------|-------------|-------|-----|
| HOI-001 | Heatsink keep-out height above SoC? | PCB placement, thermal | ME Team | Sprint 1 |
| HOI-002 | DDR4 DRAM available in industrial grade? | BOM, HCON-004 | Procurement | Sprint 1 |
| HOI-003 | Which GPIO for firmware debug UART? | Pin assignment | SW Team | Sprint 1 |
```

## Interaction with Other Skills

- **`requirements-decompose`** and **`architecture-design`**: Pre-requisites. Invokes either inline if HW requirements or system architecture are missing. Architecture on unverified requirements is a board re-spin waiting to happen.
- **Datasheet verification**: Every pin, voltage, timing, and power number must cite the authoritative component datasheet — not memory. **If the datasheet is unavailable or ambiguous, stop and surface an Open Item — do not guess.**
- **`spec-authoring`**: Downstream consumer. Every hardware block becomes a Hardware Outline Design section; every physical interface becomes a HW-SW interface spec.
- **`design-review`** and **`traceability-matrix`**: Can review through HW/SW/Test/System lenses; populates the Hardware Architecture Element column linking blocks, rails, interfaces, and component selections to source requirements.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The reference design covers all the hardware decisions" | Reference designs are evaluation platforms with different peripherals, cost targets, and thermal constraints. Copying without analysis causes late-stage shortages and SI failures. Same for deferring SI to the PCB designer — they implement constraints, not define them. |
| "Component selection is procurement's job — engineering just specifies the function" | Procurement ensures availability and cost. Engineering ensures electrical and thermal compatibility. A "functionally equivalent" alternate with 2x quiescent current or half the ESD rating passes BOM review and fails bring-up. |
| "Power sequencing is just enabling rails in order — the PMIC datasheet has a reference sequence" | The PMIC sequence satisfies the PMIC. Your SoC, DDR, and peripherals each have their own stricter requirements. A violation that "usually works" at 25°C fails at -40°C. |

## Red Flags

- Pin assignments without traceability to requirements ("the pin was free" is not a reason)
- Voltage rails specified without tolerance — every rail needs one
- Power tree that shows only voltages, not currents — a rail without current will be undersized
- Zero SI-critical interfaces identified (every design above 100 MHz has at least one)
- Component selection with only one option considered (no alternate means no trade-off analysis)
- "Downsides accepted" sections empty or say "none"
- Interfaces to external connectors with no ESD/TVS protection specified
- Power budgets that sum to "typical" values — design to maximum, not typical

## Verification

Before handing off to spec-authoring, confirm:
- [ ] Every pin assignment traces to a requirement ID or system architecture interface ID
- [ ] Every voltage rail has a specified tolerance and current budget
- [ ] Every dependency between hardware blocks is captured as a physical interface definition (Step 2)
- [ ] Every physical interface passes the completeness checklist (voltage levels, impedance, termination, length matching, power-state behavior)
- [ ] All SI-critical interfaces are identified with target eye diagrams or mask specifications
- [ ] PCB layer count and stack-up recommendation are documented
- [ ] Power tree is complete: input → all regulation stages → every output rail, with sequencing groups
- [ ] Every active component has at least one documented alternate (or justified sole-source)
- [ ] All cross-cutting constraints (power, thermal, mechanical, EMC, cost) are assigned to affected blocks
- [ ] Every constraint conflict has a documented resolution
- [ ] Every non-trivial hardware decision has documented alternatives, rationale, and accepted downsides
- [ ] ESD/TVS protection specified for every external-facing connector
- [ ] Risk register covers key uncertainties (SI, components, thermal, mechanical)
- [ ] Open items have owners and due dates; human confirmed the document; saved under `docs/architecture/`

## After This Skill

Once hardware architecture is confirmed and saved to `docs/architecture/`:

| Next Step | Skill | What It Produces |
|-----------|-------|-----------------|
| **Natural next** | `hardware-detailed-design` | Schematic guidance, BOM constraints, PCB layout rules, PDN design |
| System integration | `spec-authoring` | Generate HW-SW Interface Specification for cross-department handoff |
| Quality check | `traceability-matrix` | Verify requirements → HW architecture traceability |

**Pipeline mode**: After this skill completes, the conductor will detect `docs/architecture/` and offer Document-phase options automatically.

## See Also

- For hardware high-level design review criteria, see `references/solution-hardware-high-level-design-checklist.md`
