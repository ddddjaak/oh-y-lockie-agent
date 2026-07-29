---
name: requirements-review
description: 需求文档审查：基于检查清单对需求文档进行完整性和可追溯性审查。每个发现都引用检查项ID。Requirements document checklist review — focused review of a requirements document against company review checklists. Every finding cites a checklist item ID. Use when the user says 需求审查, 需求评审, requirements review, or when a requirements document is ready for formal peer review. This is a targeted single-document review. NOT the four-lens adversarial design-review (use design-review for comprehensive multi-angle review).
---

# Requirements Review

## Overview

A requirements document is the foundation of every downstream artifact. A gap missed here cascades into the architecture, the specifications, the test plan, and ultimately the product. Formal review checklists exist to catch these gaps systematically — but only if they are applied item by item, with every finding traced to a specific checklist criterion.

This skill loads the appropriate company review checklist (solution-level or software-level) and walks through every line item against the target requirements document. It produces a findings report where every observation cites a checklist item ID. It does not guess — if an item cannot be determined from the document alone, it is flagged for the author.

This is a focused requirements review, distinct from the broader four-lens `design-review` skill. `design-review` subjects any SE artifact (requirements, architecture, spec) to adversarial cross-department scrutiny through HW, SW, Test, and System lenses. This skill is narrower: one document type, one checklist, one goal — verify the requirements document is complete, correct, consistent, and traceable before it feeds downstream.

## When to Use

- A requirements document (system or software) is complete and ready for formal peer review
- Before requirements are handed off to `architecture-design` — catch gaps before architecture rework
- A downstream consumer reports that a requirements document is ambiguous, incomplete, or lacks traceability
- Preparing for a milestone review (requirements freeze, design freeze) and need checklist evidence
- A new team member produced a requirements document and needs a structured review against company standards
- After a significant requirements change — verify the updated document still meets checklist criteria

**When NOT to use:**

- The artifact is an architecture document, specification, test plan, or test report (use the corresponding review skill or `design-review`)
- The document is a rough draft the author has not self-reviewed yet (self-review first)
- You need cross-department adversarial review (HW vs SW vs Test lens conflicts — use `design-review`)
- The ask is a quick informal read-through, not a formal checklist-based review
- Pure formatting or typo review (do not waste checklist machinery on mechanical corrections)

## The Process

```
CONFIRM ──→ LOAD ──→ ASSESS ──→ REPORT
   │          │         │           │
   ▼          ▼         ▼           ▼
Confirm    Load      Evaluate    Produce
checklist  relevant  every       findings
type       checklist checklist  report
           file(s)   item
```

### Step 1: CONFIRM — Determine which checklist applies

Before reading any checklist file, confirm the review scope with the user:

```
REVIEW SCOPE:
Document:       [name] v[X.Y] at [file path]
Checklist type: [ ] Solution-level (solution-requirements-analysis-checklist.md)
                [ ] Software-level (software-requirements-analysis-checklist.md)
                [ ] Both (document spans system + software requirements)
Focus:          [ ] Entire document
                [ ] Specific sections: [list section numbers or requirement ID ranges]
```

**Decision guide:**

| Criterion | Use Solution Checklist | Use Software Checklist |
|-----------|----------------------|----------------------|
| Document title | "System Requirements", "方案需求", "Solution Requirements" | "Software Requirements", "软件需求", "SW Requirements" |
| Scope | Cross-domain (HW + SW + System + Mechanical) | Software/firmware domain only |
| Audience | System engineers, HW team, SW team, Test team | Software engineers, firmware engineers |
| Typical content | Power sequences, pin assignments, system states, cross-domain interfaces | API signatures, memory maps, RTOS requirements, driver interfaces |

If the document spans both domains (e.g., a combined system-software requirements document), load both checklists. Applied together, they give complementary coverage: the solution checklist catches system-level gaps (ownership across domains, cross-functional traceability), while the software checklist catches software-specific gaps (interface definitions, detailed design constraints).

**Exit condition:** Checklist type confirmed. Do not proceed until the user confirms. Guessing the wrong checklist wastes the review.

### Step 2: LOAD — Load the relevant checklist(s)

Load the checklist file(s) from `references/` based on Step 1:

- **Solution-level**: `references/solution-requirements-analysis-checklist.md`
- **Software-level**: `references/software-requirements-analysis-checklist.md`

Both checklists share the same structure with five sections, each containing numbered checklist items:

| Section | Item IDs | What It Checks |
|---------|----------|---------------|
| 1.0 Configuration Items Check (CIC) | CIC1–CIC3 | Whether process artifacts exist (communication records, interface specs, analysis outputs) |
| 2.0 Basic Information Check (BIC) | BIC1–BIC4 | Document formalities — itemization, field completeness, versioning, special requirement flagging |
| 3.0 Requirement Traceability Check (RTC) | RTC1–RTC2 | Whether every requirement traces to a known source and sources are within recognized scope |
| 4.0 Requirement Normalization Check (RNC) | RNC1–RNC13 | Requirement quality — correctness, clarity, completeness, verifiability, consistency, atomicity, prioritization, etc. |
| 5.0 Requirement Classification Check (RCC) | RCC1–RCC2 | Whether functional/non-functional and safety requirements are properly separated |

**Context boundary:** This skill reads the target requirements document and the checklist file(s) only. It does NOT read architecture documents, specifications, test plans, or test reports. If a checklist item asks about downstream artifacts (e.g., CIC2 "is there an interface requirements specification?"), assess based on what the requirements document itself says — do not pull in other documents. Flag unresolved items for the author.

### Step 3: ASSESS — Evaluate every checklist item against the document

Walk through every checklist item in order (CIC1 → CIC2 → … → RCC2). For each item, determine:

- **PASS**: The document clearly satisfies the item.
- **FAIL**: The document clearly violates the item.
- **NEEDS CLARIFICATION**: The item cannot be verified from the document alone. Do NOT guess pass/fail. Flag for the author with a specific question.

**Anti-hallucination rule:**

> If an item cannot be verified from the document alone, flag as **"needs author clarification"** — do NOT guess pass/fail. A guessed pass is a missed gap; a guessed fail undermines reviewer credibility. When you flag, state exactly what information is missing and what a clear answer would look like.

**Assessment format for each item:**

```
[Item ID] [PASS / FAIL / NEEDS CLARIFICATION]
Finding: [specific observation with document reference — section number, requirement ID, or page]
Evidence: [quote or paraphrase from the document that supports the assessment]
```

**Example assessments:**

```
RNC4: FAIL
Finding: Requirements REQ-012 through REQ-018 describe system behavior
("system shall respond to host command", "system shall enter low-power mode")
without quantifiable pass/fail criteria. No measurement method, threshold,
or observable output is specified.
Evidence: REQ-015 states "System shall respond to host command within acceptable
time" — "acceptable time" is not quantified. The checklist requires a clear test
objective that can verify the requirement was satisfied.

RNC10: PASS
Finding: All 47 requirements were cross-checked for conflicts. No duplication
or contradictory requirements found. Each requirement ID appears once and
describes a distinct capability or constraint.
Evidence: Requirement table §3 covers REQ-001 through REQ-047 with unique
descriptions. Cross-reference with the traceability table §5 shows each
requirement maps to a distinct source without overlap.

CIC2: NEEDS CLARIFICATION
Finding: The checklist asks whether an interface requirements specification
exists. The requirements document references "eSPI interface" (REQ-008) and
"I2C interface" (REQ-011) but does not indicate whether a separate interface
specification document exists or is required. If an interface spec is optional
per the project process, this item does not apply.
→ Author: Does a separate interface requirements specification exist?
  If yes, provide the document reference. If no, confirm whether one is required.
```

**Mandatory vs. Optional items:** Both checklists mark each item as "Mandatory" or "Optional." A FAIL on a Mandatory item blocks the review. A FAIL on an Optional item is a recommendation. Reflect this distinction in the report severity.

### Step 4: REPORT — Produce the review report

Assemble all assessments into a structured findings report saved to `docs/reviews/`.

**Report file path:** `docs/reviews/[project]-requirements-review-[YYYY-MM-DD].md`

## Output

```markdown
# Requirements Review Report

## Review Metadata

| Field | Value |
|-------|-------|
| Document Reviewed | [document name] v[X.Y] |
| Document Path | [file path] |
| Review Date | [YYYY-MM-DD] |
| Checklist Applied | [solution-requirements-analysis-checklist / software-requirements-analysis-checklist / both] |
| Checklist Version | [A02 / A01 from the checklist's revision history] |
| Total Items Checked | [N] (CIC: [n], BIC: [n], RTC: [n], RNC: [n], RCC: [n]) |
| Summary | [P] PASS, [F] FAIL, [C] NEEDS CLARIFICATION |

## Findings by Checklist Section

### 1.0 Configuration Items Check (CIC)

| Item ID | Assessment | Category | Finding | Document Reference |
|---------|------------|----------|---------|-------------------|
| CIC1 | PASS / FAIL / NEEDS CLARIFICATION | Mandatory / Optional | [observation] | [section/ID] |
| CIC2 | ... | ... | ... | ... |
| CIC3 | ... | ... | ... | ... |

### 2.0 Basic Information Check (BIC)

| Item ID | Assessment | Category | Finding | Document Reference |
|---------|------------|----------|---------|-------------------|
| BIC1 | ... | ... | ... | ... |
| ... | ... | ... | ... | ... |

### 3.0 Requirement Traceability Check (RTC)

| Item ID | Assessment | Category | Finding | Document Reference |
|---------|------------|----------|---------|-------------------|
| RTC1 | ... | ... | ... | ... |
| RTC2 | ... | ... | ... | ... |

### 4.0 Requirement Normalization Check (RNC)

| Item ID | Assessment | Category | Finding | Document Reference |
|---------|------------|----------|---------|-------------------|
| RNC1 | ... | Mandatory | ... | ... |
| ... | ... | ... | ... | ... |

### 5.0 Requirement Classification Check (RCC)

| Item ID | Assessment | Category | Finding | Document Reference |
|---------|------------|----------|---------|-------------------|
| RCC1 | ... | ... | ... | ... |
| RCC2 | ... | ... | ... | ... |

## Items Requiring Author Clarification

*The following items could not be assessed from the document alone. Each requires the author to provide additional information or confirm whether the item applies.*

| Item ID | Category | What Is Missing | Question for Author |
|---------|----------|----------------|-------------------|
| CIC2 | Optional | Document references interfaces but does not indicate whether a separate interface spec exists | [specific question] |
| ... | ... | ... | ... |

## Failed Mandatory Items (Blocking)

*These items must be resolved before the requirements document can proceed to downstream work.*

| Item ID | Finding | Recommended Action |
|---------|---------|-------------------|
| [item ID] | [finding] | [action] |

## Review Summary

- **Checklist applied**: [solution / software / both]
- **Items checked**: [N] total across 5 sections
- **Passed**: [P]
- **Failed**: [F] (Mandatory: [M], Optional: [O])
- **Needs clarification**: [C]
- **Recommendation**: [ ] Ready to proceed / [ ] Resolve blocking items and re-review / [ ] Major gaps — escalate to project lead

## Resolution Tracking

| Item ID | Resolution | Resolved By | Date |
|---------|------------|-------------|------|
| [item ID] | [to be filled by author] | | |
| ... | ... | | |
```

## Interaction with Other Skills

- **`requirements-decompose`**: If the review finds fundamental gaps (missing requirements, unresolved conflicts, unclear ownership), the requirements document should go back to `requirements-decompose` for rework. A failed review is the upstream skill's exit criteria not being met.
- **`design-review`**: This skill is for requirements documents only. For architecture documents, specifications, or any non-requirements SE artifact, use `design-review` which subjects the artifact to four-lens adversarial review. If the user is unsure which to use: one document type → `requirements-review`; multi-domain artifact review → `design-review`.
- **`traceability-matrix`**: After review findings are resolved, run traceability validation to confirm that fixes did not break cross-artifact references and that all requirements now trace cleanly to sources and downstream design elements.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The checklist is just a form — we can eyeball it" | Checklists exist because humans are bad at exhaustive review from memory. Walking through every item catches gaps the "eyeball" pass misses. The checklist items were curated by senior engineers who learned each one the hard way. |
| "Most items will pass — let's just flag the ones that fail" | A pass is evidence. Saying "all requirements are correctly normalized (RNC1–RNC13)" without per-item evidence is not a review — it is an assumption. The report is proof that each item was checked. |
| "I can guess whether the document satisfies this checklist item" | A guessed pass is a missed gap that cascades into architecture, spec, and test. A guessed fail wastes the author's time on a non-issue. If the document does not answer the question, flag it — the author knows their document better than you do. |
| "This is a small requirements doc — the full checklist is overkill" | Small docs have small blast radii, but the same failure modes. A 5-page requirements doc with a missing traceability chain creates the same downstream confusion as a 50-page one. The checklist is proportional to the number of requirements, not the page count. |
| "The requirements were already reviewed during decomposition" | The author reviewing their own work is not independent review. `requirements-decompose` produces the document; `requirements-review` verifies it against an external standard. These are distinct quality gates. |

## Red Flags

- Proceeding to Step 2 without confirming the checklist type in Step 1 — applying the wrong checklist produces an irrelevant review
- Guessing pass/fail for a checklist item the document does not address — flag as "needs author clarification" instead
- Reading architecture documents, specifications, or test plans to resolve checklist items — this skill's context boundary is the requirements document + the checklist files only
- Reporting findings without citing the specific checklist item ID — untethered findings are opinions, not review evidence
- Treating Optional items as ignorable — an Optional item that fails is still a finding worth surfacing; the author decides whether to act on it
- Skipping items because "that section always passes" — the one time it does not is the reason the checklist exists
- Producing a report without a resolution tracking table — a review without tracked resolution is a complaint, not a quality gate
- Mixing this skill with `design-review` — if the user wants adversarial cross-lens review, invoke `design-review`; if they want checklist-based requirements review, use this skill. The output formats and criteria are different.

## Verification

Before closing the review, confirm:

- [ ] Checklist type (solution / software / both) explicitly confirmed with user in Step 1
- [ ] Correct checklist file(s) loaded from `references/` — verify the file path and version
- [ ] Every checklist item (CIC1 through RCC2) assessed — no skipped items
- [ ] Every assessment cites the checklist item ID and a document reference (section, requirement ID, or page)
- [ ] No pass/fail guessed — any item the document does not address is flagged "needs author clarification" with a specific question
- [ ] Mandatory/Optional category from the checklist reflected in each item's assessment
- [ ] Failed Mandatory items listed in the "Failed Mandatory Items (Blocking)" section
- [ ] Items needing clarification listed in the "Items Requiring Author Clarification" section with specific questions
- [ ] Review report saved to `docs/reviews/[project]-requirements-review-[YYYY-MM-DD].md`
- [ ] Resolution tracking table included (empty, to be filled by author as items are resolved)
- [ ] Only the target requirements document and checklist files were read — no architecture, spec, test, or other downstream documents pulled in

## After This Skill

Once the requirements review report is saved to `docs/reviews/`:

| Next Step | Skill | What It Produces |
|-----------|-------|-----------------|
| **If requirements are clean** | `architecture-design` | Proceed to system-level module decomposition and interface design |
| **If findings require fixes** | `requirements-decompose` | Re-decompose requirements to address gaps identified in review |
| Quality check | `traceability-matrix` | Verify requirements completeness and traceability |

**Pipeline mode**: After this skill completes, the conductor will detect `docs/reviews/` and offer `traceability-matrix` as the Validate-phase step.

## See Also

- `references/solution-requirements-analysis-checklist.md` — Solution-level requirements review checklist (CIC1–RCC2)
- `references/software-requirements-analysis-checklist.md` — Software-level requirements review checklist (CIC1–RCC2)
- `requirements-decompose` — Upstream skill that produces the requirements document being reviewed
- `design-review` — Broader four-lens adversarial review for any SE artifact (requirements, architecture, spec); use when cross-department HW/SW/Test/System perspective conflicts are the goal
- `traceability-matrix` — Downstream skill that validates cross-artifact traceability after review findings are resolved
