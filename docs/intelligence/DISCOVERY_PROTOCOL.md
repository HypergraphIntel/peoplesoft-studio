# Discovery protocol

How a technical observation becomes a recorded finding. Implemented for
phase 1: the CLI, the store and the save-capture adapter.

## What is a finding

One claim about PeopleSoft that PeopleSoft Studio's behavior depends on,
stated so it can be checked: *a property is stored in this column*, *this
save writes these rows and moves these counters*, *this hash is computed
so*. Its `assertion` is the claim in structured form — that is what makes
two records the same finding.

Not a finding: a guess, a to-do, a bug report about Studio itself,
anything without an observation behind it.

## Recording

From a save capture (the adapter keeps counts only):

```bash
npx tsx tools/intelligence/discovery.mts capture em04-fluid-add-record \
  --type save-protocol --subsystem event-mapping --object-type "Event Mapping configuration" \
  --kind row-resave --fact table=PSPTCSSRVCONF --fact everyRowOnSave=true --fact versionCounter=SCNFM \
  --title "…" --statement "…" --observation "what this capture showed" --confidence high --tool PIA \
  --evidence repo-path:docs/CUSTOMIZATION.md
```

From a lab run (Studio's own writer: a `roundtrip-comparison`, rule 3):

```bash
npx tsx tools/lab/event-mapping-e2e.mts > run.log
npx tsx tools/intelligence/discovery.mts lab-run --script tools/lab/event-mapping-e2e.mts --output run.log \
  --release 8.62 --run-id 2026-10-13a --tests '^(configure|edit|remove|unchanged):' --type roundtrip-comparison …
```

From a JSON file (any method):

```bash
npx tsx tools/intelligence/discovery.mts record --file finding.json
npx tsx tools/intelligence/discovery.mts list [--subsystem event-mapping] [--release 8.62] [--text hash]
npx tsx tools/intelligence/discovery.mts get f-…
```

From code (a lab script, an adapter):

```ts
import { DiscoveryStore } from '../../src/intelligence/index';
const store = await new DiscoveryStore('tools/intelligence/store').open();
const { outcome, finding } = await store.record(input); // created | merged | duplicate
```

The research store, `tools/intelligence/store`, is committed with the work
it supports. `--store DIR` or `PSFT_DISCOVERY_STORE` points elsewhere.

## Rules of evidence

1. **One capture is one observation, never a rule.** The adapter does not
   infer claims; the researcher states the assertion, and its confidence
   says how far the evidence goes.
2. **The same evidence twice is a duplicate.** Re-running a recorder adds
   nothing. A *reproduction* is a different run (`--run-id`) or a different
   experiment that shows the same claim.
3. **Studio's own output is not evidence of the native behavior.** A sweep
   of a Studio writer that was built from a rule shows the rule, not
   PeopleSoft: record it as a `roundtrip-comparison` finding about Studio,
   never as another observation of the native claim. (The emw02 sweep of
   the service writer repeats em01's PSLOCK step because the writer was
   written from em01 — it is not a reproduction.)
4. **Name the release.** Every observation carries the PeopleTools release
   it was made on (a capture's `delta.json` records it).
5. **Keep it technical.** No host, path, URL, address, credential,
   institutional name or row value: the privacy scan refuses them; rewrite
   the claim in PeopleTools terms (tables, columns, counters, codes).
6. **Historical findings** are recorded only with their evidence in hand —
   a capture case, a test, delivered source — not from memory.
7. **Read values from the capture, not from the docs.** Before recording,
   check the claim against the capture's rows (keyed changes, PSVERSION),
   and write any value in an observation's text from what the capture
   shows. A doc's summary can be wrong: `docs/PAGE_SAVE.md` called 06-types
   one save, the capture shows three.
   A sweep's `otherTables` diff is by ROWID: Oracle can reuse a deleted
   row's ROWID for a new row, which then shows as an update of another
   key (r65 "removed" two fields it kept). Compare keyed sets — deleted
   plus updated-before against inserted plus updated-after — before
   claiming that rows were added or removed.
8. **Select cases by what they did, not by their name.** A case family can
   hold a case of another kind (`aa01-insert-step` among the SQL-text
   cases; the `r01-type-*`…`r06-type-*` cases are page-type saves, PDM). The `w`-prefixed App Engine cases (`wap01`…) are
   `tools/lab/ae-replay.mts` runs of Studio's own writer — never evidence of
   App Designer's behavior. So are the record family's `rd` cases
   (`rd1-native-reorder`…): saves by Studio's record writer, which updates
   `PSRECDEFN` in place where App Designer deletes and re-inserts it.
9. **Counter-evidence narrows the claim.** When one capture contradicts a
   fact (aa02 did not move AES), drop the fact from the assertion and say in
   the statement what is not established; never record the contradicting
   observation under the broader claim.

## Adapters

| Source | Status | Observation it gives |
|---|---|---|
| Save captures (`tools/corpus/save-protocol`): sweeps (`save-protocol-delta/1`) and definition captures (`def-capture/1`, `ae-capture/1`) | Implemented (`adapters/saveCapture.ts`) | Changed tables (counts), counter moves, case ID; the release from a sweep, or given (`--release`) for a definition capture, which does not record it |
| Lab end-to-end proofs (`tools/lab/*-e2e.mts`) | Implemented (`adapters/labRun.ts`, CLI `lab-run --script --output --release [--tests REGEX]`) | Check names and outcomes only (failure details never leave), `live-e2e`; a Studio writer's proof is a `roundtrip-comparison` |
| Controlled compile lab | Proposed | `compile-difference` observations |
| PeopleCode corpus harness | Proposed | `bytecode-pattern` observations — derived facts only; the corpus is institutional |
| Writer replay tests (`src/test/*Writer.test.ts`) | Proposed | `unit-replay` test results |

An adapter is a pure function from the source's own output to an
`Observation`; it never changes the research tool it reads.

## From a finding to engineering work

```bash
npx tsx tools/intelligence/engineering-task.mts f-… [--write-fixture]
```

prints an issue title, labels and body (claim, scope, evidence, acceptance
criteria), writes the body to `tools/intelligence/tasks/` and, with
`--write-fixture`, a regression test asserting each capture still shows what
the finding recorded. It files nothing: it prints the `gh issue create`
command for a person to run after review.
