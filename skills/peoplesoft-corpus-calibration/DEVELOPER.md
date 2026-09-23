# DEVELOPER.md

## STATS
09-23-2026 - 12,714 NON-EXACT results 

## Project Overview

`peoplesoft-studio` is a VS Code extension and supporting reverse-engineering toolkit for PeopleSoft PeopleCode.





## Status

Early. The foundation is in place and builds: connection management, a provider abstraction with two backends, definitions surfaced as editable virtual files, a project and definition browser, PeopleCode syntax highlighting, and a read-only record editor. Most write paths and all the visual designers are still ahead —

see [docs/ROADMAP.md](docs/ROADMAP.md).

## The PeopleCode problem

Oracle does not document how PeopleCode is stored. It is not source text: it is a tokenized byte stream in `PSPCMPROG.PROGTXT`, split across rows by `PROGSEQ`, with every identifier replaced by an index into a per-program `PSPCMNAME` table. What is implemented and verified: chunk reassembly, gap detection, and name table resolution. What is not: the opcode table itself, which covers only the constructs confirmed so far. Everything else decodes to an explicit unknown token and is reported at the top of the rendered source. This is deliberate. A decoder that guesses at an unrecognised opcode produces source that looks right and means something else. So:

- Unmapped opcodes are surfaced, never smoothed over.
- Saving PeopleCode to the database is refused, not attempted, and such documents open read-only so you find out before you type rather than after.
- `peoplesoft.peoplecode.decoder: "raw"` dumps the token stream and name table, which is how the opcode table gets extended from real programs. Until the table is calibrated against a real database, read PeopleCode from a project export, where App Designer has already written plain source.

## Getting started

```bash
npm install
npm run compile     # typecheck + bundle to dist/
npm test            # unit tests for the pure logic
npm run watch       # rebuild on change, then F5 in VS Code
```

Then PeopleSoft: Add Connection from the command palette, or Open Project Export File to start without a database. Connecting to a database fetches nothing. Use Open Definition... — the magnifier in the Projects title bar — to pick a type, search by name, and open a result. Opening a project that way shows its contents in the project tree, the same view an opened export gives.

For a database connection, the password is requested on first connect and kept in the OS secret store. It is never written to `settings.json`.

## Layout

| Path | What lives there |
| --- | --- |
| `src/model/` | Definition types, keys, record and field structures |
| `src/providers/` | The provider interface, Oracle, project files, virtual FS |
| `src/peoplecode/` | Program assembly and the token decoder |
| `src/views/` | Connections, projects and definition browser trees |
| `src/editors/` | Structured editors; the record grid so far |
| `syntaxes/` | PeopleCode TextMate grammar |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for why it is shaped this way.

## The update loop

```bash
npm run dev
```

That is the whole cycle: typecheck, bundle, unit tests, activation smoke test, package to `peoplesoft-studio.vsix`, and install it over the previous build. Then Developer: Reload Window in VS Code to pick it up. Packaging is gated on `npm run verify`, so a build that fails typecheck, tests or activation never reaches a VSIX. For tighter iteration, skip packaging entirely: `npm run watch` and then F5, which opens an Extension Development Host running straight from `dist/`.

### What `npm run smoke` covers

It loads the bundled extension against a stub `vscode` module (`scripts/vscode-stub.mjs`) and activates it, which catches the failures that otherwise cost a full package-install-reload cycle:

- the bundle fails to load, or `activate()` throws
- a command in `package.json` with no matching registration — the palette entry would fail with "command not found"
- a command registered but not declared, so it never appears in the palette
- a contributed view with no data provider, which renders permanently empty
- a tree that throws when no connection is configured, which is the state on a fresh install

It is not a simulation of VS Code. Anything that needs real editor behaviour — opening a definition, editing, saving — is a manual pass.


# DEVELOPING THE ENCODER / DECODER

A major development area is the PeopleCode binary encoder/decoder:

- `src/peoplecode/encoder.ts`
- `src/peoplecode/decoder.ts`
- supporting corpus utilities under `src/peoplecode/corpus/`

The encoder is being calibrated empirically against PeopleTools-compiled PeopleCode stored in:

- `PSPCMTXT`
- `PSPCMPROG`
- `PSPCMNAME`

The database corpus is the authority for binary behavior. 
The primary goal is not merely syntactically valid PeopleCode. 
The goal is:

> Given original `PSPCMTXT`, produce `PSPCMPROG` that is byte-for-byte identical to PeopleTools output whenever enough information is recoverable.

---

# Core Development Principle

Every encoder change must preserve all previously proven corpus behavior. Do not solve one corpus object by introducing a broader rule unless the broader behavior is supported by evidence.

Prefer:

```text
specific proven rule
```

over:
```text
generalized assumption
```

A fix is not accepted because the target object passes.

A fix is accepted only when:

```text
target improves
AND
no previously EXACT object regresses
```

---

# Validation Hierarchy

The corpus harness uses several levels of correctness.

## 1. Source -> Binary Exact

```text
PSPCMTXT
↓
encoder
↓
generated PSPCMPROG
↓
compare with stored PSPCMPROG
```

This is the strongest encoder validation.

Expected result:
```text
source→bin EXACT
```
---

## 2. Semantic Round Trip Exact

```text
stored PSPCMPROG
↓
decoder
↓
PeopleCode
↓
encoder
↓
generated PSPCMPROG
```

Expected result:
```text
roundtrip EXACT
```

This proves that the decoder produced source that preserves compiled semantics.
---
## 3. Source Match
```text
stored PSPCMPROG
↓
decoder
↓
decoded PeopleCode
↓
normalized comparison against PSPCMTXT
```

Expected result:
```text
decode SOURCE MATCH
```

Literal formatting differences may still exist because PSPCMPROG does not preserve every source formatting decision.

Examples of potentially unrecoverable formatting include:

- indentation width
- some capitalization choices
- editor formatting
- continuation alignment

Therefore:
```text
binary exactness > literal source formatting
```

for encoder calibration.
---
# Corpus Harness

Regression infrastructure is located under:
```text
tools/corpus/
```

Current structure:
```text
tools/corpus/
├── baseline.ts
├── classifications.ts
├── cli.ts
├── corpus-runner.ts
├── discovery.ts
├── failures.ts
├── inventory.ts
├── next.ts
├── reporter.ts
├── schema.sql
├── validator.ts
├── baselines/
└── reports/
```

The SQLite inventory database is:
```text
tools/corpus/corpus-results.sqlite
```

It should not be committed.

The accepted regression baseline is:
```text
tools/corpus/baselines/hcdev.json
```

That file should be committed.
---
# Current Protected Baseline
The initial protected regression corpus contains:
```text
430 definitions
430 EXACT
0 failures
```

This baseline must never regress.

Any change that causes:
```text
EXACT -> anything else
```

is a regression and must be treated as a failed change.

---
# Package Commands

The legacy corpus scanner remains available:
```bash
npm run corpus
```

Do not assume this is limited. Without explicit arguments it may scan the full available corpus.

The new regression harness is:
```bash
npm run corpus:harness
```

Targeted development example:
```bash
npm run corpus:harness -- --definition-id 1843 --verbose
```

Use `--definition-id` for development targets. It resolves the local SQLite definition row to the stored seven-part PeopleSoft key before Oracle access.

Use `--offset` only for corpus traversal, discovery, and chunked inventory.

Protected 430-object regression run:

```bash
npm run corpus:harness -- --limit 430
```

Create/update the accepted baseline:

```bash
npm run corpus:baseline -- --limit 430
```

Verify against the accepted baseline:

```bash
npm run corpus:verify -- --limit 430
```

Show current non-EXACT inventory:

```bash
npm run corpus:failures
```

Summary only:

```bash
npm run corpus:failures -- --summary
```

Filter by classification:

```bash
npm run corpus:failures -- --classification ENCODE_ERROR
```

Filter by construct:

```bash
npm run corpus:failures -- --construct EOF
```

Verbose failure detail:

```bash
npm run corpus:failures -- --verbose
```


Select the next representative failure:

```bash
npm run corpus:next
```

Target that definition by stable SQLite ID:

```bash
npm run corpus:harness -- --definition-id 1843 --verbose
```

Enable PSPCMNAME/reference tracing for that target:

```bash

npm run corpus:harness -- --definition-id 1843 --verbose --trace-refs

```

Use `--offset` only for corpus traversal and inventory chunking:

```bash

npm run corpus:inventory -- --offset 10000 --limit 5000

```

---

# Required Development Workflow for Encoder / Decoder Changes

Use a two-speed workflow:

- fast calibration loop for one representative failure;

- regression gate for all previously proven behavior.

Do not repeatedly scan the entire corpus while developing one compiler rule.

## Step 1: Review the Current Failure Backlog

The current inventory is the newest completed result for each known PeopleCode definition, merged across targeted, chunked, and failed-only runs.

Start with:

```bash

npm run corpus:failures -- --summary

```

Then select a representative from the largest unresolved failure family:

```bash

npm run corpus:next

```

`corpus:next` should report both the stable local `definition_id` and the
current discovery offset. The recommended command must use `--definition-id`,
not `--offset`.

Work by failure family rather than sequential offset. One correct grammar or
provenance rule may resolve dozens or hundreds of definitions.

---

## Step 2: Reproduce One Representative Object

Run the representative by stable local definition ID:

```bash
npm run corpus:harness -- --definition-id <ID> --verbose
```

Do not use corpus offset as the durable development target. Offsets are discovery positions and may change after new PeopleCode objects are inserted, removed, or reordered.

If the mismatch appears to involve PSPCMNAME allocation, reuse, or a `0x21` reference operand, enable reference tracing:

```bash
npm run corpus:harness -- --definition-id <ID> --verbose --trace-refs
```

Reference tracing is diagnostic only. It must not affect encoded output.

A trace contains events such as:

```text
REF SOURCE    ALLOC # 17 idx= 16 group= 12 src= 1432 record ...
REF SOURCE    USE   # 17 idx= 16 group= 12 src= 1461 record ...
```

`ALLOC` means a new PSPCMNAME/reference dependency was created.
`USE` means that reference was actually emitted as a `0x21` operand.

---
## Step 3: Identify the Failure Class

Typical classes include:

```text
ENCODE_ERROR
DECODE_ERROR
DECODE_SOURCE_MISMATCH
SOURCE_BODY_MISMATCH
SOURCE_REFERENCE_MISMATCH
ROUNDTRIP_ERROR
ROUNDTRIP_BODY_MISMATCH
ROUNDTRIP_REFERENCE_MISMATCH
UNKNOWN_MISMATCH
EXACT
```

Determine whether the problem is:

- grammar
- opcode structure
- terminator handling
- whitespace/blank-line tokenization
- comment tokenization
- reference allocation
- PSPCMNAME reuse/provenance
- decoder rendering
Do not patch the decoder to compensate for an encoder bug.
Do not patch the encoder to compensate for a decoder-only formatting issue.
---
## Step 4: Make the Narrowest Possible Change

Prefer context-sensitive rules.

Examples:

```text
top-level assignment at EOF
```

instead of:
```text
all statements at EOF
```

Prefer:

```text
Record.REC.FIELD explicit chain reuse
```

instead of:

```text

all Record.REC references reuse

```

Preserve established helper logic whenever possible. Add an explicit mode or option to a calibrated path instead of bypassing or replacing it globally.

---
## Step 5: Re-run Only the Target

```bash
npm run corpus:harness -- --definition-id <ID>
```

The target should become:

```text
EXACT
```

Do not broaden the validation scope until the representative object is understood.

---
## Step 6: Re-run the Current Failure Work Queue

After the target becomes exact:

```bash
npm run corpus:work
```

Equivalent direct form:

```bash
npm run corpus:harness -- --failed
```

`--failed` uses the merged current inventory, not merely the most recent run.

Objects that become `EXACT` automatically disappear from the next failure work queue because their newest completed result replaces the older failure.

To sample the work queue:

```bash
npm run corpus:harness -- --failed --limit 25
```

In failed mode, `--limit` and `--offset` apply to the failure queue rather than Oracle discovery.

---
## Step 7: Run the Protected Regression Gate

Before accepting the change:

```bash
npm run corpus:verify -- --limit 430
```
The change is acceptable only if:

```text
REGRESSION GATE: PASS
```

and every protected object remains `EXACT`.

A net increase in total exact results does not excuse any protected regression.

---
## Step 8: Run Normal Build / Test Validation

At minimum:

```bash
tsc -p .
npm test
```

Do not accept encoder/decoder changes with TypeScript errors, unit-test failures, or corpus regressions.

---
## Step 9: Promote Improvements Intentionally

Update the accepted baseline only after:

```text
target improvement confirmed
failure work queue re-run
protected regression gate PASS
normal build/tests PASS
```
When intentionally expanding the protected set:

```bash
npm run corpus:baseline -- --limit <protected-count>
```

The baseline is a quality ratchet, not a mechanism for accepting regressions.

---
## Step 10: Inventory New Corpus Coverage in Chunks

The database contains more than 30,000 PeopleCode definitions. Do not require one monolithic run.

Use chunked inventory passes:

```bash
npm run corpus:inventory -- --offset 0 --limit 5000
npm run corpus:inventory -- --offset 5000 --limit 5000
npm run corpus:inventory -- --offset 10000 --limit 5000
```

Continue until the full corpus has been inventoried.

The SQLite inventory merges completed results per definition, so chunked runs, targeted runs, and work-queue runs all contribute to one coherent current state.

After each inventory chunk:

```bash
npm run corpus:failures -- --summary
npm run corpus:next
```

The day-to-day loop is:

```text
inventory more corpus
  ↓
summarize failure families
  ↓
select representative with corpus
  ↓
targeted verbose/trace run
  ↓
make narrow fix
  ↓
target EXACT
  ↓
corpus
  ↓
corpus
  ↓
promote proven improvement
```

Do not run all 30,000+ definitions after every code edit.

---

# Full Corpus Strategy

The PeopleSoft environment contains more than 30,000 PeopleCode definitions.

The full-corpus process is:

```text
discover all definitions
    ↓
validate each definition
    ↓
persist result in SQLite
    ↓
inventory non-EXACT definitions
    ↓
group failures by classification / construct
    ↓
fix one failure family
    ↓
retest affected objects
    ↓
run protected regression baseline
    ↓
promote proven improvements
```

Do not work the full corpus strictly by sequential offset.

Prefer grouping by failure family.

Example:

```text

ENCODE_ERROR / unsupported <*      137

ENCODE_ERROR / expected ;           82

REFERENCE_MISMATCH / GetRecord      61

REFERENCE_MISMATCH / AppClass       43

```

A single grammar/provenance fix may resolve many objects.

---

# Failure Inventory

The failure inventory is stored in SQLite for every completed run.

Use:

```bash

npm run corpus:failures -- --summary

```

to see grouped failure families.

Use:

```bash

npm run corpus:failures

```

to see individual non-EXACT definitions.

Use:

```bash

npm run corpus:failures -- --classification ENCODE_ERROR

```

to work a specific class.

This inventory is the development backlog for compiler calibration.

---

# SQLite Rules

The SQLite file is local state:

```text

tools/corpus/corpus-results.sqlite

```

It stores:

- corpus runs
- definition identity
- per-run validation result
- classification
- first binary mismatch
- failure construct
- error message
- source/program sizes
- hashes
- stored/generated diff windows

Do not commit the SQLite database.

The committed baseline JSON is the portable regression contract.

---

# Definition Identity

Do not identify PeopleCode development targets by corpus offset.

An offset is only the object's current position in the discovery ordering. It can
change when PeopleCode definitions are created, removed, or reordered.

The identity model has three layers:

```text

--offset
    transient corpus traversal / inventory position

definition_id
    stable local SQLite surrogate used by development tooling

OBJECTID1 / OBJECTVALUE1
...
OBJECTID7 / OBJECTVALUE7
    authoritative PeopleSoft object identity

```

PeopleSoft definitions may use up to seven object key pairs:

```text
OBJECTID1 / OBJECTVALUE1
...

OBJECTID7 / OBJECTVALUE7

```
These full keys must be preserved.

Human-readable display names such as:

```text
1=AA_SUMM_JPN_VW, 2=EMPLID, 12=SavePostChange
```
are for diagnostics only.

The local SQLite `definition_id` is the preferred development handle because it remains stable inside the corpus inventory while the underlying seven-part key remains authoritative.

Target a known definition with:

```bash

npm run corpus:harness -- --definition-id 1843 --verbose

```

The harness resolves:

```text
definition_id
      ↓
SQLite definition row
      ↓
seven-part PeopleSoft key
      ↓
Oracle PSPCMTXT / PSPCMPROG / PSPCMNAME fetch
```

Keep `--offset` for discovery and chunked inventory only.

The CLI should reject ambiguous combinations such as:

```text

--definition-id + --offset
--definition-id + --limit
--definition-id + --failed

```

This keeps development targeting distinct from corpus traversal.

---
# PSPCMNAME Is Part of the Compiler Contract

Many apparent binary failures are actually reference-allocation failures.

Examples:

```text
stored:    21 11 00
generated: 21 07 00
```

This usually means the generated program selected the wrong PSPCMNAME entry.

When debugging, distinguish:

```text
opcode/body mismatch
```

from:

```text
reference/provenance mismatch
```

Important concepts include:

- RECORD reference occurrence
- FIELD reference reuse
- control group
- Local Record provenance
- Row shorthand provenance
- CreateRecord target-variable provenance
- GetRecord reuse
- Application Class runtime dependency
- Application Class method dependency
- declaration phase vs executable phase
- Function-local receiver provenance

Do not collapse these into a global same-name cache.

---

# Proven Engineering Rule: Never Delete Calibrated Logic Casually

Compiler reverse-engineering accumulates behavior in helpers that may appear redundant.

A TypeScript warning such as:

```text

TS6133: function is declared but never read

```

does not automatically mean the implementation is safe to delete.

Before removing code:

1. determine why it became unused;

2. determine whether a newer path bypassed previously calibrated behavior;

3. route the new behavior through the established helper when possible;

4. run the regression gate.

A recent example was `recordReference()`.

Removing it eliminated roughly 100 lines of calibrated Record provenance logic.

The correct fix was to preserve the helper and layer the new explicit-chain behavior on top.

---

# Important Encoder Design Pattern

When introducing a new behavior, prefer an explicit option or mode on an established helper.

Example pattern:

```ts

recordReference({

explicitChainReuse: true

});

```

rather than replacing all record-reference behavior globally.

This keeps old proven contexts intact while enabling the new calibrated context.

---

# Control-Group Sensitivity

Many PeopleTools dependency/reuse behaviors are control-group-sensitive.

Do not assume a dependency can be reused globally because its name matches.

Several reference caches use keys conceptually shaped like:

```text

controlGroup:recordName

```

or:

```text

controlGroup:variableName:fieldName

```

or:

```text

controlGroup:targetVariable:recordName

```

Only broaden reuse when the corpus proves it.

---

# EOF Semicolon Handling

PeopleCode has context-sensitive cases where final statements may omit a source semicolon.

Known proven cases include:

```text

top-level If at EOF

top-level Evaluate at EOF

top-level assignment at EOF

```

Do not generalize this to all statements.

For example:

```peoplecode

Return True

```

without a semicolon must still be rejected unless corpus evidence proves otherwise.

---

# Comment Handling

Comment forms are not interchangeable.

Known comment encodings include:

```text

/* ... */

```

and opaque disabled PeopleCode blocks:

```peoplecode

<*

disabled PeopleCode

*>

```

Disabled code blocks compile as one opaque token and must not be parsed internally as active PeopleCode.

Preserve comment opcode distinctions when round-tripping.

---

# Blank-Line Preservation

PeopleTools stores some blank-line structure as explicit opcodes.

Do not collapse all whitespace blindly.

Examples include:

```text

0x4F

```

markers in specific declaration/control-body contexts.

Multiple blank lines may require multiple markers.

Always calibrate whitespace behavior from stored PSPCMPROG.

---

# Application Class Provenance

Application Class references require special treatment.

Different dependency rows may exist for:

- import

- runtime `create`

- method invocation

These are not always interchangeable.

Behavior may differ depending on whether the instance is:

- declaration phase

- late top-level executable phase

- Function-local

Do not globally reuse a runtime-create dependency for every method call.

---

# Source Formatting vs Binary Semantics

The decoder cannot always recover exact original formatting.

Do not introduce broad decoder changes merely to make rendered text look more like one PSPCMTXT sample.

Examples of formatting that may not be reconstructable:

- three-space vs two-space indentation

- some qualifier capitalization

- line wrapping

- continuation alignment

Prefer narrow casing/rendering fixes only when strongly supported.

---

# Do Not Globally Normalize Qualifier Casing

Broad normalization has already caused regressions.

For example, do not blindly convert all:

```text

RECORD

FIELD

SCROLL

COMPONENT

```

references to a preferred display case.

Use narrow mappings only when evidence supports them.

Binary round-trip correctness has priority.

---

# Database Access

Corpus scanning is read-only.

Connection settings are supplied through:

```text

PS_CONNECT_STRING

PS_USER

PS_PASSWORD

```

The harness should not modify PeopleSoft tables.

Relevant tables:

```text

SYSADM.PSPCMTXT

SYSADM.PSPCMPROG

SYSADM.PSPCMNAME

```

---

# Changing Corpus Tooling During a Running Inventory

A long inventory run may execute multiple chunks as separate Node/tsx processes.

Do not replace active corpus tooling files in the working tree while that scripted
inventory is still progressing through chunks.

Files such as:

```text

tools/corpus/cli.ts
tools/corpus/corpus-runner.ts
tools/corpus/inventory.ts
tools/corpus/validator.ts
tools/corpus/next.ts

```

may already be loaded by the current process, while a later chunk launched by the
same shell script will load the newer versions from disk.

That can mix harness implementations within one inventory campaign.

Safe workflow:

```text

inventory running
      ↓
prepare changes elsewhere / stage them
      ↓
allow the current inventory script to finish
      ↓
replace corpus tool files
      ↓
tsc -p .
      ↓
npm run corpus:verify -- --limit 430
      ↓
test corpus:next
      ↓
test emitted --definition-id command

```

Editing unrelated project files is fine, but do not deploy changes to the corpus
execution path until the current scripted inventory completes.

---

# Performance

The current capture path performs separate Oracle queries for:

- PSPCMTXT

- PSPCMPROG

- PSPCMNAME

per definition.

This is acceptable for calibration runs and small regression sets.

Before large repeated 30,000+ definition scans, consider batching/fetch optimization.

Do not optimize the query path at the expense of result correctness.

Establish result parity first.

---

# Progress Reporting

For small corpus runs, progress should be visible frequently.

For large corpus runs, reporting should eventually include:

```text

processed / total

percentage

EXACT count

failure count

definitions per second

ETA

```

Do not interpret a silent console as proof the harness is hung if processing is still active.

---

# Regression Baseline Policy

The baseline is a one-way quality ratchet.

If the accepted baseline contains:

```text

430 EXACT

```

then future accepted states must contain those same 430 definitions as `EXACT`.

New objects may initially fail.

Existing protected objects may not regress.

A net increase in total `EXACT` does not excuse a regression.

Example:

```text
+4 newly EXACT
-1 previously EXACT
```
must still fail the regression gate.

---

# Before Committing Encoder Changes

Run:

```bash
npm run corpus:verify -- --limit 430
```
and the normal project test/build commands.

At minimum:

```bash
tsc -p .
```
must succeed.

Do not accept compiler changes with TypeScript errors or corpus regressions.

---

# Development Priorities

When working through the full inventory, prioritize roughly in this order:

1. `ENCODE_ERROR`
2. repeatable grammar families
3. reference/provenance mismatches
4. body/opcode mismatches
5. decoder semantic mismatches
6. literal source rendering differences

The objective is maximum compiler coverage with minimum regression risk.

---
# Debugging Checklist

When a new corpus case fails:

```text
1. Is decode SOURCE MATCH?
2. Is source→bin an ERROR or MISMATCH?
3. Is roundtrip exact?
4. What is the first differing byte?
5. Is the mismatch before or after the 37-byte header?
6. Does the mismatch contain a 0x21 reference operand?
7. Which PSPCMNAME row does stored use?
8. Which PSPCMNAME row does generated use?
9. Is the problem allocation, reuse, or grammar?
10. What earlier calibrated rule could this change affect?
```

Do not patch until the failure mode is understood.

---
# Philosophy

This project is effectively building a behavioral specification of PeopleTools' PeopleCode compiler from observed artifacts. Treat every successful corpus object as a test vector. Treat every newly proven rule as part of the compiler specification. Treat every `EXACT` result as protected behavior. The corpus is not just test data. It is the executable specification.


## Coexisting with other PeopleSoft extensions

`jatz.peoplesoft-tools` contributes a language also called `peoplecode`, on scope `source.peoplecode`, claiming `.pcode` and `.ppl`. Two grammars on one scope means load order decides which wins.
So this extension uses `psft-peoplecode` on `source.psft.peoplecode`, and its virtual documents end in `.peoplecode` rather than `.pcode`. Both extensions can be installed together. `richardwood.peoplesoft-datamover` only claims `.dms` and

`.dmt`, so it does not overlap at all.


## AI Agent for Corpus

```text
/goal Continue autonomous PeopleCode corpus calibration while preserving the protected 430-definition zero-regression baseline. A locally blocked definition is not a reason to stop; record it in .claude/corpus-progress.md and continue to the next actionable failure family. Keep working until all remaining failures are independently blocked after evidence exhaustion or the corpus objective is complete.
```