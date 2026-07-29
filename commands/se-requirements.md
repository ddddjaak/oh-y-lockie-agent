---
description: Start requirements decomposition — transform raw requirements (PRD, datasheet, standards, customer specs) into a structured, traceable system requirements document
agent: build
---

Invoke the requirements-decompose skill.

Begin by inventorying all raw input sources — PRD, chip datasheet, industry standards, customer specifications, reference designs. Surface the inventory to the user and ask if anything is missing.

Then work through the six-step process:
1. COLLECT — inventory all raw inputs with versions and dates
2. CLASSIFY — categorize every requirement by domain (HW/SW/System/Mechanical/Compliance) and type (Functional/Performance/Constraint/Interface/Safety)
3. RESOLVE — detect and surface conflicts, gaps, and ambiguities. For each, attach a GUESS with reasoning
4. DERIVE — generate testable system-level requirements from raw requirements
5. ASSIGN — assign every requirement an owner (who implements) and verifier (who tests)
6. VALIDATE — present the complete structured requirements document for human sign-off

Save the output to docs/requirements/[project]-system-requirements.md after user confirmation.
