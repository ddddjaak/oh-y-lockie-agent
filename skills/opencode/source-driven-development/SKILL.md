---
name: source-driven-development
description: Grounds every implementation decision in official documentation. Use when you want authoritative, source-cited code free from outdated patterns. Use when building with any framework or library where correctness matters.
---

# Source-Driven Development

## Overview

Every framework-specific code decision must be backed by official documentation. Don't implement from memory — verify, cite, and let the user see your sources. Training data goes stale, APIs get deprecated, best practices evolve. This skill ensures the user gets code they can trust because every pattern traces back to an authoritative source they can check.

## When to Use

- The user wants code that follows current best practices for a given framework
- Building boilerplate, starter code, or patterns that will be copied across a project
- The user explicitly asks for documented, verified, or "correct" implementation
- Implementing features where the framework's recommended approach matters (forms, routing, data fetching, state management, auth)
- Reviewing or improving code that uses framework-specific patterns
- Any time you are about to write framework-specific code from memory

**When NOT to use:**

- Correctness does not depend on a specific version (renaming variables, fixing typos, moving files)
- Pure logic that works the same across all versions (loops, conditionals, data structures)
- The user explicitly wants speed over verification ("just do it quickly")

## The Process

```
DETECT ──→ FETCH ──→ IMPLEMENT ──→ CITE
  │          │           │            │
  ▼          ▼           ▼            ▼
 What       Get the    Follow the   Show your
 stack?     relevant   documented   sources
            docs       patterns
```

### Step 1: Detect Stack and Versions

Read the project's build files to identify exact versions and target:

```
CMakeLists.txt / Makefile  → Compiler, RTOS, MCU SDK
Kconfig / .config           → Zephyr configuration and version
package.json                → Node/web projects (JavaScript/TypeScript ecosystem)
go.mod / Cargo.toml         → Go / Rust
Linker script (.ld)         → MCU target and memory layout
```

State what you found explicitly:

```
STACK DETECTED:
- Zephyr RTOS 3.6.0 (from west.yml)
- Arm GNU Toolchain 13.2 (from CMakeLists.txt)
- nRF Connect SDK 2.6.0
- Target: nrf52840dk_nrf52840
→ Fetching official docs for the relevant APIs.
```

If versions are missing or ambiguous, **ask the user**. Don't guess — the version determines which patterns are correct.

### Step 2: Fetch Official Documentation

Fetch the specific documentation page for the feature you're implementing. Not the homepage, not the full docs — the relevant page.

**Source hierarchy (in order of authority):**

| Priority | Source | Example |
|----------|--------|---------|
| 1 | MCU datasheet / reference manual | Chapter 28: SPI, Section 12.3: Clock Configuration |
| 2 | Official SDK / RTOS documentation | docs.zephyrproject.org, developer.nordicsemi.com |
| 3 | Arm Architecture Reference Manual | Armv7-M / Armv8-M Architecture Reference Manual |
| 4 | Vendor application notes / errata | STM32F4xx Errata Sheet, nRF52 Migration Guide |

**Not authoritative — never cite as primary sources:**

- Stack Overflow answers
- Blog posts or tutorials (even popular ones)
- AI-generated documentation or summaries
- Your own training data (that is the whole point — verify it)

**Be precise with what you fetch:**

```
BAD:  Fetch the Zephyr homepage
GOOD: Fetch docs.zephyrproject.org/latest/hardware/peripherals/spi.html

BAD:  Search "STM32 UART DMA best practices"
GOOD: Fetch RM0433 Rev 7, Chapter 38: USART, Section 38.5: DMA transfers
```

After fetching, extract the key patterns and note any deprecation warnings or migration guidance.

When official sources conflict with each other (e.g. a migration guide contradicts the API reference), surface the discrepancy to the user and verify which pattern actually works against the detected version.

### Step 3: Implement Following Documented Patterns

Write code that matches what the documentation shows:

- Use the API signatures from the docs, not from memory
- If the docs show a new way to do something, use the new way
- If the docs deprecate a pattern, don't use the deprecated version
- If the docs don't cover something, flag it as unverified

**When docs conflict with existing project code:**

```
CONFLICT DETECTED:
The existing codebase uses useState for form loading state,
but Zephyr 3.6 SPI docs recommend using the spi_config struct for this pattern.
(Source: react.dev/reference/react/useActionState)

Options:
A) Use the modern pattern (useActionState) — consistent with current docs
B) Match existing code (useState) — consistent with codebase
→ Which approach do you prefer?
```

Surface the conflict. Don't silently pick one.

### Step 4: Cite Your Sources

Every framework-specific pattern gets a citation. The user must be able to verify every decision.

**In code comments:**

```c
// I2C timeout handling per I2C-bus specification v2.1, Section 3.1.1
// Source: NXP UM10204, Section 3.1.1 "START and STOP conditions"
// SCL held low by slave for >10ms → bus reset recovery procedure
#define I2C_TIMEOUT_MS 10
```

**In conversation:**

```
I'm using a ring buffer for UART RX instead of a linear buffer.
Per nRF52840 Product Specification v1.7, Section 6.35.4,
the UARTE uses EasyDMA which supports linked-list scatter-gather,
making a ring buffer compatible with continuous DMA operation.

Source: infocenter.nordicsemi.com/topic/ps_nrf52840/uarte.html
"EasyDMA can read from and write to multiple buffers in RAM
through linked lists"
```

**Citation rules:**

- Full URLs, not shortened
- Prefer deep links with anchors where possible (e.g. `/useActionState#usage` over `/useActionState`) — anchors survive doc restructuring better than top-level pages
- Quote the relevant passage when it supports a non-obvious decision
- Include browser/runtime support data when recommending platform features
- If you cannot find documentation for a pattern, say so explicitly:

```
UNVERIFIED: I could not find official documentation for this
pattern. This is based on training data and may be outdated.
Verify before using in production.
```

Honesty about what you couldn't verify is more valuable than false confidence.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'm confident about this API" | Confidence is not evidence. Training data contains outdated patterns that look correct but break against current versions. Verify. |
| "Fetching docs wastes tokens" | Hallucinating an API wastes more. The user debugs for an hour, then discovers the function signature changed. One fetch prevents hours of rework. |
| "The docs won't have what I need" | If the docs don't cover it, that's valuable information — the pattern may not be officially recommended. |
| "I'll just mention it might be outdated" | A disclaimer doesn't help. Either verify and cite, or clearly flag it as unverified. Hedging is the worst option. |
| "This is a simple task, no need to check" | Simple tasks with wrong patterns become templates. The user copies your deprecated form handler into ten components before discovering the modern approach exists. |

## Red Flags

- Writing framework-specific code without checking the docs for that version
- Using "I believe" or "I think" about an API instead of citing the source
- Implementing a pattern without knowing which version it applies to
- Citing Stack Overflow or blog posts instead of official documentation
- Using deprecated APIs because they appear in training data
- Not reading build system files / Kconfig before implementing
- Delivering code without source citations for framework-specific decisions
- Fetching an entire docs site when only one page is relevant

## Verification

After implementing with source-driven development:

- [ ] Framework and library versions were identified from the dependency file
- [ ] Official documentation was fetched for framework-specific patterns
- [ ] All sources are official documentation, not blog posts or training data
- [ ] Code follows the patterns shown in the current version's documentation
- [ ] Non-trivial decisions include source citations with full URLs
- [ ] No deprecated APIs are used (checked against migration guides)
- [ ] Conflicts between docs and existing code were surfaced to the user
- [ ] Anything that could not be verified is explicitly flagged as unverified
