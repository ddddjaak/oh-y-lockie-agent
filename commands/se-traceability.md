---
description: Build and validate the traceability chain across all SE artifacts — Raw Requirements → System Reqs → Design Elements → Test Cases — identifying gaps, orphans, and over-coverage
agent: build
---

Invoke the traceability-matrix skill.

Run this after completing any SE artifact to verify coverage, or before milestone reviews to produce formal traceability.

Work through the five-step process:
1. EXTRACT — parse all reference IDs from all SE artifacts (requirements, architecture, specs, test plan) with version verification
2. LINK — build the full traceability graph: Raw Source → System Req → Architecture Element → Design Element → Test Case
3. COVERAGE — calculate coverage metrics for all traceability dimensions (both directions: does every requirement have a design? does every design trace to a requirement?)
4. GAP-ANALYSIS — identify orphans (nodes with no upstream or downstream trace), coverage gaps (requirements without tests), and over-coverage (tests without requirements)
5. REPORT — produce traceability report with full matrix, gap analysis, and action items (each with owner and due date)

Save the output to docs/traceability/[project]-traceability-[YYYY-MM-DD].md.
