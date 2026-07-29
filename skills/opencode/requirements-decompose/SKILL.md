---
name: requirements-decompose
description: 需求分解：将原始输入（PRD、芯片数据手册、行业标准、客户规格）转化为结构化、可追溯的系统需求文档。Requirements decomposition — transforms raw inputs (PRD, chip datasheet, industry standards, customer specs) into structured, traceable system requirements with domain ownership. Use when the user says 需求分解, 需求分析, 需求梳理, requirements decomposition, "I have a PRD", "structure my requirements", or when starting a new chip/product project with scattered input documents.
---

# Requirements Decompose

## Overview

Raw requirements arrive as a pile of heterogeneous documents — a PRD from marketing, a chip datasheet from the hardware team, an industry standard, a customer specification, a reference design. None of them speak the same language. None of them are structured for engineering traceability. None of them are complete on their own.

This skill transforms that pile into a single, structured system requirements document where every requirement is classified by domain and type, conflicts are resolved, gaps are identified, derived requirements are explicit, and ownership is assigned. Every downstream artifact — architecture, specifications, test plans — depends on this document. The quality of the entire project starts here.

This skill is to SE what stakeholder interviewing is to software development: it confronts ambiguity head-on before any design work begins.

## When to Use

- A new chip or product project kicks off and requirements exist only as a PRD or datasheet
- Multiple input sources exist (datasheet + standard + customer spec) and need consolidation into one source of truth
- Requirements are implicit, scattered across documents, or contradict each other
- You need to assign ownership (HW / SW / System / Mechanical) to each requirement before design begins
- A downstream skill (`architecture-design`, `spec-authoring`) detects incomplete or ambiguous requirements and invokes this skill inline

**When NOT to use:**

- Requirements are already fully decomposed and traceable in a structured document with IDs
- The ask is a single-module change with no new system-level impact
- Pure information lookup ("what does the datasheet say about register X?")
- The user explicitly asks for a quick answer without formal decomposition

## The Process

```
PREPROCESS ──→ COLLECT ──→ CLASSIFY ──→ RESOLVE ──→ DERIVE ──→ ASSIGN ──→ VALIDATE
    │             │           │           │           │           │            │
    ▼             ▼           ▼           ▼           ▼           ▼            ▼
  Extract      Gather     Categorize  Resolve     Derive     Assign       Human
  text/tables  all raw    by domain   conflicts   system-    ownership    review
  from PDFs    inputs     & type      & gaps      level reqs (HW/SW/SYS)  & sign-off
```

### Step 0: PREPROCESS — Extract structured content from document inputs

Before manual inventory, run automated extraction on all PDF and spreadsheet inputs. This step converts opaque documents into structured Markdown that the COLLECT and CLASSIFY steps can consume accurately.

#### PDF inputs (`docs/inputs/*.pdf`)

```bash
# Single PDF
python scripts/preprocess_pdf.py -i docs/inputs/datasheet.pdf -o docs/inputs-preprocessed/

# Batch all PDFs
python scripts/preprocess_pdf.py -i docs/inputs/ -o docs/inputs-preprocessed/ --batch

# Skip OCR if not needed (faster)
python scripts/preprocess_pdf.py -i docs/inputs/datasheet.pdf -o docs/inputs-preprocessed/ --no-ocr
```

**Then read the manifest** to understand what was extracted:

```
Read docs/inputs-preprocessed/<source-name>/manifest.json first.
It tells you:
- Which pages have text (read full-text.md directly)
- Which pages have tables (read tables/table-*.md)
- Which pages have figures (view figures/fig-*.png with Read tool)
- Any issues: encrypted sections, scanned pages, ambiguous diagrams
```

**For each extracted figure**, use the Read tool to view it, then generate a "figure description" for downstream consumption. Focus on SE-relevant information:

| If the figure is a... | Extract... |
|----------------------|------------|
| Timing diagram | Signal names, thresholds, min/typ/max times |
| Block diagram | Module names, interfaces, data flow direction |
| Pinout diagram | Pin numbers, functions, alternate functions |
| State machine diagram | States, transitions, trigger conditions |
| Power sequencing | Rail names, order, timing constraints |

**If the figure cannot be interpreted reliably**, surface it as a question:

```
FIGURE F-003 (page 4): Appears to be a power sequencing diagram.
I can see Vcore, Vio, and Vaux rails with timing annotations, but
I cannot reliably read all values. Please confirm:
- Vcore ramp time: 500μs? 5ms?
- Vio → Vcore delay: 100μs?
```

**When no PDF inputs exist** (user pastes text directly), skip this step and proceed to COLLECT.

**If the preprocessing scripts are not yet installed**, guide the user:

```
pip install -r scripts/requirements.txt
```

See `references/pdf-processing-guide.md` for detailed PDF extraction techniques and troubleshooting.

#### Spreadsheet inputs (`docs/inputs/*.xlsx`, `*.xls`, `*.csv`, `*.tsv`)

```bash
# Single spreadsheet
python scripts/preprocess_xlsx.py -i docs/inputs/BOM.xlsx -o docs/inputs-preprocessed/

# Batch all spreadsheets
python scripts/preprocess_xlsx.py -i docs/inputs/ -o docs/inputs-preprocessed/ --batch
```

**Then read the manifest** to understand what was extracted:

```
Read docs/inputs-preprocessed/<source-name>/manifest.json.
It tells you:
- How many sheets were exported (read sheets/sheet-*.md)
- Row/column counts per sheet
- Any issues: empty sheets, truncated data, encoding problems
```

**Map each sheet to its SE domain** based on column content:

| Sheet Pattern | Likely Domain | Maps to Requirement Type |
|--------------|---------------|------------------------|
| Pin#, Name, Type, Function | HW | Interface (IF-XXX) |
| Item, Qty, Part#, Value, Footprint | HW | Constraint (CON-XXX) |
| Offset, Register, Bit, Default | SW | Functional (REQ-XXX) |
| Parameter, Min, Typ, Max, Unit | System/HW | Performance (REQ-XXX) |
| Test ID, Req Ref, Pass/Fail | Test | Verification (links to TC-XXX) |

See `references/spreadsheet-processing-guide.md` for detailed extraction techniques and edge case handling.

#### Word document inputs (`docs/inputs/*.docx`)

PRDs, customer specifications, industry standards, and meeting notes often arrive as Word documents.

```bash
# Single document
python scripts/preprocess_docx.py -i docs/inputs/PRD.docx -o docs/inputs-preprocessed/

# Batch all .docx files
python scripts/preprocess_docx.py -i docs/inputs/ -o docs/inputs-preprocessed/ --batch
```

**If the document is in legacy .doc format**, convert first:

```bash
soffice --headless --convert-to docx docs/inputs/legacy.doc
```

**Then read the manifest** to understand the document structure:

```
Read docs/inputs-preprocessed/<source-name>/manifest.json.
It tells you:
- Total paragraphs and tables extracted
- Section hierarchy (Heading 1 → 2 → 3) — maps to requirement scope
- Embedded images extracted to images/
- Any issues: tracked changes, legacy format, missing content
```

**Map document headings to requirement scope**:

| Heading Pattern | SE Interpretation |
|----------------|-------------------|
| "Functional Requirements" / 功能需求 | Functional (REQ-XXX) |
| "Performance Requirements" / 性能需求 | Performance (REQ-XXX) |
| "Interface Specification" / 接口规范 | Interface (IF-XXX) |
| "Compliance" / "Standards" / 合规 | Compliance |
| "Electrical Characteristics" / 电气特性 | HW domain, Performance type |
| "Mechanical Requirements" / 结构需求 | Mechanical domain, Constraint type |

**For requirements embedded in prose paragraphs**, apply keyword scanning after extraction:

```
Paragraph: "The system shall support SPI communication at 10MHz with
DMA capability for transfers exceeding 256 bytes."

Extracted:
→ REQ-XXX: System shall support SPI communication at 10MHz (Interface)
→ REQ-XXX: SPI shall support DMA for transfers > 256 bytes (Functional)
```

See `references/docx-processing-guide.md` for detailed extraction techniques and edge case handling.

#### Presentation inputs (`docs/inputs/*.pptx`)

Architecture overviews, design reviews, and customer requirement presentations often arrive as slide decks.

```bash
# Single presentation
python scripts/preprocess_pptx.py -i docs/inputs/architecture-review.pptx -o docs/inputs-preprocessed/

# Batch all .pptx files
python scripts/preprocess_pptx.py -i docs/inputs/ -o docs/inputs-preprocessed/ --batch
```

**Then read the manifest** for slide-level metadata:

```
Read docs/inputs-preprocessed/<source-name>/manifest.json.
It tells you:
- Total slides, which have speaker notes, which have tables
- Per-slide titles and text density
- Embedded images extracted to images/
```

**Key extraction targets in presentations:**

| Slide Content | SE Value | Action |
|--------------|----------|--------|
| Speaker notes | Often contain rationale, decisions, constraints not on the slide | Always extract and review |
| Architecture diagrams (images) | Module decomposition, interfaces | Use Read tool → describe → feed to architecture-design |
| Comparison/trade-off tables | Design decisions | Extract as decision records |
| "Open Issues" / "Risks" slides | Gap log seeds | Map to gap entries in requirements doc |
| Bullet lists with "shall"/"must" | Direct requirements | Classify directly as REQ-XXX |

**Speaker notes are a priority**: they often contain the engineering rationale that the slide's bullet points summarize. A slide may say "Selected SPI over I2C for sensor interface" — the notes may say "I2C limited to 400kHz, need 10MHz throughput, SPI was the only option per datasheet §3.2".

See `references/pptx-processing-guide.md` for detailed extraction techniques.

### Step 1: COLLECT — Inventory all raw inputs

Before any analysis, inventory every input source and surface the list to the user:

```
RAW INPUT INVENTORY:
1. PRD:                 [document name, version, date, owner]
2. Chip Datasheet:      [chip name, revision, sections relevant]
3. Industry Standard:   [standard name, version, mandatory/optional clauses]
4. Customer Spec:       [customer name, document ID, date]
5. Reference Design:    [platform, version]
6. Legacy/Previous-gen: [project name, document ID]
→ Any other inputs I'm missing?
```

This is the cheapest moment to catch missing inputs. A missing source discovered during Step 3 ("resolve conflicts") means re-doing the classification.

### Step 2: CLASSIFY — Categorize every requirement

Extract every requirement from every source and classify it across two axes.

**Domain axis** — who owns this requirement?

| Domain | Examples |
|--------|----------|
| HW | Pin assignments, voltage domains, clock trees, PCB constraints, signal integrity |
| SW | Driver interfaces, protocol stacks, RTOS requirements, memory maps, boot flow |
| System | Power sequences, reset behavior, cross-domain timing, fault propagation |
| Mechanical | Thermal envelope, form factor, connector placement, mounting |
| Compliance | Certification (FCC, CE, UL), safety standards, security requirements |

**Type axis** — what kind of statement is this?

| Type | Marker words | Treatment |
|------|-------------|-----------|
| Functional | "shall support", "must provide", "is responsible for" | Trace to design element |
| Performance | "within X μs", "≤ Y mW", "≥ Z Mbps" | Trace to verification test |
| Constraint | "must not exceed", "only when", "limited to" | Trace to design rule / DFM |
| Interface | "via I2C", "over SPI at Z MHz", "through GPIO" | Trace to interface specification |
| Safety/Security | "must not result in", "shall isolate", "shall authenticate" | Trace to safety analysis |

**Output after Step 2:** A classified requirement table:

```markdown
| ID    | Raw Requirement | Source | Domain | Type    | Status |
|-------|----------------|--------|--------|---------|--------|
| REQ-001 | "SPI flash must respond within 10ms" | Datasheet §3.2 | SW | Performance | Draft |
| REQ-002 | "Vcore ramp 0.6V→1.1V in ≤ 2ms" | PRD §4.1 | System | Performance | Draft |
| REQ-003 | "eSPI bus operates at 66MHz" | Standard §2 | HW | Interface | Draft |
| REQ-004 | "System shall support S0/S3/S5 states" | PRD §2 | System | Functional | Draft |
```

### Step 3: RESOLVE — Conflict detection and gap identification

This is the highest-value step. Cross-reference all classified requirements and surface three categories of issues.

**Conflicts** — two sources say different things about the same requirement:

```
CONFLICT DETECTED:
REQ-012 (Datasheet §5.1): "I2C pull-up to 3.3V"
REQ-047 (PRD §3.2):      "All I2C buses operate at 1.8V"
→ These cannot both be true. Which source takes precedence?
→ GUESS: Datasheet takes precedence for electrical specs. PRD may be stale.
```

**Gaps** — a requirement is mentioned but not specified:

```
GAP DETECTED:
PRD mentions "secure boot" but no requirements specify:
- Which authentication algorithm (RSA / ECDSA / other)?
- Key storage mechanism (OTP / eFuse / external secure element)?
- Boot timeout behavior on verification failure?
→ These must be resolved before architecture design can proceed.
```

**Ambiguities** — a requirement exists but is not testable:

```
AMBIGUITY DETECTED:
REQ-023: "System shall boot quickly"
→ "Quickly" is not testable. Target: cold boot < 500ms? warm boot < 100ms?
→ GUESS: cold boot < 500ms based on competitive analysis. Confirm?
```

For every conflict, gap, and ambiguity, attach a GUESS with your reasoning — following the structured interview pattern. Reacting to a wrong guess is faster for the user than generating an answer from scratch.

### Step 4: DERIVE — Generate system-level requirements

Raw requirements often state *what* without *how*. Derive system-level requirements that bridge the gap between market intent and engineering specification:

```
RAW (from PRD):
  "Chip supports S0/S3/S5 power states"

DERIVED:
  SYS-REQ-001: "System shall transition S0→S3 when host asserts SLP_S3#"
  SYS-REQ-002: "System shall transition S3→S0 within 500μs of SLP_S3# de-assertion"
  SYS-REQ-003: "System shall sequence power rails S0→S3 per Table X (reverse order)"
  SYS-REQ-004: "System shall assert PWR_OK to host only after all rails stable in S0"
  SYS-REQ-005: "System shall enter S5 on SLP_S5# assertion regardless of S3 state"
```

**Derivation rules:**
- Every derived requirement must trace back to at least one raw requirement
- Every derived requirement must be testable — quantified, observable, with a clear pass/fail condition
- If a derivation feels like an architectural decision ("how" choice among valid alternatives) rather than a requirement ("what" must be true), flag it — it belongs in `architecture-design`, not here
- If you can't derive a requirement without guessing the architecture, surface the ambiguity: *"This derivation assumes a single-rail-sequencer design. If a multi-sequencer design is chosen, this splits into N requirements."*

### Step 5: ASSIGN — Ownership assignment

Assign every requirement to the owning discipline and the verifying discipline:

```markdown
| ID          | Requirement | Owner | Verifier |
|-------------|-------------|-------|----------|
| SYS-REQ-001 | S0→S3 transition on SLP_S3# | System (SE) | HW Test |
| SYS-REQ-002 | S3→S0 within 500μs | SW (FW) | SW Test |
| HW-REQ-001  | I2C pull-up 3.3V ±5% | HW (EE) | HW Test |
| SW-REQ-001  | SPI driver supports DMA chaining | SW (FW) | SW Test |
```

**Ownership rules:**
- A requirement with no owner is a requirement that will not be implemented
- Owner ≠ Verifier. The owner implements; the verifier confirms independently
- If ownership is unclear ("this could be HW or SW"), surface it: the decision is an architectural one

### Step 6: VALIDATE — Human review and sign-off

Present the complete structured requirements document. Do not proceed to `architecture-design` until the user confirms.

Ask explicitly:

```
Here's the complete system requirements document with [N] requirements
across [M] domains. [X] conflicts resolved, [Y] gaps identified and
addressed, [Z] requirements derived.

Does this capture everything? Anything to add, change, or remove?
```

The gate is an explicit confirmation. "Looks fine" is not confirmation — ask "anything to refine?" Silence is not confirmation — neither is "sure, let's move on."

## Output

A structured system requirements document saved to `docs/requirements/[project]-system-requirements.md` after user confirmation:

```markdown
# System Requirements: [Project/Chip Name]

## Document Control
- Version: [1.0 draft]
- Date: [YYYY-MM-DD]
- Author: [SE name]
- Input Sources: [list with document names, versions, dates]

## Requirement Table
| ID | Requirement | Source | Domain | Type | Owner | Verifier | Status |
|----|-------------|--------|--------|------|-------|----------|--------|
| ... | ... | ... | ... | ... | ... | ... | ... |

## Derived Requirements
| ID | Requirement | Derived From | Rationale |
|----|-------------|-------------|-----------|
| ... | ... | ... | ... |

## Conflict Resolution Log
| Conflict ID | Description | Sources | Resolution | Resolved By | Date |
|-------------|-------------|---------|------------|-------------|------|
| ... | ... | ... | ... | ... | ... |

## Gap Log
| Gap ID | Description | Impact | Resolution | Owner | Due |
|--------|-------------|--------|------------|-------|-----|
| ... | ... | ... | ... | ... | ... |

## Traceability Seed (for traceability-matrix skill)
| Raw Source | System Req ID | Design Element | Test Case |
|------------|--------------|----------------|-----------|
| ... | ... | (filled by architecture-design) | (filled by spec-authoring) |
```

## Interaction with Other Skills

- **Vague requirements handling**: When a requirement is too vague to classify (e.g., "system shall be robust" or "must be high-performance"), do NOT silently skip it. Apply the GUESS pattern: propose a quantified interpretation with reasoning, ask the user to confirm or correct. Reacting to a wrong guess is faster than generating an answer from scratch. This is built into Step 3 (RESOLVE) — every detected ambiguity gets a GUESS before surfacing.
- **`architecture-design`**: Downstream consumer. The structured requirements document is the primary input to architecture design. Each REQ-ID becomes a constraint that architecture must satisfy.
- **`spec-authoring`**: Two hops downstream. Requirements are referenced by specification sections and test case definitions.
- **`traceability-matrix`**: Populates the first column of the matrix (Raw Source → System Requirement). The traceability seed table in this document's output is the starting point for the full matrix.
- **`design-review`**: Can review the requirements document for completeness before it feeds downstream. A requirements gap caught here costs a conversation; caught during architecture design costs rework.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The PRD is clear enough — let's just start designing" | PRDs state what marketing wants. System requirements state what engineering can verify. The gap between them is where projects ship late. |
| "Conflicts will get caught in the design review meeting" | Catching a conflict during design review means redesigning architecture. Catching it here costs a conversation. |
| "I can classify requirements while designing the architecture" | Classification and design are different cognitive modes. Switching between them produces shallow work in both. |
| "Derived requirements are just design decisions — leave them for architecture" | If it is testable and traces to a raw requirement, it is a requirement. If it is a "how" choice among valid alternatives, it is a design decision. Surface the boundary cases rather than silently categorizing. |
| "We don't need formal requirement IDs — everyone knows what REQ-001 means" | "Everyone" changes over the life of a project. New team members, handoffs, and audits all need explicit traceability. The IDs cost nothing; the ambiguity costs everything. |
| "The customer spec is the requirement — we don't need to re-write it" | Customer specs are written for the customer's procurement process, not for your engineering process. They mix requirements, preferences, and aspirational language. Decomposition separates these. |

## Red Flags

- Classifying requirements without first inventorying all input sources with versions
- Accepting "TBD" or "as needed" as a terminal requirement state without an owner and deadline
- Silently resolving conflicts instead of surfacing them to the user with a proposed resolution
- Deriving requirements that do not trace back to any raw source (unmoored requirements)
- Deriving requirements that are actually architecture decisions (jumping to "how" before "what" is complete)
- Proceeding to architecture design before ownership is assigned — unowned requirements will be orphaned
- Skipping the human review gate (Step 6) because "the classification looks complete"
- A requirement whose type and domain are both unclear — revisit Step 2 before moving on

## Verification

After completing requirements decomposition:

- [ ] All PDF inputs preprocessed via `python scripts/preprocess_pdf.py` (if PDFs exist)
- [ ] Manifest.json reviewed for extracted figures that need human confirmation
- [ ] All raw input sources inventoried with names, versions, dates, and owners
- [ ] Every requirement extracted and classified by both domain and type
- [ ] All conflicts have explicit resolutions with source precedence documented
- [ ] All gaps have owners and due dates for resolution
- [ ] All ambiguities have been chased down to quantified, testable statements
- [ ] Every derived requirement traces to at least one raw requirement
- [ ] Every derived requirement is testable (quantified, observable, clear pass/fail)
- [ ] Every requirement has an assigned owner AND a verifier (not the same person)
- [ ] The traceability seed table is populated (Raw Source → System Req ID)
- [ ] The human has explicitly confirmed the requirements document (not "looks fine," not "sure")
- [ ] The document is saved to a version-controlled location under `docs/requirements/`

## After This Skill

Once requirements are decomposed, verified, and saved to `docs/requirements/`:

| Next Step | Skill | What It Produces |
|-----------|-------|-----------------|
| **Natural next** | `architecture-design` | System-level module decomposition, interfaces, constraints, trade-offs |
| HW-first path | `hardware-architecture-design` | If HW constraints dominate and you need pin assignments / power tree first |
| SW-first path | `software-architecture-design` | If firmware architecture is the primary design concern |
| Quality check | `traceability-matrix` | Run anytime to verify requirement coverage — catches gaps early |

**Pipeline mode**: After this skill completes, the conductor will detect `docs/requirements/` and offer Design-phase options automatically.

## See Also

- For PDF text/table/figure extraction techniques, see `references/pdf-processing-guide.md`
- For spreadsheet (BOM, pin list, register map) extraction, see `references/spreadsheet-processing-guide.md`
- For Word document (PRD, spec, standard) extraction, see `references/docx-processing-guide.md`
- For presentation (design review, architecture overview) extraction, see `references/pptx-processing-guide.md`
- For preprocessing scripts, see `scripts/preprocess_pdf.py`, `scripts/preprocess_xlsx.py`, `scripts/preprocess_docx.py`, `scripts/preprocess_pptx.py`, `scripts/extract_tables.py`, `scripts/extract_figures.py`
- For solution-level requirements review criteria, see `references/solution-requirements-analysis-checklist.md`
- For software-specific requirements review criteria, see `references/software-requirements-analysis-checklist.md`
