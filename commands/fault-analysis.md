---
description: 故障分析：Cortex-M故障寄存器分析、HardFault/MemManage/BusFault/UsageFault转储、堆栈回溯、根因定位
agent: build
---
# /fault-analysis — Cortex-M Fault Analysis

## Overview

Systematic fault analysis for Cortex-M firmware crashes. Invokes the `embedded-debugging` skill to walk through fault register interpretation, stack frame capture, root cause identification, and fix implementation. Follows a strict STOP → PRESERVE → DIAGNOSE → FIX → GUARD workflow.

This command wraps the `embedded-debugging` skill — no separate agent needed; the skill provides the complete diagnostic workflow.

## Usage

```
/fault-analysis [--crash-dump <file>] [--elf <file>] [--attach]
```

## Workflow

### Phase 0 — STOP (The Stop-the-Line Rule)

When a crash occurs, the system MUST NOT be reset or re-flashed before capturing diagnostic state. This is non-negotiable.

```
1. Do NOT re-flash.
2. Do NOT reset.
3. Do NOT power-cycle.
4. Attach the debugger WITHOUT resetting the target.
```

### Phase 1 — PRESERVE (Capture Fault State)

Before any analysis, capture the fault registers. The Cortex-M fault registers contain the evidence — destroying them means losing the only clue.

**Fault registers to capture:**
| Register | Address | Content |
|----------|---------|---------|
| CFSR (combined) | 0xE000ED28 | [UFSR:16][BFSR:8][MMFSR:8] — what type of fault occurred |
| HFSR | 0xE000ED2C | HardFault escalation, FORCED bit, VECTTBL |
| MMFAR | 0xE000ED34 | Address of MemManage violation (if MMARVALID set) |
| BFAR | 0xE000ED38 | Address of bus fault (if BFARVALID set) |
| Stack frame | from MSP/PSP | r0-r3, r12, lr, pc, psr — the CPU state at fault time |

**If attaching via debugger (GDB):**
```
(gdb) monitor reset halt         # ONLY if already reset — otherwise attach without reset
(gdb) x/1xw 0xE000ED28          # CFSR
(gdb) x/1xw 0xE000ED2C          # HFSR
(gdb) x/1xw 0xE000ED34          # MMFAR
(gdb) x/1xw 0xE000ED38          # BFAR
(gdb) info registers pc lr sp msp psp
(gdb) x/8xw $sp                 # Stack frame (8 words)
(gdb) info line *$pc            # Map PC to source
```

**If using a crash dump file:** provide the dump file path to the command; the embedded-debugging skill will parse it.

### Phase 2 — DIAGNOSE (Root Cause Analysis)

Invoke the `embedded-debugging` skill with the captured fault state. The skill will:

1. **Fault Type Classification** — decode CFSR to identify: MemManage (MPU violation), BusFault (bad address access), UsageFault (undefined instruction, unaligned access, divide by zero), or escalated HardFault

2. **Decision Tree Analysis** — consult the Cortex-M fault decision tree:
   - IACCVIOL / DACCVIOL → MPU violation. Check MMAR/BFAR for address. Is the MPU configured correctly?
   - PRECISERR → Bus fault with exact address in BFAR. Clock disabled? Unmapped peripheral?
   - IMPRECISERR → Async bus fault. Write buffering issue? Disable buffer, re-test.
   - UNDEFINSTR / INVSTATE → Corrupted code or bad function pointer. Check PC.
   - INVPC → Loading non-code address into PC. Stack smash? Corrupted vtable?
   - UNALIGNED → Unaligned access with UNALIGN_TRP enabled.
   - DIVBYZERO → Division by zero in integer math.

3. **Stack Frame Analysis** — from the stacked r0-r3, r12, lr, pc, psr:
   - PC: where did the fault occur? Map to source line
   - LR: what function was the caller? (note: LR on exception entry is EXC_RETURN — use the stacked LR)
   - SP: check for stack overflow (SP below stack bottom)
   - r0-r3: function arguments — do any look like corrupted pointers?

4. **Common Crash Patterns** — match against known patterns:
   - HardFault + INVSTATE + PC in RAM → stack overflow overwrote return address
   - MemManage + DACCVIOL + address near 0 → NULL pointer dereference
   - BusFault + PRECISERR + peripheral address → peripheral clock disabled
   - UsageFault + DIVBYZERO → unchecked denominator
   - Crash only with -O2, not -O0 → uninitialized variable or missing volatile

### Phase 3 — FIX (Root Cause Resolution)

Once the root cause is identified:
1. If it's a software bug: implement the fix, verify with a test that reproduces the crash
2. If it's a hardware issue: document the workaround and flag for the next board revision
3. If it's a transient condition: add error handling and recovery

### Phase 4 — GUARD (Prevent Recurrence)

After the fix is verified:
1. Add assertions around the fix point to catch regressions
2. Add stack overflow detection (watermark fill pattern or MPU guard region) if not present
3. Implement a fault handler that preserves crash context to no-init RAM across resets
4. Add a watchdog checkpoint tracking mechanism to identify what code path hung
5. If the crash was timing-dependent, add a spare GPIO toggle for scope profiling

## Fault Handler Instrumentation (Preventive)

If the firmware does not yet have a fault handler, the embedded-debugging skill should produce one:

```c
// Minimal HardFault handler — preserves crash context for post-mortem analysis
typedef struct __attribute__((packed)) {
    uint32_t r0, r1, r2, r3, r12, lr, pc, psr;
} exception_stack_frame_t;

typedef struct {
    uint32_t signature;    // 0xDEADBEEF
    uint32_t fault_type;   // 3=HardFault, 4=MemManage, 5=BusFault, 6=UsageFault
    uint32_t hfsr, cfsr;
    uint32_t mmfar, bfar;
    uint32_t pc, lr;
    uint32_t stacked_frame[8];
    uint32_t msp, psp;
    uint32_t exc_return;
    uint32_t ticks;
} crash_record_t;
```

Place in no-init RAM section so it survives warm resets.

## Rules

1. **STOP first, diagnose later.** Never reset or re-flash before capturing fault registers.
2. Attach the debugger WITHOUT resetting. Most debuggers default to reset-on-connect — override this.
3. "Random" crashes are almost always memory corruption, stack overflow, or timing races — not hardware.
4. printf() changes timing and stack usage. Don't use printf to debug a crash — use GPIO toggles, trace buffers, or the fault handler.
5. A crash that "disappears" with -O0 still exists — the optimizer just relocated the bug. Find and fix the root cause, not the symptom.
6. Every crash fix must include a regression test that reproduces the original crash.
7. If the firmware has no fault handler, implementing one is part of the GUARD phase — not optional.
8. Stack overflow is the #1 cause of mysterious Cortex-M crashes. Always check SP against stack bounds first.
