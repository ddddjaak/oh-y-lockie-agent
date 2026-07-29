---
description: Run adversarial cross-department design review — four parallel fresh-context reviewers (HW, SW, Test, System lenses) examine an SE artifact for gaps, inconsistencies, and unstated assumptions
agent: build
---

Invoke the design-review skill.

Work through the four-step process:
1. SCOPE — confirm the artifact to review, review depth (quick scan / standard / exhaustive), focus areas, and which lenses to use
2. LENS-REVIEW — spawn four parallel adversarial reviewers (HW, SW, Test, System), each receiving ONLY the artifact with a department-specific "find issues" prompt. Reviewers do not see each other's output
3. RECONCILE — classify every finding using precedence: artifact misread → actionable → trade-off → noise. Surface cross-lens tensions (where two lenses disagree with each other) — these are the highest-value outputs
4. REPORT — produce structured review report with actionable findings, trade-off findings, cross-lens tensions, and resolution tracking table

Save the output to docs/reviews/[project]-[artifact]-review-[YYYY-MM-DD].md.
