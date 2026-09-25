# Changelog

## 0.2.3

Version **0.2.3** improves PeopleCode dependency lifetime modeling and
adds corpus-scale evidence for how PeopleTools allocates and reuses
`PSPCMNAME` references.

### PeopleCode Compiler Semantics

- Corrected Record and Scroll dependency reuse across flat top-level
  statements. Reuse-participating calls now allocate fresh leading
  dependencies at the flat top level while preserving established reuse
  inside control-flow bodies and Function or Method bodies.
- Added a narrower same-statement reuse rule for repeated `Record.X`
  arguments. This covers nested calls such as `DeleteRow(...,
  ActiveRowCount(...))` and repeated `.GetRecord(Record.X)` chains within
  one expression without leaking dependencies into later statements.
- Preserved the existing FetchValue-specific fallback and the separate
  `RowScrollSelect`, `RowScrollSelectNew`, and `ScrollSelect` reference
  machinery.
- Updated encoder tests that previously expected the disproven behavior
  of sharing Record dependencies between independent flat top-level
  FetchValue statements.

### Compiler Research and Diagnostics

- Added machine-readable reference-lifecycle evidence that compares stored
  `PSPCMPROG` reference operands with generated `ALLOC` and `USE` events.
- Expanded reference tracing to cover direct `0x48` and `0x4A` reference
  emission paths.
- Added branch, control-depth, function-depth, statement, and epoch
  analysis for corpus-scale dependency-lifetime research.
- Ran full-population studies across FetchValue, ActiveRowCount,
  ScrollFlush, GetRecord, RowScrollSelect, and ScrollSelect. These studies
  rejected several broader syntax-based hypotheses and isolated the
  flat-top-level lifetime boundary implemented in this release.

### Corpus Validation

- Corpus size: **30,209 PeopleCode definitions**.
- Full-corpus exact result: **23,069 / 30,209 (76.4%)**.
- Five definitions became newly exact: **7365, 14699, 14717, 17132, and
  22618**.
- The protected regression baseline remains **430 / 430**.
- Full-corpus comparison found **zero previously-exact regressions**.

### Extension Activation

- Simplified explicit activation events by removing redundant per-view
  activation entries. The extension continues to activate for the `psft`
  filesystem and after VS Code startup.

## 0.2.2

Version **0.2.2** expands PeopleSoft Studio's local MCP integration and continues the reverse engineering of the PeopleCode compiler.

- Next Cycle is real work on the compiler, expect significant updates.

### MCP Server and AI Integration

PeopleSoft Studio now provides a more complete local MCP experience for AI clients.

- Added MCP server status to the VS Code status bar.
- Added a centralized MCP control menu for:
  - viewing server status
  - starting the MCP server
  - stopping the MCP server
  - restarting the MCP server
  - copying the MCP endpoint URL
  - configuring supported AI clients
- Added direct configuration support for:
  - OpenAI Codex
  - Claude Code
  - manual MCP client setup
- MCP startup is managed through a dedicated controller rather than directly from extension activation.
- MCP startup failures no longer prevent PeopleSoft Studio from activating.
- MCP can be disabled during smoke tests with `PSFT_DISABLE_MCP=1`.
- PeopleSoft Studio exposes its own stable MCP interface and does not require PeopleTools 8.63 MCP.
- When the delivered PeopleTools 8.63 MCP is available, PeopleSoft Studio is designed to delegate or proxy supported operations while preserving the same client-facing PeopleSoft Studio MCP interface.
- Older PeopleTools environments continue to use PeopleSoft Studio's native providers and reverse-engineered PeopleCode capabilities.

### PeopleCode MCP Tools

Expanded read-only PeopleCode tooling exposed through MCP.

Current tools support:

- listing configured PeopleSoft connections
- searching PeopleSoft definitions
- retrieving definitions
- listing definition children
- listing project items
- retrieving PeopleCode by definition key
- retrieving Record PeopleCode
- retrieving Component and Component Record PeopleCode
- retrieving Application Class PeopleCode
- searching PeopleCode source references

The MCP layer uses the same PeopleSoft Studio `Workspace` and `DefinitionProvider` infrastructure as the VS Code UI rather than scraping `psft://` documents.

### PeopleCode Compiler Reverse Engineering

Continued byte-for-byte reconstruction of the PeopleTools PeopleCode compiler.

Recent compiler work includes:

- improved PSPCMNAME reference allocation and reuse
- improved control-group-aware reference lifetime handling
- improved Record, Field, Scroll, Row, and Rowset reference semantics
- improved cross-record FIELD reuse behavior
- improved explicit `Record.RECORD.FIELD.Value` handling
- improved `GetRecord()`, `GetRow()`, and related postfix reference behavior
- improved `RowScrollSelect`, `RowScrollSelectNew`, `ScrollSelect`, and `ScrollFlush` reference behavior
- improved quoted metadata reference scoping
- improved Application Class and package path handling
- added `%metadata` package-root encoding
- added package-qualified constant encoding
- improved Function metadata and nested `array of array of ...` type handling
- added additional declaration syntax support including `ComponentLife`
- improved explicit Record method-call statements
- improved alternate comparison syntax such as `Not =` and `Not >`
- expanded variable-name handling for legacy PeopleCode identifier forms

### Comments and Legacy Source Preservation

Improved reproduction of PeopleTools comment and legacy source encoding.

- Added additional `REM` and `remark` handling.
- Improved multiline `REM` payload preservation.
- Preserved semicolon-delimited REM continuations.
- Preserved inline comments following REM statements.
- Added support for REM comments inside additional control-flow bodies.
- Improved comment placement around `Then`, `Else`, declarations, Functions, and control-flow boundaries.
- Improved preservation of whitespace and blank-line structural markers where those affect compiled output.

### Corpus and Compiler Validation

PeopleSoft Studio's local HCDEV compiler corpus remains the primary conformance suite for reverse-engineering work.

- Corpus size: **30,209 PeopleCode definitions**
- Latest full-corpus exact result: **22,984 / 30,209 (76.1%)**
- Protected regression baseline remains **430 / 430**
- Broad compiler changes continue to require full-corpus validation with zero previously-exact regressions.
- Reference tracing continues to track generated `ALLOC` and `USE` behavior against stored `PSPCMNAME` data.
- Failure analysis is increasingly focused on reconstructing underlying compiler semantics rather than accumulating isolated byte-pattern fixes.

### Compiler Architecture Direction

The compiler research effort is transitioning from direct byte-pattern calibration toward reconstruction of the PeopleTools compiler model itself.

Current areas of investigation include:

- semantic binding
- lexical and control-flow scope
- implicit owner resolution
- dependency interning
- PSPCMNAME reference lifetime
- reference reuse epochs
- intrinsic-function argument semantics
- separation of parsing, binding, dependency planning, and bytecode emission

The long-term objective remains an independent PeopleCode compiler capable of reproducing PeopleTools-generated `PSPCMPROG` and `PSPCMNAME` output.

### Notes

- PeopleCode database saves remain disabled while compiler and dependency semantics continue to be validated.
- SQL definitions remain writable where supported by the Oracle provider.
- PeopleSoft Studio's MCP server remains usable independently of PeopleTools 8.63 MCP.
- Delivered PeopleTools 8.63 MCP support is additive rather than a requirement for PeopleSoft Studio AI integration.



## 0.2.1

Version **0.2.1** brings editional encoding / decoding maps and even more AI tooling, refactored

## 0.2.0

Version **0.2.0** brings editional encoding / decoding maps and AI tooling

- Add tools for the following provider methods:
  psft_get_peoplecode
  psft_find_peoplecode_references
  psft_get_application_class
  psft_get_record_peoplecode
  psft_get_component_peoplecode

## 0.1.9

Version **0.1.9** AI clients added:
- Codex
- Claude
- Manual Config

## 0.1.8

### Local MCP Server wrapper for AI Agents

Version **0.1.8** represents a major step forward for PeopleSoft Studio's native PeopleCode tooling.


## 0.1.7

### Major PeopleCode Compiler and Decoder Expansion

Version **0.1.7** represents a major step forward for PeopleSoft Studio's native PeopleCode tooling.

This release substantially expands the reverse-engineered PeopleCode compiler, decoder, dependency resolver, and validation framework used by the extension. The goal is not simply to parse PeopleCode, but to reproduce the same compiled structures, reference metadata, and binary behavior generated by PeopleSoft Application Designer.

A large portion of this release focused on byte-for-byte calibration against real PeopleSoft definitions stored in `PSPCMPROG` and `PSPCMNAME`.

### PeopleCode Encoding

- Significantly expanded native PeopleCode source-to-binary encoding.
- Improved generation of `PSPCMPROG` structures to more closely match Application Designer output.
- Added additional compiler handling for:
  - `If` / `Else` / `End-If`
  - `For` / `End-For`
  - `While`
  - `Evaluate`
  - `When`
  - `When-Other`
  - `Function`
  - `End-Function`
  - `Return`
  - `Break`
  - `Try` / `Catch`
  - local, global, component, and panel group declarations
  - Application Class declarations
  - imported Application Classes
  - declared functions
  - rowsets, rows, records, fields, scrolls, and pages
- Added support for previously unmapped PeopleCode opcode and control-marker combinations.
- Improved preservation of structural control-group markers generated by Application Designer.
- Improved statement terminator handling in contexts where PeopleSoft omits or structurally represents semicolons differently.
- Added special handling for top-level statements at end-of-file where Application Designer does not emit a normal terminating semicolon.
- Added support for semicolon variations appearing in `Evaluate` clause headers.
- Improved distinction between syntactic semicolons and semicolons that actually generate compiled bytes.

### PeopleCode Function Metadata

- Reverse-engineered additional Function metadata emitted after executable PeopleCode.
- Corrected Function metadata directory generation.
- Identified the second Function directory field as a **signature-slot offset**, rather than a simple Function ordinal.
- Added cumulative signature-slot tracking based on Function parameters.
- Improved Function parameter type encoding.
- Improved Function return-type metadata.
- Added support for untyped Function parameters.
- Improved handling of primitive Function parameter and return types.
- Expanded detection of Function declarations and Function program metadata boundaries.

### PeopleCode Reference Resolution

A major part of 0.1.7 is improved reproduction of Application Designer's `PSPCMNAME` dependency behavior.

- Added more accurate reference allocation and reuse.
- Added control-group-aware dependency tracking.
- Improved ordering of `PSPCMNAME` references.
- Improved distinction between RECORD, FIELD, RECORD/FIELD, SCROLL, PAGE, PACKAGE/Application Class, and Declare Function references.
- Improved Record and Field reference reuse inside control structures.
- Improved Field lookup scoping to avoid incorrectly reusing references from unrelated control groups.
- Added row-shorthand Record caching by control group.
- Added row-shorthand Field scoping by control group.
- Improved Record reuse for `Select()` calls.
- Improved Record reuse for explicit `Record.RECORDNAME` syntax.
- Improved Record/Field handling for explicit chains such as:

```peoplecode
Record.RECORD_NAME.FIELD_NAME
```

- Improved Rowset expression handling such as:

```peoplecode
&Rowset(&i).RECORD_NAME.FIELD_NAME.Value
```

- Added correct handling for single Record members returned from Rowset selectors:

```peoplecode
&Rowset(CurrentRowNumber()).RECORD_NAME
```

- Corrected distinction between Row properties and Record references.
- Row state/property members such as `.Visible`, `.IsNew`, `.IsDeleted`, and `.IsChanged` now remain inline instead of incorrectly generating RECORD dependencies.

### Scroll and Rowset Reference Handling

- Improved SCROLL dependency allocation.
- Added calibrated reuse behavior for repeated `GetRowset(Scroll.RECORD_NAME)` calls within the appropriate control group.
- Prevented duplicate SCROLL metadata entries where Application Designer reuses an existing dependency.
- Preserved occurrence-sensitive Scroll behavior outside the proven `GetRowset()` context.
- Improved nested Rowset/Row/Scroll traversal parsing.

### Application Class Support

- Expanded Application Class dependency generation.
- Improved `import` handling.
- Added root wildcard import support.
- Improved imported package/reference grouping.
- Added runtime Application Class dependency generation.
- Improved dependencies created by `create PACKAGE:Class(...)`.
- Added Function-local Application Class dependency handling.
- Added support for late top-level Application Class local declarations.
- Improved receiver-sensitive Application Class method reference behavior.
- Improved Package root, qualify path, and class metadata generation.
- Prevented ordinary PeopleCode containing the word `class` inside comments from being incorrectly classified as an Application Class program.

### Declaration Encoding

Expanded declaration support and corrected several previously ambiguous byte patterns.

- `Local`
- `Global`
- `Component`
- `PanelGroup`
- Application Class locals
- multiple variables in a single declaration
- primitive declarations
- object declarations
- untyped parameters
- `Rowset`
- `SQL`
- Record-oriented declaration behavior

Additional calibration includes:

- Correct `PanelGroup` declaration encoding.
- Correct reopening and closing of declaration sections.
- Improved declaration boundaries following imports.
- Correct handling of comments between imports and declarations.
- Improved top-level declaration grouping.

### Comment Encoding

Comment handling received substantial improvements.

- Improved standalone block comments.
- Improved comments immediately following statements.
- Added calibrated support for inline block comments after `Then`.
- Added calibrated support for inline block comments after `Else`.
- Added same-line comment preservation after statement terminators.
- Improved distinction between normal block-comment encoding and inline comment opcode forms.
- Improved comments appearing at Function boundaries.
- Improved comments between imports and declarations.
- Improved comments within nested control-flow structures.
- Added support for PeopleCode disabled-code blocks:

```peoplecode
<*
   disabled PeopleCode
*>
```

Disabled PeopleCode is preserved as an opaque UTF-16 payload using the compiled format generated by PeopleTools.

### Blank-Line and Structural Marker Fidelity

PeopleTools stores more structural formatting information than initially expected.

0.1.7 improves preservation of these structures, including:

- repeated `0x4F` grouping markers
- control-body boundaries
- declaration boundaries
- blank lines preceding certain control terminators
- blank-line multiplicity before `End-If`
- grouping transitions around imports, Functions, loops, and conditional blocks

Several rules were intentionally narrowed after corpus validation showed that seemingly similar whitespace patterns can compile differently depending on structural context.

### PeopleCode Decoder

The decoder has also been expanded to support additional compiled constructs.

- Improved Function decoding.
- Improved typed `Catch` reconstruction.
- Improved `While` header reconstruction.
- Improved `For` header reconstruction.
- Improved Function header semicolon reconstruction.
- Improved object-type local declarations.
- Improved `PanelGroup` declarations.
- Improved comment reconstruction.
- Added inline comment reconstruction after `Then`.
- Added inline comment reconstruction after `Else`.
- Improved keyword casing normalization.
- Improved message/function name reconstruction.
- Improved Record, Field, Scroll, and Application Class reconstruction.
- Improved blank-line reconstruction around control structures.

The encoder and decoder are validated independently:

- **source → binary exactness** validates compiler behavior.
- **binary → source → binary exactness** validates semantic decoder correctness.
- Literal decoded-source equality is tracked separately because some original formatting is not recoverable from `PSPCMPROG`.

### Corpus Validation Framework

0.1.7 introduces a much more robust regression and calibration framework for validating PeopleCode behavior against a real PeopleSoft environment.

New corpus tooling includes:

```text
tools/corpus/
├── baselines/
├── reports/
├── baseline.ts
├── classifications.ts
├── cli.ts
├── corpus-results.sqlite
├── corpus-runner.ts
├── discovery.ts
├── failures.ts
├── inventory.ts
├── next.ts
├── reporter.ts
├── schema.sql
└── validator.ts
```

The harness now tracks:

- stable definition IDs
- PeopleSoft seven-part object identities
- source hashes
- stored binary hashes
- generated binary hashes
- first differing byte offset
- stored/generated diff windows
- source encoding success
- source-to-binary exactness
- decoder success
- round-trip exactness
- failure classifications
- failure constructs
- run history
- protected baseline regressions

### Stable Definition IDs

Corpus definitions now receive a stable local `definition_id`.

This allows a specific PeopleCode definition to be repeatedly targeted even when its current traversal offset changes:

```bash
npm run corpus:harness -- --definition-id 4428 --verbose
```

Reference tracing can also be enabled:

```bash
npm run corpus:harness -- --definition-id 4428 --verbose --trace-refs
```

The authoritative PeopleSoft identity remains the seven-part `OBJECTID` / `OBJECTVALUE` key.

### Reference Tracing

Added optional reference tracing for compiler diagnostics.

Trace events distinguish `ALLOC` and `USE` and include source offset, control group, assigned reference index, reference type, and Record/Field/Package information.

Example:

```text
REF SOURCE ALLOC #11 idx=10 group=1 scroll CRSE_SESSN_VW
REF SOURCE USE   #11 idx=10 group=1 scroll CRSE_SESSN_VW
```

This has proven particularly useful for diagnosing `PSPCMNAME` ordering and reference reuse mismatches.

### Persistent Corpus Results

Corpus runs are now stored in SQLite.

The database tracks:

- corpus runs
- stable definitions
- per-definition results
- exact/non-exact status
- binary differences
- source hashes
- generated hashes
- failure classifications

Current inventory is calculated using the newest completed result for each definition rather than assuming the most recent run covered the entire corpus.

This allows targeted runs without corrupting the state of the full corpus inventory.

### Protected Regression Baseline

Added a protected set of known-exact PeopleCode definitions.

The baseline acts as a compiler regression contract:

> An `EXACT → non-EXACT` transition is always considered a regression.

The harness now explicitly reports:

- improved definitions
- regressed definitions
- unchanged failures
- newly discovered definitions
- source changes

The regression gate prevents a new calibration rule from silently fixing one definition while breaking previously proven behavior.

### Corpus Failure Analysis

Added tooling for working the corpus by **failure family** rather than simply processing definitions sequentially.

New commands include:

```bash
npm run corpus:harness
npm run corpus:failures
npm run corpus:next
npm run corpus:work
npm run corpus:inventory
npm run corpus:baseline
npm run corpus:verify
```

The workflow now prioritizes repeated, actionable compiler patterns rather than blindly working definitions by offset.

### Compiler Calibration Workflow

The encoder/decoder development workflow has been formalized around the following process:

1. Select a representative failure family.
2. Target a stable definition ID.
3. Locate the first stored/generated binary difference.
4. Map the difference back to the source construct.
5. Inspect reference traces when appropriate.
6. Compare additional HCDEV examples.
7. Derive the narrowest evidence-supported encoding rule.
8. Re-run the target.
9. Validate related definitions.
10. Run the protected regression baseline.
11. Reject or narrow any rule causing an `EXACT → non-EXACT` regression.
12. Continue to the next actionable failure family.

This replaces speculative compiler development with corpus-driven calibration.

### Corpus Scale

The PeopleCode validation corpus now contains more than **30,000 PeopleCode definitions** from the HCDEV environment.

This provides a large real-world test surface covering Record PeopleCode, Field PeopleCode, Component PeopleCode, Application Packages, Functions, legacy and modern PeopleCode, nested Rowsets, Application Classes, unusual control structures, comments, disabled code, historical Oracle-delivered code, and highly specialized PeopleSoft constructs.

### Connection Selection

Improved PeopleSoft connection handling in the VS Code status bar.

- Added persistent selected connection state.
- Added connection selection through VS Code Quick Pick.
- Added a dedicated connection-selection command.
- Improved synchronization between the active workspace connection and the status bar.
- Corrected cases where clicking the active connection status item could fail to locate or switch the connection.
- Improved support for multiple configured PeopleSoft environments.

The status bar now clearly exposes the active PeopleSoft connection while maintaining the extension's current read-only state.

### Read-Only Safety

PeopleSoft Studio remains intentionally conservative while the compiler and metadata model continue to be calibrated.

- Existing PeopleSoft definitions remain read-only.
- Corpus access remains read-only.
- Compiler development is validated against stored PeopleTools output rather than writing speculative changes back to PeopleSoft.
- Write support will only be enabled when PeopleSoft Studio can reliably generate the same compiled structures and dependency metadata expected by PeopleTools.

### Architecture Work Toward Native PeopleCode Creation

0.1.7 lays significant groundwork for future creation and modification of PeopleCode directly from PeopleSoft Studio.

The compiler is being designed to eventually generate the same core artifacts Application Designer produces, including:

```text
PeopleCode source
        ↓
PeopleSoft Studio compiler
        ↓
PSPCMPROG
PSPCMNAME
definition/reference metadata
```

The objective is not merely executable PeopleCode. The long-term target is **Application Designer-compatible compilation**, including:

- exact binary structures
- dependency discovery
- dependency ordering
- dependency reuse
- Function metadata
- Application Class metadata
- compiler control structures
- PeopleTools definition context

### Internal Engineering Improvements

- Added stronger compiler state isolation.
- Added control-group-aware reference maps.
- Added specialized reference caches for Row/Rowset shorthand behavior.
- Reduced broad global dependency fallbacks.
- Added additional parser context flags for narrow compiler behaviors.
- Improved compiler diagnostics around first-difference locations.
- Improved binary comparison reporting.
- Added stored/generated size comparison.
- Added round-trip binary comparison.
- Improved corpus run bookkeeping.
- Added protection against partial/targeted runs replacing full inventory state.
- Added clearer failure-family classification.
- Added regression-focused development workflows.
- Added more extensive TypeScript compiler checks around encoder changes.

### Fixed

- Fixed duplicate Record dependencies in several Rowset and `Select()` patterns.
- Fixed duplicate Scroll dependencies for repeated `GetRowset(Scroll.X)` calls.
- Fixed incorrect global Field reuse across unrelated control groups.
- Fixed missing Record references for single-member Rowset selectors.
- Fixed Row properties being incorrectly classified as Record dependencies.
- Fixed Application Class programs being falsely detected from comments containing the word `class`.
- Fixed import-section termination around standalone comments.
- Fixed late top-level Application Class declarations failing to generate Package dependencies.
- Fixed Function-local Application Class method dependency generation.
- Fixed explicit `Record.RECORD.FIELD` dependency generation.
- Fixed missing inline comments following `Then`.
- Fixed missing inline comments following `Else`.
- Fixed comment opcode selection after top-level statement terminators.
- Fixed multiple-variable Component declaration handling.
- Fixed Function metadata offsets for Functions containing parameters.
- Fixed repeated blank-line markers before certain `End-If` boundaries.
- Fixed top-level EOF semicolon handling for several statement classes.
- Fixed several decoder keyword casing inconsistencies.
- Fixed Function, `For`, and `While` header reconstruction.
- Fixed several declaration-section boundary mismatches.
- Fixed Package-reference duplication in Application Class usage.
- Fixed multiple Record/Field reference ordering discrepancies.
- Fixed several byte-level mismatches previously hidden by semantically equivalent source output.

### Validation Philosophy

PeopleSoft Studio now treats compiler fidelity as a measurable property rather than an assumption.

A definition can independently satisfy:

```text
decode SOURCE MATCH
source→bin EXACT
roundtrip EXACT
```

The most important compiler criterion is:

```text
source→bin EXACT
```

which means the extension generated the same compiled PeopleCode representation stored by PeopleTools.

`roundtrip EXACT` additionally proves that decoded PeopleCode can be recompiled back into the exact original binary representation.

This validation model will continue to drive future PeopleCode compiler development.

### Looking Ahead

Work begun in 0.1.7 is intended to ultimately enable PeopleSoft Studio to safely:

- create new PeopleCode definitions
- edit existing PeopleCode
- compile PeopleCode without Application Designer
- generate correct `PSPCMNAME` dependencies
- generate correct `PSPCMPROG`
- validate PeopleCode before persistence
- compare Studio compilation against PeopleTools compilation
- support richer PeopleSoft metadata-aware refactoring
- provide deeper PeopleCode navigation and dependency analysis directly inside VS Code

0.1.7 is the largest compiler-focused release of PeopleSoft Studio to date and establishes the validation infrastructure needed to continue closing the remaining gaps between PeopleSoft Studio and Application Designer.


## 0.1.6

PeopleCode encoder foundation and PSPCMPROG calibration

- Added initial PeopleCode encoder capable of producing PeopleTools-compatible compiled PeopleCode byte streams.
- Added byte-exact encoder tests using PSPCMPROG output generated by PeopleTools / Application Designer as the reference.
- Added `encodeFragment()` for encoding PeopleCode executable fragments.
- Added `encodeProgram()` for generating complete PSPCMPROG payloads, including calibrated program headers, executable sections, metadata, and program boundaries.
- Added `encodeProgramArtifacts()` for returning the compiled PSPCMPROG payload together with external PeopleCode reference metadata required by the compiled program.

- Added expression encoding for:
  - `&variables`
  - string literals, including PeopleCode doubled-quote escaping
  - `True` / `False`
  - unsigned integer literals
  - unary minus
  - arithmetic operators (`+`, `-`, `*`, `/`)
  - comparison operators (`=`, `<>`, `<`, `<=`, `>`, `>=`)
  - Boolean operators (`Not`, `And`, `Or`)
  - parentheses and nested expressions
  - function calls and nested calls
  - multiple function arguments
  - member method expressions such as `&e.ToString()`

- Calibrated PeopleTools Boolean-expression structure, including the structural `0x41` / `0x42` markers used with expression precedence and grouping.

- Added declaration encoding for:
  - `Local`
  - `Global`
  - `Component`
  - `Constant`

- Calibrated declaration-section boundaries and declaration-to-executable transitions, including PeopleTools `0x2D` and `0x4F` structural markers.

- Added Function definition encoding:
  - Function names
  - typed parameters
  - `Returns` clauses
  - Local declarations inside functions
  - executable function bodies
  - `Return`
  - `End-Function`

- Calibrated Function PSPCMPROG headers and metadata trailers.
- Calibrated PeopleCode type metadata for function parameters and return values, including string, boolean, and integer types.

- Added control-flow encoding for:
  - `If` / `Then` / `Else` / `End-If`
  - `Evaluate` / `When` / `When-Other` / `End-Evaluate`
  - `While` / `End-While`
  - `For` / `To` / `Step` / `End-For`
  - `Repeat` / `Until`
  - `Break`

- Added exception-handling encoding for:
  - `try`
  - `catch`
  - `throw`
  - `end-try`

- Added `Declare Function ... PeopleCode RECORD.FIELD EVENT` encoding.
- Calibrated external PeopleCode reference encoding, including the `0x3A`, `0x21`, `0x40`, and `0x42` structures used by `Declare Function`.
- Added external reference collection as a separate encoder artifact rather than coupling PSPCMNAME persistence directly to the PeopleCode encoder.
- Added deduplication of repeated external PeopleCode references. Multiple declarations referencing the same `RECORD.FIELD` and event reuse the same compiled reference index.
- Calibrated reference indexing against PSPCMNAME data using multiple distinct and repeated PeopleCode targets.
- Added golden test coverage proving exact PSPCMPROG reproduction and external-reference deduplication across multiple `Declare Function` declarations.
- Added explicit unsupported-syntax handling so the encoder fails deterministically instead of silently producing unverified bytecode.
- Continued separation of shared PeopleCode binary knowledge into reusable format/layout definitions, including opcode metadata, numeric formats, and PSPCMPROG layout constants.

### Notes

- The encoder is under active calibration against real PeopleTools-generated PSPCMPROG data. Supported syntax is intentionally limited to constructs whose binary representation has been verified.
- PeopleCode encoding is now substantially functional, but this release does not yet enable unrestricted PeopleCode database saves.
- External references required by compiled PeopleCode are now exposed by the encoder, but PSPCMNAME database persistence remains a separate implementation step.
- Some PeopleTools structural bytes have been calibrated in specific contexts but are not yet treated as universal semantics outside those contexts.
- Full PeopleCode expression and statement coverage is not yet complete.
- Decoder/encoder round-trip testing will continue to expand as additional PeopleCode constructs are calibrated.


## 0.1.5

Status Bar ( Database & Read-Only indicator )

- Database is a command, but its not wired to anything yet.


## 0.1.4

PeopleCode completion, hover, outline, and snippets

- PeopleCode completion — keywords, common built-ins, system variables (%Mode, %Request, …), locals harvested from the open file, and Function / method names declared in the same document; member hints after . on common receivers (%Request, rowset/record/field-style names).
- PeopleCode hover — short docs for keywords, built-in signatures, and system variables; basic note for Record.FIELD-style tokens and & variables.
- Document outline / breadcrumbs — symbols for class, interface, method, Function, property, and instance fields (regex-based).
- PeopleCode snippets — if / ifelse, for, while, evaluate, try, local declarations (locs, locn, …), MessageBox, SQLExec, GetLevel0, function/method skeletons, and more.
- Compare With Environment… — opens the same definition from a second connected backend in VS Code’s diff editor (text types: PeopleCode, SQL, and other canReadAsText definitions).
- SQL syntax highlighting — TextMate grammar for psft-sql (keywords, comments, strings, bind variables).
- Editor title actions — context-sensitive actions for PeopleCode/SQL (psft://) and the record custom editor; project view actions for build/compare where contributed.
- Record refresh — reloads the active record editor from the provider.
- Fixed PeopleCode string literals — embedded " characters are re-escaped as "" in decoded source so output matches Application Designer (e.g. JSON fragments in string literals).
- Activation / smoke coverage for new language providers and commands.
- README rewritten to match reality: trusted read of PeopleCode and SQL, SQL write on Oracle, record grid read-only, no PeopleCode save to the database yet, no page designer or full LSP.
- Clearer separation of what works vs what is still roadmap (encoder, record save, designers, project migrate).

### Notes 
- PeopleCode opened from Oracle remains read-only until a verified encoder exists; project export remains the safest path when you need editable source text offline.
- Compare needs two connections (or export + DB). Non-text definitions (e.g. records) are not diffed as text yet.
- Completion/hover/outline are editor-side helpers, not a full language server (no environment-wide go-to-definition or compile diagnostics).


## 0.1.3

- README.md modified for VS Marketplace
- Added DEVELOPER.md


## 0.1.2

Marketplace fixes

- GitHub URLs


## 0.1.0

First installable build.

- Connect to a PeopleSoft environment over Oracle, or open an Application
  Designer project export
- Browse projects, records, fields, pages, components, menus, application
  packages, App Engine programs and SQL definitions
- Open definitions as editable `psft://` documents
- PeopleCode syntax highlighting, including MetaSQL and application classes
- Read-only record editor showing the field grid, attributes and view SQL
- SQL definitions are readable and writable against the database

Known limits: PeopleCode read from the database decodes only as far as the
opcode table goes and cannot be saved back; record definitions and project
export files are read-only. See `docs/ROADMAP.md`.
