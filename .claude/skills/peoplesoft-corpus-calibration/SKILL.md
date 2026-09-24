---
name: peoplesoft-compiler-calibration
description: Diagnose, calibrate, and fix PeopleCode encoder/decoder corpus failures in peoplesoft-studio while preserving every previously proven byte-exact result.
---

# PeopleSoft Compiler Calibration

Use this skill when working on the PeopleCode encoder, decoder, PSPCMNAME
reference allocation, corpus harness, or compiler-conformance failures in the
`peoplesoft-studio` repository.

The captured HCDEV corpus is the empirical specification of PeopleTools compiler
behavior.

## Authoritative project documentation

Before making compiler or corpus changes, read the repository root:

```text
DEVELOPER.md
```

Treat it as the current project contract.

If this skill conflicts with `DEVELOPER.md`, use `DEVELOPER.md` unless the user
explicitly asks to change that contract.

Supporting material is under:

```text
skills/peoplesoft-compiler-calibration/references/
```

Read the relevant reference file before changing compiler behavior.

## Local snapshot is the primary oracle

The completed local HCDEV snapshot is the default source of compiler evidence:

```text
tools/corpus/hcdev-snapshot.sqlite
```

It contains the captured artifacts needed for calibration:

- PeopleCode source;
- PSPCMPROG;
- PSPCMNAME;
- stable definition identity.

All normal investigation, calibration, failure-queue processing, regression
testing, and full-corpus validation must use the local snapshot.

If a command can run successfully against the local snapshot, prefer it over any
workflow that opens an Oracle connection.

Treat the latest completed snapshot as authoritative for the current development
cycle unless there is concrete evidence that the snapshot itself is stale or
corrupt.

Do not:

- query Oracle merely to re-fetch PeopleCode source;
- query Oracle merely to re-fetch PSPCMPROG;
- query Oracle merely to re-fetch PSPCMNAME;
- rebuild the snapshot during normal calibration;
- bypass the snapshot because live Oracle feels more authoritative;
- add `--live` just because a local mismatch is difficult.

The snapshot exists specifically to remove Oracle latency and make corpus work
deterministic and repeatable.

## Live HCDEV policy

Live HCDEV is opt-in verification, not the normal calibration path.

Use live mode explicitly:

```bash
npm run corpus:harness -- --definition-id <ID> --live
```

Use `--live` only when:

1. comparing the local snapshot with current HCDEV;
2. investigating suspected snapshot corruption or staleness;
3. proving a behavior that genuinely requires fresh Oracle evidence;
4. refreshing/rebuilding the snapshot as an explicit maintenance operation;
5. the user explicitly asks for live HCDEV verification.

A local blocker is not a datasource blocker.

Before switching to live HCDEV, first determine whether the problem is:

- encoder grammar;
- opcode emission;
- section or statement boundaries;
- whitespace/comment tokenization;
- PSPCMNAME allocation/reuse/provenance;
- decoder semantics;
- decoder-only source rendering;
- unsupported syntax;
- regression;
- or snapshot integrity.

Only the last category normally justifies investigating the datasource itself.

## Mandatory workflow

1. Inspect the current failure backlog:

   ```bash
   npm run corpus:failures -- --summary
   ```

2. Select a representative from the largest unresolved family:

   ```bash
   npm run corpus:next
   ```

3. Use the emitted `--definition-id`.

   Never use corpus offset as the durable development identity.

4. Reproduce only the selected definition against the local snapshot:

   ```bash
   npm run corpus:harness -- --definition-id <ID> --verbose
   ```

5. For PSPCMNAME/reference mismatches, add:

   ```bash
   --trace-refs
   ```

6. Determine whether the failure is primarily:

   - encoder grammar;
   - opcode emission;
   - statement/section boundary handling;
   - whitespace/comment tokenization;
   - PSPCMNAME allocation/reuse/provenance;
   - decoder semantics;
   - decoder-only source rendering.

7. Make the narrowest evidence-backed change possible.

8. Re-run the target locally until it is:

   ```text
   EXACT
   ```

9. Run targeted local checks for definitions affected by the same rule.

10. Run the protected regression gate:

    ```bash
    npm run corpus:verify -- --limit 430
    ```

11. Run TypeScript/tests:

    ```bash
    tsc -p .
    npm test
    ```

12. Continue to the next actionable failure rather than stopping after one
    successful fix.

13. Never update the baseline to conceal a regression.

## Failure-queue refresh policy

Do not run every current failure after every individual fix.

Use:

```bash
npm run corpus:harness -- --failed --limit <N>
```

for bounded local batches when useful.

Use a broad failure-queue refresh when:

- a meaningful batch of fixes has accumulated;
- the current merged inventory is becoming stale;
- a rule has broad expected impact;
- or the user explicitly asks for one.

Use the full local corpus periodically, not after every edit:

```bash
npm run corpus:harness
```

A partial or interrupted broad refresh is not an authoritative replacement for
the newest completed result already held for each definition.

## Local mismatch investigation

When a definition is non-EXACT:

1. inspect local source;
2. inspect stored PSPCMPROG;
3. inspect generated PSPCMPROG;
4. locate the first meaningful binary difference;
5. inspect stored PSPCMNAME;
6. inspect generated reference/provenance traces when relevant;
7. classify the construct/failure family;
8. search the local snapshot for related examples;
9. distinguish competing hypotheses using corpus evidence;
10. make the narrowest retained rule;
11. rerun the target and affected regression targets.

Do not use `--live` merely because the failure is difficult.

## Development identity

Use these concepts distinctly:

```text
--offset
    discovery/inventory traversal only

definition_id
    stable local SQLite development handle

OBJECTID1 / OBJECTVALUE1
...
OBJECTID7 / OBJECTVALUE7
    authoritative PeopleSoft object identity
```

Target compiler work with:

```bash
npm run corpus:harness -- --definition-id <ID> --verbose
```

Do not target compiler work with `--offset` unless the task is explicitly corpus
discovery/inventory.

## Regression rule

A compiler change is accepted only when:

```text
target improves
AND
no previously EXACT protected definition regresses
```

A net increase in exact definitions does not excuse a protected regression.

If the protected baseline falls below 430/430, stop new corpus work and enter
regression-isolation mode until 430/430 is restored.

A regression is an actionable task, not a reason to abandon the overall
calibration run.

## Evidence rule

Do not generalize from one failing object without evidence.

Prefer context-specific rules and preserve calibrated helper logic.

The stored PeopleSoft representation is the external oracle. Do not make the
encoder and decoder compensate for each other merely to improve roundtrip
metrics.

## Encoder vs decoder

Do not patch the decoder to make an encoder failure disappear.

Do not patch the encoder to compensate for a decoder-only formatting difference.

Validation priority:

```text
source -> binary EXACT
roundtrip EXACT
source rendering match
```

Binary exactness has priority over cosmetic source rendering.

## Reference provenance

When the first binary difference is a `0x21` reference operand, investigate
PSPCMNAME allocation/reuse before changing opcode grammar.

Use:

```bash
npm run corpus:harness -- --definition-id <ID> --verbose --trace-refs
```

`ALLOC` means a new reference/dependency row was created.

`USE` means that reference was emitted into PSPCMPROG.

Do not introduce global same-name reuse without corpus evidence.

## Full inventory

The local snapshot contains the full captured HCDEV corpus and is the preferred
source for broad validation.

Run the full local corpus with:

```bash
npm run corpus:harness
```

Do not run all 30,000+ definitions after every compiler edit.

Use targeted definitions, bounded failure batches, and the protected regression
gate during active development. Run the full local corpus periodically to
refresh authoritative classifications.

Use live discovery/inventory only for explicit snapshot maintenance or current
HCDEV verification.

## Running inventory safety

Do not replace corpus execution-path files while a multi-chunk inventory or
full-corpus shell script is still running.

A later process may load changed code and mix harness versions within one
campaign.

## Read before changing behavior

Before implementing a fix, consult:

```text
references/workflow.md
references/corpus-classifications.md
references/proven-encoder-rules.md
references/debugging-checklist.md
```
