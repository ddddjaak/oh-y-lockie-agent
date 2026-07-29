---
description: Start architecture design — decompose system requirements into modules, define every interface, analyze cross-cutting constraints, and document trade-off decisions
agent: build
---

Invoke the architecture-design skill.

Prerequisites: structured system requirements must exist. If missing or incomplete, invoke requirements-decompose first.

Work through the five-step process:
1. DECOMPOSE — break the system into modules with single responsibilities, natural boundaries, and clear dependencies
2. INTERFACE — define every module dependency precisely: data format, timing, concurrency model, error handling, power-state behavior
3. CONSTRAINT — extract all cross-cutting constraints from requirements, assign to affected modules, surface conflicts
4. TRADE-OFF — for every non-trivial decision, document alternatives considered, rationale (citing specific requirement IDs), and accepted downsides
5. DOCUMENT — produce the complete architecture design document with block diagram, module definitions, interface specs, constraint analysis, trade-off records, and risk register

Save the output to docs/architecture/[project]-architecture-design.md after user confirmation.
