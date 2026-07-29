---
name: traceability-matrix
description: 追溯矩阵：构建并验证跨所有SE产物的追溯链——原始需求→系统需求→设计元素→测试用例。识别覆盖缺口、孤立设计元素和未测需求。Traceability matrix — builds and validates the traceability chain across all SE artifacts: Raw Requirements to System Requirements to Design Elements to Test Cases. Identifies coverage gaps, orphaned design elements, and untested requirements. Use when the user says 追溯, 追溯矩阵, 覆盖缺口, 追溯链, traceability, coverage gap, gap analysis, or after completing any SE artifact to verify cross-artifact integrity. Can and should be run after every phase, not just at the end.
---

# Traceability Matrix

## Overview

Every SE artifact references other artifacts. Requirements reference their sources. Architecture elements reference their requirements. Specifications reference their architecture. Test cases reference their requirements. These references form a chain. When the chain is intact, you can answer "if we change X, what breaks?" by following the links. When the chain is broken, you discover the breakage during integration testing — or worse, in the field.

This skill extracts all references from all SE artifacts, builds the complete traceability graph, identifies every broken link and uncovered node, and produces a report that tells you exactly what is missing. It runs across artifacts rather than producing one — it is the quality assurance step of the SE workflow, the "lint" that verifies every requirement has a design, every design element is tested, and every test validates something required.

## When to Use

- After completing any SE artifact — to verify that it properly links to upstream and downstream artifacts
- Before a milestone review (requirements freeze, design freeze, test readiness) — to produce the formal traceability evidence
- When scope changes — to assess which design elements and test cases are affected by a requirement change
- After a `design-review` resolution — to verify that fixes have not broken traceability links
- Auditing or certification requires formal traceability documentation
- Integrating artifacts from multiple authors — to verify cross-author consistency

**When NOT to use:**

- No SE artifacts exist yet (run the upstream skills first)
- The change to an artifact is purely editorial (typo fix, reformatting — reference IDs unchanged)
- There is only one artifact (traceability requires at least two artifacts to trace between)
- The user explicitly asks for a quick coverage check (do it manually, don't invoke the full skill)

## The Process

```
EXTRACT ──→ LINK ──→ COVERAGE ──→ GAP-ANALYSIS ──→ REPORT
    │          │          │             │              │
    ▼          ▼          ▼             ▼              ▼
  Parse all  Build     Calculate      Identify       Produce
  artifact   trace     coverage       orphans,       traceability
  references chains    metrics        gaps, &        report
                                      over-coverage
```

### Step 1: EXTRACT — Parse all reference IDs from all artifacts

Inventory every SE artifact and extract every reference ID it contains:

```
ARTIFACT INVENTORY:
1. System Requirements: docs/requirements/project-x-sysreq.md v1.2
   → Defines: SYS-REQ-001 through SYS-REQ-025
   → References: PRD §1-§5, Datasheet §2-§8

2. Architecture Design: docs/architecture/project-x-arch.md v1.1
   → Defines: MOD-01 through MOD-12, CON-001 through CON-015, IF-001 through IF-023
   → References: SYS-REQ-001 through SYS-REQ-023, HW-REQ-001 through HW-REQ-008

3. Software Outline Design: docs/spec/project-x-sod-power.md v1.0
   → Defines: FEAT-001 through FEAT-012
   → References: MOD-01, MOD-02, IF-001 through IF-006, SYS-REQ-001 through SYS-REQ-008

4. HW-SW Interface Spec: docs/spec/project-x-hwsw-if.md v1.0
   → Defines: (pins, registers, interrupts — numbered by section)
   → References: MOD-01 through MOD-12, CON-001 through CON-012

5. Test Plan: docs/spec/project-x-test-plan.md v1.0
   → Defines: TC-001 through TC-035
   → References: SYS-REQ-001 through SYS-REQ-020, HW-REQ-001 through HW-REQ-005

→ Confirm: are these all the artifacts? Any missing?
```

**Extraction rules:**
- System Requirements: extract all REQ-IDs defined in the document, and all source references they point to
- Architecture Design: extract all MOD-IDs, CON-IDs, and IF-IDs defined; extract all REQ-IDs they reference
- Specifications (SOD, HW-SW IF): extract all REQ-IDs, MOD-IDs, IF-IDs, and CON-IDs they reference
- Test Plan: extract all TC-IDs defined; extract all REQ-IDs they reference
- If an artifact references an ID with an ambiguous format, surface the ambiguity — do not guess the match

### Step 2: LINK — Build the traceability graph

Construct the full traceability chain:

```
Raw Source ──→ System Requirement ──→ Architecture Element ──→ Design Element ──→ Test Case
    │                  │                      │                      │                │
 PRD §3.1          SYS-REQ-001           MOD-01                  SOD §4.2          TC-001
                                          MOD-02                  SOD §5.1          TC-002
                                          IF-001                  HW-SW IF §3       TC-003
                                          CON-001                                   TC-004
```

For each node, determine its status:

| Status | Meaning |
|--------|---------|
| ✅ Complete | The node has both upstream trace (what it satisfies) and downstream trace (what satisfies it) |
| ⚠️ Partial | The node has one direction but the other is incomplete (e.g., a requirement with test cases but no architecture element) |
| ❌ Orphan | The node has no trace in one or both directions |

### Step 3: COVERAGE — Calculate coverage metrics

Compute coverage for each traceability dimension:

```markdown
## Coverage Summary

| From | To | Coverage | Detail |
|------|----|----------|--------|
| Raw Sources | System Requirements | 15/15 (100%) | Every raw source section has at least one derived system requirement |
| System Requirements | Architecture Elements | 23/25 (92%) | SYS-REQ-018, SYS-REQ-022 have no architecture element |
| System Requirements | Test Cases | 21/25 (84%) | SYS-REQ-014, SYS-REQ-018, SYS-REQ-022, SYS-REQ-025 have no test case |
| Architecture Elements | Design Elements | 10/12 (83%) | MOD-07, MOD-12 have no SOD section |
| Architecture Elements | Test Cases | 8/12 (67%) | MOD-07, MOD-09, MOD-11, MOD-12 have no dedicated test |
| Test Cases | System Requirements | 35/35 (100%) | All test cases trace to at least one requirement |
```

**Important:** Coverage is directional. "Requirements → Architecture" (does every requirement have a design?) is different from "Architecture → Requirements" (does every design element satisfy a requirement?). Both matter; they answer different questions.

### Step 4: GAP-ANALYSIS — Identify orphans, gaps, and over-coverage

**Orphan detection — downstream missing:**

```
ORPHAN (no downstream trace):
SYS-REQ-018: "System shall log all power state transitions to internal flash"
  → No architecture element addresses this requirement.
  → No test case validates it.
  → Impact: Requirement will not be designed or tested.
  → Action: Architect a logging module (new MOD-XX) or assign to existing module.
```

**Orphan detection — upstream missing:**

```
ORPHAN (no upstream trace):
MOD-07 (Debug UART driver) — defined in architecture §3.7, referenced in SOD §8.
  → Traces to zero system requirements.
  → Impact: This module was built but no requirement asked for it. Either the
    requirement is missing (it should exist — debug UART is needed for bring-up)
    or the module is unnecessary.
  → Action: Add requirement SYS-REQ-026: "System shall provide debug UART output
    at 115200 baud for development and field diagnostics." Or justify why this
    module exists without a requirement.
```

**Coverage gaps:**

```
COVERAGE GAP:
SYS-REQ-014: "System shall enter deep sleep when idle > 5s"
  → Has architecture element (MOD-08 Power Management)
  → Has SOD section (§6.2 Deep Sleep Entry)
  → NO test case — untestable as specified.
  → Action: Add test case for deep sleep entry (verify current drop within 5s of
    idle) AND verify the requirement specifies how to measure "idle."
```

**Over-coverage:**

```
OVER-COVERAGE:
TC-042: "Verify SPI CRC error recovery with corrupted packet at 80% of transfer"
  → Tests a behavior not required by any specification.
  → Impact: Either (A) this tests undocumented required behavior — add a
    requirement, or (B) this tests unnecessary behavior — remove the test case.
  → GUESS: This is a valid robustness test that should be captured by a
    requirement. Add SYS-REQ-027: "System shall recover from SPI CRC errors
    without data loss or state corruption."
```

### Step 5: REPORT — Produce the traceability report

Assemble all findings into the traceability report.

## Output

A traceability report saved to `docs/traceability/[project]-traceability-[YYYY-MM-DD].md`:

```markdown
# Traceability Report: [Project Name]

## Report Metadata
| Field | Value |
|-------|-------|
| Date | [YYYY-MM-DD] |
| Analyzed By | traceability-matrix skill |
| Artifacts Analyzed | [list with paths and versions] |

## Traceability Matrix

| Raw Source | System Req | Arch Element | Design Element | Test Case(s) | Status |
|------------|-----------|-------------|---------------|-------------|--------|
| PRD §3.1 | SYS-REQ-001 | MOD-01 | SOD §4.2, HW-SW IF §3 | TC-001, TC-002, TC-003 | ✅ Complete |
| PRD §3.1 | SYS-REQ-002 | MOD-01, MOD-02 | SOD §4.3, §5.1 | TC-004, TC-005 | ✅ Complete |
| PRD §3.2 | SYS-REQ-003 | MOD-03 | SOD §4.5 | TC-006 | ⚠️ Partial — single test case for multi-rail requirement |
| Datasheet §5.1 | HW-REQ-003 | — | — | — | ❌ Orphan — no architecture, no test |
| — | — | MOD-07 | SOD §8 | — | ❌ Orphan — no requirement trace |
| PRD §4.1 | SYS-REQ-014 | MOD-08 | SOD §6.2 | — | ❌ Gap — no test case |
| PRD §5.3 | SYS-REQ-022 | — | — | — | ❌ Gap — no architecture, no test |
| ... | ... | ... | ... | ... | ... |

## Coverage Summary
[Table from Step 3]

## Gap Analysis

### Requirements Without Architecture Elements
| Req ID | Description | Severity | Recommendation |
|--------|-------------|----------|---------------|
| SYS-REQ-018 | Power state transition logging | High | Architect logging module or assign to existing MOD-04 (CABI — log via MCU) |
| SYS-REQ-022 | Deep sleep wake on GPIO edge | Critical | Architect wake-pin configuration in MOD-08 |
| ... | ... | ... | ... |

### Requirements Without Test Cases
| Req ID | Description | Priority | Recommendation |
|--------|-------------|----------|---------------|
| SYS-REQ-014 | Deep sleep entry on idle timeout | P1 | Add TC-036: measure current drop after 5s idle |
| SYS-REQ-025 | Watchdog triggers system reset | P0 | Add TC-037: verify reset within watchdog timeout |
| ... | ... | ... | ... |

### Orphaned Architecture Elements
| Element ID | Description | Location | Recommendation |
|------------|-------------|----------|---------------|
| MOD-07 | Debug UART driver | Arch §3.7 | Add requirement or document as infrastructure (not requirement-driven) |
| MOD-12 | LED controller | Arch §4.1 | Add requirement SYS-REQ-028 for LED behavior |
| ... | ... | ... | ... |

### Orphaned Test Cases
| TC-ID | Description | Recommendation |
|-------|-------------|---------------|
| TC-042 | SPI CRC error recovery | Add requirement for CRC error handling or remove test |
| ... | ... | ... |

### Over-Coverage
| Test Case | Tests Behavior | Source | Recommendation |
|-----------|---------------|--------|---------------|
| TC-042 | SPI CRC error recovery | No requirement | Add SYS-REQ-027 or remove TC-042 |
| ... | ... | ... | ... |

## Action Items
| ID | Description | Owner | Due | Priority |
|----|-------------|-------|-----|----------|
| AI-001 | Add architecture for SYS-REQ-022 (deep sleep wake) | [SE name] | [date] | Critical |
| AI-002 | Add test case for SYS-REQ-014 (deep sleep entry) | [Test lead] | [date] | High |
| AI-003 | Resolve MOD-07 orphan (add requirement or document infrastructure) | [SE name] | [date] | Medium |
| AI-004 | Resolve TC-042 orphan (add requirement or remove test) | [SE name] | [date] | Low |
| ... | ... | ... | ... | ... |

## Report Status
- [ ] All critical gaps assigned owners
- [ ] All orphans resolved or explicitly waived
- [ ] Coverage metrics meet project thresholds
- [ ] Report reviewed by SE lead
```

## Interaction with Other Skills

- **`requirements-decompose`**: If orphan requirements are found (no trace source), or if requirements reference sources that do not exist, invoke to add or correct requirements.
- **`architecture-design`**: If orphan architecture elements are found (no requirement trace), invoke to either add the missing requirement or remove the unnecessary module.
- **`spec-authoring`**: If test coverage gaps are found (requirement has no test case), invoke to generate the missing test cases.
- **`design-review`**: Run before or after design review. Before: identify traceability gaps so they are not re-discovered during review. After: verify that review-driven fixes have not broken traceability links.
- **All upstream skills**: This skill is the consumer of every other skill's output. It validates the cross-artifact integrity of the entire SE workflow. When it finds a gap, it invokes the relevant upstream skill to fill it.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "Traceability is just paperwork for auditors and certification" | Traceability is the only systematic way to answer "if we change X, what breaks?" without reading every document and holding a meeting. It is an engineering tool, not a compliance cost. |
| "100% coverage is impossible — don't bother measuring" | 100% is not the goal. Knowing *which* 15% is uncovered is the goal. The uncovered 15% is where field issues come from. |
| "I'll trace manually in a spreadsheet — it's more flexible" | Manual traceability drifts with every artifact update. An architecture change that renumbers MOD-IDs breaks every spreadsheet cell that references the old number. Automated extraction catches drift immediately. |
| "Orphans are fine — some things don't need traceability" | Some things genuinely do not need traceability (debug infrastructure, development tools). But "genuinely doesn't need it" should be an explicit decision, not a discovery during gap analysis. Every orphan should be either traced or explicitly waived with a reason. |
| "Coverage percentages are the deliverable" | Coverage percentages are a summary. The deliverable is the gap analysis — the list of specific, named things that are not covered, with owners and due dates. A 92% coverage number with no action items is a statistic, not a tool. |

## Red Flags

- Running traceability without version-pinning all input artifacts (version skew produces false gaps)
- Reporting coverage percentages without listing what is NOT covered (the missing items are the value, not the percentage)
- Treating orphan detection as a classification exercise rather than a trigger for action items (every orphan needs a resolution or an explicit waiver)
- Generating action items without owners and due dates (an action item with no owner is an observation, not an action)
- Accepting "we'll trace it later" without a specific milestone (traceability debt accumulates faster than technical debt)
- Artifacts that define IDs in incompatible formats (SYS-REQ-001 in one document, SYSREQ-001 in another) — surface and standardize the ID format
- Missing the directional nature of coverage (requirements→design is different from design→requirements; both matter)

## Verification

Before closing the traceability analysis, confirm:

- [ ] All SE artifacts inventoried with exact paths and version numbers
- [ ] Version alignment verified — all artifacts reference consistent versions of their upstream inputs
- [ ] Every reference ID extracted from every artifact
- [ ] Full traceability matrix built (not just requirements→tests, but all five levels)
- [ ] Coverage metrics calculated for all traceability dimensions (both directions)
- [ ] Every orphan identified and documented with a recommendation (not just listed)
- [ ] Every coverage gap has a corresponding action item
- [ ] Every over-coverage instance has a recommendation (add requirement or remove test)
- [ ] All action items have owners and due dates
- [ ] Report includes explicit waiver section for any gaps that are intentionally accepted
- [ ] Report saved to `docs/traceability/`

## After This Skill

Traceability is the final phase of the SE workflow. Once validated:

| If | Then |
|----|------|
| **Gaps found** | Re-run the relevant upstream skill (`requirements-decompose`, `architecture-design`, `spec-authoring`, etc.) to fill gaps, then re-run `traceability-matrix` to verify closure |
| **All gaps resolved** | The SE artifact chain is complete and verified — all artifacts trace from Raw Requirements → System Reqs → Design Elements → Test Cases |
| **Scope changed** | Re-run `traceability-matrix` for impact analysis — it will surface all affected artifacts from a single requirement ID change |

**Pipeline mode**: This is the final checkpoint. The conductor will report the chain status and offer to re-run any upstream skill needed to close remaining gaps.
