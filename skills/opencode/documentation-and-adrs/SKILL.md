---
name: documentation-and-adrs
description: Records decisions and documentation. Use when making architectural decisions, changing public APIs, shipping features, or when you need to record context that future engineers and agents will need to understand the codebase.
---

# Documentation and ADRs

## Overview

Document decisions, not just code. The most valuable documentation captures the *why* — the context, constraints, and trade-offs that led to a decision. Code shows *what* was built; documentation explains *why it was built this way* and *what alternatives were considered*. This context is essential for future humans and agents working in the codebase.

## When to Use

- Making a significant architectural decision
- Choosing between competing approaches
- Adding or changing a public API
- Shipping a feature that changes user-facing behavior
- Onboarding new team members (or agents) to the project
- When you find yourself explaining the same thing repeatedly

**When NOT to use:** Don't document obvious code. Don't add comments that restate what the code already says. Don't write docs for throwaway prototypes.

## Architecture Decision Records (ADRs)

ADRs capture the reasoning behind significant technical decisions. They're the highest-value documentation you can write.

### When to Write an ADR

- Choosing a framework, library, or major dependency
- Designing a data model or database schema
- Selecting an authentication strategy
- Deciding on an RTOS (FreeRTOS vs Zephyr vs bare-metal superloop)
- Choosing between build tools, hosting platforms, or infrastructure
- Any decision that would be expensive to reverse

### ADR Template

Store ADRs in `docs/decisions/` with sequential numbering:

```markdown
# ADR-001: Use FreeRTOS with priority inheritance for task scheduling

## Status
Accepted | Superseded by ADR-XXX | Deprecated

## Date
2025-01-15

## Context
The firmware must handle BLE events (< 1ms deadline), sensor polling (100ms),
and flash logging (seconds) concurrently. A bare-metal superloop would miss
BLE deadlines during flash writes.

## Decision
Use FreeRTOS with 4 priority levels. Priority inheritance enabled on
the I2C mutex (configUSE_MUTEXES = 1).

## Consequences
- +8KB flash for RTOS kernel, +2KB RAM for task stacks
- Flash logging will be preempted by higher-priority tasks (acceptable)
- Must ensure no task starves the idle task (watchdog feeds from idle hook)
```

### ADR Lifecycle

```
PROPOSED → ACCEPTED → (SUPERSEDED or DEPRECATED)
```

- **Don't delete old ADRs.** They capture historical context.
- When a decision changes, write a new ADR that references and supersedes the old one.

## Inline Documentation

### When to Comment

Comment the *why*, not the *what*:

```typescript
// BAD: Restates the code
// Increment counter by 1
counter += 1;

// GOOD: Explains non-obvious intent
// Rate limit uses a sliding window — reset counter at window boundary,
// not on a fixed schedule, to prevent burst attacks at window edges
if (now - windowStart > WINDOW_SIZE_MS) {
  counter = 0;
  windowStart = now;
}
```

### When NOT to Comment

```typescript
// Don't comment self-explanatory code
function calculateTotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

// Don't leave TODO comments for things you should just do now
// TODO: add error handling  ← Just add it

// Don't leave commented-out code
// const oldImplementation = () => { ... }  ← Delete it, git has history
```

### Document Known Gotchas

```typescript
/**
 * IMPORTANT: This function must be called before the first render.
 * If called after hydration, it causes a flash of unstyled content
 * because the theme context isn't available during SSR.
 *
 * See ADR-003 for the full design rationale.
 */
export function initializeTheme(theme: Theme): void {
  // ...
}
```

## API and Interface Documentation

For public APIs (HAL, driver interfaces, SDK APIs):

### Inline with Header Comments (Preferred for C)

```c
/**
 * @brief Initialize the UART peripheral.
 *
 * @param[out] dev  Pointer to receive the device handle. Must not be NULL.
 * @param[in]  cfg  Configuration struct. Must not be NULL. Must have version set.
 * @return HAL_OK on success.
 * @return HAL_ERR_PARAM if dev or cfg is NULL.
 * @return HAL_ERR_ALREADY_INITIALIZED if the peripheral was already initialized.
 *
 * @note ISR-safe: No. Must be called from thread context.
 * @note Blocks: No. Returns immediately after configuration.
 */
hal_err_t uart_init(uart_dev_t** dev, const uart_config_t* cfg);
```

### Interface Contract Documentation

For module boundaries and HAL interfaces, document the contract in the header:

```c
// hal_uart.h — PUBLIC INTERFACE CONTRACT
//
// Contract guarantees:
// - All functions: thread-safe (mutex); NOT ISR-safe except where documented
```

## README Structure

Every project should have a README that covers:

```markdown
# Project Name

One-paragraph description of what this project does.

## Quick Start
1. Clone the repo
2. Install toolchain: follow the setup guide for your target MCU
3. Set up environment: copy the example config and adjust for your target
4. Build and flash: `make TARGET=nrf52840 && make flash`

## Commands
| Command | Description |
|---------|-------------|
| `make TARGET=<name>` | Build for the specified target |
| `make test` | Run host-based unit tests |
| `make flash` | Flash firmware to connected device |
| `make clean` | Clean build artifacts |

## Architecture
Brief overview of the project structure and key design decisions.
Link to ADRs for details.

## Contributing
How to contribute, coding standards, PR process.
```

## Changelog Maintenance

For shipped features:

```markdown
# Changelog

## [1.2.0] - 2025-01-20
### Added
- Task sharing: users can share tasks with team members (#123)
- Email notifications for task assignments (#124)

### Fixed
- Duplicate tasks appearing when rapidly clicking create button (#125)

### Changed
- Task list now loads 50 items per page (was 20) for better UX (#126)
```

## Documentation for Agents

Special consideration for AI agent context:

- **CLAUDE.md / rules files** — Document project conventions so agents follow them
- **Spec files** — Keep specs updated so agents build the right thing
- **ADRs** — Help agents understand why past decisions were made (prevents re-deciding)
- **Inline gotchas** — Prevent agents from falling into known traps

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The code is self-documenting" | Code shows what. It doesn't show why, what alternatives were rejected, or what constraints apply. |
| "We'll write docs when the API stabilizes" | APIs stabilize faster when you document them. The doc is the first test of the design. |
| "Nobody reads docs" | Agents do. Future engineers do. Your 3-months-later self does. |
| "ADRs are overhead" | A 10-minute ADR prevents a 2-hour debate about the same decision six months later. |
| "Comments get outdated" | Comments on *why* are stable. Comments on *what* get outdated — that's why you only write the former. |

## Red Flags

- Architectural decisions with no written rationale
- Public APIs with no documentation or types
- README that doesn't explain how to run the project
- Commented-out code instead of deletion
- TODO comments that have been there for weeks
- No ADRs in a project with significant architectural choices
- Documentation that restates the code instead of explaining intent

## Verification

After documenting:

- [ ] ADRs exist for all significant architectural decisions
- [ ] README covers quick start, commands, and architecture overview
- [ ] API functions have parameter and return type documentation
- [ ] Known gotchas are documented inline where they matter
- [ ] No commented-out code remains
- [ ] Rules files (CLAUDE.md etc.) are current and accurate
