---
name: test-report-review
description: 测试报告审查：验证测试报告正确性、完整性及与测试方案的可追溯性。不会假设标准被放宽。Test report review — verifies test report correctness, completeness, and traceability against its governing test plan. Never assumes pass/fail criteria were relaxed. Use when the user says 测试报告审查, 测试结果审查, test report review, or when a test report is submitted for sign-off. NOT for reviewing the test plan itself (use test-plan-review).
---

# Test Report Review

## Overview

A test report that says "all tests passed" is not the same as a test report that proves it. A reviewer reading a test report sees test items with checkmarks. A reviewer reading a test report against the test plan sees gaps: pass/fail criteria that were silently relaxed, test items marked "passed" with data that contradicts the threshold, missing test environment details that make results unreproducible, and orphaned test results that test nothing in the requirements.

This skill reviews a test report document against its governing test plan and the relevant review checklist. It does not trust the report's conclusions — it verifies them against the criteria the test plan defined. Every finding cites a specific checklist item ID and, where applicable, the test plan criterion the report data is inconsistent with.

## When to Use

- A test report has been submitted for review, sign-off, or milestone gate
- Preparing for a formal review meeting where the test report is the primary evidence
- The test report's conclusions ("all passed") appear inconsistent with known issues or defect counts
- A downstream team has raised questions about whether testing was adequate
- Validating that regression testing or a re-spin touched all affected areas
- After a requirements or architecture change — to confirm tests were updated to match

**When NOT to use:**

- The test report is a draft the test team has not self-reviewed yet (ask them to self-review first)
- Reviewing the test plan itself (use `design-review` with the Test lens instead)
- Typos and formatting issues in the test report (these do not need a full checklist-driven review)
- The test report has no associated test plan (nothing to compare against — the review cannot be meaningful)
- Pure traceability audit without correctness verification (use `traceability-matrix` for coverage-only checks)

## Context Boundary

This skill reads exactly three categories of input:

1. **Test report** — the document under review, at the path provided by the user
2. **Test plan** — the governing test plan that defines pass/fail criteria, test environment, and traceability expectations
3. **Relevant checklist(s)** — loaded based on report type (Step 1), from `references/`

Do not load checklists for report types the user did not request. Do not apply checklist items from a qualification-test checklist to a solution-level report.

## The Process

```
CLASSIFY ──→ LOAD ──→ REVIEW ──→ CROSS-CHECK ──→ REPORT
    │          │         │            │              │
    ▼          ▼         ▼            ▼              ▼
  Determine  Load      Work        Compare test    Produce
  report     test      through     results to      review
  type &     report,   each        test plan       report
  relevant   test      checklist   pass/fail       in
  checklist  plan      category    criteria        docs/reviews/
```

### Step 1: CLASSIFY — Determine report type and load only relevant checklists

The user provides a test report path. Before reading it, ask the user to confirm the report type — the checklist loaded depends on this:

| Report Type | Checklist to Load | What It Covers |
|-------------|-------------------|----------------|
| **Solution-level test report** | `references/solution-test-report-checklist.md` | End-to-end system validation: configuration items, basic info, requirement traceability, execution normalization, result classification |
| **Software qualification test report** | `references/software-qualification-test-review-checklist.md` | Unit/module-level qualification: test case coverage, priority smoke tests, basic function, stress, interrupt/DMA |
| **Software integration test report** | `references/software-integration-test-review-checklist.md` | Cross-module integration: architecture coverage, HW-SW constraints, interface tests, static/dynamic design, performance |

```
REPORT TYPE CONFIRMATION:
Test report: [path]
Test plan:   [path — ask if not provided]
Type:        [ ] Solution-level test report
             [ ] Software qualification test report
             [ ] Software integration test report
→ Load ONLY the corresponding checklist from references/.
  If the user does not know which type, read the test report and classify
  based on scope and content before proceeding.
```

If the user requests multiple types, process sequentially — different checklists, different findings.

### Step 2: LOAD — Read test report, test plan, and relevant checklist

Load all three documents into context:

1. **Test report** — the document under review
2. **Test plan** — the governing plan; extract every pass/fail criterion with its threshold value
3. **Relevant checklist** — the checklist identified in Step 1

Surface what was loaded:

```
LOADED FOR REVIEW:
Test report: [name] v[X.Y] at [path], [N] pages
Test plan:   [name] v[X.Y] at [path], defines [M] test cases with pass/fail criteria
Checklist:   [checklist name] from references/, [K] checklist items across [C] categories
→ Confirm: do these versions match? If test plan version predates the test report,
  the criteria may have changed — flag this.
```

**Version alignment check:** If the test report references a test plan version that differs from the one provided, surface the mismatch. A test report written against test plan v1.0 reviewed against test plan v1.2 may produce false findings — criteria may have been added, removed, or changed.

### Step 3: REVIEW — Work through each checklist category systematically

For every checklist item in the loaded checklist, evaluate the test report and record one of three verdicts:

| Verdict | When to Use |
|---------|-------------|
| **PASS** | The test report satisfies the checklist item — evidence is present, clear, and complete |
| **FAIL** | The test report does not satisfy the checklist item — evidence is missing, incomplete, or incorrect |
| **N/A** | The checklist item does not apply to this specific test report (document the reason) |

**Every finding MUST cite the checklist item ID.** A finding without a checklist item ID is an opinion, not a review finding.

**Checklist category mapping by report type:**

For **solution-level test reports** (`solution-test-report-checklist.md`):
- 1.0 CIC — Configuration Items Check: communication records, HW/SW requirements, detailed design
- 2.0 BIC — Basic Information Check: test itemization, result fields, overall conclusion, special requirements
- 3.0 RTC — Requirement Traceability Check: test status annotations, test conclusions per item
- 4.0 RNC — Requirement Normalization Check: version/time/location/personnel, network topology, equipment records, execution statistics, detailed results, defect statistics,遗留问题 (open issues)
- 5.0 RCC — Requirement Classification Check: result-to-conclusion consistency, open-issue-to-result correspondence

For **software qualification test reports** (`software-qualification-test-review-checklist.md`):
- 0.0 CIC — Configuration Items Check: communication records, test case outputs, test code in VCS
- 1.0 BIC — Basic Information Check: test case coverage of module requirements
- 2.0 TCC — Test Case Check: priority annotation, basic function tests, stress tests, interrupt/DMA tests

For **software integration test reports** (`software-integration-test-review-checklist.md`):
- 0.0 CIC — Configuration Items Check: communication records, integration test case outputs, integration test code
- 1.0 BIC — Basic Information Check: test case coverage of architecture design
- 2.0 TCC — Test Case Check: priority, HW-SW constraints, architecture checks, interface tests (input validation, DET), static design (data types, file structure), dynamic design (module states, boot flow, memory map), basic module functions, performance (memory, CPU load, interrupt timing, critical section timing)

### Step 4: CROSS-CHECK — Compare test results to test plan pass/fail criteria

This is the anti-hallucination step. Do NOT take the test report's conclusions at face value. For each test case documented in the test report:

1. **Find the corresponding test case in the test plan.** Extract the pass/fail criterion and its threshold value (e.g., "S0→S3 transition ≤ 10ms", "current drop to ≤ 2W within 5s of idle").
2. **Check whether the test report's measured result satisfies the criterion.** If the test plan says ≤ 10ms and the test report records 12ms, that is a FAIL regardless of what the report's conclusion column says.
3. **Flag any criterion relaxation without justification.** If the test plan threshold is ≤ 10ms and the test report records 12ms with "PASS" in the conclusion column, flag it as a discrepancy. The criterion may have been relaxed by mutual agreement — but if that agreement is not documented in the report, it is a review finding.

```
CRITERIA CROSS-CHECK:
Test plan TC-005: "Vcore ramp time ≤ 2ms from enable to stable"
Test report TC-005: measured 2.3ms, conclusion "PASS"
→ FLAG: Measured 2.3ms exceeds threshold 2.0ms by 15%. The report marks
  this as PASS. If the criterion was relaxed, it must be documented in the
  report with rationale and approval. Otherwise this is a FAIL.
→ Checklist item: RCC1 (result-to-conclusion consistency)
```

**Critical rule:** If test data appears inconsistent with pass criteria, flag it — do NOT assume the criteria were relaxed. The burden of proof is on the report to document any relaxation, not on the reviewer to assume it.

**Spot-check strategy:** For reports with many test cases, spot-check at minimum:
- Every test case with a "FAIL" conclusion (verify the failure is correctly reported)
- Every P0/highest-priority test case
- A random sample of at least 10% of "PASS" test cases, weighted toward those with numeric thresholds
- Any test case where the reported value is within 20% of the threshold boundary

### Step 5: REPORT — Produce the test report review report

Assemble all findings into a structured review report.

## Output

A test report review report saved to `docs/reviews/[project]-test-report-review-[YYYY-MM-DD].md`:

```markdown
# Test Report Review

## Review Metadata
| Field | Value |
|-------|-------|
| Test Report Reviewed | [name] v[X.Y] |
| Test Report Path | [file path] |
| Test Plan Used | [name] v[X.Y] at [path] |
| Report Type | [Solution-level / Qualification / Integration] |
| Checklist Applied | [checklist name] |
| Review Date | [YYYY-MM-DD] |
| Total Findings | [N] — [A] FAIL, [B] PASS, [C] N/A |

## Checklist Findings

### [Category Number] [Category Name] — [Overall Verdict: PASS / FAIL]

| Item ID | Checklist Requirement | Verdict | Evidence in Report | Notes |
|---------|----------------------|---------|-------------------|-------|
| CIC1 | 是否有沟通记录 | PASS | §1.2 Communication Record table lists 3 meetings | |
| BIC2 | 测试结果字段是否按要求填写 | FAIL | §3 Test Results: TC-012 through TC-015 missing "Test Date" and "Tester" fields | Required per checklist; Mandatory item |
| RNC3 | 测试使用的量具、设备是否有清楚的记录 | FAIL | §2 Test Environment: oscilloscope model listed but serial number and calibration expiry date missing | Mandatory item |
| ... | ... | ... | ... | ... |

## Criteria Cross-Check Findings

*Discrepancies between test report conclusions and test plan pass/fail criteria.*

| TC-ID | Test Plan Criterion | Reported Value | Report Conclusion | Finding |
|-------|--------------------|----------------|-------------------|---------|
| TC-005 | Vcore ramp ≤ 2ms | 2.3ms | PASS | **FAIL** — measured value exceeds threshold by 15%. Checklist item: RCC1. Resolution required: either (A) re-test with corrected setup, (B) document criterion relaxation with justification and approval, or (C) accept as non-conformance with mitigation. |
| TC-012 | Wake latency ≤ 500μs | 487μs | PASS | **PASS** — within threshold (2.6% margin). No issue. |
| ... | ... | ... | ... | ... |

## Coverage Gaps

*Test plan requirements with no corresponding test result in the report.*

| Requirement ID | Test Plan TC | Status in Report | Recommendation |
|----------------|-------------|-----------------|----------------|
| SYS-REQ-015 | TC-020 | Not found in report | Test appears in plan but not in report. Confirm whether test was executed and omitted from report, or skipped entirely. Checklist item: RTC1. |
| ... | ... | ... | ... |

## Summary and Recommendation

- Checklist items: [P] PASS / [F] FAIL / [N] N/A
- Criteria cross-check discrepancies: [D]
- Coverage gaps: [G]
- Recommendation: [ ] Accept as-is  [ ] Conditional accept (fix [list] items)  [ ] Reject — re-test and re-submit  [ ] Escalate to [role]

## Open Issues Requiring Resolution
| ID | Description | Checklist Item | Owner | Due |
|----|-------------|---------------|-------|-----|
| TR-001 | Document criterion relaxation for TC-005 or re-test | RCC1 | Test lead | [date] |
| TR-002 | Add missing equipment calibration data for RNC3 | RNC3 | Test engineer | [date] |
| ... | ... | ... | ... | ... |
```

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The test report says all passed — reviewing it is a formality" | A test report that says all passed when the data says otherwise is a bigger problem than a test report that honestly reports failures. The data, not the conclusion column, is the ground truth. |
| "The criteria were probably relaxed by mutual agreement" | Possibly — but if that agreement is not documented in the report, it does not exist from a traceability standpoint. The reviewer cannot assume undocumented decisions. Flag the discrepancy and let the test team document the relaxation. |
| "Spot-checking 10% of PASS cases is good enough — the rest are probably fine" | Systematic errors cluster. If the test setup had a calibration issue, every measurement from that setup is suspect. The 10% spot-check is a minimum, not a guarantee. If any spot-check fails, expand the sample. |
| "The checklist items are Mandatory/Optional — I only need to check Mandatory ones" | Optional items are Optional for the test team to execute, not Optional for the reviewer to check. If an Optional item is claimed in the report, verify it. If it is not claimed, note that it was not performed (that is itself a finding, not a pass). |
| "The test report and test plan versions don't match — I'll review against the report's stated version" | Review against the version provided. If the report claims v1.0 but the provided plan is v1.2, surface the mismatch as a finding. The review is only valid against a known baseline. |

## Red Flags

- Reviewing a test report without access to the governing test plan (the plan IS the criteria; without it you are proofreading, not reviewing)
- Accepting the test report's conclusions without spot-checking the data against the plan's pass/fail criteria
- Assuming pass/fail criteria were relaxed when the reported data does not meet them (flag, do not assume)
- Applying checklist items from the wrong report type (qualification checklist items to an integration report)
- Treating checklist items as a survey rather than pass/fail — every item gets a verdict with evidence
- Skipping the criteria cross-check (Step 4) for "small" or "routine" reports — a 2.3ms that should be 2.0ms is equally wrong regardless of report size
- Reporting findings without proposed resolution paths (a finding with no recommended action is a complaint, not a review)
- Accepting "N/A" for a checklist item without documenting WHY it does not apply

## Verification

Before closing the review, confirm:

- [ ] Report type confirmed with user (solution / qualification / integration); only the relevant checklist was loaded
- [ ] Test report and test plan both read in full; version alignment verified
- [ ] Every checklist item in the loaded checklist evaluated with a verdict (PASS / FAIL / N/A) and evidence
- [ ] Every finding cites a specific checklist item ID (e.g., RCC1, BIC2, TCC4)
- [ ] Criteria cross-check performed: pass/fail criteria from test plan compared to reported results for all FAIL cases, all P0 cases, and ≥10% of PASS cases
- [ ] Any discrepancy between reported value and test plan threshold flagged — no assumptions made about criteria relaxation
- [ ] Coverage gaps identified: test plan items with no corresponding result in the report
- [ ] Every FAIL finding has a proposed resolution path
- [ ] Review report saved to `docs/reviews/[project]-test-report-review-[YYYY-MM-DD].md`

## Interaction with Other Skills

- **`spec-authoring`**: If the review finds that the test plan's pass/fail criteria are ambiguous or unverifiable (making criteria cross-check impossible), the test plan may need to be regenerated with quantified criteria.
- **`traceability-matrix`**: If the review surfaces extensive coverage gaps (many test plan items missing from the report), run traceability-matrix to quantify the full gap and generate the action items.
- **`design-review`**: If the test report reveals a pattern of failures that suggest a design issue (not a test execution issue), run design-review on the affected architecture area.
- **All upstream skills**: A test report review that finds criteria violations or coverage gaps may trigger rework in design, spec, or test planning phases.

## After This Skill

Once the test report review is saved to `docs/reviews/`:

| Next Step | Skill | What It Produces |
|-----------|-------|-----------------|
| **If all tests pass** | `release-review` | Proceed to release readiness review |
| **If findings require fixes** | (upstream skill) | Address test failures and re-execute affected test cases |
| **Final validation** | `traceability-matrix` | Verify complete REQ→TEST→REPORT chain with pass/fail traceability |

**Pipeline mode**: After this skill completes, the conductor will detect `docs/reviews/` and offer `traceability-matrix` as the Validate-phase step.

## See Also

- `references/solution-test-report-checklist.md` — Solution-level test report checklist (CIC, BIC, RTC, RNC, RCC)
- `references/software-qualification-test-review-checklist.md` — Software qualification test review checklist (CIC, BIC, TCC)
- `references/software-integration-test-review-checklist.md` — Software integration test review checklist (CIC, BIC, TCC)
