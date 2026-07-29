---
name: hardware-detailed-design
description: 硬件详细设计：原理图指导、BOM约束、PCB布局规则、信号完整性要求、电源完整性设计。Hardware detailed design — schematic guidance, BOM constraints, PCB layout rules, signal integrity requirements, and power delivery network (PDN) design. Use when the user says 硬件详细设计, 原理图设计, PCB布局, BOM, hardware detailed design, schematic design, PCB layout, or when hardware architecture is confirmed and schematic capture can begin. NOT for software detailed design (use software-detailed-design) or algorithm design (use algorithm-design).
---

# Hardware Detailed Design

## Overview

Hardware architecture says which pin connects to what. Hardware detailed design says exactly how — the trace width, the decoupling capacitor value, the ground plane stitching pattern, the maximum via count per net. This is the contract between the SE/architect and the PCB designer: constraints that are specified prevent re-spins; constraints that are assumed cause them.

This skill transforms the hardware architecture document into a detailed hardware design that an EE can take directly into schematic capture and PCB layout. Every constraint is quantified. Every tolerance is specified. If the chip datasheet does not provide a parameter, this skill flags it rather than inferring it.

## When to Use

- Hardware architecture is confirmed and schematic capture is about to begin
- Preparing PCB layout constraints for a new board design
- The EE team needs formal design rules before starting layout
- A design review found that hardware constraints were underspecified
- Adding a new subsystem (power domain, high-speed interface) to an existing design

**When NOT to use:**

- Hardware architecture is not yet designed (run `hardware-architecture-design` first)
- The change is a single component value tweak with no architecture impact
- Pure software design (use `software-detailed-design`)
- Algorithm design (use `algorithm-design`)

## Context Boundary

**Read ONLY:**
- Hardware architecture document (pin assignments, voltage domains, component selection, constraint analysis)
- Component datasheets for parts selected in the hardware architecture
- Industry standards referenced by constraints (IPC-2221 for trace width, JEDEC for memory routing, PCIe CEM for connector specs)

**Do NOT read:** software architecture, firmware design, test plans, or requirements documents. If a design rule requires software input (e.g., "which GPIOs need debug header access?"), surface an Open Item — do not read the software architecture to answer it.

If the chip datasheet does not provide a required parameter, flag it rather than inferring it. A missing datasheet parameter is an Open Item, not a gap you fill with experience.

## The Process

```
INPUT-GATE → SCHEMATIC-GUIDE → PCB-CONSTRAINTS → PDN-DESIGN → THERMAL → DOCUMENT
     │              │                │              │           │         │
     ▼              ▼                ▼              ▼           ▼         ▼
  Verify        Specify          Define         Design       Analyze    Produce
  hardware      schematic        trace/plane     power       thermal    detailed
  arch version  requirements     rules           delivery     budget     design doc
```

### Step 1: INPUT-GATE — Verify hardware architecture version

Confirm the hardware architecture document is available, version-pinned, and confirmed. Detailed design on unconfirmed architecture is wasted work — if the architecture changes, every schematic constraint derived from it must be re-verified.

```
INPUT VERIFICATION:
Hardware Architecture: [path, version, date]
Key docs:
  - Power tree diagram [section, page]
  - Pin assignment table [section, page]
  - Component selection decisions [section, page]
  - Signal integrity targets [section, page]
  - Constraint analysis [section, page]
→ Confirm: Architecture confirmed? No pending changes that would invalidate detailed constraints?
```

**Gate:** If the hardware architecture has open items that affect component values, trace widths, or layout rules, surface them. A detailed design derived from TBDs is not a design — it is a draft.

### Step 2: SCHEMATIC-GUIDE — Specify schematic-level requirements

For every external component selected in the hardware architecture, define the schematic-level parameters the EE needs: exact value, tolerance, package, dielectric type, voltage rating, and placement constraint. Every component must trace to a requirements ID or datasheet section.

```markdown
## Schematic Component Specification

### Power Decoupling — VDD_CORE (1.1V, 2.5A)
| Ref Des | Value | Tolerance | Package | Dielectric | Voltage Rating | Placement | Traces to |
|---------|-------|-----------|---------|------------|---------------|-----------|-----------|
| C1-C4 | 100nF | ±10% | 0201 | X7R | 6.3V | Within 2mm of SoC pin (inner pair) | SoC Datasheet §4.2 Decoupling Guidelines |
| C5-C6 | 10μF | ±20% | 0603 | X7R | 6.3V | Within 5mm of SoC pin group | SoC Datasheet §4.2 |
| C7 | 47μF | ±20% | 0805 | X7R | 6.3V | Within 10mm of PMIC output | PDN analysis (§4 below) |

### DDR4 Termination — VTT (0.6V, 0.5A)
| Ref Des | Value | Tolerance | Package | Dielectric | Voltage Rating | Placement | Traces to |
|---------|-------|-----------|---------|------------|---------------|-----------|-----------|
| R1-R4 | 40.2Ω | ±1% | 0402 | — (resistor) | — | At DRAM end of A/C bus, ≤ 300mil from last DRAM | JESD79-4B §4.2.5, HW-REQ-007 |

### Crystal Oscillator — CLK_24MHz
| Ref Des | Value | Tolerance | Package | Load Cap | ESR Max | Drive Level | Traces to |
|---------|-------|-----------|---------|----------|---------|-------------|-----------|
| Y1 | 24MHz | ±10ppm | 3225 | 12pF | 50Ω | 100μW max | SoC Datasheet §3.1 OSC Characteristics |
| C8-C9 | 22pF | ±5% | 0402 | C0G | — | — | Calculated: C_L = 12pF, C_stray ≈ 3pF → (12-3)×2 = 18pF, select 22pF standard |
```

**Rules:**
- Every capacitor dielectric must be specified. X7R for decoupling, C0G/NP0 for oscillators and timing circuits, X5R only if cost-constrained and temperature range permits.
- Every resistor tolerance must be justified. 1% for termination (signal integrity), 5% for pull-ups (non-critical).
- Placement constraints are part of the schematic guide — they communicate to the PCB designer which components are placement-critical before layout starts.

### Step 3: PCB-CONSTRAINTS — Define layout rules

Define trace width, spacing, impedance control, via limits, and reference plane requirements for every net class. Every high-speed interface identified in the hardware architecture must have quantified layout rules.

```markdown
## PCB Layout Rules by Net Class

### High-Speed Differential Pairs (DDR CLK/DQS, PCIe TX/RX, USB 3.x SS)
| Parameter | DDR4 CLK/DQS | PCIe Gen3 | USB 3.1 Gen1 SS |
|-----------|-------------|-----------|-----------------|
| Z_diff | 80Ω ±10% | 85Ω ±15% | 90Ω ±15% |
| Z_se | 40Ω ±10% | 42.5Ω ±15% | 45Ω ±15% |
| Max intra-pair skew | ≤ 5 mils | ≤ 5 mils | ≤ 5 mils |
| Max inter-pair skew | ≤ 40 mils (CLK to DQS) | ≤ 100 mils (TX to RX) | ≤ 100 mils |
| Max trace length | ≤ 2.5 inch (CLK), ≤ 1.8 inch (DQ) | ≤ 10 inch | ≤ 8 inch |
| Min trace spacing (pair-to-pair) | ≥ 3× trace width | ≥ 4× trace width | ≥ 4× trace width |
| Reference plane | Solid GND, no splits under pairs | Solid GND, no splits | Solid GND, no splits |
| Max vias per net | ≤ 2 | ≤ 2 | ≤ 2 |
| Via stub max | ≤ 10 mils (back-drill if longer) | ≤ 10 mils | ≤ 10 mils |
| AC coupling cap placement | — | Near TX, ≤ 200 mils from pin | Near TX, ≤ 200 mils from pin |

### Single-Ended (GPIO, I2C, UART, SPI ≤ 10MHz)
| Parameter | Value |
|-----------|-------|
| Z₀ | 50Ω ±15% (if length > λ/10) |
| Max trace length | ≤ 6 inch (I2C ≤ 100pF total bus capacitance) |
| Min trace spacing | ≥ 2× trace width |
```

**Via count rules:** Every via adds ~0.5nH inductance and creates an impedance discontinuity. For DDR data lines, target ≤ 1 via; 2 vias is the hard maximum. If the layout requires 3+ vias on a DDR DQ net, surface as a risk requiring SI re-simulation.

### Step 4: PDN-DESIGN — Power Delivery Network

Calculate target impedance for every rail. Show the math — not just the conclusion.

```markdown
## PDN Design

### VDD_CORE (1.1V, 2.5A, ±5% tolerance)

**Target impedance:**
Z_target = (V_supply × %ripple) / (I_max_transient)
        = (1.1V × 0.05) / (1.25A)    [50% of max current as worst-case transient step]
        = 0.055V / 1.25A
        = 44 mΩ

**Frequency range:** DC to f_knee = 0.35 / t_rise
- t_rise (estimated from SoC core switching): ~200ps
- f_knee = 0.35 / 200e-12 = 1.75 GHz

**Decoupling scheme:**
| Frequency Range | Component | Part Number | Z @ f | Placement |
|----------------|-----------|-------------|-------|-----------|
| DC – 1 kHz | PMIC feedback loop | [PMIC part] | < 10mΩ | PMIC output |
| 1 kHz – 1 MHz | 47μF X7R 0805 (C7) | [mfr part] | < 100mΩ @ 100 kHz | Within 10mm of PMIC |
| 1 MHz – 100 MHz | 10μF X7R 0603 (C5-C6) | [mfr part] | < 200mΩ @ 10 MHz | Within 5mm of SoC |
| 100 MHz – 1 GHz | 100nF X7R 0201 (C1-C4) | [mfr part] | < 500mΩ @ 100 MHz | Within 2mm of SoC pin |
| 1 GHz – 1.75 GHz | PCB plane capacitance | — | ~50-200mΩ (calculated from stack-up) | Power-ground plane pair |

**Plane capacitance check:**
C_plane = ε₀ × ε_r × A / d
        = 8.854e-12 × 4.3 (FR4) × (100mm × 100mm) / (0.2mm prepreg)
        = 1.9 nF

At 1 GHz: Z_plane = 1 / (2π × 1e9 × 1.9e-9) ≈ 84 mΩ  → approaching target; verify post-layout
```

**Verification:** For every rail, Z_target must be achieved from DC to f_knee. If any frequency band shows Z > Z_target, flag as PDN RISK with the specific band and proposed mitigation (additional capacitance, thinner dielectric, different material).

### Step 5: THERMAL — Analyze thermal budget

Calculate junction temperature for every component dissipating > 100mW. Show the math.

```markdown
## Thermal Analysis

| Component | P_max (W) | θ_JA (°C/W) | Package | T_j at T_amb=85°C | T_j_max (°C) | Margin (°C) | Status |
|-----------|-----------|-------------|---------|--------------------|--------------|-------------|--------|
| SoC | 8.0 | 18 (JESD 4-layer) | BGA-484 | 85 + 8.0×18 = 229°C | 105 | -124°C | ❌ FAIL — requires heatsink |
| SoC (with heatsink) | 8.0 | 8 (estimated, 20×20×10mm Al) | BGA-484 | 85 + 8.0×8 = 149°C | 105 | -44°C | ❌ FAIL — still over |
| DDR4 DRAM ×2 | 2.0 each | 35 (FBGA-96) | FBGA-96 | 85 + 2.0×35 = 155°C | 95 | -60°C | ❌ FAIL — requires airflow |
| DDR4 DRAM (1 m/s airflow) | 2.0 | 22 (with airflow) | FBGA-96 | 85 + 2.0×22 = 129°C | 95 | -34°C | ❌ FAIL |
| PMIC | 1.5 | 25 (QFN-48) | QFN-48 | 85 + 1.5×25 = 122.5°C | 125 | 2.5°C | ⚠️ WARNING — marginal |

**Thermal violations surfaced:**
1. SoC T_j = 229°C >> T_j_max = 105°C. Heatsink alone insufficient — requires forced airflow or thermal plane to bottom-side copper pour.
2. DDR4 DRAMs require airflow ≥ 2 m/s to stay within T_j_max at 85°C ambient.
3. PMIC margin ≤ 3°C — insufficient for manufacturing variation. Consider PMIC with θ_JA ≤ 20°C/W or copper pour under exposed pad ≥ 25×25mm.
```

**Rules:**
- θ_JA values must cite the datasheet or JEDEC standard test board — not "typical value from similar package."
- If T_j exceeds T_j_max, surface as THERMAL VIOLATION with options: heatsink, airflow, alternative component, or reduced T_ambient_max.
- Even if T_j passes at 25°C, calculate at T_ambient_max. Thermal problems that only appear at 85°C are discovered in qualification, not bring-up.

### Step 6: DOCUMENT — Produce the hardware detailed design document

Assemble all outputs into a structured document. Present to user for confirmation before schematic capture begins.

## Output

A hardware detailed design document saved to `docs/spec/[project]-hardware-detailed-design.md`:

```markdown
# Hardware Detailed Design: [Project/Board Name]

## Document Control
| Field | Value |
|-------|-------|
| Version | [semver] |
| Date | [YYYY-MM-DD] |
| Author | [SE/EE name] |
| Hardware Architecture Reference | [path, version, date] |
| PCB Layer Count | [N] layers |
| PCB Material | [FR4 / Megtron 6 / Rogers 4350B / ...] |

## 1. Schematic Component Specification
[Tables from Step 2 — organized by: power decoupling, high-speed interfaces, clocking, I/O protection, miscellaneous]

## 2. PCB Layout Rules
[Tables from Step 3 — organized by net class: high-speed differential, single-ended critical, single-ended non-critical, power]

### Stack-up Recommendation
| Layer | Type | Material | Thickness | Copper Weight | Primary Use |
|-------|------|----------|-----------|---------------|-------------|
| L1 (Top) | Signal | — | 1.9 mil prepreg | 1 oz + plating | High-speed, critical routing |
| L2 | GND Plane | FR4 core | 4 mil | 1 oz | Reference for L1/L3 |
| L3 | Signal/PWR | — | 4 mil prepreg | 1 oz | Low-speed signals, power islands |
| L4 | PWR Plane | FR4 core | 4 mil | 1 oz | Split power plane |
| L5 | GND Plane | — | 4 mil prepreg | 1 oz | Reference for L4/L6 |
| L6 (Bottom) | Signal | — | 1.9 mil | 1 oz + plating | Low-speed, debug headers |

## 3. Power Delivery Network Analysis
[Per-rail PDN tables from Step 4 — Z_target calculation, decoupling scheme, plane capacitance check]

### PDN Risk Summary
| Rail | Z_target (mΩ) | Max Z_actual (mΩ) | Frequency Band | Status |
|------|---------------|-------------------|----------------|--------|
| VDD_CORE | 44 | 84 (plane at 1 GHz) | 1.0–1.75 GHz | ⚠️ RISK — verify post-layout |
| ... | ... | ... | ... | ... |

## 4. Thermal Analysis
[Tables from Step 5 — per-component T_j at T_ambient_max with margin]

### Thermal Violations and Mitigations
| Component | T_j Calculated | T_j_max | Mitigation | New T_j | Status After Mitigation |
|-----------|---------------|---------|------------|---------|------------------------|
| SoC | 229°C | 105°C | Heatsink + 2 m/s airflow | 101°C | ✅ PASS (4°C margin) |
| DDR4 DRAM | 129°C | 95°C | 2 m/s airflow, θ_JA → 18°C/W | 91°C | ✅ PASS (4°C margin) |

## 5. Signal Integrity Requirements
| Interface | Data Rate | Pre-Layout Sim | Post-Layout Sim | Eye Mask | Status |
|-----------|-----------|---------------|-----------------|----------|--------|
| DDR4 CH-A | 3200 MT/s | Required (IBIS, all PVT) | Required (S-param extraction) | EH ≥ 85mV, EW ≥ 0.35 UI @ 1e-16 | Pending |
| PCIe Gen3 x4 | 8 GT/s | Required (IBIS-AMI) | Required | EH ≥ 25mV, EW ≥ 0.30 UI @ 1e-12 | Pending |
| USB 3.1 Gen1 | 5 GT/s | Required | Required | Per USB-IF compliance spec | Pending |

## 6. Risk Register
| Risk ID | Risk | Likelihood | Impact | Mitigation | Owner | Trigger |
|---------|------|-----------|--------|------------|-------|---------|
| HDRISK-001 | PDN Z > Z_target at 1-2 GHz | Medium | High | Post-layout PDN sim; add plane capacitance or embedded capacitance material if violated | EE Lead | Z > 44mΩ at f > 1 GHz |
| HDRISK-002 | DDR4 SI fails slow-slow corner at 85°C | Medium | High | Pre-layout sweep all PVT corners; 2666 MT/s fallback | SI Engineer | Eye margin < 10% at SS/85°C |
| HDRISK-003 | Thermal margin < 5°C after mitigation | Low | Critical | Thermal simulation with enclosure; measure on EVT board | ME Team | T_j > T_j_max - 5°C in sim |

## 7. Open Items
| ID | Question | Blocker For | Owner | Due |
|----|----------|-------------|-------|-----|
| HDOI-001 | PCB dielectric constant and loss tangent at 8 GHz for PCIe Gen3? | Impedance calculation | PCB Vendor | Before layout start |
| HDOI-002 | Heatsink keep-out zone and mounting hole positions confirmed? | PCB placement | ME Team | Sprint 2 |
| HDOI-003 | PMIC θ_JA on 6-layer board vs. datasheet 4-layer value? | Thermal analysis | PMIC Vendor | Sprint 1 |
```

## Interaction with Other Skills

- **`hardware-architecture-design`**: Pre-requisite. Provides pin assignments, voltage domains, and component selection.
- **`architecture-design`**: Provides system-level constraints that drive layout rules.
- **`design-review`**: Can review the detailed design through HW lens before manufacturing.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The PCB designer will fill in the layout rules" | The PCB designer fills in manufacturing rules (minimum trace/space, annular ring, solder mask). The SE fills in design rules (impedance, length matching, via count). If you do not specify impedance control, the PCB designer assumes 50Ω default — which may be wrong for your DDR4 40Ω requirement. |
| "Decoupling is standard — 100nF per pin, done" | Decoupling depends on the frequency spectrum of the current draw, the ESR of the capacitors, and the plane inductance. A 100nF cap with 100nH mounting inductance resonates at ~50MHz. If your core switches at 1GHz, you need plane capacitance because no discrete cap reaches that high. "Standard" decoupling fails for any modern SoC. |
| "Thermal analysis is premature — we will test it on the prototype" | A prototype that overheats and destroys the MCU costs a board re-spin and 2-4 weeks. A thermal calculation costs 15 minutes. θ_JA is in the datasheet; P_max is in the power tree. The math is multiplication. There is no excuse for skipping it. |
| "The reference design schematic covers all the component choices" | Reference designs use the vendor's preferred parts — which may be on 26-week lead time, NRND, or rated for 0-70°C when you need -40 to +85°C. Copying without verifying every component against your requirements is how prototypes work and products fail. |
| "Impedance control is the fab's problem — we just note it on the fab drawing" | The fab controls impedance within their process tolerance (±10%). But you must specify: which nets need it, what the target is, and which layer pairs are controlled. If you do not mark the nets, the fab treats them as standard — and your DDR4 CLK pair gets 50Ω instead of 80Ω differential. |
| "Via count doesn't matter — modern PCBs handle it" | Every via on a 3200 MT/s DDR data line adds a stub that reflects energy. At these speeds, a single unnecessary via can close the eye by 20%. The via budget is an SI budget, not a manufacturing convenience. |

## Red Flags

- Decoupling capacitors specified without dielectric type (X7R vs. X5R vs. C0G have different temperature and DC bias behavior)
- High-speed interfaces without impedance targets, length constraints, or via limits
- PDN without target impedance calculation — "we used the reference design decoupling" is not PDN design
- Thermal analysis that skips the math or shows T_j > T_j_max without proposed mitigation
- Component values copied from reference design without verification against your voltage rails, temperature range, and cost targets
- "Standard stack-up" without verifying that target impedances are achievable on the chosen material and thickness
- No SI simulation planned for interfaces above 1 GT/s (pre-layout IBIS at minimum)
- Placement constraints that say "close to pin" without a distance in mm
- θ_JA values cited without noting test board conditions (JEDEC 1s0p vs. your 6-layer board)
- Every component with a single source and no alternate — that is a procurement risk, not a design

## Verification

Before handing off to schematic capture, confirm:

- [ ] Hardware architecture version verified (Step 1 input gate); all architecture open items that affect component values resolved
- [ ] Every power rail has decoupling scheme specified with capacitor values, tolerances, dielectrics, voltage ratings, and placement distances
- [ ] Every capacitor dielectric is correct for its role: X7R for decoupling, C0G/NP0 for oscillators/timing, X5R only with documented temperature justification
- [ ] Every resistor tolerance is justified: 1% for termination, 5% acceptable only for pull-ups/non-critical
- [ ] Every high-speed interface (≥ 10MHz) has: impedance target, max length, intra-pair skew, inter-pair skew, via limit, and reference plane
- [ ] PDN target impedance calculated for every rail (show the math); decoupling scheme verified against Z_target from DC to f_knee
- [ ] Plane capacitance checked for frequencies above the last discrete capacitor's effective range
- [ ] Thermal T_j calculated for every component > 100mW at T_ambient_max; θ_JA values cited from datasheets
- [ ] Every T_j violation surfaced with specific mitigation (heatsink, airflow, alternative component, reduced spec)
- [ ] Stack-up recommendation documented with layer count, material, thicknesses, and primary use for each layer
- [ ] SI simulation requirements documented for every interface above 1 GT/s
- [ ] All datasheet-cited values have section references
- [ ] Every sole-source component flagged with risk level and procurement lead time
- [ ] The human has explicitly confirmed the detailed design document
- [ ] The document is saved to a version-controlled location under `docs/spec/`

## After This Skill

Once hardware detailed design is saved to `docs/spec/`:

| Next Step | Skill | What It Produces |
|-----------|-------|-----------------|
| **Natural next** | `design-review` | Four-lens adversarial review of the hardware detailed design |
| Quality check | `traceability-matrix` | Verify HW architecture → detailed design traceability |

**Pipeline mode**: After this skill completes, the conductor will detect `docs/spec/` and offer Verify-phase options automatically.

## See Also

- For hardware detailed design review criteria, see `references/solution-hardware-detailed-design-checklist.md`
