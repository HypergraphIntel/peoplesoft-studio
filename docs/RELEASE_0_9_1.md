# 0.9.1 release verification

Status: **all 0.9.1 acceptance gates passed; developer-authorized Git release snapshot**. Updated October 15, 2026.

Git release target: `main` and annotated tag `v0.9.1`. Their remote refs are
the completion evidence for commit/tag/push. Marketplace publishing and a
GitHub Release/artifact upload are separate and are not part of this Git release.

## Release scope

- Menu-first navigation, short contextual menus, at most two primary actions per
  view header, AI client setup in Settings and a Change Review sidebar.
- Durable proposals, exact-revision review, checkpoints, verified application,
  object history, reviewed reversal/redo and safe remaining-work preparation.
- Nine Oracle review adapter families: SQL, HTML, freeform style sheet,
  PeopleCode, Process, Query, bounded Page edits and existing Record/AE headers.
- Page visual before/after comparison and native control-type restrictions.
- Data Mover script templates, Recent Projects and the previously committed
  Configurator and Configurable Search discovery improvements in the changelog.

This is incremental experimental authoring. The complete Change Review proposal
is a larger initiative, with adapter coverage tracked in
[COVERAGE.md](change-review/COVERAGE.md). Future structural adapters, automatic
multi-object transactions, cross-environment promotion, Windows crash durability,
general native crash/lost-response certification and shared/retained history
management are outside the 0.9.1 completion claim. A deliberate pause is not a
crash test. Reversal of continued work still needs a combined recovery plan.

## Release gates

| Gate | Current state | Evidence / next action |
| --- | --- | --- |
| Package/lockfile version | Verified | Both are 0.9.1, matching MCP handshake and release tag |
| Source/documentation audit | Candidate claims updated | Corrected adapter counts, Data Mover status, staged/legacy approval guidance and published-vs-candidate labels |
| Full verify and HTTP/UI fixture suite | Passed for 0.9.1 candidate | 1,915 passed, one skipped, 36 HTTP/UI checks; handshake version checked against the manifest |
| Navigation reachability | Passed | 103 commands, nine views, primary-action limit; developer confirmed clear, uncluttered menu placement |
| Installed candidate activation | Final candidate verified after reload | Active MCP handshake 0.9.1, all nine adapters, installed bundle matches final artifact; native closeout rechecked |
| Native Query cycle | Reverified after 0.9.1 reload | Native current content/token, approval/checkpoint, reverse links and three verified timeline revisions match recorded redo |
| Native Page description cycle | Verified | Existing developer-approved apply/inverse; full eleven-table state restored |
| Correct Page control types | Verified apply, native Designer and checkpoint inverse | Developer confirmed Windows Application Designer matches; full Page scope restored at version 565 |
| Native Record/AE headers | Apply and checkpoint inverse verified | Six-/twenty-table semantic scopes restored exactly, fresh native tokens, fresh inverse approval and reversed dependencies verified |
| Native controlled pause/continuation | Verified, including final restoration | Native Record committed once, AE stayed untouched until fresh continuation approval, pinned Record unchanged, and both full original scopes restored |
| Package content/fingerprint | Passed; final candidate installed and reloaded | Manifest/contributions, bundle and normalized README/CHANGELOG match source; SHA-256 recorded below |
| Git release | Developer authorized | Commit to main and annotated v0.9.1 tag; verify matching origin refs |
| Distribution publication | Separate | No Marketplace publish or GitHub Release/artifact upload |

The failed Static Text flag trial is retained as failed native acceptance, not
converted into success. Its checkpoint restoration was verified at Page version
563. The corrected guard is implemented and fixture tested.

The final native closeout found zero operational pending Change Sets and zero
uncertain objects. The partial original remains truthful audit history, linked
to its completed continuation. No history was deleted or rewritten.
The release audit corrected the MCP handshake from its previous hard-coded
0.9.0 version to 0.9.1; the production HTTP test now prevents manifest/handshake
version drift. No encoder/decoder source changed, so no new corpus calibration
claim is made. The unrelated `tools/corpus/save-protocol/results/cs01-edit/`
capture remains untouched.

## Compatibility changes

Normal calls to migrated Oracle authoring tools return `REVIEW_REQUIRED` and a
Change Set ID instead of immediate-save success. Clients must poll and wait for
the developer's trusted workspace approval/application. `writes=allow` does not
skip that approval. Page/Record/AE structural operations are refused on their
bounded staged edit paths even though the native editor writers support more.
Legacy tools retain their existing confirmation/policy behavior.

History stores use schema 1 for ordinary sets and schema 2 for continuations;
older review builds must reject schema 2 rather than drop prerequisites. Release
notes and client instructions must preserve these boundaries.

## Controlled lab closeout

Only confirmed CUSTOM `ZZ_PCODE_LAB_PG`, `ZZ_RPT_LINE` and `ZZ_AE_LAB01` are used.
Capability checks precede every staging harness so an old schema cannot strip
review arguments and invoke an immediate legacy writer. Staging executes native
rollback validation and records live baseline hashes/tokens without committing.

1. Candidate activation is verified. The first three-object Page → Record → AE
   proposal was fully applied using the normal Apply action. Independent native
   acceptance and separately approved checkpoint inverse both passed; Windows
   Application Designer matched the Page controls before reversal.
2. `Native header pause validation` now stages two description-only changes:
   Record `ZZ_RPT_LINE` → AE `ZZ_AE_LAB01`. It starts from the verified original
   baselines. After fresh approval, the developer chooses **More actions → Apply
   one object, then pause**. Verify Record committed and AE remained untouched.
3. Prepare the untouched AE as fresh remaining work. The developer reviews and
   applies the continuation; verify AE and the pinned, unchanged Record.
4. Stage a fresh two-header baseline-restoration proposal from the retained
   original snapshots. Typed adapters must reproduce each full original scope.
   After separate developer approval/application, independently verify both
   original content hashes under fresh tokens. Page remains restored by the
   first cycle; it is not part of this second trial.

The partial original and its continuation stay auditable. Baseline restoration
is a fresh reviewed change, not a claim that combined continuation reversal is
supported. Native fault/crash behavior remains separately documented.

Closeout harness commands; acceptance modes only read, while stage/restore only prepare and validate proposals:

```sh
npx tsx tools/lab/structured-review-native-acceptance.mts applied
npx tsx tools/lab/structured-review-native-acceptance.mts reverted <inverse-id>
npx tsx tools/lab/structured-review-native-stage.mts --pause-headers
npx tsx tools/lab/structured-review-native-acceptance.mts --headers paused
npx tsx tools/lab/structured-review-native-acceptance.mts --headers remaining <continuation-id>
npx tsx tools/lab/structured-review-native-restore.mts --headers
npx tsx tools/lab/structured-review-native-acceptance.mts --headers restored <restoration-id>
```

The `restore` command stages and validates only. It cannot approve or apply.
All three new native harnesses pass strict standalone TypeScript checking;
that check is not a native acceptance result.

The first native proposal `e419a3b0-1438-41c6-bf4d-af9a90552178` was
fully applied using **Apply approved changes**. It is not pause evidence.
The developer confirmed the corrected Page in Windows Application Designer
before separately approving checkpoint inverse
`8c52441a-d3b0-48f6-83d3-9712713c46b1`. Independent checks passed fresh
approvals, complete native snapshots/tokens, reversed dependencies and the
original REVERTED backlink. Page was restored at version 565.

The separate two-header trial `7b01aa98-bf35-4ccf-8463-7f69113075ec`
then passed deliberate pause acceptance: exactly one Record write verified,
an explicit pause journal entry, and the full AE baseline/token unchanged.

Final native closeout passed: AE-only continuation
`0e67da7c-266d-4d78-9dee-1a0d7b586995` committed once while the pinned Record
snapshot/token stayed unchanged. Separately approved restoration
`2dca21dc-f930-458d-9cea-e86617736490` restored both complete original header
scopes under fresh tokens. A final read-only audit verified all three lab
objects at their original content hashes, Page still at version 565, zero
operational pending work and zero uncertain objects. The original partial
record remains unchanged and links to its completed continuation.

Final UI fixes keep the pause action visible but disabled before sufficient
approval, and classify a provably completed direct continuation's original
partial record in History. Actual unknown or mismatched outcomes remain pending.
Source/native-data checks and the production HTTP/UI suite pass (36 checks);
developer confirmed the actual VS Code menu and history display after the final candidate reload.

## Accepted candidate and release artifact

`peoplesoft-studio-0.9.1.vsix` was packaged and installed successfully.
The manifest/contributions and bundle exactly match source; README/CHANGELOG
match after only VSCE repository-link and same-repository issue-link rewriting.
SHA-256: `161f0d201010460a18cab2e539e626c321aa50e376a364678bbaa7c4602700b6`.
The developer reloaded the final candidate; activation and native readback pass.
Actual menu and history display inspection passed by developer confirmation.
Evidence: `tools/lab/results/release-0.9.1-readiness.json`.

Post-reload native readback passed again on October 15: all three lab scopes
remain restored, Page is version 565, zero operational pending work and zero
uncertain objects. The installed bundle SHA-256 matches the final artifact.

## Final visual acceptance — October 15, 2026

The developer confirmed Pending Changes shows 0, the native header pause original
is in History as completed via follow-up, and menu placement is clear and
uncluttered: “Yes — history and menus look right.” All acceptance gates for
this bounded candidate are complete. No further native lab changes are needed.
The developer then requested commit, tag and push. This document accompanies
that Git release snapshot; distribution publishing is a separate action.

The Git release package was rebuilt after finalizing the dated README/CHANGELOG.
Its runtime bundle matches the developer-accepted candidate exactly.
Release VSIX SHA-256: `bbc523827b3db65d07811cd81d4341ae171ebc8c990e67f0bab1b7b26d1550dc`.
The earlier fingerprint above identifies the installed acceptance candidate;
the evidence JSON records both artifacts.
