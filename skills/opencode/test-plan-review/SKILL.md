---
name: test-plan-review
description: 测试方案审查：验证测试方案完整性、需求到测试用例覆盖率、死引用、不可测声明和P0覆盖缺失。Test plan review — verifies test plan completeness, requirements-to-test-case coverage, dead references, untestable claims, and missing P0 coverage. Use when the user says 测试方案审查, 测试计划审查, test plan review, or when a test plan document is ready for review before a test readiness milestone. NOT for reviewing test results (use test-report-review).
---

# Test Plan Review

## Overview

A test plan written in isolation is self-consistent. Reviewed against a checklist, it is compliant. Reviewed against checklists *and* the requirements it claims to cover, it reveals whether the product will actually be tested.

This skill performs a two-axis review of a test plan document: **compliance** (does the plan meet process standards, per the applicable checklist?) and **coverage** (does every requirement — especially every P0 — have a corresponding test case, and does every test case trace to a real requirement?). It does not read architecture or detailed design documents. Its scope is the test plan itself and the requirements document it targets.

## When to Use

- A test plan document is complete and ready for formal review
- Before a test readiness or test freeze milestone
- A downstream test team reports the test plan is missing sections, ambiguous, or untestable
- Requirements have changed and the test plan needs a coverage reassessment
- Preparing evidence for a certification or audit that requires documented test plan review

**When NOT to use:**

- The test plan is an early draft the author has not self-reviewed yet (author self-review first)
- Reviewing test *results* or test *reports* (this skill reviews the plan, not the execution)
- Typos or formatting-only fixes — do not invoke a full review for mechanical corrections
- Reviewing architecture or detailed design (out of scope), or a quick sanity check on one section (do it manually)

## The Process

```
SCOPE ──→ COMPLIANCE ──→ COVERAGE ──→ REPORT
   │           │             │            │
   ▼           ▼             ▼            ▼
 Confirm    Run every     Cross-ref      Produce
 checklist  applicable    test cases     review
 & inputs   checklist     against reqs   report
```
### Step 1: SCOPE — Confirm which checklists apply and what inputs exist

Before any checking, clarify the review boundary:

```
REVIEW SCOPE:
Test Plan:  [document name] v[X.Y] at [file path]
Requirements: [document name] v[X.Y] at [file path]  ← required for coverage check
Checklists: [ ] software-test-plan-checklist.md      ← mandatory for software test plans
            [ ] solution-test-strategy-checklist.md   ← mandatory for solution-level test strategies
            [ ] Both — the test plan covers both software and solution-level strategy
Depth:      [ ] Standard — run all checklist items
            [ ] Quick scan — mandatory items only (skip Optional items)
Output:     docs/reviews/[project]-test-plan-review-[YYYY-MM-DD].md
→ Confirm scope before proceeding.
```

**Checklist selection guidance:**
- `software-test-plan-checklist.md` — SW module / unit / integration test plans
- `solution-test-strategy-checklist.md` — solution-level / system-level test strategies spanning HW+SW+System
- If the test plan covers both levels, run both. Mark inapplicable items N/A with a reason — do not silently skip.

**Input validation:** If no requirements document is provided, coverage check (Step 3) cannot run. Warn: *"Without a requirements document, I can only run the compliance check (Step 2). Shall I proceed compliance-only, or provide the requirements document?"*

### Step 2: COMPLIANCE — Run the applicable checklist(s)

For each checklist selected in Step 1, run every checklist item against the test plan document. Each finding MUST cite the checklist item ID.

**How to evaluate a checklist item:**
1. Read the checklist item's check content (e.g., "是否描述了测试范围，包括测试类别、测试入口、测试特殊要求，测试目标和测试对象")
2. Search the test plan document for evidence that addresses this item
3. Classify the result:

| Result | Meaning |
|--------|---------|
| PASS | Evidence found. Cite where in the test plan (section number or line). |
| FAIL | Missing or insufficient. Describe what is missing. |
| N/A | Item does not apply to this test plan. Must state why. |

**Mandatory vs. Optional:** Checklist items marked "Mandatory" that fail are compliance gaps and appear in the Actionable Findings section of the report. Checklist items marked "Optional" that fail are informational recommendations.

**Grouped reporting:** Report findings grouped by checklist and section (e.g., "software-test-plan-checklist §3.0 — DRC1"). Do not produce a flat list of 30+ raw items. Group by checklist section, cite item IDs, and attach evidence references.

**Anti-hallucination rule — checklist items:** Every finding must cite a real checklist item ID from the loaded checklists. If a checklist item ID does not exist in either of the loaded checklist files, do NOT invent it. If you cannot find a matching checklist item for an observation, record it under a separate "Reviewer Observations" section — never fabricate an item ID.

### Step 3: COVERAGE — Cross-reference test cases against requirements

Extract every requirement ID from the requirements document and every test case ID from the test plan. Build the coverage cross-reference. This step has three sub-checks.

#### 3a. P0 coverage check

Every requirement with priority P0 (or equivalent — "critical", "must-test", "safety") MUST have at least one corresponding test case. Produce an explicit list:

```
P0 REQUIREMENT COVERAGE:
| Req ID    | Requirement Description | Priority | Test Case(s) | Status |
|-----------|------------------------|----------|-------------|--------|
| SYS-REQ-001 | Cold boot < 500ms     | P0       | TC-001      | ✅ Covered |
| SYS-REQ-005 | Watchdog triggers reset | P0    | —           | ❌ GAP   |
| SYS-REQ-012 | S0→S3 power seq order  | P0       | TC-008, TC-009 | ✅ Covered |
```

A P0 requirement with no test case is a blocking finding — the report marks it Critical.

#### 3b. Dead reference detection

For every test case in the test plan, extract the requirement ID(s) it references. Cross-reference against the requirements document. If a test case references a requirement ID that does NOT exist in the requirements document:

```
DEAD REFERENCE:
TC-025 references "SYS-REQ-099" but the requirements document (v1.2)
defines SYS-REQ-001 through SYS-REQ-045. SYS-REQ-099 does not exist.
→ Flag as dead reference. Do NOT guess the intended requirement.
→ Action: Test author must correct the reference or add the missing requirement.
```

**CRITICAL ANTI-HALLUCINATION RULE:** If a test case references a requirement ID that does not exist in the requirements document, flag it as a dead reference. Do NOT guess which requirement the test case was intended to cover. Do NOT suggest a "likely" match. The test author must resolve the reference — guessing introduces traceability errors that compound downstream.

#### 3c. Orphan test case detection

```
ORPHAN TEST CASE:
TC-042: "Verify SPI CRC error recovery with corrupted packet at 80% of transfer"
→ References zero requirement IDs.
→ Impact: This test validates behavior no requirement asked for.
→ Action: Either (A) add a requirement for SPI CRC error handling, or
  (B) remove TC-042 from the test plan.
```

### Step 4: REPORT — Produce the test plan review report

Assemble all findings into a structured review report.

## Output

A test plan review report saved to `docs/reviews/[project]-test-plan-review-[YYYY-MM-DD].md`:

```markdown
# Test Plan Review Report: [Project Name]

## Review Metadata
| Field | Value |
|-------|-------|
| Test Plan Reviewed | [document name] v[X.Y] |
| Test Plan Path | [file path] |
| Requirements Document | [document name] v[X.Y] |
| Requirements Path | [file path] |
| Checklists Applied | [list names] |
| Review Date | [YYYY-MM-DD] |
| Review Depth | [Standard / Quick scan] |
| Total Findings | [N] — [A] actionable, [B] recommendations, [C] informational |

## Actionable Findings
*Findings requiring a change to the test plan.*

| ID | Checklist | Item ID | Severity | Section | Description | Evidence / Missing | Recommendation |
|----|-----------|---------|----------|---------|-------------|-------------------|----------------|
| TPR-001 | SW Test Plan | DRC5 | High | — | Test plan does not specify test end, termination, or abort conditions | No mention of exit criteria in any section | Add a "Test Exit Criteria" section defining pass/fail thresholds, abort conditions, and completion criteria |
| TPR-002 | Solution Test Strategy | RNC5 | Medium | Equipment List | Test equipment list missing quantities, models, and calibration expiry dates | §Equipment lists only names — e.g., "oscilloscope" with no model or quantity | Add columns: Quantity, Model/Part Number, Calibration Due Date for each equipment item |
| ... | ... | ... | ... | ... | ... | ... | ... |

## P0 Coverage Gaps
*P0 requirements without test cases — blocking.*

| Req ID | Requirement | Reason No Test | Recommendation |
|--------|-------------|---------------|----------------|
| SYS-REQ-005 | Watchdog triggers system reset | No test case found in plan | Add test case: verify reset assertion within watchdog timeout; verify reset de-assertion sequence |
| ... | ... | ... | ... |

## Dead References
*Test cases referencing requirement IDs that do not exist in the requirements document.*

| Test Case | References | Status |
|-----------|-----------|--------|
| TC-025 | SYS-REQ-099 | Does not exist in requirements document (range: SYS-REQ-001–045). Author must correct. |
| ... | ... | ... |

## Orphan Test Cases
*Test cases with no requirement trace.*

| Test Case | Description | Recommendation |
|-----------|-------------|---------------|
| TC-042 | SPI CRC error recovery | Add a requirement for SPI CRC error handling or remove TC-042 |
| ... | ... | ... |

## Informational Recommendations
*Optional checklist items or observations that do not block approval.*

| ID | Source | Item ID | Observation | Recommendation |
|----|--------|---------|-------------|---------------|
| TPR-010 | SW Test Plan | CIC1 | Communication records not referenced | Consider linking to design review meeting minutes |
| ... | ... | ... | ... | ... |

## Reviewer Observations
*Observations that do not correspond to a specific checklist item but are worth noting.*

| ID | Observation |
|----|-------------|
| TPR-020 | Test schedule in §5 allocates 2 days for integration testing; given 35 test cases, this may be optimistic |
| ... | ... |

## Coverage Summary
| Metric | Value |
|--------|-------|
| Total Requirements | [N] |
| P0 Requirements | [M] |
| P0 Requirements Covered | [X] / [M] ([X/M*100]%) |
| Total Test Cases | [P] |
| Test Cases with Valid Trace | [Q] / [P] |
| Orphan Test Cases | [R] |
| Dead References | [S] |
| Compliance Checklist Items Passed | [T] / [U] |

## Resolution Tracking
| Finding ID | Resolution | Resolved By | Date |
|------------|------------|-------------|------|
| TPR-001 | [to be filled] | | |
| TPR-002 | [to be filled] | | |
| ... | ... | | |

## Review Recommendation
- [ ] Approved — no findings or all findings are informational only
- [ ] Conditionally approved — actionable findings must be resolved; no re-review required
- [ ] Re-review required — critical findings (P0 coverage gaps, multiple Mandatory checklist failures) require a second review after fixes
- [ ] Rejected — fundamental issues (no P0 coverage, missing required sections) require a major revision before re-review
```

## Interaction with Other Skills

- **`requirements-decompose`**: If the review finds that requirements themselves are missing, ambiguous, or unnumbered, invoke to produce structured, traceable requirements before the test plan can be reviewed.
- **`spec-authoring`**: If the review finds missing test cases for covered requirements, invoke to generate the missing test case definitions.
- **`traceability-matrix`**: Run after this review's findings are resolved to verify the full end-to-end traceability chain (not just requirements→tests, but all five levels).
- **`design-review`**: Run before or in parallel. The design review catches design issues in the test plan (untestable claims, missing instrumentation); this review catches process and coverage issues. They complement each other.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The test plan references requirements by section, not by ID — that's good enough" | Section references break when the requirements document is renumbered. Requirement IDs are the only stable traceability anchor. If the requirements document lacks IDs, fix the requirements document first. |
| "100% P0 coverage is impossible — some P0s are implicitly tested by integration" | "Implicitly tested" means "not tested in a way that can be verified." Every P0 must have an explicit test case with a pass/fail criterion. If the integration test covers it, reference the integration test case ID. |
| "Dead references are just typos — I'll fix them mentally" | A dead reference means a test case is linked to a nonexistent requirement. The test may be testing the wrong thing, or testing nothing traceable. Do NOT guess the intended requirement. The test author must resolve it. |
| "The checklist items are guidelines, not requirements" | Mandatory checklist items marked FAIL are compliance gaps. Optional items are guidance. The distinction matters — do not blur it by treating all items as equally negotiable. |
| "I'll just review the test plan manually — I know what a good test plan looks like" | Manual review catches what you notice. Checklist-driven review catches what the organization decided must be checked. The checklist is institutional memory; trust it over your intuition. |
| "This is a lot of checklist items — can we just focus on the important ones?" | Quick scan depth skips Optional items. Standard depth runs all items. Do not selectively skip Mandatory items — that is not a review, it is cherry-picking. |

## Red Flags

- Running the review without a requirements document for coverage check (warn the user — compliance-only review is incomplete)
- Silently skipping checklist items instead of marking them N/A with a stated reason
- Fabricating checklist item IDs that do not exist in the loaded reference files (anti-hallucination)
- Guessing the intended requirement when a test case references a nonexistent requirement ID (flag as dead reference — do NOT guess)
- Treating all checklist items as equally weighted (Mandatory failures are compliance gaps; Optional failures are recommendations)
- Producing findings without citing the checklist item ID or evidence from the test plan text
- Producing coverage percentages without listing which specific P0 requirements are uncovered (the uncovered list is the value)
- Reading architecture or detailed design documents during this review (out of scope — this skill reads only test plan + requirements document + checklists)
- Skipping the orphan test case check — test cases that trace to nothing waste execution time and create false confidence
- Saving the report outside `docs/reviews/`

## Verification

Before closing the review, confirm:

- [ ] Review scope (test plan, requirements document, checklist(s), depth) explicitly confirmed with user
- [ ] Every applicable checklist item evaluated with evidence reference (PASS/FAIL/N/A with reason)
- [ ] Every finding cites the real checklist item ID from the loaded reference file
- [ ] No fabricated checklist item IDs used
- [ ] P0 coverage check complete — every P0 requirement listed with covered/gap status
- [ ] Every dead reference flagged with the nonexistent requirement ID and the valid range from the requirements document
- [ ] Zero dead references resolved by guessing — all flagged for author resolution
- [ ] Every orphan test case identified with a recommendation (add requirement or remove test case)
- [ ] Coverage summary metrics computed (requirements, P0, test cases, orphans, dead refs)
- [ ] Report includes actionable findings table with proposed fixes
- [ ] Report includes resolution tracking table (initially empty, filled as fixes are applied)
- [ ] Report saved to `docs/reviews/`
- [ ] Architecture and detailed design documents were NOT read during this review (context boundary enforced)

## After This Skill

Once the test plan review report is saved to `docs/reviews/`:

| Next Step | Skill | What It Produces |
|-----------|-------|-----------------|
| **If test plan is approved** | (testing) | Proceed with test execution per the approved test plan |
| **If findings require fixes** | `spec-authoring` | Update the test plan to address gaps identified in review |
| After test execution | `test-report-review` | Review test results and reports for correctness and traceability |
| Quality check | `traceability-matrix` | Verify requirements → test case coverage completeness |

**Pipeline mode**: After this skill completes, the conductor will detect `docs/reviews/` and offer `traceability-matrix` as the Validate-phase step.

## See Also

- For software test plan checklist criteria: `references/software-test-plan-checklist.md`
- For solution test strategy checklist criteria: `references/solution-test-strategy-checklist.md`
- For test execution result review, see the test report review skill
- For full cross-artifact traceability validation, run `traceability-matrix` after this review's findings are resolved
