---
name: design-review
description: 四视角对抗式设计审查：以HW/SW/Test/System四个部门视角对SE产物进行独立审查，发现跨领域不一致、未声明假设和遗漏。Four-lens adversarial design review — runs fresh-context reviewers through HW, SW, Test, and System department lenses to catch gaps, inconsistencies, and unstated assumptions in any SE artifact (requirements, architecture, or specification). Use when the user says 设计审查, 四视角审查, 对抗式审查, design review, adversarial review, or wants a comprehensive multi-angle review before cross-department distribution. NOT a single-document checklist review (use requirements-review, code-static-review, test-plan-review, test-report-review, or release-review for targeted checklist-based reviews).
---

# Design Review

## Overview

An SE artifact reviewed by its author finds the problems the author already knows about. An SE artifact reviewed by a meeting finds the problems people notice while reading for approval. A design review that matters finds the problems no single reader would catch — the cross-domain inconsistencies, the unstated assumptions, the failure modes that only emerge when HW, SW, Test, and System perspectives collide.

This skill applies adversarial review methodology to SE artifacts. It materializes four fresh-context reviewers, each biased to **disprove** through their department's lens, and reconciles their findings into a single actionable report. Run it before the formal design review meeting — so the meeting is about decisions, not discovery.

## When to Use

- An SE artifact (requirements document, architecture design, specification) is complete and ready for cross-department distribution
- Before a formal design review meeting — surface issues in advance so the meeting is productive
- When integrating across department boundaries (HW↔SW, power↔thermal, boot↔security)
- After a significant design change that may have ripple effects across modules or domains
- A downstream consumer of the artifact reports that the document is ambiguous, incomplete, or inconsistent
- Preparing for a milestone review (requirements freeze, design freeze, test readiness)

**When NOT to use:**

- The artifact is an early draft the author has not self-reviewed yet (self-review first, then adversarial review)
- Typos, formatting errors, or mechanical corrections (these do not need four-lens adversarial review)
- The user explicitly wants speed over thoroughness for a low-risk, single-department artifact
- Reviewing implementation code (use a code review process, not this design artifact review)
- Pure information lookup ("does this register address match the datasheet?" — verify directly, don't review)

## The Process

```
SCOPE ──→ LENS-REVIEW ──→ RECONCILE ──→ REPORT
   │           │               │            │
   ▼           ▼               ▼            ▼
 Define    Four parallel    Classify      Produce
 artifact  adversarial      findings      review
 & depth   reviews          by severity   report
```

### Step 1: SCOPE — Define what is being reviewed

Clarify the review target and depth before spinning up reviewers:

```
REVIEW SCOPE:
Artifact: [type — Requirements / Architecture / SOD / HW-SW IF / Test Plan]
Document: [name] v[X.Y] at [file path]
Depth:    [ ] Quick scan — major issues only, ~5 min per lens
          [ ] Standard — thorough review, ~15 min per lens
          [ ] Exhaustive — every section, every claim, every reference
Focus:    [ ] Entire document
          [ ] Specific sections: [list § numbers]
          [ ] Specific concern: [e.g., "only power sequencing interfaces"]
Lenses:   [ ] All four (HW, SW, Test, System) — default
          [ ] Subset: [specify which]
→ Confirm scope before proceeding.
```

**Depth guidance:**
- **Quick scan** for early drafts, minor updates, or when the artifact author just wants a second pair of eyes before self-review
- **Standard** for artifacts going to cross-department review, or when this is the last check before sign-off
- **Exhaustive** for safety-critical artifacts, milestone deliverables, or when a previous review found systemic issues

**Artifact size guard:** If the artifact exceeds ~20 pages, ask the user to specify focus areas. An exhaustive four-lens review of a 50-page architecture doc is expensive and produces diminishing returns. A targeted review of the 5 highest-risk sections is often higher value.

### Step 2: LENS-REVIEW — Four parallel adversarial reviews

Spawn four independent reviewers, each receiving the ARTIFACT only — no author reasoning, no CLAIM, no context about why decisions were made. This is the same isolation pattern as adversarial review: hand over the artifact and the adversarial prompt, not the conclusion.

Each lens has a distinct adversarial prompt tuned to its department's concerns.

#### Hardware Lens

```
You are a hardware engineer (EE) reviewing this SE artifact.

Your job is to FIND ISSUES. Assume the author is overconfident and
that hardware-specific details may be underspecified or wrong.

Look for:
- Pin assignments, voltage domains, and timing constraints that are
  missing, ambiguous, or contradictory
- Assumptions about PCB layout, signal integrity, power delivery,
  or thermal that are implicit when they should be explicit
- HW requirements that unnecessarily constrain component selection
  (e.g., specifying a specific part number instead of a requirement)
- Power sequencing, reset, and clock specifications that are incomplete
  — can the EE team implement from this without follow-up questions?
- Interfaces described without electrical characteristics (voltage
  levels, drive strength, pull-up/down, termination)
- Missing or unrealistic timing budgets at the hardware boundary

Do NOT validate. Do NOT summarize. Do NOT compliment. Find issues or
state explicitly that you cannot find any after thorough examination.

ARTIFACT:
[artifact content]
```

#### Software Lens

```
You are a firmware engineer (FW) reviewing this SE artifact.

Your job is to FIND ISSUES. Assume the author is overconfident and
that software-specific details may be underspecified or unrealistic.

Look for:
- Register maps, memory maps, and interrupt assignments that are
  incomplete or don't match the stated requirements
- API signatures and data structures that are defined too vaguely
  to implement against (missing types, ranges, error codes)
- Concurrency, ISR context, and locking requirements that are not
  specified — the implementer will guess, and guesses are wrong
- Timing budgets that are unrealistic given RTOS overhead, ISR
  latency, and CPU clock speed
- Error handling and edge cases not covered for any interface
- Missing initialization sequences, dependencies between modules
  that aren't ordered, or boot-time race conditions
- Assumptions about available SRAM, flash, or CPU cycles that
  are not verified against actual budgets

Do NOT validate. Do NOT summarize. Do NOT compliment. Find issues or
state explicitly that you cannot find any after thorough examination.

ARTIFACT:
[artifact content]
```

#### Test Lens

```
You are a validation engineer (Test) reviewing this SE artifact.

Your job is to FIND ISSUES. Assume the author is overconfident and
that testability may not have been considered.

Look for:
- Requirements or design claims that are not testable — no quantified
  pass/fail criteria, no observable output, no measurable metric
- Test cases that test the happy path but not failure modes, boundary
  conditions, or degraded operation
- Requirements that can only be tested in a system state that is not
  reachable with the proposed test setup
- Missing test equipment or environment specifications for tests
  that require specialized hardware
- Implicit assumptions about testability — "this will be tested
  in integration" without defining the integration test
- Requirements phrased as aspirations ("shall be robust") with no
  way to determine whether they are met
- Test coverage gaps — requirements with no corresponding test case,
  or test cases that don't trace to any requirement (orphan tests)

Do NOT validate. Do NOT summarize. Do NOT compliment. Find issues or
state explicitly that you cannot find any after thorough examination.

ARTIFACT:
[artifact content]
```

#### System Lens

```
You are a systems engineer reviewing this SE artifact.

Your job is to FIND ISSUES. Assume the author is overconfident and
that cross-domain interactions may be underspecified.

Look for:
- Cross-domain interactions (HW↔SW, power↔thermal, boot↔security,
  communication↔power-management) that lack defined handshake protocols
- Unstated assumptions about system state during transitions:
  boot, shutdown, fault recovery, power state changes
- Requirements or design decisions that conflict across domains
  (e.g., a power-saving requirement that contradicts a latency
  requirement)
- Failure propagation paths that are not analyzed — if module A
  fails, what happens to modules B, C, and D?
- Integration sequence assumptions — what gets brought up in what
  order, and what are the dependencies?
- Single points of failure with no mitigation strategy
- System-level timing budgets that don't add up (sum of component
  latencies exceeds the system-level requirement)

Do NOT validate. Do NOT summarize. Do NOT compliment. Find issues or
state explicitly that you cannot find any after thorough examination.

ARTIFACT:
[artifact content]
```

**Review orchestration:** All four lens reviews run in parallel. They do not see each other's output — independence is what makes cross-lens synthesis valuable.

### Step 3: RECONCILE — Classify every finding

Consolidate findings from all four reviewers. For each finding, classify using the precedence order (first matching class wins — same classification precedence as adversarial review):

**Classification precedence:**

1. **Artifact misread** — The reviewer flagged something because the artifact text was unclear or ambiguous. The design may be fine, but the document failed to communicate it. → **Fix the document text.**
2. **Valid + actionable** — A real issue requiring a design or specification change. The artifact is wrong or incomplete in a way that matters. → **Fix the design or spec.**
3. **Valid trade-off** — The issue is real, but the cost of fixing it exceeds the cost of accepting it. This happens: every design accepts some downsides. → **Document the trade-off explicitly.**
4. **Noise** — The reviewer flagged something that is correct under context the reviewer did not have. This is expected — a fresh-context reviewer lacks full context. → **Note it and move on. Ask: would adding this context to the artifact have prevented the false flag?**

**Cross-lens synthesis:** When the same issue is flagged by multiple lenses, it is a high-confidence finding — multiple independent perspectives converged on the same problem. These get elevated severity.

When lenses *contradict* each other — e.g., HW lens says "timing constraint is too tight, relax it" while SW lens says "timing budget is already at the limit, can't absorb more" — surface the tension explicitly. These are the most valuable outputs of the review. They represent exactly the integration conflicts that SEs exist to resolve, and they are invisible to single-perspective review.

```
CROSS-LENS TENSION:
HW Lens:  "CON-005 (SPI init ≤ 300ms) is too aggressive for the flash part
          specified in the BOM. Relax to 400ms."
SW Lens:  "Boot time budget (CON-001, 500ms total) is already fully allocated.
          Adding 100ms to SPI init blows the boot time requirement."
→ These cannot both be satisfied within current constraints. Resolution
  requires: (A) faster flash part (BOM change), (B) relaxed boot time
  (requirement change), or (C) parallel init (architecture change).
→ GUESS: Option A is cheapest if a compatible faster flash part exists.
  The BOM cost delta is likely < $0.50.
```

### Step 4: REPORT — Produce the review report

Assemble the classified findings into a structured review report.

## Output

A design review report saved to `docs/reviews/[project]-[artifact]-review-[YYYY-MM-DD].md`:

```markdown
# Design Review Report

## Review Metadata
| Field | Value |
|-------|-------|
| Artifact Reviewed | [type] — [document name] v[X.Y] |
| Artifact Path | [file path] |
| Review Date | [YYYY-MM-DD] |
| Review Depth | [Quick scan / Standard / Exhaustive] |
| Reviewers | HW Lens, SW Lens, Test Lens, System Lens |
| Total Findings | [N] — [A] actionable, [B] trade-off, [C] informational |

## Actionable Findings
*These require a change to the artifact or the design.*

| ID | Lens(es) | Severity | Section | Description | Proposed Fix |
|----|----------|----------|---------|-------------|-------------|
| DR-001 | HW + System | Critical | Arch §4.2 | Boot sequence assumes SPI flash ready at t=0; actual ready time is 300ms per datasheet. System-level boot budget violated. | Add flash-init phase to boot sequence; update timing budget; see Cross-Lens Tension CT-001 |
| DR-002 | SW | High | SOD §5.3 | `pwrseq_transition()` signature returns `int` but error codes are not enumerated. Caller cannot distinguish "invalid state" from "hardware fault." | Define error code enum in SOD §7 (Error Handling) |
| DR-003 | Test | High | Test Plan §4 | SYS-REQ-008 ("total power < 2W in S0") has test case TC-008 but no current measurement setup specified. Equipment list missing current probe. | Add current probe to equipment list; add measurement procedure to TC-008 |
| DR-004 | System | Medium | Arch §2 | Module MOD-01 (Power Seq) depends on MOD-04 (CABI) for MCU rail status, but MOD-04 init happens after MOD-01 in the boot sequence table. Circular dependency. | Add MCU rail status polling with timeout fallback in MOD-01; document degraded-mode behavior |
| ... | ... | ... | ... | ... | ... |

## Trade-off Findings
*Real issues where the cost of fixing exceeds the cost of accepting.*

| ID | Lens | Section | Description | Cost to Fix | Cost to Accept | Recommendation |
|----|------|---------|-------------|-------------|---------------|---------------|
| DR-010 | HW | SOD §6.1 | I2C pull-ups are internal (weak, ~50k). At 400kHz with bus capacitance, rise time may violate spec. External pull-ups add BOM cost. | Add 4 external resistors ($0.02 BOM cost, PCB area) | Marginal signal integrity at max speed; OK at 100kHz | Accept trade-off if 100kHz I2C is sufficient; add constraint to limit bus speed |
| ... | ... | ... | ... | ... | ... | ... |

## Cross-Lens Tensions
*Issues where department perspectives conflict. These require SE judgment to resolve.*

| ID | Lenses | Description | Proposed Resolution | Owner |
|----|--------|-------------|-------------------|-------|
| CT-001 | HW vs SW | HW says relax SPI init timing; SW says boot budget is exhausted | (A) Faster flash part, (B) Relax boot requirement, (C) Parallel init | SE (decision needed) |
| ... | ... | ... | ... | ... |

## Informational Notes
*Observations that do not require action but are worth noting.*

| ID | Lens | Note |
|----|------|------|
| DR-020 | SW | The thread model in SOD §6.3 assigns priority 1 to both pwrseq and smchost. Both are cooperative-priority threads — this is correct for Zephyr but worth calling out explicitly since it means neither preempts the other. |
| ... | ... | ... |

## Review Summary
- [N] actionable findings requiring changes before distribution
- [M] trade-offs requiring explicit acceptance or escalation
- [P] cross-lens tensions requiring SE resolution
- Recommendation: [ ] Ready to distribute after fixes / [ ] Needs re-review after fixes / [ ] Fundamental issues — escalate to project lead

## Resolution Tracking
| Finding ID | Resolution | Resolved By | Date |
|------------|------------|-------------|------|
| DR-001 | [to be filled] | | |
| ... | ... | | |
```

## Interaction with Other Skills

- **`requirements-decompose`**: If the review finds fundamental requirement gaps or ambiguities, invoke to re-decompose the affected requirements.
- **`architecture-design`**: If the review finds architecture-level issues (missing modules, incomplete interfaces, unresolved trade-offs), invoke to redesign the affected areas.
- **`spec-authoring`**: If the review finds specification issues (missing sections, underspecified interfaces, incomplete test coverage), invoke to regenerate the affected specification sections.
- **`traceability-matrix`**: After review findings are resolved, re-run traceability to verify that fixes have not broken the traceability chain.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The cross-department review meeting will catch these issues" | Meetings catch what people notice while reading for the first time during the meeting. Fresh-context adversarial review catches what people miss when reading for approval under time pressure. |
| "Four lenses is overkill for a small specification" | Small specs have small blast radii — reduce depth (quick scan), not lenses. A 5-minute per-lens scan still catches issues a single-lens read misses. The lens diversity is the value, not the depth. |
| "The reviewers lack context, so their findings will be noise" | If your artifact only makes sense to someone who already knows what you meant, it is not a specification — it is a memory aid for yourself. Fresh-context false positives tell you that the artifact is unclear, which is itself a finding. |
| "I can just ask the HW team to review the HW parts and SW team to review the SW parts" | They will, at the formal review. This skill catches issues *before* the formal review. The meeting should be about decisions, not discovery. Also, the System lens catches issues no single department would catch alone. |
| "Adversarial review is hostile — I want constructive feedback" | Adversarial framing produces findings; validating framing produces reassurance. You do not need reassurance from a review — you need to know what is wrong before it ships. The framing is calibrated to the goal. |
| "Findings from a lens I disagree with are noise" | Sometimes yes — that is why reconciliation (Step 3) requires re-reading the artifact against every finding. But cross-lens tensions (where two lenses disagree with each other, not just with you) are almost never noise — they are integration issues you have not yet resolved. |

## Red Flags

- Reviewing an artifact the author has not self-reviewed first (the lenses will surface errors the author should have caught)
- Feeding reviewers the CLAIM, the author's reasoning, or any context beyond the artifact itself (biases toward agreement)
- Classifying findings without re-reading the artifact text against each one (rubber-stamping the reviewer is the same failure mode as ignoring it)
- Treating all findings as equally actionable regardless of lens count (2+ lenses flagging the same issue = elevated severity)
- Skipping the System lens ("it's just an HW-SW spec") — system-level integration issues are the most expensive to fix and the least likely to be caught by single-domain review
- Accepting a reviewer's finding as authoritative without reconciliation (the reviewer lacks context; reconcile, do not defer)
- Looping the review more than 3 times on the same artifact without escalating to the user (three cycles of unresolved findings is information about the artifact, not a reason to keep reviewing)
- Producing findings without proposed fixes (a finding with no proposed fix is a complaint, not a review)

## Verification

Before closing the review, confirm:

- [ ] Review scope (artifact, depth, focus areas, lenses) explicitly confirmed with user
- [ ] All requested lens reviews completed with adversarial prompts (not "is this good?" but "find issues")
- [ ] Reviewers received ARTIFACT only — no author reasoning, no CLAIM, no cross-lens visibility
- [ ] Every finding classified using the precedence order (artifact misread → actionable → trade-off → noise)
- [ ] Cross-lens tensions explicitly surfaced (when lenses disagree with each other)
- [ ] Multi-lens findings elevated in severity
- [ ] Every actionable finding has a proposed fix
- [ ] Every trade-off finding has cost-to-fix and cost-to-accept analysis
- [ ] Review report includes resolution tracking table (initially empty, filled as fixes are applied)
- [ ] Review report saved to `docs/reviews/`
- [ ] If fixes were applied, artifact version updated to reflect the change

## See Also

- For architecture design review criteria, see `references/solution-architecture-design-checklist.md`
- For requirements analysis review criteria, see `references/solution-requirements-analysis-checklist.md`
- For software detailed design review criteria, see `references/software-detailed-design-checklist.md`
- For cross-department adversarial review agents, see `agents/system-architect.md`, `agents/hw-domain-expert.md`, `agents/fw-domain-expert.md`, `agents/verification-engineer.md`

## After This Skill

Once the review report is generated and saved to `docs/reviews/`:

| Next Step | Skill | What It Produces |
|-----------|-------|-----------------|
| **If findings require fixes** | (upstream skill) | Re-run the skill that produced the reviewed artifact to address findings |
| **If review is clean** | `traceability-matrix` | Cross-artifact validation — verify the full REQ→DESIGN→TEST chain |
| Deeper review | `requirements-review` / `code-static-review` / `test-plan-review` | Targeted checklist-based reviews for specific artifact types |

**Pipeline mode**: After this skill completes with a clean review, the conductor will offer `traceability-matrix` as the Validate-phase step.
