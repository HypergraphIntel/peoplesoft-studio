# Compiler Calibration Workflow

## Objective

Convert unresolved corpus definitions to `EXACT` while preserving all previously
proven behavior.

## Fast development loop

```text
corpus:failures -- --summary
        ↓
corpus:next
        ↓
target by --definition-id
        ↓
verbose / trace-refs
        ↓
understand failure
        ↓
make narrow fix
        ↓
target EXACT
        ↓
corpus:work
        ↓
corpus:verify
        ↓
typecheck / tests
```

## 1. Inspect failure families

```bash
npm run corpus:failures -- --summary
```

Prefer working the largest repeatable family first.

## 2. Select a representative

```bash
npm run corpus:next
```

The command should print:

- classification;
- construct;
- family count;
- stable `definition_id`;
- current offset;
- display name;
- recommended command.

Use the `definition_id`, not the offset.

## 3. Reproduce one object

```bash
npm run corpus:harness -- --definition-id <ID> --verbose
```

For PSPCMNAME or reference mismatches:

```bash
npm run corpus:harness --   --definition-id <ID>   --verbose   --trace-refs
```

## 4. Classify the defect

Determine whether the primary defect is:

- unsupported grammar;
- incorrect opcode;
- wrong statement terminator;
- wrong section boundary;
- comment encoding;
- blank-line marker;
- reference allocation;
- reference reuse/provenance;
- decoder semantic output;
- decoder-only formatting.

Do not change code until the failure mechanism is understood.

## 5. Patch narrowly

A good fix has a small semantic blast radius.

Prefer:

```text
explicit Record.REC.FIELD chain in control group N
```

over:

```text
all Record references
```

Prefer:

```text
top-level assignment at EOF
```

over:

```text
all statements at EOF
```

Reuse existing calibrated helpers instead of creating parallel generalized paths.

## 6. Re-run the target

```bash
npm run corpus:harness -- --definition-id <ID>
```

Do not continue until the target is `EXACT`.

## 7. Re-run all known failures

```bash
npm run corpus:work
```

This tests how broadly the new rule improves the unresolved inventory.

Definitions that become `EXACT` disappear automatically from the next current
failure queue.

## 8. Protect prior exact behavior

```bash
npm run corpus:verify -- --limit 430
```

Any protected `EXACT -> non-EXACT` transition fails the change.

## 9. Build and test

```bash
npm run typecheck
npm test
```

Use additional project verification commands when appropriate.

## 10. Promote only proven improvements

Do not update the baseline simply because the branch differs from it.

Baseline promotion is allowed only after:

```text
target exact
failure queue tested
protected regression gate passed
TypeScript/tests passed
```

## Inventory workflow

Use `--offset` only for broad discovery:

```bash
npm run corpus:inventory -- --offset 0 --limit 5000
npm run corpus:inventory -- --offset 5000 --limit 5000
```

The current inventory is the newest completed result for every known definition,
merged across completed runs.

Do not infer corpus state from only the latest run.
