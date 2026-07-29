---
name: algorithm-design
description: 算法设计：信号处理链路、控制环路、校准例程、滤波器设计、数据变换。每个参数量化并追溯到需求。Algorithm design — signal processing chains, control loops, calibration routines, filter design, and data transforms. Every parameter is quantified and traced to a requirement. Use when the user says 算法设计, 信号处理, 控制算法, 滤波器, 校准, algorithm design, signal processing, control loop, filter design, or when system requirements specify algorithmic behavior.
---

# Algorithm Design

## Overview

System requirements and architecture often identify modules whose behavior is inherently algorithmic: a PID temperature controller, a low-pass filter chain for sensor data, a touch calibration routine, an FFT-based fault detector. These modules cannot be specified by interface alone — you need to define the math, the parameters, the precision, the convergence guarantees.

This skill takes algorithm-relevant requirements and the system architecture as input and produces a quantified algorithm design document. It answers the "how does this module compute?" question that `architecture-design` leaves for the spec author. Every parameter is traced to a requirement. Every precision, latency, and memory claim is backed by a number with units. Every hardware-dependent assumption is explicit — and if the hardware spec does not yet provide the needed characteristic, the design flags it rather than guessing.

## When to Use

- System requirements contain quantitative algorithmic needs (e.g., "filter settling time ≤ 10ms", "PID overshoot ≤ 5%", "calibration accuracy ±1 LSB")
- The architecture document identifies modules whose core responsibility is computation, not just data plumbing (signal processing blocks, control loops, estimation/calibration, transforms)
- A downstream skill (`spec-authoring`) detects that a module in the architecture decomposition has algorithm behavior described only by the module name ("Touch Calibration Module") with no math, no parameters, no convergence criteria
- Adding a new algorithm to an existing system (new sensor processing pipeline, new control strategy)
- An algorithm behavior depends on hardware characteristics that must be verified before implementation (ADC noise floor, DAC settling time, sensor response curve)

**When NOT to use:** The module is purely data plumbing (reads a register, writes a buffer, translates a protocol) — use `architecture-design` interface definitions. The algorithm is a standard library call with no design decisions (e.g., `memcpy`, `crc32`, `arm_biquad_cascade_df1_f32`). Algorithm requirements do not yet exist — run `requirements-decompose` first. The module's algorithm is already fully specified with quantified parameters traced to requirements.

## The Process

```
INPUT GATE ──→ MODEL ──→ PARAMETERIZE ──→ BOUND ──→ VALIDATE ──→ DOCUMENT
  Verify       Define      Derive &       Quantify    Cross-check   Produce
  scope in     math model  trace params   precision,   against arch  design doc
  reqs                     to reqs        latency,mem  & HW specs
```

### Step 1: INPUT GATE — Verify algorithm scope in requirements

Before writing a single equation, verify that the input is algorithm-relevant. Read ONLY the requirements tagged as algorithmic and the architecture modules that contain them. Do not read unrelated specifications.

**Input gate checklist:**

```
ALGORITHM SCOPE VERIFICATION:
1. List every requirement that contains an algorithmic claim:
   - Quantified performance (settling time, overshoot, accuracy, SNR, latency)
   - Functional computation (filter, control, estimate, calibrate, transform, detect)
   - Signal processing chain (sample rate, decimation, windowing, FFT size)

2. List every architecture module that maps to those requirements.

3. For each module, answer:
   - What does it compute?    → [one sentence]
   - What drives the computation? → [requirement ID(s)]
   - What are its input(s) and output(s)? → [signal names, rates, formats]

4. EXIT if: No requirements or modules meet the algorithmic threshold.
   Proceed if: At least one module has non-trivial computation to design.
```

**Anti-hallucination rule:** If an algorithm behavior depends on a hardware characteristic not yet specified (e.g., ADC noise floor unknown, sensor response curve unavailable, DAC glitch energy not characterized), flag it in the algorithm design as an `ASSUMPTION` with a placeholder value and a resolution trigger. Do NOT assume a value from memory or a different chip.

### Step 2: MODEL — Define the mathematical model

For each algorithm module, write the mathematical model. This is not pseudocode — it is the equations in their canonical form, with every symbol defined.

**Model definition template:**

```markdown
### Algorithm: [Name] — [Module ID]

**Mathematical formulation:**

[Equation(s) — e.g., difference equation, transfer function, state-space model, optimization objective]

**Where:**

| Symbol | Name | Units | Range | Defined By |
|--------|------|-------|-------|------------|
| T_s    | Sample period | s | 100μs – 1ms | REQ-SYS-012 (ADC sample rate) |
| K_p    | Proportional gain | dimensionless | 0.01 – 100 | To be derived (Step 3) |
| f_c    | Cutoff frequency | Hz | 10 – 500 | REQ-FUNC-008 (motion artifact rejection) |
| N      | FFT size | samples | power of 2 | Derived from Δf = f_s / N, REQ-PERF-003 (frequency resolution ≤ 1Hz) |

**Algorithm domain:** [Continuous-time / Discrete-time (Z-domain) / State-space / Frequency-domain / Optimization]
```

**Modeling rules:**
- Every symbol must appear in the parameter table with its definition, units, valid range, and the requirement ID that constrains it
- If the model has multiple valid forms (e.g., Direct Form I vs. Direct Form II for an IIR filter), choose one and note the trade-off in a decision record
- If the model involves iteration or convergence, state the convergence criterion and the maximum iteration count

### Step 3: PARAMETERIZE — Derive and trace every parameter to a requirement

Every tunable constant in the algorithm must have a source. "Chosen by designer" is not a source — it is a gap.

**Parameter traceability table:**

```markdown
| Parameter | Value | Source Requirement | Derivation |
|-----------|-------|-------------------|-------------|
| α (filter coefficient) | 0.0392 | REQ-PERF-005 (settling ≤ 10ms at f_s = 1kHz) | α = 1 − e^(−T_s/τ), τ = settling_time/5 = 2ms, T_s = 1ms → α = 1 − e^(−0.5) ≈ 0.393… |
| K_p, K_i, K_d | 2.5, 0.8, 0.1 | REQ-CTRL-002 (overshoot ≤ 5%, settling ≤ 50ms) | Ziegler-Nichols tuned for plant model G(s) = ... |
| FFT size N | 1024 | REQ-PERF-003 (Δf ≤ 1Hz at f_s = 1kHz) | Δf = f_s/N → N = f_s/Δf = 1000/1 = 1000 → next power of 2 = 1024 |
| Calibration points | 5-point (0%, 25%, 50%, 75%, 100%) | REQ-CAL-001 (linearity error ≤ 0.5% after cal) | Piecewise linear with 5 segments → max interpolation error ≤ 0.5% for sensor curve with max 2nd derivative = ... |
```

**For parameters WITHOUT a requirement source:**
```
ORPHAN PARAMETER: [name] = [value]
→ No requirement specifies this value. Derived from: [justification].
→ If the source constraint is not in the requirements, add it or flag as an assumption.
```

### Step 4: BOUND — Quantify precision, latency, and memory

Every algorithm must be bounded in three dimensions: how accurate (precision), how fast (latency), and how big (memory).

```markdown
### Resource Budget: [Algorithm Name]

| Dimension | Requirement | Design Target | Margin | Verification Method |
|-----------|------------|---------------|--------|---------------------|
| **Precision** | ≤ 0.1°C error (REQ-PERF-007) | ±0.05°C (Q16.16 fixed-point) | 2x | Compare against double-precision reference over 10K Monte Carlo inputs |
| **Latency** | ≤ 500μs per sample (REQ-PERF-008) | ≤ 380μs (measured on target) | 24% | Cycle-counted inner loop × 1.2 margin for cache misses |
| **Memory (RAM)** | ≤ 4KB per channel (REQ-MEM-003) | 2.8KB (state + working buffers) | 30% | Static analysis of struct sizes |
| **Memory (Flash)** | ≤ 16KB total (REQ-MEM-004) | 12.4KB (.text + .rodata + LUTs) | 22% | Compiler output size check |
| **Throughput** | ≥ 1000 samples/s (REQ-PERF-009) | 1500 samples/s | 50% | Process 10K dummy samples, measure wall time |

**Fixed-point analysis** (if applicable):
| Variable | Q Format | Range | Resolution | Overflow Risk |
|----------|----------|-------|------------|---------------|
| filter_state[0] | Q15.16 | [−32768, 32767] | 1/65536 ≈ 0.000015 | Saturating add used — overflow handled |
| accumulator | Q31.32 | [−2^31, 2^31−1] | 1/2^32 ≈ 2.3e-10 | Checked: max value = 1.2e9 < 2^31 |
```

**Precision rules:**
- If the algorithm uses floating-point, confirm the target platform has an FPU. If not, fixed-point is mandatory — design the Q-format explicitly.
- Every Q-format must state its range and confirm no overflow for worst-case inputs.
- Precision claims must be verifiable: "compare against double-precision reference" or "compare against MATLAB/Simulink golden model."

### Step 5: VALIDATE — Cross-check against architecture and hardware specs

Before finalizing, verify that the algorithm design is consistent with the system architecture and that every hardware-dependent claim is either confirmed or flagged.

```markdown
### Validation Cross-Check

| Check | Status |
|-------|--------|
| Algorithm inputs/outputs match interface definitions in architecture | ✅ IF-ADC-DSP-001 confirms sample format = int16, rate = 1kHz |
| Algorithm memory budget fits within architecture allocation for this module | ✅ 2.8KB < 4KB allocated in architecture §4.3 |
| Algorithm latency fits within the end-to-end timing budget for the signal chain | ✅ 380μs < 500μs budget from ADC sample to control output |
| Hardware characteristics used in derivation are confirmed in the datasheet | ⚠️ ADC noise floor assumed 2 LSB RMS — datasheet §7.3 says 1.5 LSB typical, 4 LSB max. Re-run worst-case analysis with 4 LSB. |
| Fixed-point ranges valid for worst-case inputs | ✅ Monte Carlo 10K inputs, no overflow |
| Convergence is guaranteed for the full input range | ✅ Lyapunov analysis shows global asymptotic stability for K_p ≤ 5.0 |
```

**Flag format for unconfirmed assumptions:**
```
ASSUMPTION: [what is assumed] = [value]
→ Source of uncertainty: [hardware characteristic not yet specified]
→ Impact if wrong: [what breaks — precision degrades? algorithm diverges?]
→ Resolution trigger: [when/how this will be confirmed — "when ADC characterization report available Sprint 3"]
→ Placeholder behavior: [what the design does in the meantime — "use nominal value of 2 LSB; add 3x margin to latency budget"]
```

Do NOT assume ADC ENOB from a different chip family, sensor linearity without datasheet confirmation, DSP cycle counts from a different compiler, or that RTOS context switch time is negligible without measuring.

### Step 6: DOCUMENT — Produce the algorithm design document

Assemble all outputs into the algorithm design document. Present to the user for review. Do not proceed to `spec-authoring` until confirmed.

## Output

An algorithm design document saved to `docs/spec/[project]-algorithm-design.md` after user confirmation:

```markdown
# Algorithm Design: [Project/Chip Name]

## Document Control
- Version, Date, Author
- References: [System Requirements doc path + version, Architecture doc path + version]

## 1. Algorithm Inventory
| Algorithm ID | Name | Module (from Architecture) | Type | Requirement(s) |
|-------------|------|---------------------------|------|---------------|
| ALG-01 | Sensor Low-Pass Filter | MOD-03 Sensor Processing | IIR Filter | REQ-PERF-005, REQ-PERF-007 |
| ALG-02 | PID Temperature Controller | MOD-04 Thermal Engine | Control Loop | REQ-CTRL-001, REQ-CTRL-002 |
| ALG-03 | 5-Point Touch Calibration | MOD-07 Touch Controller | Calibration | REQ-CAL-001, REQ-CAL-003 |

## 2. Per-Algorithm Design
[For each algorithm: Model (Step 2), Parameters (Step 3), Resource Budget (Step 4)]

## 3. Resource Summary
| Algorithm | RAM | Flash | Latency | CPU Load (at f_cpu) |
|-----------|-----|-------|---------|---------------------|
| ALG-01 | 2.8KB | 3.2KB | 380μs | 3.8% at 1000 samples/s |
| ALG-02 | 1.2KB | 2.1KB | 120μs | 1.2% at 100Hz loop |
| **Total** | **4.0KB** | **5.3KB** | — | **5.0%** |

## 4. Assumptions and Unresolved Dependencies
[Every ASSUMPTION from Step 5 with placeholder value, impact, and resolution trigger]

## 5. Decision Records
[Any non-trivial choices — fixed-point vs. float, filter structure, solver selection — with rationale]
```

## Interaction with Other Skills

- **`requirements-decompose`** and **`architecture-design`**: Pre-requisites. Algorithm parameters must trace to requirement IDs; algorithm modules and their interfaces are defined by the architecture decomposition. If either upstream artifact lacks quantified algorithmic claims or module interface definitions, invoke the upstream skill to resolve them before proceeding.
- **`spec-authoring`**: Downstream consumer. The algorithm design document feeds directly into the module's detailed behavior specification. Every algorithm parameter becomes a specification requirement for the implementing SW module.
- **`design-review`**: Can review the algorithm design document through mathematical, implementation, and test lenses before handoff.
- **`traceability-matrix`**: Populates the algorithm element column, linking each algorithm parameter to its source requirement.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The algorithm is standard — just use the textbook version" | Textbook algorithms assume infinite precision, no timing constraints, and ideal inputs. Real hardware has ADC noise, fixed-point rounding, and RTOS jitter. The design documents how the standard algorithm is adapted to reality. |
| "We'll tune the parameters during implementation" | Tuning without a model is guessing. Guessing produces parameters that work for one test case and fail in production. Derive parameters from requirements; use testing to validate the derivation, not to discover the values. |
| "Fixed-point analysis is premature — we have an FPU" | FPUs have finite precision too. A 32-bit float has 23 mantissa bits — enough for most control loops, not enough for high-Q IIR filters. Algorithm design quantifies precision requirements regardless of the number format. |
| "The hardware team hasn't characterized the ADC yet, so just assume 12 ENOB" | Assuming a number that sounds reasonable is how algorithms pass simulation and fail on silicon. Flag the gap, use a placeholder with margin, and define exactly what must be confirmed before tape-out. |
| "I checked the algorithm in my head — it converges" | Non-linear systems can have hidden divergence modes (limit cycles, chaotic regions, numerical instability). Formal analysis or exhaustive simulation is required. A claim of convergence without analysis is a hope, not a design. |

## Red Flags

- Algorithm parameters with no traced requirement ID (every constant must have a "why this value" answer)
- Precision, latency, or memory claims without numbers and units ("fast enough" is not quantified)
- Fixed-point design without Q-format range and overflow analysis
- Hardware characteristics assumed from memory or a different chip family without confirmation
- Convergence claimed without analysis or exhaustive simulation evidence
- Algorithm described only in prose with no equations (prose cannot be implemented unambiguously)
- Resource budget that sums to >100% of the architecture allocation without a conflict being surfaced
- Algorithm design that reads requirements or architecture modules unrelated to the algorithm in question (context pollution)

## Verification

Before handing off to spec-authoring, confirm:

- [ ] Every requirement tagged as algorithmic is addressed by at least one algorithm design
- [ ] Every algorithm in the inventory has a mathematical model with all symbols defined (Step 2)
- [ ] Every algorithm parameter has a source requirement ID or is explicitly flagged as an orphan with justification (Step 3)
- [ ] Every algorithm has quantified precision, latency, and memory bounds with verification methods (Step 4)
- [ ] Fixed-point algorithms (if any) have Q-format definitions with range and overflow analysis
- [ ] Every hardware-dependent assumption is flagged with placeholder value, impact, and resolution trigger (Step 5)
- [ ] Algorithm resource totals fit within architecture allocations; conflicts are surfaced
- [ ] No unrelated requirements or architecture modules were read or referenced
- [ ] The human has explicitly confirmed the algorithm design document
- [ ] The document is saved to `docs/spec/[project]-algorithm-design.md`

## After This Skill

Once the algorithm design is documented and saved to `docs/spec/`:

| Next Step | Skill | What It Produces |
|-----------|-------|-----------------|
| **Natural next** | `design-review` | Four-lens adversarial review of the algorithm design |
| Implementation | `software-detailed-design` | If the algorithm needs firmware-level implementation |
| Quality check | `traceability-matrix` | Verify algorithm requirements → design traceability |

**Pipeline mode**: After this skill completes, the conductor will detect `docs/spec/` and offer Verify-phase options automatically.

## See Also

- For algorithm detailed design review criteria, see `references/solution-algorithm-detailed-design-checklist.md`
