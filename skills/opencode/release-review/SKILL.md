---
name: release-review
description: 发布就绪审查：交叉检查发布包（二进制、发布说明、版本清单、测试报告）的完整性和可追溯性。Release readiness gate review — cross-references the release package (binary, release notes, version manifest, test reports) against structured checklists for completeness and traceability. Use when the user says 发布审查, 发布就绪, 版本发布审查, release review, release readiness, or when a release candidate must be verified before external distribution. NOT for reviewing individual artifacts (use design-review for architecture/specs, test-report-review for test results).
---

# Release Review

## Overview

A release package that "looks complete" often is not. The binary boots but the version manifest is stale. The test report says "all passed" but 3 test cases were skipped without justification. The release notes mention new features but omit known regressions. These gaps are invisible to a quick sanity check and devastating when the release reaches a customer.

This skill performs a systematic, checklist-driven release readiness review: inventory every artifact, verify internal consistency (do versions match? do test results trace to requirements?), and cross-reference against two structured checklists. The output is a release review report that gives the release owner a concrete list of what must be fixed before the release can ship — and what can be accepted as a known trade-off.

This skill is the release-phase counterpart to `design-review`: it is adversarial review applied to the release package, not the design artifact.

## When to Use

- A release package has been assembled (binary, release notes, version manifest, test reports) and the team needs a gate review before external distribution
- Preparing for a milestone release sign-off (Alpha, Beta, RC, GA)
- A release candidate has been cut and must be verified for completeness, consistency, and traceability
- A previous release had a field issue and the team wants a structured review before the next release
- A downstream consumer (FAE, customer, manufacturing) reports that the release package is incomplete or inconsistent

**When NOT to use:**

- The release package has not been assembled yet (checklist items will all read "N/A" — wait until the package exists)
- Reviewing a single hotfix patch without a full release package (use `design-review` for the patch diff)
- Source-level code review (use a code review process, not release readiness review)
- Requirements or architecture review (use `requirements-decompose`, `architecture-design`, or `design-review`)
- Pure information lookup ("what version is the SPI driver binary?" — check the manifest directly)

## The Process

```
INVENTORY ──→ CHECKLIST ──→ FINDINGS ──→ REPORT
    │             │              │            │
    ▼             ▼              ▼            ▼
  Catalog     Cross-ref      Classify      Produce
  every       against both   findings      release
  artifact    checklists     by severity   review
```

### Step 1: INVENTORY — Catalog every release artifact

Before any checklist evaluation, enumerate every artifact in the release package. This is the anti-hallucination gate: do not reason about artifacts you have not seen.

```
RELEASE ARTIFACT INVENTORY:
1. Binary / Executable:     [filename, format (HEX/BIN/ELF), size, build timestamp]
2. Version Manifest:        [filename, stated version, date, list of components and their versions]
3. Release Notes:           [filename, version, date, list of changes / fixes / known issues]
4. Test Reports:            [list of filenames, test types (unit/integration/system/acceptance), dates, pass/fail/skip counts]
5. Source Code Package:     [archive name, version tag, commit hash if available]
6. User / Integration Guide:[filename, version if any]
7. Test Tools / Scripts:    [list if included]
8. Other:                   [any additional artifacts]
→ Confirm with user: Is this the complete release package? Anything missing?
```

**Version consistency check (CRITICAL — do NOT skip):** Compare the version declared in the version manifest against the version metadata embedded in each binary. If the binaries expose version strings, build IDs, or metadata headers, read them. If the version manifest says v2.1.3 but binary metadata says v2.1.2, flag as CRITICAL — do NOT assume which is correct. The mismatch itself is the finding. Both could be wrong. The release owner must resolve it.

```
VERSION CONSISTENCY:
Manifest declares:     v2.1.3
Binary metadata says:  v2.1.2  ← CRITICAL: version mismatch
Binary metadata says:  v2.1.3  ← OK: consistent
Binary has no embedded version metadata ← WARNING: cannot verify, flag as informational
```

### Step 2: CROSS-REFERENCE — Checklist-driven review

Evaluate the release package against two structured checklists. Load them from the references directory (do not reproduce their full content inline):

**Primary checklist:** `references/solution-software-release-review-checklist.md`

This covers four domains:

| Domain | What It Checks |
|--------|---------------|
| 1.0 Requirements Coverage | Are all requirements implemented? Are unimplemented items documented and agreed? |
| 2.0 Test Coverage | Did dev self-test and solution test both achieve 100% coverage? Is coding standard compliance verified? |
| 3.0 Issue Tracking | Are historical defects from similar projects mitigated? Are all critical and severe bugs closed? |
| 4.0 Release Content | Source code, binaries, release notes, test report, user guide, test tools — all present and clear? |

**Supplementary checklist:** `references/solution-mass-production-test-strategy-checklist.md`

This covers five domains relevant when the release is headed for mass production:

| Domain | What It Checks |
|--------|---------------|
| 1.0 Configuration Items | Are communication records, HW/SW technical requirements, and design specifications present? |
| 2.0 Basic Information | Are referenced document versions recorded? Are test chapters complete? |
| 3.0 Requirement Traceability | Does every test item trace to a product characteristic? Any gaps? |
| 4.0 Test Analysis | Does analysis cover interfaces, functions, and performance characteristics? |
| 5.0 Test Design Classification | Do test designs map to test analysis? Are test designs actionable? |

**How to cross-reference:** For each checklist item, read the release artifact that provides the evidence and record a status:

- **OK** — The artifact provides a clear, verifiable answer.
- **GAP** — The artifact does not address this item, or the answer is insufficient.
- **N/A** — This item does not apply to this release type (e.g., mass-production checklist items for an Alpha release).

Every GAP becomes a finding. Every OK needs a citation to the specific artifact, section, or line that substantiates it — do not mark OK on assumption.

### Step 3: FINDINGS — Classify every issue

For every GAP identified in Step 2, classify by severity using this precedence order:

1. **CRITICAL** — Blocks release. Version mismatch, missing mandatory artifact, test failures not resolved, critical/blocker bugs still open, requirement coverage below 100% without documented agreement.
2. **HIGH** — Should block release unless explicitly waived. Known issues not documented in release notes, test coverage gaps > 5%, missing optional but expected artifacts, ambiguous release notes that could mislead downstream consumers.
3. **MEDIUM** — Should be fixed in the next release. Minor documentation gaps, non-critical checklist items with insufficient evidence, version metadata not embedded in binary.
4. **LOW / INFORMATIONAL** — Noted for awareness. Minor formatting issues, suggestions for improvement, historical defect patterns that are not applicable but worth monitoring.

**Cross-checklist elevation:** When the same finding surfaces from both checklists independently, elevate severity by one level. Two independent checklists converging on the same gap is high-confidence signal.

### Step 4: REPORT — Produce the release review report

Assemble findings into a structured report saved to `docs/reviews/[project]-release-review-[YYYY-MM-DD].md`.

## Output

A release review report saved to `docs/reviews/[project]-release-review-[YYYY-MM-DD].md`:

```markdown
# Release Review Report

## Review Metadata
| Field | Value |
|-------|-------|
| Release Package | [project/release name] |
| Target Version | [version from manifest] |
| Review Date | [YYYY-MM-DD] |
| Reviewer | Release Review (automated) |
| Checklists Used | solution-software-release-review-checklist, solution-mass-production-test-strategy-checklist |
| Total Findings | [N] — [A] CRITICAL, [B] HIGH, [C] MEDIUM, [D] LOW |

## Artifact Inventory
| # | Artifact | Filename | Version / Date | Status |
|---|----------|----------|---------------|--------|
| 1 | Binary | [name] | [version metadata] | [Present / Missing] |
| 2 | Version Manifest | [name] | [stated version] | [Present / Missing] |
| 3 | Release Notes | [name] | [date] | [Present / Missing] |
| 4 | Test Reports | [list] | [dates, pass/fail counts] | [Present / Missing] |

## Version Consistency
| Check | Result |
|-------|--------|
| Manifest version vs Binary metadata | [OK / MISMATCH — details] |
| Manifest version vs Release Notes version | [OK / MISMATCH — details] |
| Manifest version vs Test Report target version | [OK / MISMATCH — details] |

## Checklist Results

### Release Review Checklist
| Item | Domain | Status | Evidence |
|------|--------|--------|----------|
| 1.0 Requirements Coverage | Design goals listed | OK / GAP | [citation] |

### Mass Production Test Strategy Checklist
| Item | Domain | Status | Evidence |
|------|--------|--------|----------|

## Findings

### CRITICAL — Blocks Release
| ID | Checklist(s) | Description | Evidence | Required Action |
|----|-------------|-------------|----------|-----------------|
| RR-001 | Release 3.0 + MP 3.0 | Version manifest declares v2.1.3; binary metadata reads v2.1.2. Cannot determine which is correct. | Manifest §1, Binary header offset 0x100 | Resolve version mismatch; re-build or re-tag; re-verify |

### HIGH — Should Block Unless Waived
| ID | Checklist(s) | Description | Evidence | Required Action |
|----|-------------|-------------|----------|-----------------|

### MEDIUM — Fix in Next Release
| ID | Checklist(s) | Description | Evidence | Required Action |
|----|-------------|-------------|----------|-----------------|

### LOW / INFORMATIONAL
| ID | Checklist(s) | Description | Evidence |
|----|-------------|-------------|----------|

## Release Recommendation
- [ ] **GO** — Release is ready. No CRITICAL or HIGH findings.
- [ ] **CONDITIONAL GO** — Release is ready after [N] CRITICAL / [M] HIGH findings are resolved (see resolution tracking).
- [ ] **NO-GO** — Release is not ready. Fundamental issues require rework before re-review.

## Resolution Tracking
| Finding ID | Severity | Resolution | Resolved By | Date |
|------------|----------|------------|-------------|------|
| RR-001 | CRITICAL | [to be filled] | | |
| ... | ... | ... | | |
```

## Context Boundary

**What this skill reads:**
- Release artifacts (binary, release notes, version manifest, test reports)
- The two release review checklists from `references/`

**What this skill does NOT read:**
- Design documents (architecture specs, requirements documents, interface specifications)
- Source code (unless the release package includes it and a checklist item requires verifying it)
- Upstream or downstream artifacts outside the release package

**Exception:** If a finding cannot be resolved from release artifacts alone and requires tracing back to a design document or requirement, surface the finding with the traceback noted as incomplete. Flag it as requiring the release owner to provide the design-document evidence. Do NOT autonomously pull design documents into scope — the release review is about the release package, not the entire project history.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The test team said everything passed — that is enough" | Test reports say what was tested, not what was skipped. A 100% pass rate on 80% coverage is a 20% gap, not a clean bill of health. The checklist forces you to read the coverage, not just the pass rate. |
| "The version manifest is auto-generated, it must be correct" | Auto-generated manifests are only as correct as the build pipeline that produced them. If the pipeline tagged the wrong commit or pulled a stale binary, the manifest is wrong with full automation. Verify, do not trust. |
| "Known issues are in the bug tracker, not the release notes — that is fine" | Downstream consumers (customers, FAEs, manufacturing) do not have access to your bug tracker. Known issues not in the release notes are unknown issues to everyone outside the dev team. |
| "It is an Alpha release — the mass production checklist does not apply" | Correct — mark MP items N/A explicitly. But do not skip the checklist entirely. Some MP items (traceability, configuration management) are valuable even at Alpha. Explicit N/A is a decision; skipping is an oversight. |
| "Version mismatch is probably just a build timestamp difference" | "Probably" is not a verification result. Flag the mismatch as CRITICAL and let the release owner determine the root cause. Guessing "it is fine" is how mismatched versions ship. |
| "The checklists are too detailed for a small release" | Checklists are minimum bars, not maximum bars. A small release may legitimately skip sections — mark them N/A with a one-line justification. That takes less time than defending why the checklist does not apply. |

## Red Flags

- Proceeding to checklist evaluation before completing the artifact inventory (you cannot check what you have not cataloged)
- Marking checklist items OK without citing specific evidence from a release artifact (assumption, not verification)
- Ignoring version mismatches between manifest and binary metadata — flag as CRITICAL, do not "probably" them away
- Accepting "all tests passed" without checking the total test count, skip count, and coverage percentage
- Reviewing release notes for formatting but not for content — a well-formatted release note that omits a known regression is worse than no release note
- Skipping the supplementary mass-production checklist because "we are not in MP yet" — mark items N/A, do not skip the checklist
- Producing findings with no required action (a finding without a fix path is a complaint, not a review)
- Recommending GO when CRITICAL or HIGH findings remain unresolved

## Verification

Before closing the review, confirm:

- [ ] Every release artifact in the package inventoried with filename, version, and date
- [ ] Version consistency checked: manifest version vs binary metadata vs release notes version vs test report target version
- [ ] Version mismatches flagged as CRITICAL with specific evidence (which binary, which offset, which string)
- [ ] Both checklists (`solution-software-release-review-checklist.md` and `solution-mass-production-test-strategy-checklist.md`) referenced and evaluated
- [ ] Every checklist item has a status (OK / GAP / N/A) with evidence citation for every OK
- [ ] Every GAP classified by severity using the precedence order (CRITICAL → HIGH → MEDIUM → LOW)
- [ ] Cross-checklist findings elevated in severity where applicable
- [ ] Every CRITICAL and HIGH finding has a required action
- [ ] Release recommendation (GO / CONDITIONAL GO / NO-GO) explicitly stated
- [ ] Report saved to `docs/reviews/` with project name and date in filename
- [ ] Resolution tracking table initialized (empty, to be filled as findings are addressed)

## After This Skill

Once the release review report is saved to `docs/reviews/`:

| Next Step | Skill | What It Produces |
|-----------|-------|-----------------|
| **If release is approved** | (release) | Proceed with external distribution — binaries, release notes, version manifest |
| **If findings require fixes** | (upstream skill) | Address issues identified in review and re-submit |
| **Final validation** | `traceability-matrix` | Verify complete REQ→DESIGN→TEST→RELEASE chain closure |

**Pipeline mode**: After this skill completes, the conductor will detect `docs/reviews/` and offer `traceability-matrix` as the Validate-phase step.

## See Also

- `references/solution-software-release-review-checklist.md` — Primary release review checklist (4 domains: requirements coverage, test coverage, issue tracking, release content)
- `references/solution-mass-production-test-strategy-checklist.md` — Supplementary checklist for mass-production readiness (5 domains: configuration items, basic info, traceability, test analysis, test design)
- `design-review` — For adversarial review of design artifacts (architecture, specifications) before they feed into the release
- `traceability-matrix` — For verifying cross-artifact traceability before release (requirements → design → test)
