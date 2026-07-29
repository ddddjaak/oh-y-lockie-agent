---
description: Autonomous goal-driven SE workflow — give a clear end-goal and the AI runs the full Define → Design → Document → Verify → Validate chain without per-phase prompts. Self-corrects on review failures. Escalates only when genuinely stuck.
agent: build
---

# /se-goal — Autonomous SE Workflow

## Overview

This command triggers **Autonomous Goal Mode**. You give a clear end-goal, and the AI runs the complete SE workflow chain autonomously — requirements decomposition → architecture design → specification authoring → adversarial review → traceability validation. It self-corrects when reviews find issues. It only asks you when genuinely stuck.

This is the "give a goal, AI goes to work" pattern. Not "help me step by step" — "do it all."

## Usage

```
/se-goal <your goal>
```

## Examples

```
/se-goal 完成温度传感器方案的完整SE流程，PRD在docs/inputs/prd.md
/se-goal from this datasheet to a reviewed spec and traceability matrix
/se-goal 端到端：从需求分解走到追溯矩阵，芯片是PMIC
/se-goal complete the full SE workflow for the motor controller, inputs are in docs/inputs/
```

## What Happens

1. **PLAN** — AI parses your goal, scans for inputs, reports the planned chain ONCE
2. **ACT** — Auto-executes skills in order: requirements → architecture → specs → review → traceability
3. **OBSERVE** — Runs each skill's verification checklist
4. **REFLECT** — If checks pass → next phase. If checks fail → auto-fix and retry (max 3x). If stuck → asks you.

## Stop Conditions

- ✅ **SUCCESS**: traceability-matrix passes with zero gaps
- 🚨 **ESCALATE**: 3 consecutive retries fail in the same phase
- ⏱️ **BUDGET**: 20+ skill executions (asks whether to continue)
- ⏸️ **PAUSE**: You say "stop", "pause", or "wait"

## Progress Format

```
✅ Define  complete — 23 requirements (REQ-001 ~ REQ-023)
✅ Design  complete — 5 modules, 12 interfaces
⏳ Document in progress — spec-authoring (attempt 1)…
```

No per-phase prompts. Just reports and continues.
