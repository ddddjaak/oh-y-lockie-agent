---
description: Author formal specifications — Software Outline Design (软件概要设计), HW-SW Interface Spec (软硬件接口规格), and Test Plan (测试方案) — from architecture and requirements
agent: build
---

Invoke the spec-authoring skill.

Prerequisites: architecture design and system requirements must exist. If missing, invoke architecture-design and/or requirements-decompose first.

Work through the five-step process:
1. SELECT — confirm which specification(s) to generate: Software Outline Design, HW-SW Interface Spec, Test Plan, or all three
2. GATHER — collect and version-verify all input artifacts; surface misaligned versions
3. GENERATE — author specification content following defined templates. Every claim must trace to a requirement ID or architecture interface ID. Enforce: numbers not adjectives, empty sections are errors, TBDs must have owners and due dates
4. CROSS-CHECK — verify internal consistency: all requirement references resolve, all interface definitions match architecture, no orphan content
5. FINALIZE — present for human review and sign-off

Save outputs to docs/spec/[project]-[spec-type].md after user confirmation.
