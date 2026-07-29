---
name: code-static-review
description: 代码静态审查：对照公司编码规范检查源代码，覆盖代码层次、排版、注释、命名、设计和寄存器定义六大类。Source code static review — checks source code for compliance across six categories: code hierarchy, layout, annotation, naming, design, and register definitions. Use when the user says 代码审查, 静态检查, 代码规范检查, code review, static analysis, coding standard, or when source code needs compliance checking before check-in or at code freeze. NOT for reviewing design documents (use design-review or requirements-review).
---

# Code Static Review

## Overview

A static code review verifies that source code conforms to the company coding standards — before it reaches peer review, integration testing, or release. Unlike a design review (which asks "is the design correct?"), a static review asks "does this code follow the rules?" The rules are prescribed by the Software Static Review Checklist: line length, indentation, brace style, naming conventions, annotation format, function structure, register definition patterns, and more.

This skill reads source files against the checklist item by item, records every violation with a traceable citation (checklist ID + file:line), and produces a compliance report. Unclear cases are flagged for SME review rather than guessed. The review is scoped explicitly to the files the user specifies — no architecture documents, no requirements, no test plans.

## When to Use

- Source code is ready for peer review and needs a standards-compliance pass first
- A module is approaching code freeze and requires a formal static review checkpoint
- New team members have contributed code that must be checked against company conventions
- A legacy module is being brought under current coding standards for the first time
- Pre-commit or pre-merge compliance verification is required by the project workflow
- Register header files need verification against the register definition rules (RDC section)

**When NOT to use:**

- Reviewing design documents, requirements, or specifications (use `design-review`)
- Functional correctness testing or logic verification (this skill checks form, not behavior)
- Performance profiling, memory analysis, or dynamic analysis (out of scope)
- Reviewing documentation, build scripts, or non-code artifacts (the checklist covers C source and header files)
- When the user has not supplied specific source files to review (scope is mandatory — see Step 1)

## The Process

```
SCOPE → CATEGORIZE → CHECK → REPORT
  │         │          │        │
  ▼         ▼          ▼        ▼
Confirm   Map files  Run each   Produce
which     to check-  checklist  compliance
files     list sec-  item per   report at
to review tions      file       docs/reviews/
```

### Step 1: SCOPE — Confirm exactly which source files to review

Before touching any file, establish an explicit list of source files under review. This is a hard gate — do not proceed without user confirmation.

```
STATIC REVIEW SCOPE:
Source files: [list each file with full path]
Checklist:    references/software-static-review-checklist.md
Sections:     [ ] All sections (0.0–5.0) — default
              [ ] Subset: [specify — e.g., "1.0 Layout + 3.0 Naming only"]
Output:       docs/reviews/[module]-static-review-[YYYY-MM-DD].md
→ Confirm scope before proceeding.
```

If the user provides a directory instead of individual files, list the source files found and ask the user to confirm or narrow the list. Do NOT assume — a missing file is a missed violation.

**Context boundary (enforced):** This skill reads ONLY two things:
1. The source files listed in the confirmed scope
2. `references/software-static-review-checklist.md`

Do NOT read architecture documents, requirements documents, design specifications, test plans, or any other reference. Static review is self-contained — the checklist is the sole authority.

### Step 2: CATEGORIZE — Map each file to applicable checklist sections

Not every checklist section applies to every file. Before checking, determine applicability:

| Section | ID prefix | Applies to |
|---------|-----------|------------|
| 0.0 Code Hierarchy Check | CHC | All .c and .h files |
| 1.0 Code Layout Check | CLC | All .c and .h files |
| 2.0 Code Annotation Check | CAC | All .c and .h files |
| 3.0 Code Naming Check | CNC | All .c and .h files |
| 4.0 Code Design Check | CDC | All .c and .h files (module-scope items may reference the module as a whole) |
| 5.0 Register Define Check | RDC | Header files containing register definitions ONLY |

Mark sections that do not apply with "N/A — [reason]" in the report. This shows the section was considered, not skipped.

### Step 3: CHECK — Evaluate each file against each applicable checklist item

For each file in scope, evaluate it against every applicable checklist item from the confirmed sections. Work item by item, not file by file — this ensures consistent application of each rule across all files.

**For each checklist item, record one of four outcomes:**

| Outcome | Meaning | Action |
|---------|---------|--------|
| **Compliant** | The file follows the rule | No action; note as "OK" in the report |
| **Violation** | The file clearly breaks the rule | Record with exact file:line, checklist ID, and description |
| **Not Applicable** | The rule does not apply to this file (e.g., register rules in a .c file that defines no registers) | Note as "N/A" with brief reason |
| **Needs SME Review** | The pattern is ambiguous — you cannot confidently determine compliance or violation | Flag for human review; do NOT guess |

**Anti-hallucination rule:** If you are uncertain about whether a code pattern violates a standard, you MUST classify it as "Needs SME Review." Never guess compliant or non-compliant. A false pass hides a real violation; a false flag wastes reviewer time. When in doubt, escalate.

**Evidence requirement:** Every violation and every "Needs SME Review" entry must cite:
- The checklist item ID (e.g., `CLC1`, `CDC2`, `RDC3`)
- The exact file path and line number
- The relevant code snippet (quoted, not paraphrased)

**Common violations by section (pattern recognition guide):**

- **CHC1–CHC2**: Missing or malformed module directory structure; files not following the prescribed hierarchy; incorrect file-to-file include relationships
- **CLC1**: Lines exceeding 120 characters
- **CLC2**: Indentation not 4 spaces per level
- **CLC4**: Complex expressions missing parentheses; macros without parenthesized arguments
- **CLC6**: Magic numbers used directly instead of named constants
- **CLC7–CLC10**: if/switch/for/while statements not following the prescribed brace-and-spacing format
- **CLC11**: Compiler-specific or platform-specific keywords used without abstraction
- **CLC14**: Numeric literals missing the `U` suffix for unsigned types
- **CLC16**: Missing or incomplete file header template
- **CAC1**: Single-line comments using `//` instead of `/* */`
- **CAC2**: Dead code commented with `/* */` instead of `#if 0`
- **CAC3–CAC5**: Missing comments on globals, structs, enums, empty bodies, or function definitions
- **CNC1**: Non-descriptive symbol names (single letters, abbreviations without obvious meaning)
- **CNC2–CNC8**: Naming that violates the prescribed convention for its symbol category
- **CDC1**: Module lacks an initialization function or does not track init state
- **CDC2**: Service-layer function does not validate all input parameters
- **CDC3**: Module header missing version macro (`<Module>_VERSION`)
- **CDC7**: Local variables declared mid-function instead of at function top
- **CDC9**: Compiler warnings present in submitted code
- **RDC1–RDC5**: Register definitions not following the two-layer union/bitfield pattern, missing reserved field naming, incorrect base-address or offset conventions

This is not an exhaustive list — every item in the checklist must be evaluated, not just the common ones.

### Step 4: REPORT — Produce the compliance report

Assemble findings into a structured report.

## Output

A static review report saved to `docs/reviews/[module]-static-review-[YYYY-MM-DD].md`:

```markdown
# Static Code Review Report

## Review Metadata
| Field | Value |
|-------|-------|
| Module / Scope | [module name or description] |
| Files Reviewed | [N] files — [list file paths] |
| Review Date | [YYYY-MM-DD] |
| Checklist Version | A01 (2024/01/29) |
| Checklist Reference | references/software-static-review-checklist.md |
| Sections Applied | [list — e.g., "All sections (0.0–5.0)"] |

## Summary
| Metric | Count |
|--------|-------|
| Total checklist items evaluated | [N] |
| Compliant | [N] |
| Violations found | [N] |
| Needs SME Review | [N] |
| Not Applicable | [N] |

## Section 0.0: Code Hierarchy Check

### CHC1 — Module software structure conforms to development standards
| File | Outcome | Detail |
|------|---------|--------|
| src/module.c | Compliant | — |
| src/module.h | Compliant | — |

### CHC2 — File reference relationships conform to development standards
| File | Outcome | Detail |
|------|---------|--------|
| ... | ... | ... |

[... continue for each checklist item in each applicable section ...]

## Violations Detail

| ID | File:Line | Checklist Item | Description |
|----|-----------|----------------|-------------|
| V-001 | src/adc.c:47 | CLC1 | Line exceeds 120 characters (current: 134 chars). `uint32_t adc_channel_config = ADC_ChannelConfig(ADC_CHANNEL_0, ADC_RESOLUTION_12BIT, ADC_SAMPLING_RATE_HIGH, ADC_TRIGGER_SOFTWARE);` |
| V-002 | src/adc.c:89 | CLC6 | Magic number used directly: `if (timeout > 5000)`. Replace with named constant. |
| V-003 | src/timer.h:23 | CAC1 | Comment uses `//` instead of `/* */`: `// Timer callback function pointer` |
| V-004 | src/timer.c:156 | CDC7 | Variable `uint8_t retry_count` declared after executable statements at line 152. All local variables must be declared at function top. |
| ... | ... | ... | ... |

## Needs SME Review

| ID | File:Line | Checklist Item | Description | Why Uncertain |
|----|-----------|----------------|-------------|---------------|
| SME-001 | src/dma.c:203 | CLC11 | `__attribute__((packed))` used on struct `dma_descriptor_t`. This is a compiler-specific keyword — unclear whether the project's abstraction layer covers this case. | The checklist prohibits direct use of compiler-specific keywords, but the project may have a sanctioned wrapper that was not found in the reviewed files. Needs SME to confirm whether a project-level abstraction exists. |
| ... | ... | ... | ... | ... |

## Not Applicable Items

| Section | Item | Reason |
|---------|------|--------|
| 5.0 Register Define Check | RDC1–RDC5 | No register definition headers in the reviewed file set |

## Review Conclusion

- [ ] All violations resolved — ready for peer review
- [ ] Minor violations remain — acceptable for this phase with documented waivers
- [ ] Critical violations present — do not proceed to peer review until resolved
- [ ] SME review items pending — require human judgment before closure

Next step: [recommendation — e.g., "Fix V-001 through V-007, then request SME review for SME-001 and SME-002"]
```

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "This is just formatting — the code works" | Coding standards exist so that every engineer can read every module. A working module that only the author can read is a bus factor of one. Formatting violations are cheap to fix and expensive to accumulate. |
| "The checklist is too strict for this small file" | Standards do not have a minimum file size. A 20-line header with a naming violation causes the same integration confusion as a 2000-line file. Apply the checklist uniformly. |
| "I can tell this is compliant without checking every item" | That is how violations ship. The checklist exists because humans are bad at noticing pattern deviations without systematic checking. Work item by item. |
| "The register definition rules only matter for the hardware abstraction layer" | Register definition errors propagate to every driver that touches that peripheral. The RDC section is there because register layout mistakes are among the hardest bugs to debug — they look like logic errors but are actually data structure errors. |
| "Uncertain items should be marked compliant — we can fix them later if needed" | Marking an uncertain item as compliant is a false negative. The SME review category exists precisely for this case. Use it. The cost of a false negative (shipped violation) far exceeds the cost of a human check. |

## Red Flags

- Reviewing files before the user has explicitly confirmed the file list (Step 1 is a hard gate)
- Reading architecture documents, requirements, or test plans during the review (context boundary violation)
- Skipping checklist items because "this section probably doesn't apply" without verifying (apply systematically, then mark N/A with reasons)
- Guessing compliant/non-compliant on ambiguous patterns instead of flagging "Needs SME Review" (anti-hallucination rule)
- Reporting a violation without a file:line citation (unverifiable finding)
- Reporting a violation without the checklist item ID (untraceable to the standard)
- Treating all violations as equally severe — a missing init function (CDC1) is more consequential than a one-character line-length overflow (CLC1). Reflect severity in the conclusion.
- Recommending "proceed to peer review" when "Needs SME Review" items remain unresolved
- Reviewing files not in the confirmed scope (scope creep)

## Verification

Before closing the review, confirm:

- [ ] Scope (exact file list, checklist sections, output path) explicitly confirmed with user
- [ ] Only source files in scope and the static review checklist were read — no architecture, requirements, or test documents
- [ ] Every checklist item in the confirmed sections evaluated for every file in scope
- [ ] Every violation cites the checklist item ID and exact file:line
- [ ] Every "Needs SME Review" entry explains why the pattern is ambiguous
- [ ] No guesses made on compliance — uncertain items routed to SME review
- [ ] Sections that do not apply to the reviewed files are marked N/A with reasons
- [ ] Violation severity reflected in the review conclusion (not all violations are equal)
- [ ] Report saved to `docs/reviews/` with the prescribed naming convention
- [ ] Review conclusion states a clear next step (fix, escalate, or proceed)

## After This Skill

Once the static review report is saved to `docs/reviews/`:

| Next Step | Skill | What It Produces |
|-----------|-------|-----------------|
| **If findings require fixes** | (developer) | Fix the code issues identified in the review, then re-run |
| **If code is clean** | `traceability-matrix` | Cross-artifact validation of the full chain |
| Further reviews | `test-plan-review` / `test-report-review` | Continue with test artifact reviews if relevant |

**Pipeline mode**: After this skill completes, the conductor will detect `docs/reviews/` and offer `traceability-matrix` as the Validate-phase step.

## See Also

- `design-review` — For adversarial, cross-department review of SE design artifacts (requirements, architecture, specifications). Use design-review for design correctness; use code-static-review for coding standard compliance.
- `references/software-static-review-checklist.md` — The authoritative checklist. Every finding in this skill traces to an item in that document.
- For requirements analysis criteria, see `references/software-requirements-analysis-checklist.md`
- For architecture design criteria, see `references/software-architecture-design-checklist.md`
