# App Engine implementation matrix

Every App Engine object and property: how it is stored (docs/APP_ENGINE.md),
where PeopleSoft Studio implements it, how it is tested, and whether the
result was checked natively.

Columns:

- **Mapped** -- the App Designer capture that proves the storage (case names
  in `tools/corpus/save-protocol/results`), or *corpus* when only HRDMO's
  delivered data shows it.
- **Model / Writer** -- `aeDocument.ts` (read, operations) and
  `appEngineWriter.ts` (save). **Designer** -- the App Engine Designer.
  **MCP** -- `psft_ae_*`.
- **Tests** -- *replay*: the capture is replayed by `aeDocument.test.ts` /
  `appEngineWriter.test.ts` (model and plan); *live*: replayed through the
  writer on HRDMO by `tools/lab/ae-replay.mts` and identical to App
  Designer's rows (`results/ae-replay-report.txt`).
- **Native** -- App Designer opened (and where noted edited and saved) what
  PeopleSoft Studio wrote.

Legend: ✓ done; ◐ partial (see note); ✗ not done.

## Program

| Property | Mapped | Model / Writer | Designer | MCP | Tests | Native |
|---|---|---|---|---|---|---|
| Create (MAIN, Step01) | ae01 | ✓ | ✓ New Definition | ✓ create | replay, live (identical but LICENSE_CODE) | ✓ opened, edited, saved; App Designer fills LICENSE_CODE (nae01) |
| Description, Comments, Owner ID | ap01-ap03 | ✓ | ✓ | ✓ | replay, live | ✓ |
| State records (add, remove, default) | ap11-ap14 | ✓ | ✓ (search *AET) | ✓ | replay, live | ✓ |
| Temp tables, Instance Count | ap10, ap15 | ✓ | ✓ (search RECTYPE 7) | ✓ | replay, live | ✓ |
| Share Online, Use Delete, Runtime Abort, Batch Only (RECUSE bits) | ap06-ap09 | ✓ | ✓ | ✓ | replay, live | -- |
| Disable Restart, Message Set, Program Type | ap04, ap16-ap18, ap20 | ✓ | ✓ | ✓ | replay, live | -- |
| Application Library (MAIN renamed / re-added) | ap05, ap19 | ✓ | ✓ | ✓ | replay; live ◐ (rows identical; counters App Designer's differ: it moves SRM/PCM here) | -- |
| ASOF_DT set at the first re-save | ap01 | ✓ | -- | -- | replay, live | -- |
| Transform columns, AE_DATE_OVERRIDE, PSAEAPPLLANG | corpus | ✓ kept as stored | -- | -- | lossless round trip | -- |
| Save As (copy) | ae13 | ✓ copyProgram | ✓ Save As... | ✓ copy | plan; E2E live | -- |
| Rename | ae14 | ✓ | ✓ Rename... | ✓ rename | E2E live; counters/tombstones per ae14 | -- |
| Delete | ae15 | ✓ | ✓ Delete Program | ✓ delete | E2E live; tombstones per ae15 | -- |
| LICENSE_CODE | ae01, ae13, nae01 | ✓ blank on create, kept on edit | -- | -- | plan | ✓ App Designer fills it at its next save |

## Section and variant

| Property | Mapped | Model / Writer | Designer | MCP | Tests | Native |
|---|---|---|---|---|---|---|
| Insert Section (SectionN, Private) | ae10 | ✓ | ✓ | ✓ | replay, live | ✓ (E2E1 DONE) |
| Rename section (SQL, PeopleCode moved; PSAESECTDEL; PJM) | ae11 | ✓ | ✓ | ✓ | replay, live | -- |
| Delete section (tombstones) | ae16 | ✓ | ✓ | ✓ | replay, live | -- |
| Description, Comment | as01, as09 | ✓ | ✓ | ✓ | replay, live | ✓ |
| Market, Platform, Effective Date (variant re-key) | as02-as04, ae18, ae19 | ✓ | ✓ | ✓ | replay, live ◐ (ae18/19: App Designer leaves PSSQLHASH's market stale; the writer moves it) | -- |
| Effective Status, Section Type, Auto Commit, Access | as05-as08 | ✓ | ✓ | ✓ | replay, live | ✓ |
| MAIN Public, cannot be deleted | dialogs | ✓ enforced | ✓ | ✓ | unit | -- |
| A second variant of a section | corpus (169 HRDMO sections) | ✓ read, edit, save | ◐ edits existing variants; no "add variant" command | ✓ (spec) | lossless round trip | ✗ App Designer's way of adding a variant not captured |

## Step

| Property | Mapped | Model / Writer | Designer | MCP | Tests | Native |
|---|---|---|---|---|---|---|
| Insert Step/Action (name, defaults, renumber) | aa01, ax26, ao01 | ✓ | ✓ | ✓ | replay, live | ✓ |
| Rename (SQL, PeopleCode moved) | ar01 | ✓ | ✓ | ✓ | replay, live | ✓ (E2E1 Truncate) |
| Move (Cut / Paste) | ao02 | ✓ | ✓ | ✓ | replay, live | -- |
| Copy / Paste (rename on duplicate) | ao03 | ✓ | ✓ | ✓ copy_step | replay, live | -- |
| Delete | ao04 | ✓ | ✓ | ✓ | replay, live | -- |
| Description, Comment, Commit After, Frequency, On Error, Active | at01-at07, ax24 | ✓ | ✓ | ✓ | replay, live | ✓ |

## Actions

| Property | Mapped | Model / Writer | Designer | MCP | Tests | Native |
|---|---|---|---|---|---|---|
| Insert Action (type order, defaults, P's On Return A, M's row) | ax08-ax17 | ✓ | ✓ | ✓ | replay, live | ✓ |
| Change type (defaults; P's On Return S) | ax27, ax31 | ✓ | ✓ | ✓ | replay, live | -- |
| Delete (P: On Return blank; tombstones) | ad01, ad02 | ✓ | ✓ | ✓ | replay, live | -- |
| Description, Comment | ax06, ax07 | ✓ | ✓ | ✓ | replay, live | ✓ |
| ReUse Statement | ax01, ax02 | ✓ | ✓ | ✓ | replay, live | ✓ |
| Do Select Type | ax20, ax21 | ✓ | ✓ | ✓ | replay, live | ✓ |
| No Rows (step) | ax03-ax05 | ✓ | ✓ | ✓ | replay, live | ✓ (App Designer 8.62 shows Abort as "Out of available memory." on reopen -- delivered programs too) |
| On Return (step) | ax22, ax23 | ✓ | ✓ | ✓ | replay, live | ✓ |
| Call Section: section, program, Dynamic | ax28-ax30 | ✓ | ✓ | ✓ | replay, live | ✓ |
| Log Message: set, number, parameters | ax25 | ✓ | ✓ | ✓ | replay, live | ✓ |
| XSLT Graphical Mapper | ax40, ax41 | ✓ | ✓ | ✓ | replay, live | -- |
| SQL text (flattened as App Designer stores it) | aa02-aa10 | ✓ | ✓ (VS Code editor, panel) | ✓ | replay, live | ✓ |
| XSLT text (verbatim) | ax43 | ✓ | ✓ | ✓ | live ◐ (App Designer's stale-hash correction) | -- |
| PeopleCode (compiled, PSPCM*) | ap-pc01, ap-pc02 | ✓ | ✓ (VS Code editor) | ✓ | replay (bytes equal App Designer's: savePlan.test), live | ✓ opened in App Designer's PeopleCode editor |
| Unique type per step, never SQL with Call Section, XSLT only in Transform | dialogs, corpus | ✓ enforced | ✓ | ✓ | unit | -- |

## Validation, semantics, MCP

| Capability | Where | Tests |
|---|---|---|
| App Designer's Edit Validation warnings (no actions, no SQL / PeopleCode / XSLT) | aeValidation.ts | aeModel.test |
| Structural errors (names, MAIN, duplicates, codes, combinations, state default) | aeValidation.ts | aeModel.test |
| References: state records, temp tables, called programs / sections (Public), messages, %Bind fields | aeValidation.ts (database lookups) | aeModel.test, E2E |
| PeopleCode compiled before save | designer Validate, MCP, writer | appEngineWriter.test, E2E |
| Execution flow, recursion, external / dynamic calls, explanation, dependencies | aeSemantics.ts | aeModel.test, E2E |
| Spec read / build / verify | aeSpec.ts | aeModel.test (every captured state), E2E |
| MCP tools over HTTP against HRDMO | appEngineTools.ts | tools/lab/ae-mcp-e2e.mts: 21 of 21 |
| Designer client (rendering, edits, menus, keys) | media/aeDesigner.js | jsdom harness (lab); not driven inside VS Code here |

## Known differences and limits

- **PSSQLHASH market** after a market / platform / effective-date change: App
  Designer leaves the hash row under the old variant until a later save; the
  writer moves it with the text (ae18, ae19, ax43).
- **Counters** of the Application Library rename follow App Designer's (ap05);
  everywhere else the writer moves the counters App Designer moves.
- **Not captured**: adding a section variant in App Designer, pasting a
  section into another program, the Program Properties of Transform message
  columns. The model keeps and saves such data; the designer offers no
  command for them.
- **Not verified**: running programs. Nothing here executes an App Engine
  program; runtime behaviour in docs/APP_ENGINE_SEMANTICS.md is from
  PeopleBooks.
