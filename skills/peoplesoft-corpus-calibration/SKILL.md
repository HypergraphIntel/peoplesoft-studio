---
name: peoplesoft-corpus-calibration
description: Diagnose, calibrate, and fix PeopleCode encoder/decoder corpus failures in peoplesoft-studio while preserving every previously proven byte-exact result.
---

# PeopleSoft Corpus Calibration

Use this skill when working on the PeopleCode encoder, decoder, PSPCMNAME
reference allocation, corpus harness, or compiler-conformance failures in the
`peoplesoft-studio` repository.

The database corpus is the empirical specification of PeopleTools compiler
behavior.

## Authoritative project documentation

Before making compiler or corpus changes, read the repository root:

```text
AGENTS.md
```

Treat it as the current project contract.

If this skill conflicts with `AGENTS.md`, use `AGENTS.md` unless the user
explicitly asks to change that contract.

Supporting material is under:

```text
skills/peoplesoft-corpus-calibration/
```

Read the relevant reference file before changing compiler behavior.

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

4. Reproduce only the selected definition:

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

8. Re-run the target until it is:

   ```text
   EXACT
   ```

9. Re-run the current failure work queue:

   ```bash
   npm run corpus:work
   ```

10. Run the protected regression gate:

    ```bash
    npm run corpus:verify -- --limit 430
    ```

11. Run TypeScript/tests:

    ```bash
    npm run typecheck
    npm test
    ```

12. Never update the baseline to conceal a regression.

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

## Evidence rule

Do not generalize from one failing object without evidence.

Prefer context-specific rules and preserve calibrated helper logic.

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
npm run corpus:harness --   --definition-id <ID>   --verbose   --trace-refs
```

`ALLOC` means a new reference/dependency row was created.

`USE` means that reference was emitted into PSPCMPROG.

Do not introduce global same-name reuse without corpus evidence.

## Full inventory

Broad corpus discovery should be chunked:

```bash
npm run corpus:inventory -- --offset 0 --limit 5000
npm run corpus:inventory -- --offset 5000 --limit 5000
```

Do not run the entire 30,000+ corpus after every compiler edit.

Use broad inventory for discovery and targeted/work-queue runs for development.

## Running inventory safety

Do not replace corpus execution-path files while a multi-chunk inventory shell
script is still running.

A later chunk may start a new Node/tsx process and load changed code, mixing
harness versions in one inventory campaign.

## Read before changing behavior

Before implementing a fix, consult:

```text
workflow.md
corpus-classifications.md
corpus-encoder-rules.md
debugging-checklist.md
```
