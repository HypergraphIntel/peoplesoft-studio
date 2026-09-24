---
name: peoplesoft-corpus-calibration
description: Calibrate the PeopleCode encoder/decoder against HCDEV corpus evidence while preserving exact protected-baseline definitions.
---

For each actionable failure:

1. Target by stable definition_id.
2. Inspect source→bin before decoder text.
3. Locate the first binary difference.
4. Map it back to the PeopleCode construct.
5. Search the corpus for corroborating examples.
6. Inspect PSPCMNAME/reference trace only when relevant.
7. Derive the narrowest evidence-backed rule.
8. Implement it.
9. Re-run the target.
10. Run related calibration examples.
11. Run the protected 430-definition gate.
12. Repair regressions before continuing.
13. Select the next actionable failure automatically.

Never guess byte semantics merely to advance a target.
Never treat one blocked definition as a global blocker.

## Failure queue refresh policy

Do not run the entire current failure backlog after every successful calibration.

After restoring the protected 430/430 baseline:

1. Use the merged current inventory.
2. Run `corpus:next` to select the next actionable family.
3. Use targeted definition runs for calibration.
4. Run the protected 430 gate after each retained change.
5. Run a broad `corpus:work` refresh only:
   - after a meaningful batch of compiler improvements,
   - when the merged inventory is clearly stale,
   - or when explicitly requested.

If a broad refresh is started and is discovered to cover thousands of definitions at a rate that would materially delay calibration work, stop it cleanly and continue from the merged inventory. Do not treat an incomplete refresh as authoritative.

## Newly established rule

For rowset variables derived from `GetLevel0()(…).GetRowset(Scroll.X)`:

- `.RowNumber` remains inline.
- Explicit row-shorthand record members may allocate per occurrence.
- Top-level direct selection of the rowset's own record can track record dependency by field.
- Nested control-flow and `.GetRow(...)` paths retain previously calibrated reuse behavior.

Do not generalize this to all level-0 rowsets; provenance alone is insufficient.

## Independent stored-byte verification

Do not rely exclusively on the encoder's own reference trace when investigating
reference allocation, reuse, or ordering.

When reference behavior is ambiguous:

1. Query the authoritative stored `PSPCMNAME` rows directly.
2. Inspect the corresponding stored `PSPCMPROG` bytes.
3. Enumerate reference operands from the stored program independently of the
   encoder implementation.
4. Compare stored reference indices and ordering against generated output.
5. Use encoder trace output only as a diagnostic aid, not as the authoritative
   source of truth.

The stored PeopleSoft artifacts are the oracle.

## Long-running work

This task may span multiple context windows.

Do not stop because the current context window is becoming full.
Before compaction/context refresh:
- save current calibration state,
- save locally blocked definitions,
- save the current target and first diff,
- save regression status,
- save the next planned action.

Resume from that persisted state after compaction and continue autonomously.

## Proven reference-provenance rules

### Control-group-scoped Record/Scroll reuse

For constructs such as `ActiveRowCount`, `DeleteRow`, `InsertRow`, and related
row/scroll operations, reference reuse may be control-group scoped.

Top-level control-block boundaries participate in determining those control
groups and must be modeled structurally.

### Component Application Class instances

For Component-declared Application Class instances:

- runtime creation establishes the dependency,
- subsequent method calls reuse that existing dependency,
- do not allocate a separate per-method dependency row.

### Chained GetRecord().GetField()

For:

    GetRecord(...).GetField(...)

a Field reference may reuse the immediately preceding Record context when the
`GetField` call is directly chained from that `GetRecord`.

Do not generalize this behavior to unrelated declared Record-variable cases.