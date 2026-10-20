# Bounded Page review adapter — development

The Oracle `page` adapter supports existing-control move/resize, label/use and
Page description/comments. Normal `psft_edit_page` calls stage those operations
when Change Review is enabled. They return REVIEW_REQUIRED/persisted=false;
developer approval/application remain in the persistent review workspace.

Page/control creation/deletion, copy/paste, tab-order/scroll-level edits,
binding changes, other Page properties and `saveInvalid` are refused on this
staging path. Servers without Change Review and other platforms retain their
legacy routes. Explicit `dryRun` keeps the broader existing rollback-preview
path; a preview is not approval to apply it.

Control-type restrictions apply. Static Text does not support Display Only or
Invisible; the MCP operation and shared writer refuse those flags while allowing
them to be cleared for restoration. The native Page designer already omits
those options on Static Text. Database readback alone is insufficient evidence
that a property is valid for a native control type.

## Native snapshot scope

`pageSnapshot.ts` reads full rows from the current writer's eleven tables:

- PSPNLDEFN, PSPNLFIELD, PSPNLFIELDEXT.
- PSPNLHTMLAREA, PSPNLHTMLLANG, PSPTPNLRTEDITOR.
- PSPNLCNTRLDATA, PSPNLBTNDATA.
- PSPNLACEGRDDATA, PSPNLACEGRDAXIS, PSPNLTREECTRL.

Scope is named `page-writer-tables/1`. This is the current writer's affected
metadata, not a universal Page/dependency snapshot. Page PeopleCode and owning
component definitions are separate objects. Global PDM/SYS counters are neither
restoration snapshots nor object revisions.

Catalog metadata selects every native column. CLOBs are fetched as complete
strings, without the Layout reader's 4,000-character display truncation.
DATE/TIMESTAMP values use full-precision text. Unsupported time-zone columns,
opaque values, unsafe integers, missing columns/tables and snapshots exceeding
8 MiB are refused; nothing silently drops an unsupported column. Existing
snapshot privacy checks also apply. Rows are sorted canonically so relational
storage order does not imply an edit.

Only PSPNLDEFN.VERSION/LASTUPDDTTM/LASTUPDOPRID are excluded from content.
The native version is returned separately; the concurrency token hashes the
version plus the complete scoped content. Control changes without a version
bump therefore change the token. Unknown native columns are retained, never
given inferred editing semantics.

`readPageForReview` uses an Oracle read-only transaction for a consistent read,
then rolls it back. `savePage(captureSnapshots: true, dryRun: true)` captures
the before-image under the writer's Page header lock, executes/verifies the
existing native writer, captures its actual after-image, then rolls back.
`includeSnapshots` exposes these images on explicit MCP dryRun requests;
returned versions/counts/tokens for the after-image remain hypothetical.
Snapshot failure before or after DML rolls back the transaction.

## Native projection, not row replay

Preparation runs the existing writer in rollback mode. Its after-image includes
native normalization such as derived scroll levels or related property changes.
Staging re-reads the baseline and requires its token to match the preview's
before-image. A no-op/unsupported Page request does not create an empty set.

Validation reconstructs only a typed editor request: mandatory geometry,
label/use fields, Page description/comments and the original surviving control
IDs. It replays that request through rollback preview and requires the entire
scoped after-image hash to equal the staged proposal. Arbitrary native-column
edits cannot become SQL writes; an unhandled change fails equivalence.
Ambiguous, inserted or deleted control identities are rejected.

The native HRDMO 8.62 `SECUREINVISIBLE` column returns character flags `"0"`
and `"1"`. Projection converts only those exact values to the existing editor's
numeric flag, matching the current Page reader/writer. Raw snapshot values stay
unchanged; geometry and other native columns do not receive string coercion.

Application repeats current authorization, target and snapshot checks. The
writer checks the full baseline token again under the Page header lock, before
DML. After commit, the service independently reads the full native snapshot and
requires equality to the approved after-state before VERIFIED/APPLIED. A
concurrent change or uncertain result stops the set under the existing recovery
contract. No cross-object transaction or dependency overlay is claimed.

## History, comparison and inverse

Native control comparisons match positive PNLFLDID values; FIELDNUM changes
remain visible as real native order changes. Other tables are preserved in the
before/after panes, with ambiguity explicit where row identity is not modeled.
The review UI draws before/after snapshots using the same layout model and
static control drawing as the Page designer. Persisted control IDs link amber
highlights, move/resize/label/use summaries and paired selection. Both panes
share a fit scale, with explicit 50/75/100 percent options; hidden controls use
hatching. Exact native snapshots and differences remain available. Timeline
baseline comparison opens retained Page drawings without database reads.
These drawings do not expand subpages or reproduce Fluid/styles/runtime layout.
Captured HTML never runs, and ambiguous identity or invalid geometry yields an
explicit unavailable message. Unknown after-states have no fabricated drawing.

Reversal uses the generic checkpoint workflow and the same native equivalence
validation. It succeeds only if the bounded typed writer can reproduce the
checkpoint exactly. An intrinsic normalization that cannot be inverted by this
subset remains a validation failure, not a raw-row restoration shortcut.

Manual Page saves are observed after their normal ownership gate. Supported
Oracle snapshots record actual before/after results without fabricated MCP
approval. Unrecordable history does not block the developer's save. Structural
manual edits can be recorded, but the bounded adapter cannot reverse them.

## Evidence and next gate

The existing capture-backed Page-plan tests remain unchanged. Transaction tests
exercise full-text snapshots, token/content separation, unchanged previews,
post-DML snapshot failure, full-token guards and timestamp/order fidelity.
Production HTTP/UI fixtures exercise the real provider/writer over a
transactional fixture: stage/approve/apply/checkpoint inverse, unsupported
native-column refusal, unversioned control drift, manual history and visible
external-edit gaps. These are not native database certification.

Installed native rollback previews passed on HRDMO `ZZ_PCODE_LAB_PG`: all eleven
scoped table images and the native version/token were unchanged after rollback.
Evidence: `tools/lab/results/page-review-native-preview.json`. This does not
independently certify global native counters. Native staging then refused a
character `SECUREINVISIBLE` flag; no staged object or committed Page write was
produced. The narrow conversion fix passes captured native projection and local
HTTP/UI character-flag apply/inverse tests, but needs installed acceptance.

After developer reload, the corrected installed build staged and validated
Change Set `ba4a466c-fbf6-4190-9f64-aa423d53edda` (revision 2,
READY_FOR_REVIEW). Exact native diff is only PSPNLDEFN.DESCR:
`Lab Page Edited` -> `Page Change Review validation`. Post-staging readback
retains the original scoped content/token/version 533. Evidence:
`tools/lab/results/page-review-native-validation.json`.

Developer apply and independent readback now pass for that description proposal:
APPLIED/VERIFIED, native version 560, all eleven table images equal the approved
after-snapshot, and the live timeline token matches its verified revision.
`tools/lab/page-review-acceptance.mts` checks approval/checkpoint/snapshot hashes,
live timeline matching and reversal-chain links using read-only MCP tools.

Checkpoint inverse `dd4967c1-8835-4691-b6d2-05dec76ad072` was separately
developer-approved/applied and passed independent native readback. Original
scoped content is restored exactly at version 561 under a new token; original
set is REVERTED with its backlink. Timeline matches the inverse and retains two
continuous verified revisions. This is one native description apply/inverse
cycle. Native visual reopen, global counter readback, native Page redo and
broader controls remain outside this acceptance result.

An additional static-text control test verified native storage/readback but
FAILED native control-type acceptance: the developer correctly reported that
Display Only/Invisible are not valid on Static Text. Its separately reviewed
inverse restored the original full checkpoint at version 563. Evidence is in
`page-control-review-native-validation.json`, explicitly marked FAILED for
native type validity. Repeat geometry/label on Static Text and use flags on a
field control after activating the guard fix.


The corrected control trial is now independently verified in the active 0.9.1
candidate. Full set `e419a3b0-1438-41c6-bf4d-af9a90552178` changed Static Text
21 geometry/label (six properties) and Edit Box 2 use flags (two properties),
with all eleven native table images matching the approved snapshot at version
564. The developer reopened Windows Application Designer and confirmed both
controls match. Freshly approved checkpoint inverse
`8c52441a-d3b0-48f6-83d3-9712713c46b1` restored the entire original semantic
scope at version 565, with fresh token and correct reversed dependencies.
Evidence is in `structured-review-native-validation.json`. The older Static
Text flag trial remains explicitly FAILED; this separate corrected acceptance
does not alter that evidence. Page redo, inserted controls and unsupported
structural operations remain outside this result.

Native Page redo (October 19, installed 0.9.6 candidate): a redo of inverse
`8c52441a…` was refused ("Live state changed since application") because the
page had been edited outside review since. A fresh description cycle on
`ZZ_PCODE_LAB_PG` then passed: apply `2709920a-7370-46af-99b3-33ff96c2fd7b`
(PSPNLDEFN.DESCR `Lab Page Edited` -> `Page redo acceptance`), checkpoint
inverse `3da9bfad-54ce-4eab-aa43-fadcae1a5160` and redo
`2c568d3c-d3ac-484a-8635-1ad2f7198b79`, each developer-approved, VERIFIED with
live MATCHES_RECORDED and independent description readback. The timeline
correctly marks the forward revision GAP after the unrecorded external edit,
then MATCHES_PREVIOUS for the inverse and redo. Inserted controls and other
structure remain outside this result.
