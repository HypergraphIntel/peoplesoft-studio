# Corpus Calibration Progress

## Checkpoint

- **Datasource mode**: LOCAL SNAPSHOT (`tools/corpus/hcdev-snapshot.sqlite`)
  throughout this entire session. `--live` was never used.
- **Protected baseline**: 430/430, confirmed clean as of this checkpoint
  (`npm run corpus:verify -- --limit 430`).
- **Last successful calibration**: Fix #96 (see below for its full
  description; Fixes #95-#96 are one validated commit). Fix #94 was
  committed at `8a55c61`; Fix #93 at `aef89e5`; Fix #92 at `c8a167e`;
  and Fix #91 at `16233cd`.
  (Fix #90's own code
  landed in commit `b17f9c7` "More encoder / decoder fixes" -- committed
  directly by the user's own editor tooling mid-session, capturing this
  fix's already-verified working-tree diff verbatim; content confirmed
  identical via `git show`.)
  **Mid-session git incident (2026-09-25, /goal resume session)**: a
  `git pull --rebase` replayed Fix #85-#89 onto an updated `origin/main`
  that has its OWN separate, parallel corpus-calibration work -- a
  DIFFERENT session/agent using the SAME "Fix #N" numbering scheme,
  currently at least through their own Fix #91 (multi-level `array of
  array` support, bare/untyped `array` parameters, a `While`-EOF-omission
  fix, and others -- unrelated to anything in this ledger's own Fix #85
  onward). The rebase itself completed cleanly, but a subsequent stash pop
  left `src/peoplecode/encoder.ts` with unresolved conflict markers AND
  silent duplicate-declaration corruption, committed as-is (`c73cc3e`).
  Fixed in commit `3b2597c` (see its own commit message for the full
  three-marker-conflict-plus-four-silent-duplication trail; verified via
  `tsc`, `npm test`, `corpus:verify --limit 430`, and a full corpus diff
  against this session's own last-known-good run 1545: 129 newly exact, 0
  regressed, confirming both bodies of work combined correctly). THIS
  PROGRESS FILE was ALSO clobbered by the same incident -- overwritten
  with an interleaved merge of this ledger's own content and origin's
  separate, same-numbered "Fix #85" through "Fix #91" write-ups -- and has
  been restored from this session's own last true pre-incident commit
  (`be8a8e4`, the parent of the `pull --rebase (start)` reflog entry) via
  `git checkout be8a8e4 -- .claude/corpus-progress.md`. Origin's own
  separate progress notes are NOT reproduced here (their code is already
  safely merged into `encoder.ts` and corpus-verified); if ever needed,
  they remain recoverable from git history at commit `c73cc3e` or later.
  Going forward this session, prefer `git commit` without `git pull
  --rebase` mid-session to avoid a repeat -- if a pull is genuinely
  needed, checkpoint `.claude/corpus-progress.md` to a scratch copy
  first.
- **Corpus total** (full-corpus run_id 1657, after Fixes #95-#96):
  22920/30209 exact (75.9%).
  Fix #73 was first rechecked against the already-equivalent full run 1326
  (run 1327: all 30209 materially unchanged). Subsequent full diffs were:
  Fix #74 run 1327 -> 1338 (2 exact, 4 advanced, 0 regressed); Fix #75 run
  1338 -> 1341 (1 advanced, 0 regressed); Fix #76 run 1341 -> 1348 (3
  exact, 2 advanced, 0 regressed); Fixes #77-#78 run 1348 -> 1357 (7 exact,
  38 advanced, 0 regressed); Fix #79 run 1357 -> 1364 (6 advanced, 0
  regressed); Fix #80 run 1364 -> 1371 (3 exact, 1 advanced, 0 regressed);
  Fix #81 run 1371 -> 1375 (1 exact, 0 regressed); Fix #82 run 1375 -> 1399
  (8 exact, 7 advanced, 0 regressed); Fix #83 run 1399 -> 1442 (15 exact,
  11 advanced, 0 regressed); Fix #84 run 1442 -> 1446 (1 exact, 0
  regressed); Fix #85 run 1446 -> 1457 (15 exact, 0 regressed, diffed
  directly against `corpus_run`/`result` rows in `corpus-results.sqlite`
  since both runs were full 30209-definition runs); Fix #86 run 1457 ->
  1509 (1 exact -- definition 843 -- 0 regressed against 1457, diffed the
  same way; two intermediate full runs during Fix #86's OWN development,
  1470 and 1494, each had a real, caught, and then repaired regression --
  see Fix #86's own notes below for the full two-round isolation trail);
  Fix #87 run 1509 -> 1521 (21 exact, 0 regressed); Fix #88 run 1521 ->
  1526 (11 exact, 0 regressed); Fix #89 run 1526 -> 1545 (66 exact, 0
  regressed -- resolves the `controlDepth` discriminator behind
  definitions 889/1749's own contradictions, documented in "Identified,
  not yet fixed" below; 1749 itself progressed but is not yet fully EXACT,
  see its own updated note). A mid-session git incident (rebase/stash-pop
  left `encoder.ts` and this progress file both corrupted; fully
  recovered, see below) interrupted the run-diff sequence between Fix #89
  and Fix #90 -- Fix #90 run 1578 -> 1587 (14 exact, 0 regressed, diffed
  against the merge-conflict-resolution commit's own full run rather than
  1545 directly, since that run already included both this session's
  work and `origin/main`'s separately-landed array-of-array/bare-array
  feature); Fix #91 run 1587 -> 1597 (1 exact, 0 regressed); Fix #92 run
  1597 -> 1622 (2 exact, 2 advanced, 0 regressed); Fix #93 run 1622 ->
  1628 (2 exact, 0 regressed); Fix #94 run 1628 -> 1638 (1 exact, 3
  advanced, 0 regressed); Fixes #95-#96 run 1638 -> 1657 (1 exact, 6
  advanced, 0 regressed). The
  protected gate remains 430/430.
- **Locally blocked / deferred, evidence exhausted this session** (see
  their own entries further down for full evidence trails): the `#If
  #ToolsRel` preprocessor-directive family (73 combined occurrences,
  environmental per-definition dependency, no local signal available);
  the general multi-method Application Class program feature gap (263+
  combined `import`/`Constants`/`Action`/`Utils`/`adhocAccessLogic`/etc.
  occurrences, `parseApplicationClassProgram()` only handles the narrow
  single-method inline shape); a decoder-only rendering gap for `Return
  <number> /* comment */;` noted under Fix #72 (narrow, not corpus-
  evidenced, deliberately left unfixed); definition 1305 (ARCH_WRK.
  PSARCH_RUN_SQL.FieldChange, newly deferred this session -- a bare
  RECORD.FIELD reference wrongly resolving to the implicit owner
  reference; a separate FetchValue-suppression hypothesis was tried,
  caused 19 regressions on the full corpus diff, and was reverted --
  see "Identified, not yet fixed" for the full trail). (Definition 889,
  deferred earlier this session, is RESOLVED by Fix #89 below -- no
  longer deferred. Definition 1749 progressed under Fix #89 but has a
  SECOND, deeper issue of its own -- still deferred, see its own updated
  note under "Identified, not yet fixed".)
- **Validation caveat**: after Fix #89, on top of Fix #88's commit
  `81afbce`, both `npx tsc -p . --noEmit` (whole project) and `npm test`
  (whole project: 477 tests, 476 pass, 1 pre-existing skip) are clean.
  Every post-fix protected gate is 430/430. A separate, unevidenced
  FetchValue change was tried and reverted after Fix #89 landed (see
  definition 1305's note); the working tree is clean of that attempt
  (`git checkout -- src/peoplecode/encoder.ts` after the revert,
  confirmed via `corpus:verify --limit 430`).
- **Next action**: resume failure-family triage from full run_id 1457 (group
  `corpus-results.sqlite`'s latest run by `classification`/`construct`,
  the same query used to find every target this session, or use `npm run
  corpus:next`). `npm run corpus:next` currently surfaces the `UNKNOWN_MISMATCH`
  / `(none)` catch-all bucket (4852 remaining) as highest raw priority;
  representatives from it must be triaged individually since the bucket
  itself has no single construct signature. The call-string, multiline-REM,
  and terminal-`#` families are calibrated below. Empty/simple Application
  Class definitions such as 28770 remain actionable but require adding
  explicit application-package ownership to encoder context; do not infer
  that owner from source text. The legacy `remark` family is calibrated
  below.

## Current target
- **Fix #96** landed locally (src/peoplecode/encoder.ts): `%metadata`,
  when it is the root component of an Application Class/package path,
  uses the system-variable opcode `0x12`, not the ordinary inline-name
  opcode `0x0A`; later colon-separated path components remain inline
  names. Definition 16084 provides complete stored-byte evidence in all
  three contexts present in the program (imports, Local class types, and
  runtime `create` paths) and is now fully EXACT after Fix #95 let it
  reach this first byte mismatch. Added a byte-exact `%metadata:Key`
  import regression.
- **Fix #95** landed locally (src/peoplecode/encoder.ts): a colon-qualified
  package constant such as `Key:Class_MacroSetId` is a valid expression
  operand. Stored bytes encode its components as ordinary inline names
  separated by the existing colon opcode `0x57`, without allocating a
  new PACKAGE dependency for the constant itself. Targeted ordinary event
  programs 16082, 16084, 16085, 17911, and 24645 all compile past this
  syntax; definition 16084 becomes exact once Fix #96 also corrects its
  `%metadata` path roots. The full run additionally identified 16498 and
  17821 as affected representatives. Added a
  byte-exact fragment regression. Combined full run 1638 -> 1657: 1
  exact, 6 advanced, 0 regressed. Full project `npm run typecheck` and
  `npm test` are clean (486 tests, 485 pass, 1 intentional skip);
  protected gate: 430/430.
- **Fix #94** landed locally (src/peoplecode/encoder.ts): an explicit
  `Record.REC` root may lead a method-call statement, not only an
  assignment. Four independent failures shared this parser rejection:
  `Record.CPQPROMPT1_WRK.CopyFieldsTo(&grPromptEdit);` (definition 3288),
  two sibling `CopyFieldsTo(...)` calls (3285 and 14778), and
  `Record.WKF_CNT_INC_ESP.GetField(&i).SetDefault();` (20920). The
  statement branch now accepts the already-fully-parsed primary when its
  consumed source ends in a method call; a non-call `Record.*` expression
  still fails unless followed by `=`, preserving the existing strict
  assignment validation. Definition 3288 is now fully EXACT; 3285,
  14778, and 20920 compile past this construct and expose later unrelated
  byte mismatches. Added a byte-exact fragment regression. Full run 1628
  -> 1638: 1 exact, 3 advanced, 0 regressed. Full project `npm run
  typecheck` and `npm test` are clean (484 tests, 483 pass, 1 intentional
  skip); protected gate: 430/430.
- **Fix #93** landed locally (src/peoplecode/encoder.ts): a `REM` between
  a completed `If` condition and `Then` is an opaque disabled-condition
  tail, encoded as the ordinary standalone-comment opcode `0x24`
  immediately before `Then`'s `0x1F`. Two independent HCDEV definitions
  prove the rule: 8781 has a single-line `REM ...;`, while 22751 has
  `REM And` followed by an indented `&tmp = 1;` continuation; stored
  places both physical lines of the latter in one 0x24 payload. The
  general REM continuation grammar remains deliberately narrow: the new
  indented continuation is enabled only by `ifStatement()` in its
  before-Then position, and only when that line closes with a semicolon,
  so ordinary REM comments cannot speculatively absorb executable code.
  Definitions 8781 and 22751 are both now source-to-binary EXACT,
  roundtrip EXACT, and source MATCH. Added a focused multiline regression
  test. Full run 1622 -> 1628: 2 exact, 0 regressed. Full project
  `npm run typecheck` and `npm test` are clean (483 tests, 482 pass, 1
  intentional skip); protected gate: 430/430.
- **Fix #92** landed locally (src/peoplecode/encoder.ts): ordinary
  `Component` declarations may preserve a trailing comma immediately
  before their semicolon. Four independent HCDEV definitions prove the
  same byte shape across scalar, Rowset, and array types: the comma is
  the normal `0x03` punctuation opcode followed directly by the ordinary
  declaration semicolon `0x15`, with no missing variable invented. For
  example, definition 21463's `Component string &NodeAttrSelected,;`
  stores `54 40 "string" 01 "&NodeAttrSelected" 03 15`, while definition
  14721 independently stores the same terminal `03 15` after four Rowset
  variables. The component-variable loop now stops after emitting a
  comma when the next token is `;`. Definitions 14721 and 21463 are now
  fully EXACT. Definitions 17309 and 21578 both compile past the formerly
  unsupported declaration and expose later, unrelated mismatches (17309:
  body offset 10833, comment-boundary shape; 21578: body offset 2361,
  reference indices), so they advanced from ENCODE_ERROR without being
  claimed exact. Added a byte-level regression covering both an ordinary
  separator and a trailing comma. Full run 1597 -> 1622: 2 exact, 2
  advanced, 0 regressed. Full project `npm run typecheck` and `npm test`
  are clean (482 tests, 481 pass, 1 intentional skip); protected gate:
  430/430.
- **Fix #91** landed locally (src/peoplecode/encoder.ts): the FIELD half of
  an explicit `Record.REC.FIELD.Value` chain (the calibrated
  `explicitRecordRootName`/`explicitRecordFields` mechanism, keyed by
  `controlGroup:rootRecordName:fieldName`) now ALSO falls back to the
  shared, name-only `declaredRecordFields` pool
  (`controlGroup:fieldName`) already used by the Record-variable and
  row-shorthand FIELD-reuse mechanisms, and writes into that same shared
  pool. ACL_WS_WRK.WSOPRACCESS.SaveEdit (definition 437) proves the FIELD
  half is reusable by NAME ALONE across a DIFFERENT root record within
  the same control group: `&classid = Record.PTIBMAPAUTH_VW.CLASSID.
  Value;` (an If-branch) and `&classid = Record.PSAUTHWS_VW1.CLASSID.
  Value;` (its Else) -- stored has exactly ONE `FIELD`/`CLASSID`
  PSPCMNAME row (RECNAME is the literal placeholder `'FIELD'`, with no
  link to either owning record at all), reused for both, even though the
  RECORD half of each chain still allocates its own fresh row (different
  literal record names). The pre-existing `explicitRecordFields` map,
  scoped by root-record-name, could never find this cross-record reuse.
  Mirrors the ALREADY-proven cross-Record-variable case one mechanism
  over (ACCOMPLISHMENTS.EMPLID.SavePostChange, cited in that map's own
  comment) -- this is the missing THIRD leg of a pool the code already
  treats as shared across every other FIELD-reaching syntax. Definition
  437 is now source->bin EXACT, roundtrip EXACT, source MATCH; every
  other definition this pool touches (381, 24, 535, 772) re-verified
  individually EXACT. Full run 1587 -> 1597: 1 exact, 0 regressed (a
  narrow, rare shape). Added a minimal-fragment byte-level regression
  test. Full project `tsc -p . --noEmit` and `npm test` (481 tests, 480
  pass, 1 pre-existing skip) both clean; protected gate: 430/430.
- **Fix #90** landed locally (src/peoplecode/encoder.ts): `quotedReference()`'s
  0x48 quoted-reference dedup (`MenuName."X"`, `BarName."USE"`, etc.) is now
  scoped by `controlGroup`, not global across the whole program. The
  original mechanism (`references.find(item => item.kind ===
  'quoted-reference' && ...)`, unconditional, no scoping at all) was
  evidenced by ACA_XML_WRK.ACA_UPDATE_PB.FieldChange (definition 369):
  two `Transfer(...)` calls with an identical `MenuName."ACA_SETUP_RPT"`/
  `BarName."USE"` pair, both nested inside ONE top-level `If %Page =
  "ACA_XMIT_ACK" Then ... Else If All(...) Then ... End-If; End-If;` (one
  control group), both reuse the same PSPCMNAME rows. AE_DERIVED.
  AE_TEMPTBL_BTN.FieldChange (definition 805) disproves the GLOBAL
  reading directly: its own two `Transfer(...)` calls, with an identical
  `BarName."USE"`, sit in two SEPARATE top-level `If` statements --
  different control groups -- and stored allocates a completely fresh row
  for the second call's `BarName."USE"` (NAMENUM 15, not reusing NAMENUM
  7's row from the first call); generated wrongly reused it (and, worse,
  reused the WRONG earlier row -- `ItemName`'s, not even `BarName`'s own
  -- since the global `.find()` matches whichever same-qualifier-and-value
  entry happens to exist anywhere in `references`, with no adjacency or
  scoping signal at all). Fixed with a dedicated
  `quotedReferencesByControlGroup` map keyed by
  `${controlGroup}:${qualifier}:${value}`, mirroring every other
  control-group-scoped reuse mechanism already in this file. Definitions
  369 and 805 are both now source->bin EXACT, roundtrip EXACT, source
  MATCH (369 was already EXACT before this fix; confirmed still EXACT
  after). Full run 1578 -> 1587: 14 exact, 0 regressed. Added two
  minimal-fragment byte-level regression tests, one per evidence shape.
  Full project `tsc -p . --noEmit` and `npm test` (480 tests, 479 pass, 1
  pre-existing skip) both clean; protected gate: 430/430. (Code landed in
  commit `b17f9c7`, committed by the user's own editor tooling mid-
  session under a generic message -- see this file's Checkpoint section
  for the full mid-session git-incident trail.)
- **Fix #89** landed locally (src/peoplecode/encoder.ts): a RECORD name
  REPEATED within a RowScrollSelect-family call's own argument list (e.g.
  `RowScrollSelect(1, Record.X, Record.X, ...)`) may now ALSO reuse an
  earlier same-control-group row via `genericRecordReferencesSinceLastFamilyCall`
  (Fix #86's fallback pool) -- but only when nested inside a control-flow
  block (`controlDepth > 0`: If/For/While/Evaluate/etc), not at the flat
  top level. This resolves the exact contradiction Fix #87's session left
  deferred as definition 889: AE_WRK.AE_REFRESH.FieldChange's `ScrollFlush
  (Record.MESSAGE_LOG); RowScrollSelect(1, Record.MESSAGE_LOG, Record.
  MESSAGE_LOG, ...)` -- textually IDENTICAL to definition 840's own
  calibrated non-reuse disproof -- sits inside a Function's `Evaluate ...
  When` body (`controlDepth > 0`), while 840's copy sits at flat top level
  (`controlDepth === 0`). AMM_DERIVED.PT_FORCE_RETRY.FieldChange
  (definition 1007, nested only in top-level `If` blocks, no Function at
  all) independently confirms `controlDepth`, not `functionDepth`, is the
  actual discriminator. ARCH_FLT_RQST.PSARCH_ID.SavePostChange (definition
  1220, the ORIGINAL single-occurrence-fallback evidence) is itself nested
  inside its own `If %PanelGroup = ... Then` block, and ARCH_WRK.
  PSARCH_COPY_ROWS.FieldChange's (definition 1283) own repeated-name
  ScrollFlush/ScrollSelect pairs sit at flat top level -- so this was
  always the missing half of the ORIGINAL rule, not a new one. Implemented
  by widening the existing single-occurrence fallback's guard from
  `singleOccurrenceCallArgumentRecordNames?.has(name)` to `... || controlDepth
  > 0`; every previously-calibrated definition this whole mechanism
  touches (840, 1283, 1220, 1145, 1236, 30, 95, 1172, and Fix #86/#87's own
  843/860/5687/982) re-verified individually EXACT. Definitions 889 and
  1007 are now source->bin EXACT, roundtrip EXACT, source MATCH.
  DERIVED_BAS.BN_TOGGLE.ODEM_RemoteCall (definition 1749, an EARLIER
  session's own deferred sub-puzzle citing this exact contradiction)
  progressed -- first diff moved from body offset 717 to 1089 -- but is
  NOT yet fully EXACT; see its own updated note under "Identified, not yet
  fixed" for the SECOND, deeper issue this fix uncovered (an intervening
  RowScrollSelect-family call appears to invalidate the WHOLE fallback
  pool even at `controlDepth > 0`, when stored evidence suggests it
  should not for an unrelated key -- deliberately NOT chased further this
  session to avoid a third speculative change in one session to this
  already twice-regressed area). Full run 1526 -> 1545: 66 exact, 0
  regressed -- by far the largest single improvement this session, meaning
  this exact shape (single-arg `ScrollFlush` immediately followed by a
  repeated-name RowScrollSelect/RowScrollSelectNew/ScrollSelect call,
  nested in a control-flow block) is very common in the corpus. Added a
  minimal-fragment byte-level regression test. Full project `tsc -p .
  --noEmit` and `npm test` (477 tests, 476 pass, 1 pre-existing skip) both
  clean; protected gate: 430/430.
- **Fix #88** landed locally (src/peoplecode/encoder.ts): `parseFunctionMetadata`
  (which scans raw source text for top-level `Function NAME` headers to
  build the program's function directory/trailer) now scans a
  comment-and-string-masked copy of the source instead of the raw text.
  AE_WRK.MESSAGE_NBR.FieldChange (definition 908) proves the gap: a whole
  `Function Check_Integrity ... End-Function;` definition sits inside a
  leading `/* ... */` block comment, ahead of two real Functions
  (`load_stmt`, `Check_Syntax`). The unmasked regex scan matched
  "Check_Integrity" as a genuine third function purely because the text
  "Function Check_Integrity" appears at a line start -- it has no
  awareness of comments at all -- inflating the stored function-directory
  count from 2 to 3 and adding a spurious metadata/trailer entry (stored
  4174 bytes vs generated 4222). AE_WRK.FUNCLIB.FieldChange (definition
  907, a larger program with the exact same shape) is fixed by the same
  change. New helper `maskCommentsAndStringLiteralsForFunctionScan`
  replaces block comments and double-quoted string literals with
  same-length runs of spaces (preserving every other character's
  position, so all the existing offset arithmetic in
  `parseFunctionMetadata` -- `source.indexOf(')', parameterStart)`,
  `source.slice(...)` -- still reads the correct, unmasked text); only the
  regex matching itself runs against the masked copy. Definitions 907 and
  908 are now source->bin EXACT, roundtrip EXACT, source MATCH. Full run
  1521 -> 1526: 11 exact, 0 regressed. Added a minimal-fragment,
  full-program byte-level regression test. Full project `tsc -p .
  --noEmit` and `npm test` (476 tests, 475 pass, 1 pre-existing skip) both
  clean; protected gate: 430/430.
- **Fix #87** landed locally (src/peoplecode/encoder.ts): `Record.X.MEMBER`
  now excludes the six inline Row state/property members (`RowNumber`,
  `IsNew`, `IsDeleted`, `IsChanged`, `Visible`, `Selected`) from the
  "explicit `Record.REC.FIELD` chain" detector. AMM_DERIVED.IB_FO_BACK_PB.
  FieldChange (definition 982) proves it: `If Record.AMM_DERIVED.IsChanged
  = True Or ...` matched the chain regex (which only checks for two dotted
  identifiers after `Record`, e.g. `Record.REC.FIELD`, with no requirement
  for a genuine third `.Value`-style continuation), setting
  `expectedReferenceMember` to `'field'` mode. That prevented the postfix
  loop's own `isInlineRowStateMember` check (which requires `'record'`
  mode, and already correctly keeps a Row VARIABLE's `.IsChanged` inline)
  from ever running, so `IsChanged` got compiled as an attempted FIELD
  PSPCMNAME reference instead of staying inline text. Stored emits `21
  <ref> 05 0A "IsChanged"` -- the RECORD reference alone, no FIELD row.
  Fixed by checking the second dotted segment against the same row-state
  regex `isInlineRowStateMember` already uses, and skipping the
  explicit-chain branch (falling back to plain `recordReference()`, which
  correctly leaves `expectedReferenceMember` unset for a bare `Record.X`
  literal base) when it matches. Definition 982 is now source->bin EXACT,
  roundtrip EXACT, source MATCH. Full run 1509 -> 1521: 21 exact, 0
  regressed -- a broad, evidently common shape (`Record.X.IsChanged`/
  `.IsNew`/etc. used directly in a boolean condition, without going
  through a Row variable first). Added a minimal-fragment byte-level
  regression test. Full project `tsc -p . --noEmit` and `npm test` (475
  tests, 474 pass, 1 pre-existing skip) both clean; protected gate:
  430/430.
- **Fix #86** landed locally (src/peoplecode/encoder.ts): the
  `singleOccurrenceCallArgumentRecordNames` fallback (a RowScrollSelect/
  RowScrollSelectNew/ScrollSelect call's own Record.X argument, appearing
  once in that call, may reuse an earlier same-control-group row) read
  straight from `recordReferencesByControlGroup` -- the shared pool EVERY
  Record.X allocation writes to, including a RowScrollSelect-family call's
  OWN "last call argument becomes visible" write (evidenced separately for
  a LATER UpdateValue-style reader, definition 1145). AE_UPGCONV_WRK.
  UPGPATH.FieldChange (definition 843) disproves reading that shared pool
  here: `ScrollFlush(Record.PSAEAPPLDEFN); RowScrollSelect(1, Record.
  UPGCONV_DEFN, Record.UPGCONV_DEFN); RowScrollSelectNew(1, Record.
  UPGCONV_DEFN, Record.PSAEAPPLDEFN, "...", &UPGPATH);` -- RowScrollSelectNew's
  own UPGCONV_DEFN and PSAEAPPLDEFN arguments both allocate fresh rows
  (NAMENUM 4/5) in the stored program, reusing neither the intervening
  RowScrollSelect's own row nor ScrollFlush's earlier row two statements
  back.
  First attempt (reverted mid-session, see below) tried a narrower
  "immediately preceding call was specifically ScrollFlush" rule, which
  caused a REAL, CAUGHT regression on full run 1470 (definition 860,
  AE_WRK.AE_DECIDE.SavePreChange: a bare `ScrollSelectNew(...)`, not
  itself a RowScrollSelect-family name, immediately followed in the
  sibling Else branch by `ScrollSelect(...)` reusing ScrollSelectNew's
  rows -- proving the fallback is still real for a NON-ScrollFlush earlier
  call). Root cause, once isolated: the true distinguishing factor is not
  "was the earlier call specifically ScrollFlush" but whether a
  RowScrollSelect-family call (RowScrollSelect, RowScrollSelectNew, or
  bare ScrollSelect) has intervened since the earlier allocation. Fixed
  properly with `genericRecordReferencesSinceLastFamilyCall`, a map that
  mirrors `recordReferencesByControlGroup`'s own ordinary (non-call-private)
  writes but is entirely cleared in the `finally` block of every
  RowScrollSelect-family call (after that call's own resolution has
  already read it) -- so it carries a row forward across an ordinary call
  or an If/Else sibling-branch boundary, but not across a RowScrollSelect-
  family call.
  Second attempt (also reverted mid-session) applied that rule but caused
  a SECOND real, caught regression on full run 1494 (definition 5687,
  DERIVED_HR.LOOKUP_NID_BTN.FieldChange: `ScrollFlush(Record.NID_SRCH_VW)`
  inside an If's Else branch REUSES NID_SRCH_VW via the separate
  `reuseRecordReferenceWithinControlGroup` check -- a short-circuit return
  that never reached the generic-write code path my new map's population
  was scoped to, so the map stayed empty and the Else branch's own
  ScrollSelect wrongly allocated a fresh row instead of reusing the SAME
  NID_SRCH_VW row all four calls, across both branches, share in the
  stored program). Fixed by also re-populating
  `genericRecordReferencesSinceLastFamilyCall` at that specific reuse
  check, not just at fresh generic allocations.
  All three shapes (843 deny, 860 allow, 5687 allow-via-repopulation) now
  verified individually EXACT, plus every previously-calibrated definition
  this whole mechanism touches (1220, 1283, 840, 1145, 1236, 30, 95, 1172).
  Full run 1457 -> 1509: 1 exact (843; 860 and 5687 were already EXACT at
  1457, so they show as "unchanged", not "improved", despite being the
  regressions caught and repaired mid-session against the broken
  intermediate attempts), 0 regressed. Added three minimal-fragment
  byte-level regression tests, one per evidence shape. Full project
  `tsc -p . --noEmit` and `npm test` (474 tests, 473 pass, 1 pre-existing
  skip) both clean; protected gate: 430/430.
- **Fix #85** landed locally (src/peoplecode/encoder.ts): a later, unrelated
  initialized top-level `Local` no longer retroactively suppresses an
  earlier leading-Local declaration-section `0x2D` boundary. The
  `leadingRunHasInitializedLocal` setter's first branch condition was
  `!closedTopLevelDeclarationSection` alone, which is vacuously true in any
  program with no `Declare Function`/top-level declaration section at all
  (`sawTopLevelDeclaration` stays false, so `closedTopLevelDeclarationSection`
  never becomes true either) -- so ANY initialized top-level Local anywhere
  later in the source, even one with no relationship to the earlier leading
  Local run, wrongly set the flag and suppressed that earlier run's `0x2D`.
  Definition 528 (ADDRESS_TYPE_FL.ADDRESS_TYPE.RowDelete) proves this:
  `Local SQL &SQL1;` (uninitialized, reference-bearing) is followed by
  `SQLExec(...)` and an assignment, THEN `Local Record &recContact =
  CreateRecord(Record.EMERGENCY_CNTCT);` (initialized) -- the stored program
  closes the FIRST Local's section with `15 2D 4F` before `SQLExec`, but the
  generated program dropped the `2D`, landing one byte short (1569 vs stored
  1570) starting at body offset 191. Fixed by requiring
  `sawTopLevelDeclaration &&` before `!closedTopLevelDeclarationSection` in
  that branch, matching the sibling `closesTopLevelDeclarationSection` check
  a few dozen lines away which already has this guard. The DERIVED_GPFRDSN
  (`Declare Function` still open) and CAFNUI_CTRL_WRK (Application Class
  Local) calibrated cases that originally motivated this flag both still
  pass, since both have `sawTopLevelDeclaration` true or hit the untouched
  Application Class branch. Definition 528 is now source->bin EXACT,
  roundtrip EXACT, source MATCH. Full run 1446 -> 1457: 15 exact, 30194
  unchanged, 0 regressed. Added a minimal-fragment byte-level regression
  test reproducing the same shape. Full project `tsc -p . --noEmit` clean;
  full `npm test` 471 tests, 470 pass, 1 pre-existing skip; protected gate:
  430/430.
- **Fix #84** landed locally (src/peoplecode/encoder.ts): quoted Component
  metadata references now dispatch through the already-calibrated quoted-name
  `0x48` encoder before the bare `Component.NAME` reference parser. Definition
  13326 proves `%Component = Component."HRS_PKG_MDL_APP"` is PSPCMNAME
  `COMPONENT/HRS_PKG_MDL_APP` and executable bytes `48 <uint16 reference
  index>`; both encoder and decoder qualifier maps already contained
  `COMPONENT`, so no new binary semantics were introduced. Definition 13326
  is now source->bin EXACT, roundtrip EXACT, and source MATCH. Full run 1442
  -> 1446: 1 exact, 30208 unchanged, 0 regressed. Added a test proving quoted
  Component uses `0x48` while bare Component still uses `0x21`. Relevant
  encoder suite: 115/116 pass (1 pre-existing skip); protected gate: 430/430.
- **Fix #83** landed locally (src/peoplecode/encoder.ts): captured PeopleCode
  variable names may begin with a digit and may end with `#`. The lexer had
  historically allowed either an ordinary letter/underscore-led identifier
  OR digits-only (`&123`) but rejected the evidenced mixed digit-led forms
  (`&6x_plan_changed`, `&2ndParm`, `&80EE_pin_num`) and stopped before `#`
  in names such as `&TotalRow#`. All variable parsers and structural
  lookaheads now use the same `&[A-Za-z0-9_]+#?` grammar, including Local /
  Component declarations, expressions, comparison/group lookaheads, Function
  metadata, and the narrow Application Class parser. Captures 20483/20495
  prove digit-led declaration/assignment use; 15118 proves terminal-`#`
  declarations, assignments, comparisons, and loop bounds. A snapshot scan
  found 27 digit-led-variable definitions and 11 terminal-`#` definitions.
  Full run 1399 -> 1442: 15 became fully EXACT; 11 advanced to independent
  later states; 30183 unchanged; 0 regressed. Added a semantic binary
  roundtrip test covering both forms. Relevant encoder suite: 114/115 pass
  (1 pre-existing skip); protected gate: 430/430.
- **Fix #82** landed locally (src/peoplecode/encoder.ts): legacy `remark`
  statements use the exact same calibrated comment parser as `REM` at every
  existing top-level/control-flow/Function-body placement. Captured definition
  14278 proves the original `remark` spelling and semicolon are stored intact
  as one `0x24 <uint16 byte length> <UTF-16LE payload>` record, not normalized
  to `REM`; definitions 11198, 20696, and 2708 independently prove If-body and
  Function-body placements. A complete snapshot scan found 17 definitions / 83
  physical `remark` lines, including immediately-consecutive and
  semicolon-less forms handled by the already-calibrated continuation logic.
  Full run 1375 -> 1399: definitions 2708, 4305, 5749, 6291, 6293, 11198,
  14278, and 20696 became fully EXACT; 6274, 6276, 6284, 6285, 6287, 6288,
  and 6290 advanced to independent later failures; 25951 and 25960 remain
  unchanged because earlier untyped-array syntax blocks them before their
  remark lines. Totals: 8 exact, 7 advanced, 30194 unchanged, 0 regressed.
  Added a byte-level `remark` payload test. Relevant encoder suite: 113/114
  pass (1 pre-existing skip); protected gate: 430/430.
- **Fix #81** landed locally (src/peoplecode/encoder.ts): declared Function
  and bare call identifiers may have the corpus-observed optional terminal
  `#` (`assign_seq#`), while `#` remains unsupported anywhere else in an
  identifier. Definition 3428 stores the name identically in the declaration
  and call (`0A` inline-name payload), and is now source->bin EXACT,
  roundtrip EXACT, and source MATCH. Full run 1371 -> 1375: 1 exact, 30208
  unchanged, 0 regressed. Added a complete captured-program golden.
  Relevant encoder suite: 112/113 pass (1 pre-existing skip); protected gate:
  430/430. Full-project typecheck is currently blocked by the unrelated MCP
  edits recorded in the checkpoint above.
- **Fix #80** landed locally (src/peoplecode/encoder.ts): a REM statement
  lacking a semicolon on its first physical line may continue onto the
  captured single-space prose form without repeating `REM`. PeopleTools
  stores the newline, leading space, continuation text, and final semicolon
  together in one `0x24` UTF-16 payload. The rule is deliberately limited to
  exactly one leading space followed by a non-whitespace character so an
  ordinary indented PeopleCode statement is not swallowed. Snapshot search
  found exactly definitions 5424-5426 in this source shape; all three became
  fully EXACT. Definition 27369 also advanced from body offset 5 to 1088: its
  common-indent-relative continuation is the same captured shape. Full run
  1364 -> 1371: 3 exact, 1 advanced, 30205 unchanged, 0 regressed. Added a
  byte-level payload test; protected gate: 430/430.
- **Fix #79** landed locally (src/peoplecode/encoder.ts): the dispatcher no
  longer uses a regex that can mistake dotted JavaScript text inside a quoted
  bare-call argument for a PeopleCode call-result property assignment. A
  balanced lexical lookahead now skips doubled-quote PeopleCode strings and
  block comments while walking call/member/index postfixes, and selects the
  property-assignment branch only when a real source-level `=` follows the
  chain. Definitions 11121, 11126, 11128, 18960, 23465, and 23466 all
  advanced past `expected assignment = after call-result property` to their
  independent later mismatches; none became exact. Full run 1357 -> 1364: 6
  advanced, 30203 unchanged, 0 regressed. Added a focused
  `AddOnLoadScript("document.getElementById(...).style.visibility = ...")`
  regression test. At this point full typecheck and complete tests passed
  (465 total, 464 pass, 1 pre-existing skip); protected gate: 430/430.
- **Fix #78** landed locally (src/peoplecode/encoder.ts): encode parsed
  `Continue;` statements directly as context-gated opcode `0x6E`. The
  general fixed-token table deliberately still leaves 0x6E unmapped because
  it is overloaded outside the statement shape; inside `statement()` the
  source keyword makes the selection unambiguous. Seed definitions 14194,
  14195, and 14196 all store `Else Continue;` as `19 6E 15`. Combined with
  Fix #77, those three advanced from `ENCODE_ERROR` to deeper
  `UNKNOWN_MISMATCH`. Full run 1348 -> 1357 found 7 definitions newly exact,
  38 advanced, 30164 unchanged, 0 regressed. New total: 22628/30209 exact.
  Verified: `npm run typecheck`; `npm test` 463/464 (1 pre-existing skip);
  `corpus:verify --limit 430` 430/430.
- **Fix #77** landed locally (src/peoplecode/encoder.ts): a parenthesized
  variable/field expression followed by a postfix member in an If condition
  (for example `(&recRunCtlLang.LANGUAGE_CD).IsInBuf`) is an object/value
  primary with a postfix chain, not necessarily a parenthesized boolean
  subexpression. Route that narrow shape through `comparisonExpression()` so
  `primary()` consumes both the group and `.IsInBuf`. Definitions 14194-14196
  all advanced past their shared `expected Then` failure to the separately
  calibrated Continue opcode gap. Added a focused regression test.
- **Fix #76** landed locally (src/peoplecode/encoder.ts): parenthesized
  comparisons whose left operand is a system variable now select
  `booleanExpression()`, covering `(%Mode <> %Action_Add)`. Four independent
  definitions proved the same `0B 12 ... 10 12 ... 14` shape: 11810, 11892,
  and 19201 became fully EXACT; 12250 advanced to an unrelated unsupported
  statement at source offset 621. Full run 1341 -> 1348: 3 exact, 2 advanced,
  30204 unchanged, 0 regressed. Added a focused byte-shape regression test.
  Verified: `npm run typecheck`; `npm test` 461/462 (1 pre-existing skip);
  `corpus:verify --limit 430` 430/430.
- **Fix #75** landed locally (src/peoplecode/encoder.ts): When-Other body
  statements now preserve block comments between the expression and its
  explicit semicolon using the existing placement-dependent 0x4E/0x24
  machinery. Definition 5000's inline `True /*False*/;` advanced from its
  later `ENCODE_ERROR` to the pre-existing reference-index mismatch at body
  offset 3204. Full run 1338 -> 1341: only definition 5000 changed, 30208
  unchanged, 0 regressed. Added a focused regression test. Verified:
  `npm run typecheck`; `npm test` 460/461 (1 pre-existing skip);
  `corpus:verify --limit 430` 430/430.
- **Fix #74** landed locally (src/peoplecode/encoder.ts): the final statement
  in a When-Other body may omit its source semicolon immediately before
  `End-Evaluate`, matching the already-calibrated ordinary When-body rule.
  Definitions 12623 and 12626 became fully EXACT; 10488 and 15626 advanced
  to deeper `UNKNOWN_MISMATCH`; 27819 advanced to its decoder-only source
  mismatch; 5000 advanced to Fix #75's later comment-placement gap. Full run
  1327 -> 1338: 2 exact, 4 advanced, 30203 unchanged, 0 regressed. Added a
  focused regression test. Verified: `npm run typecheck`; `npm test` 459/460
  (1 pre-existing skip); `corpus:verify --limit 430` 430/430.
- **Fix #73** landed (src/peoplecode/encoder.ts, `whileStatement()`'s
  body loop): the final statement in a `While` body may omit its source
  semicolon when immediately followed by `End-While`, exactly the same
  relaxation `forStatement()`'s body loop already has for `End-For` --
  `whileStatement()`'s own body loop had no such allowance at all,
  failing unconditionally whenever the last statement lacked its own
  `;`. Mirrored the existing For-body code shape precisely (check
  `/^End-While\b/i` before failing, `continue` back to the loop's own
  `word('End-While')` handling on the next iteration instead of
  consuming a `;`).
  Target: definition 7041 (GPGB_RC_CTL.GPGB_RC_APPLD.FieldFormula):
  ```
  While ...
     ...
     &i = &i + 1
  End-While;
  ```
  confirmed full EXACT. Searched the corpus for the "expected ; in While
  body" `ENCODE_ERROR` construct family (6 sampled): 1 confirmed fully
  EXACT (7041 above), 4 advanced past the While-body-omission construct
  into separate, unrelated, deeper reference-index/structural issues in
  larger programs (5014, 7541, 9686, 10284), 1 hit a different, unrelated
  "unsupported PeopleCode statement" error further into the file (9670)
  -- all 5 non-exact candidates confirmed via git-stash comparison to
  have failed at the targeted construct before this fix, zero
  regressions. Verified: `npx tsc -p .` clean; `npm test` 458/459 (1
  pre-existing skip); `corpus:verify --limit 430` 430/430, 0
  regressions. Full-corpus run 1327 also matched the prior full run 1326 on
  all 30209 definitions (0 regressions).
- **Fix #72** landed (src/peoplecode/encoder.ts), four related comment-
  placement gaps found together via the `BLOCK_COMMENT` `ENCODE_ERROR`
  family, all fixed with the same `restStartsWithKeywordPastComments()`/
  `blockCommentByPlacement()` machinery Fix #70 introduced:
  1. **`booleanUnary()`'s comment-after-operator handling was hardcoded
     inline-only**: a comment right after `And`/`Or` (before its right
     operand) always used `inlineBlockComment()` (0x4E), but a
     STANDALONE (own-line) comment there needs `blockComment()` (0x24).
     HS_EXAM_AUDIO2.<various>.FieldChange (definition 1353) proves it
     with TWO own-line comments in a row after `And`.
  2. **Top-level statements had no comment-before-`;` handling at all**
     (If/For/While bodies already did): added the same placement-aware
     comment loop right before the top-level `;` check.
     HR_LINK_WRK.DESCR.FieldFormula (definition 18680):
     `X = MsgGetText(...) /* Go to */;`.
  3. **The EOF-omission "trailing standalone comment" allowance
     (`assignmentBeforeFinalStandaloneComment`) was scoped only to plain
     assignments**, not the other self-terminating-at-EOF statement
     types (If/Evaluate/For/bare-call/etc.) added across Fixes #60/#68.
     Generalized to `selfTerminatingBeforeFinalStandaloneComment`,
     covering all of them. HS_EXAM_AUDIO2.<various>.FieldChange
     (definition 1353, same target as #1) also needed this half: a
     top-level `If ... End-If` (no `;`) followed by one standalone
     comment then true EOF.
  4. **A When-body statement omitting its own `;` before the next
     `When`/`End-Evaluate` had no allowance for a standalone comment in
     between** (unlike If/For bodies, which already tolerate one).
     CAR_PLAN_TBL.MAX_LIST_AMT.FieldFormula (definition 2484): a nested
     `If ... End-If` (no `;`) followed by `/* Lease */` then `When =
     "L"`.
  Searched the corpus for the `BLOCK_COMMENT`-construct `ENCODE_ERROR`
  family (11 occurrences, all sampled): 8 confirmed fully EXACT (1353,
  2484, 3684, 4393, 6508, 11192, 16873, 18680), 2 advanced past their
  respective comment-placement construct into separate, unrelated,
  deeper reference-index/structural issues (18580, 23802), confirmed via
  git-stash comparison to have failed at the targeted construct before
  this fix -- zero regressions. **One pre-existing test needed
  updating**: `encoderNumbers.test.ts`'s `Return 1 /* comment */;` was
  in the "unsupported" list (predating any comment-before-top-level-`;`
  support) -- removed without adding a replacement assertion, since a
  synthetic round-trip check for that exact input surfaced a separate,
  narrower, decoder-only rendering gap (a same-line `Return <number>
  /* comment */;` renders across three lines instead of one) that is
  outside this fix's corpus-evidenced scope; noted here rather than
  silently patched over, for a future session searching the corpus for
  that specific decoder shape. Verified: `npx tsc -p .` clean; `npm
  test` 458/459 (1 pre-existing skip); `corpus:verify --limit 430`
  430/430, 0 regressions. Full-corpus background diff (run_id 284 ->
  286, all 30,209 definitions) confirmed: 24 improved, 0 regressed,
  30185 unchanged. New corpus total: 22506/30209 exact (74.5%).
- **Fix #71** landed (src/peoplecode/encoder.ts): a statement immediately
  followed by a `REM ...;` comment (no semicolon of its own) may omit
  its trailing source semicolon, in two contexts:
  1. **Inside an If body**: added `REM` to the existing `Else`/`End-If`
     omission-allowance list at the If-body statement-terminator check.
     Target: definition 13181 (FUNCLIB_HR.FIELDVALUE_ERROR.FieldEdit):
     ```
     Error MsgGet(2050, 10, "Field Text Type required for Field Type of VALUE")
     rem error "Text cannot be blank for VALUE field type ";
     End-If;
     ```
  2. **At the top level**: added a `precedesRemStatement` check
     (unrestricted by EOF, since the REM statement need not be the last
     thing in the file -- the top-level loop's own dedicated REM branch
     picks it up cleanly on its next iteration). Target: definition 2175
     (CAF_FACTOR_360.CAF_CLOSE_BTN.FieldChange):
     ```
     &cmpSession.Configuration.ComparisonHandler.
         DeleteFactorfromAnalysisGrouplets(&RS_Flt_Factor360(&save_i_flt_fac))
     rem &cmpSession.ProcessNUIAction("updfactor");
     ```
  Searched the corpus for the "expected ;"/"expected ; in If body"
  `ENCODE_ERROR` family sharing this `rem`-adjacent shape (9 sampled):
  7 confirmed fully EXACT (13155, 13174, 13181, 13182, 13192, 13208,
  5462), 2 advanced past the statement-before-REM construct into
  separate, unrelated, small reference-index mismatches (2175, 13179),
  confirmed via git-stash comparison to have failed at this exact
  construct before the fix -- zero regressions. Verified: `npx tsc -p .`
  clean; `npm test` 459/460 (1 pre-existing skip); `corpus:verify
  --limit 430` 430/430, 0 regressions. Full-corpus background diff
  (run_id 282 -> 284, all 30,209 definitions) confirmed: 9 improved, 0
  regressed, 30200 unchanged. New corpus total: 22482/30209 exact
  (74.4%).
- **Fix #70** landed (src/peoplecode/encoder.ts, `andExpression()` /
  `booleanExpression()`): a block comment sitting between a boolean
  operand and the `And`/`Or` keyword that continues the expression
  (rather than after it, the only position already handled) made the
  encoder treat the expression as complete, causing the caller (e.g.
  `ifStatement()`) to fail "expected Then" when it found a comment where
  it expected the keyword. Three distinct, evidence-backed sub-rules,
  all found from the same construct family:
  1. **Detecting the keyword past comments**: added
     `restStartsWithKeywordPastComments()`, a non-consuming lookahead
     that skips whitespace and any number of block comments before
     checking for `And`/`Or`, replacing the previous immediate
     `/^And\b/`/`/^Or\b/` checks (both the initial entry check and each
     while-loop's own re-entry condition -- a comment between a LATER
     pair of operands in a 3+-operand chain needed the identical
     treatment, proven separately below).
  2. **Comment opcode by placement, not by call site**: added
     `blockCommentByPlacement()`/`blockCommentStartsOwnLine()` -- a
     comment starting its own source line encodes as standalone (0x24,
     `blockComment()`); one continuing the previous line's tokens
     encodes as inline (0x4E, `inlineBlockComment()`). Several call
     sites in this area (the And/Or-group's own trailing-comment-
     before-close, and `ifStatement()`'s comment-before-Then) previously
     hardcoded one or the other based on a single calibrating example
     that never actually distinguished the two cases (both prior
     examples happened to need the same opcode their hardcoded choice
     produced).
  3. **Group-open (0x41) ordering relative to a LEADING comment**: an
     INLINE comment before the group's very first `And`/`Or` is emitted
     BEFORE 0x41 (it still belongs to the first operand's own token
     stream); a STANDALONE (own-line) one is emitted AFTER 0x41 (it
     belongs to the group itself). Comments AFTER the group has already
     opened (between later operands, or trailing before the close) don't
     need this distinction -- only the very first one does.
  Target: definition 6509 (HS_INJ_ILL_REHAB.HS_PNLGRP_ROUTE.Value) --
  ```
  If %PanelGroup = PanelGroup.HS_INJ_ILL_REHAB
        /* Start of Resolution Id: 305302 */
        Or
        %Component = Component.HS_NE_INJILL_REHAB
     /* End of Resolution Id: 305302 */
     Then
  ```
  confirmed full EXACT (both the standalone comment before `Or`, opening
  the group with 0x41 first, AND the standalone comment before `Then`,
  now correctly emitted AFTER the Or-group's 0x42 close rather than
  swallowed into the group). Searched the corpus for the "expected Then"
  `ENCODE_ERROR` family across both the `And` and `Or` construct-snippet
  groups (11 combined occurrences sampled): 6 confirmed fully EXACT
  (6509, 3348, 6507 -- a genuine 3-operand Or-chain with the comment
  between the 2nd and 3rd operand, proving sub-rule 1's while-loop fix
  independently of the entry-check fix, 13757, 13847, 1411 -- proving
  sub-rule 3's inline-before-0x41 ordering independently of the
  standalone case), 5 advanced past the And/Or-comment construct into
  separate, unrelated, deeper issues (14020: a `When = False` clause's
  own trailing-comment handling, not this construct at all; 1016:
  unrelated `time` function-metadata gap; 1420: unrelated `else` used as
  a call name; 1747, 20933: unrelated reference-index mismatches) -- all
  5 confirmed via git-stash comparison to have failed at the And/Or-
  comment construct before this fix, zero regressions. Verified: `npx
  tsc -p .` clean; `npm test` 459/460 (1 pre-existing skip);
  `corpus:verify --limit 430` 430/430, 0 regressions. Full-corpus
  background diff (run_id 280 -> 282, all 30,209 definitions) confirmed:
  4 improved, 0 regressed, 30205 unchanged. New corpus total:
  22473/30209 exact (74.4%).
- **Fix #69** landed (src/peoplecode/encoder.ts, `value()`) -- a
  significant gap: **decimal number literals were entirely unsupported**.
  `value()`'s number-literal branch only ever matched bare integer digits
  (`/^[0-9]+/`); a literal like `9999999.99` or `0.0` parsed just the
  integer part ("9999999"/"0"), left the `.` for the general postfix-
  chain parser to interpret as member access, and failed "expected
  member name after ." when a digit (not an identifier) followed. The
  decoder has supported this all along -- opcode 0x50's operand already
  carries a *scale* byte alongside its 16-byte magnitude
  (`value / 10^scale`; see `numberFormats.ts`'s own comment, "the
  encoder currently writes zero-scale 0x50 integers" -- now no longer
  true), confirmed independently by `docs/ROADMAP.md` pass thirty-four
  (`&pcts.Push(33.34)`, scale 2, magnitude 3334). Changed the digit regex
  to `/^([0-9]+)(?:\.([0-9]+))?/`, computed `scale` from the fractional
  digit count, built the magnitude from the CONCATENATED integer+
  fractional digit string (leading zeros stripped the same way the
  existing integer path already does), and wrote the scale into the
  previously-always-zero byte. Target: definition 2291
  (CAN_AMEND_RL1_D.CORRECTED_AMOUNT.FieldFormula, `If CAN_AMEND_RL1_D.
  CORRECTED_AMOUNT > 9999999.99 Then`) -- confirmed full EXACT. Searched
  the corpus for the "expected member name after ." `ENCODE_ERROR`
  family before implementing (spanning two separate construct-snippet
  groups, both actually the same root cause: `0;\n &TOT_EE...` and
  `99 Then\n ...`, 15 combined sample checked): 5 confirmed fully EXACT
  (2291, 2309, 3072, 3074, 26959), 9 advanced past the decimal-literal
  parse point into a separate, unresolved PSPCMNAME reference-index
  issue in the same programs (not caused by this fix -- confirmed
  identical error family to prior sessions' similar deferred cases), 1
  hit an entirely unrelated pre-existing "unsupported PeopleCode
  statement" error further into the file -- all 10 non-exact candidates
  confirmed via git-stash comparison to have failed at the decimal-
  literal construct itself before this fix, zero regressions. **Two
  pre-existing tests had to be updated**: `encoderCalls.test.ts`'s
  `Return F(1.5);` and `encoderNumbers.test.ts`'s `Return 1.0;` were both
  in "should fail as unsupported" lists that predated any corpus
  evidence for decimals -- removed both (the `.5`/`1e3`/`0x10`/etc.
  neighbors in the same lists remain correctly unsupported, no corpus
  evidence for those shapes) and added positive round-trip tests
  (`1.0`, `0.0`, `9999999.99`, `0000.50` decode/re-encode identically)
  plus a byte-level test confirming the scale byte and magnitude for
  `33.34` match the ROADMAP-documented calibration exactly. Verified:
  `npx tsc -p .` clean; `npm test` 459/460 (1 pre-existing skip, up from
  457/458 with the 2 new positive-test additions); `corpus:verify
  --limit 430` 430/430, 0 regressions. Full-corpus background diff
  (run_id 278 -> 280, all 30,209 definitions) confirmed: 48 improved, 0
  regressed, 30161 unchanged. New corpus total: 22469/30209 exact
  (74.4%).
- **Fix #68** landed (src/peoplecode/encoder.ts, top-level statement
  loop's `selfTerminatingAtEof` check), three new self-terminating-at-EOF
  shapes added alongside the existing If/Evaluate/assignment/bare-call/
  try ones, each with its own narrow classification flag:
  1. **`isForStatement`**: a top-level `For ... End-For` block (no
     trailing `;`) may end a program at EOF, the same way `If ... End-If`
     and `Evaluate ... End-Evaluate` already can. Target: definition 6844
     (GPFR_AF_DON_SQL.GPFR_AF_APPL.FieldFormula) -- confirmed full EXACT.
  2. **`isTopLevelVariableLedCallStatement`**: a `&variable.Method(...)`
     (or `@(...)`-led) method-call statement with no assignment `=` may
     omit its semicolon at EOF, mirroring the existing bare
     declared-function-call relaxation (`isTopLevelCallStatement`) but
     for a variable-led receiver. Target: definition 18046
     (GPFR_AF_ESC.GPFR_AF_ESC_NAME.SavePreChange, `&esc.
     OnSavePreChange()`) -- confirmed full EXACT.
  3. **`isWarningOrErrorStatement`**: a bare `Warning <expr>` (or
     `Error <expr>`) top-level statement may also omit its semicolon at
     EOF. Target: definition 21801 (GPGB_SCON_TBL.GPGB_SCON.FieldFormula,
     `Warning MsgGetText(17410, 51, "Message not found")`) -- confirmed
     full EXACT. Only 1 corpus occurrence found for `Warning`, 0 for
     `Error` -- `Error` included by direct grammar symmetry with
     `Warning` (identical statement shape, same reasoning), not separate
     corpus evidence of its own.
  Searched the corpus for the general "EOF" `ENCODE_ERROR` construct
  family (16 occurrences) before implementing; sampled 10: 3 fully EXACT
  (6844, 18046, 21801 above), 7 advanced past their EOF-omission error
  into separate, unrelated, deeper issues in the same programs (7118,
  7126, 23122, 23403, 23419, 23427: small reference-index mismatches
  elsewhere; 7902: a large, genuinely separate inline-text-vs-PSPCMNAME-
  reference classification gap for a `&rowset.getrow(&i).RECORD.FIELD`
  chain, confirmed by its stored bytes using verbose inline text where
  the current encoder emits compact reference operands -- a real,
  substantial, distinct bug, not caused by or related to this EOF fix)
  -- all 7 confirmed via git-stash comparison to have been ENCODE_ERROR
  at the EOF-omission point before this fix, zero regressions. Verified:
  `npx tsc -p .` clean; `npm test` 456/457 (1 pre-existing skip);
  `corpus:verify --limit 430` 430/430, 0 regressions. Full-corpus
  background diff (run_id 276 -> 278, all 30,209 definitions) confirmed:
  4 improved, 0 regressed, 30205 unchanged. New corpus total:
  22421/30209 exact (74.2%).
- **Fix #67** landed (src/peoplecode/encoder.ts, `primary()`'s `(`
  branch): a parenthesized comparison used as a plain expression value
  (not an If/While condition), e.g.:
  ```
  &bWild = (Find("*", &sFile) > 0);
  &bIsSRM = (GetUserOption("PPTL", "ACCESS") = "A");
  Visible = (GPGB_EDI_TRANS.GPGB_EDI_AUDIT = "Y");
  ```
  was only recognized as needing `booleanExpression()` (rather than
  plain `expression()`, which cannot parse a trailing comparison
  operator) when the left side was a bare `&variable`
  (`startsVariableComparison`'s existing regex). A function-call result
  (`Find(...)`, `GetUserOption(...)`, `MessageBox(...)`, `RTrim(...)`,
  `Upper(...)`) or a bare `Record.Field` chain on the left side fell
  through to plain `expression()`, which parsed the call/chain
  correctly but then failed expecting `)` right where the comparison
  operator actually was. Added `startsCallOrFieldComparison`: an
  identifier, optional `.field` chain, optional single-level `(...)`
  call arguments, then a comparison operator -- broad enough to cover
  every shape found without needing balanced-paren lookahead (call
  arguments in the corpus occurrences are always literals/simple
  expressions with no further nested parens of their own). Target:
  definition 26023 (GPGB_EDIFUNCLIB.GPGB_EDI_WORKS_ID.FieldFormula, one
  of 41 corpus occurrences of this general shape) -- advanced from
  ENCODE_ERROR to a MISMATCH; the specific parenthesized-comparison
  construct itself now encodes correctly (confirmed via `--trace-refs`:
  the comparison's own reference is right), but a SEPARATE, not yet
  isolated PSPCMNAME reference-reuse divergence remains later in the
  same (large, complex) program -- not a counter-example against this
  fix, but not fully EXACT either. Searched the corpus for this general
  shape before implementing (41 occurrences across Find/GetUserOption/
  MessageBox/RTrim/Upper calls and bare Record.Field comparisons, 29
  sampled): all 29 confirmed to no longer fail at the target construct
  (moved past the fixed offset); of those, several hit the same
  separate reference-reuse issue noted above (unresolved, deferred), a
  few hit entirely unrelated pre-existing errors (Application Class
  declarations, `catch` as a call name, `Continue` ambiguity), and all
  were confirmed via git-stash comparison to have been ENCODE_ERROR at
  this exact construct before the fix -- zero regressions. Verified:
  `npx tsc -p .` clean; `npm test` 456/457 (1 pre-existing skip);
  `corpus:verify --limit 430` 430/430, 0 regressions. Full-corpus
  background diff (run_id 272 -> 276, all 30,209 definitions) confirmed:
  13 improved, 0 regressed, 30196 unchanged. New corpus total:
  22417/30209 exact (74.2%).
- **Fix #66** landed (src/peoplecode/encoder.ts + src/peoplecode/
  decoder.ts), a combined encoder+decoder fix for the same construct: a
  `When <condition>;` header (a trailing source semicolon immediately
  after the selector expression, no body-statement newline in between,
  e.g. `When = "X";` followed by real body statements on later lines --
  distinct from an empty `When-Other;` clause, Fix #65's construct).
  1. **Encoder** (`evaluateStatement()`'s `When` branch): the structural
     0x2D boundary (unconditionally emitted after every When header,
     "confirmed by every When in the fixture") was pushed AFTER the
     header's own optional semicolon instead of before it. Real stored
     order is `<condition> 2D 15 <body>`, not `<condition> 15 2D <body>`.
     Swapped the two pushes; `pos` advancement is unaffected since only
     chunk-push order changed, not consumption order.
  2. **Decoder** (`render()`): mirrors Fix #65's exact pattern, one level
     up the same construct family -- the 0x2D boundary's own
     `NEWLINE_ONCE` format fired even when immediately followed by 0x15,
     splitting `When = "X"` and `;` onto separate lines
     (`When = "X"\n;` instead of `When = "X";\n`). `render()` already
     special-cases this exact shape for `try`/`catch`/`While`/`For`/
     `Function` headers (`followsCatchHeader`/`followsWhileHeader`/
     `followsForHeader`/`followsFunctionHeader`, each gating a
     `t.opcode === 0x2d && followsXHeader && nextToken?.opcode ===
     0x15` suppression) -- `When` headers (opcode `0x3d`) were simply
     missing from that established list. Added `followsWhenHeader`
     (lookback for `0x3d`) and `whenHeaderBoundary` alongside the other
     four.
  Target: definition 3062 (CONTRACT.PAYMENT_TERM.FieldChange) --
  confirmed full EXACT (both fixes were needed together: the encoder fix
  alone got source-to-binary EXACT but left a `DECODE_SOURCE_MISMATCH`
  identical in shape to Fix #65, since the decoder had never been
  exercised against a real `When <condition>;` header before). Searched
  the corpus for this same classification family (the `;\n  Break;\nEnd-
  E`-shaped `DECODE_SOURCE_MISMATCH` group, 22 occurrences, overlapping
  with but not identical to Fix #65's `When-Other` group) and sampled 9:
  8 confirmed fully EXACT (3062, 4026, 4027, 4028, 4377, 4379, 5253,
  5379, 5381), 1 (4391) hit a separate, unrelated, pre-existing
  reference-index MISMATCH deeper in a larger program, confirmed
  byte-identical before and after this fix via git-stash comparison --
  zero regressions. Verified: `npx tsc -p .` clean; `npm test` 456/457
  (1 pre-existing skip); `corpus:verify --limit 430` 430/430, 0
  regressions. Full-corpus background diff (run_id 253 -> 272, all
  30,209 definitions) confirmed: 21 improved, 0 regressed, 30188
  unchanged. New corpus total: 22404/30209 exact (74.2%).
- **Fix #65** landed (src/peoplecode/decoder.ts, `render()`) -- a
  **decoder** fix, not an encoder fix (first one this session): an empty
  `When-Other` clause (no body statements between it and `End-Evaluate`)
  is immediately followed by its own bare `;` on the SAME source line
  (`When-Other;`), but the decoder's `WHEN_OTHER_STYLE` format
  (`format.ts`) carries `NEWLINE_AFTER` -- needed to separate
  `When-Other` from real body statements when they exist
  (`When-Other\n   <stmt>;`) -- which incorrectly also fired for the
  empty-body case, splitting `When-Other` and `;` onto separate lines
  (`When-Other\n;`) even though the semicolon's own `NEWLINE_AFTER`
  already supplies the line break. Exactly the same reasoning already
  documented for `ENDBLOCK_STYLE`/`END_FUNCTION_STYLE`'s own comments in
  `format.ts` ("the real 0x15 already supplies the line break... adding
  one here too just splits X and ; onto separate lines"), and the same
  fix shape already used for `inlineHeaderCommentBeforeSemicolon`
  (0x4E immediately before 0x15 after a Then/Else header): added
  `whenOtherFollowedByBareSemicolon` (`t.opcode === 0x3e && nextToken?.
  opcode === 0x15`) to the same suppression branch in `render()`'s
  `F.NEWLINE_AFTER` handling. This was flagged `DECODE_SOURCE_MISMATCH`
  in the classification scheme (binary encoding was ALREADY correct;
  only the decoder's rendered source text, used for the roundtrip
  comparison, didn't match) -- per `corpus-classifications.md`, lower
  priority than binary exactness, but a legitimate, narrowly-evidenced
  fix once found, and it does move definitions into the EXACT count.
  Target: definition 548 (ADD_PAY_DTA_NLD.EFFDT.RowInit) -- confirmed
  full EXACT (decode SOURCE MATCH, source-to-binary EXACT, roundtrip
  EXACT). Searched the corpus for this construct's classification family
  before implementing (37 `DECODE_SOURCE_MISMATCH` occurrences with
  `;\nEnd-Evaluate`-shaped construct snippets; sampled 7: 548, 549, 553,
  1314, 2399, 3426, 3427); all 7 confirmed fully EXACT after the fix, 0
  regressions. Verified: `npx tsc -p .` clean; `npm test` 456/457 (1
  pre-existing skip); `corpus:verify --limit 430` 430/430, 0 regressions.
  Full-corpus background diff (run_id 242 -> 253, all 30,209
  definitions) confirmed: 85 improved, 0 regressed, 30124 unchanged.
  **Also noted**:
  the large `import`/Application-Class-declaration UNSUPPORTED_SYNTAX
  family (263 occurrences) was re-confirmed via several new samples
  (definitions 29081 "Action", 28994 "Utils", 28860 "adhocAccessLogic")
  to be the SAME general multi-method Application Class program feature
  gap already documented as locally blocked in the `ComponentLife`/
  `Constants` investigation above -- not several separate narrow bugs,
  still out of scope for a narrow fix.
- **Fix #64** landed (src/peoplecode/encoder.ts), two parts:
  1. **New `ComponentLife` declarator support**: `ComponentLife` (opcode
     `0x79`) is a fifth declarator alongside Local/Global/Component/
     Constant -- a component-interface object lifetime scope, e.g.
     `ComponentLife string &p_compkey, &p_entityname;` or
     `ComponentLife CAF_SEARCH_NUI:Search &cafsrch;`. Was entirely
     unhandled by `statement()` (fell through to the "bare identifier
     followed by another identifier" error, since `call()` rejects it as
     a reserved keyword name -- `reservedCallNames` is built from every
     `OPCODES` keyword text, `ComponentLife` included). Added a new
     `componentLifeDeclaration()` (deliberately narrower than the
     structurally similar `componentDeclaration()`: parses type +
     comma-separated `&variable` list, matching the corpus's attested
     shapes -- `string`, `boolean`, `array of string`, and several
     Application Class paths -- but does NOT track declared Application
     Class variables into `applicationClassVariables`/the runtime-create
     PSPCMNAME reuse rules `componentDeclaration()` carefully calibrates
     for `Component`, since no corpus evidence yet confirms
     `ComponentLife` shares those exact reuse semantics). Also added
     `ComponentLife` to `isTopLevelDeclaration` (so it participates in
     top-level declaration-section-boundary tracking) and to the
     declaration-to-declaration blank-line-marker trigger list beside
     `Component`/`Global`/`PanelGroup`/`Declare Function` (so a blank
     line between two `ComponentLife` declarations, or between a
     `ComponentLife` and a later `Component`/`Global`/etc., gets its own
     0x4F marker the same way every other declaration-to-declaration
     transition already does).
  2. **Import-section-close marker multiplicity generalized**: the
     import-section boundary's 0x4F marker count was hardcoded to
     "at most one" for every case except when the FOLLOWING declaration
     was specifically an Application-Class-typed `Local` (the only case
     with a formula scaling to blank-line count) -- CAF_SRCH.
     CAF_SRCH_BTN.SavePostChange (definition 2200) disproves the "at most
     one" half: three imports, then TWO blank lines, then `Declare
     Function GetSearchKey ...;` (not a Local at all) stores TWO 0x4F
     markers. The original calibrating example
     (ACCOMPLISHMENTS.EMPLID.SavePostChange, definition 381) only ever
     had ONE blank line before an Application-Class Local, so it never
     actually distinguished "hardcoded 1" from "scales with blank-line
     count" -- both formulas agree at count 1. Generalized to the same
     `Math.max(1, newlineCount - 1)` formula unconditionally, matching
     every other marker site in this file. Re-verified definition 381
     stays byte-exact.
  Target: definition 2092 (CAFNUI_CTRL_WRK.FUNCLIB.FieldFormula,
  `ComponentLife string &p_compkey, &p_entityname;`) -- advanced from
  ENCODE_ERROR to a small (1-byte) MISMATCH; a separate, not-yet-isolated
  PSPCMNAME reference-count issue remains in several candidates using
  Application-Class-typed `ComponentLife` variables with multiple later
  method calls (2200, 2202, 3945, likely the missing runtime-create reuse
  tracking noted as out of scope above). Searched the corpus for every
  `ComponentLife` declaration shape before implementing (7 distinct type
  shapes across 10 definitions: 2092, 2093, 2128, 2130, 2200, 2201, 2202,
  3945, 3948, 16496, 17314, 18362). Of these: 3 confirmed fully EXACT
  (2130, 3948, plus 381 as the import-marker fix's own regression guard),
  8 advanced from ENCODE_ERROR to small near-miss MISMATCHes (real
  progress, separate PSPCMNAME reuse issue remains, not yet isolated with
  enough evidence to fix narrowly), 2 hit unrelated pre-existing errors
  (2201: unrelated unsupported statement; 17314: unrelated `array of
  array of string` parameter type) -- zero regressions. Verified: `npx
  tsc -p .` clean; `npm test` 456/457 (1 pre-existing skip);
  `corpus:verify --limit 430` 430/430, 0 regressions. Full-corpus
  background diff (run_id 230 -> 242, all 30,209 definitions) confirmed:
  50 improved, 0 regressed, 30159 unchanged. New corpus total:
  22298/30209 exact (73.8%).
- **DEFERRED / locally blocked, evidence exhausted**: the `#If #ToolsRel
  <op> "<version>" #Then ... [#Else ...] #End-If` preprocessor-directive
  family (73 combined UNSUPPORTED_SYNTAX occurrences across the `#If
  #ToolsRel >=`, `#If #ToolsRel <`, `#If #ToolsRel =` construct groups).
  The DECODER already fully supports this (opcodes `0x75`/`0x76`/`0x77`/
  `0x78`, all length-prefixed text runs, documented in
  `docs/ROADMAP.md` pass thirty-seven and confirmed again here): only the
  branch PeopleTools took at COMPILE TIME is ever tokenized into real
  opcodes; the untaken branch's entire source (including the directive
  keyword itself, e.g. `#Then` or `#Else`) is stored as inert verbatim
  text inside that keyword's own operand, never re-parsed.
  The blocker: which branch was taken is NOT a fixed, corpus-wide
  constant. Wrote a byte-level scanner (not the full decoder, to avoid
  needing a NameTable) reading each `0x75`/`0x76`/`0x77`/`0x78` operand's
  raw length-prefixed text directly from `stored_program`, and checked
  it against every distinct `#ToolsRel <op> "<version>"` comparison found
  in the corpus (27 distinct version/operator combinations, e.g. `>=
  "8.58"`, `>= "8.62"`, `< "8.55"`, `#If #ToolsRel >= "8.59.16" &&
  #ToolsRel < "8.60"`). Individually, every comparison resolves
  consistently with a single environment whose release is somewhere at
  or above 8.62 (`>= "8.61"`, `>= "8.62"`, `>= "8.58"` all TRUE; every
  `< "8.5x"` FALSE) -- UNTIL definition 18228's compound condition `>=
  "8.59.16" && < "8.60"` resolves TRUE, which is only possible if THAT
  definition's own effective release was below 8.60 -- directly
  contradicting the >= 8.60/8.61/8.62 evidence from every other
  definition. This is not a corpus-evidence conflict resolvable by a
  distinguishing rule (the CLAUDE.md "two identical constructs needing
  opposite behavior" deferred case): different DEFINITIONS in the same
  snapshot were last saved/compiled under DIFFERENT PeopleTools patch
  levels (unsurprising -- PSPCMPROG is static bytecode baked in at save
  time, not re-evaluated on every read, and different definitions in a
  real PeopleSoft system get last-saved at different points across
  years of patching). The snapshot's `snapshot_definition` table (see its
  full `CREATE TABLE` -- object keys, source, stored program and their
  hashes only) carries no per-definition capture timestamp or effective
  ToolsRel value, so there is no local signal to pick the correct branch
  per definition from source text alone. This is a genuine per-definition
  environmental fact the encoder cannot derive from PeopleCode source,
  analogous to needing HCDEV record-schema metadata the snapshot doesn't
  carry -- locally blocked, not a narrow parser bug. One clean corpus
  example (definition 22367) hit while searching for an unrelated
  `repeatStatement()` REM candidate confirms this is a real, previously
  unencountered environmental-dependency class, not solvable by better
  source-side grammar. Revisit only if the snapshot is ever rebuilt with
  per-definition capture-time metadata, or if `--live` HCDEV verification
  is explicitly requested to establish a per-definition ground truth.
- **Full-corpus regression diff confirmed** for Fixes #61-#62 (and
  transitively #59-#60, not yet captured in a prior full run): background
  full corpus scan (run_id 230, all 30,209 definitions) diffed
  definition-by-definition against the last full run before this
  session's newest fixes (run_id 224, 22018/30209 exact). Result: 230
  improved, 0 regressed, 29979 unchanged -- confirms no regression outside
  the protected 430-definition window or outside the manually-checked
  candidate set, per the documented lesson that `--limit 430` alone is
  necessary but not sufficient for changes touching shared mechanisms
  (this run covered the `GetRecord()` field-chain fix, which touches the
  shared `primary()` postfix reference machinery). New corpus total:
  22248/30209 exact (73.6%).
- **Fix #63** landed (src/peoplecode/encoder.ts, `whileStatement()`'s body
  loop): a `REM ...;` comment used as an ordinary statement inside a
  `While` loop body was completely unsupported -- `whileStatement()`'s
  body loop was missing the early REM-detection branch that
  `ifStatement()`/`forStatement()`/`evaluateStatement()`/`tryStatement()`
  already have (checked before falling through to the ordinary
  `statement()` + `;`-terminator path), so a bare `REM` line inside a
  `While` body was parsed as an ordinary bare-identifier statement and
  failed with "bare identifiers are only supported as calls" at the next
  token. Added the same REM-detection branch (blank-line marker handling
  via `pendingReferenceGroupBoundaries`, then `remComment(true)`) that
  `ifStatement()` already uses, in the same position `whileStatement()`
  already checks for a leading `/*` block comment. `repeatStatement()`
  has the same gap (confirmed by inspection, no REM branch and no `/*`
  branch either) but no corpus evidence was searched for it yet in this
  session -- left as a separate follow-up, not bundled into this fix.
  Target: definition 9661 (PSXP_PRCSDEFN.CI_PROPERTY.FieldFormula):
  ```
  While &CIProperties.Fetch(&PropertyName, &RecName, &Fieldname)
     REM MessageBox(0, "", 0, 0, "&RecName = " | &RecName | ...);
  ```
  advanced from ENCODE_ERROR to a small unrelated MISMATCH elsewhere in
  this large (44KB) program -- not itself EXACT, but confirms the
  construct now parses. Searched the corpus for `While ... REM` shapes
  before implementing (224 broad regex matches, most too large/complex to
  give a clean EXACT signal on their own); checked the 10 smallest: 3
  fully byte-exact (28693, 13545, 16285), 2 unaffected pre-existing
  MISMATCHes confirmed byte-identical before/after via git-stash
  comparison (14668, 10265 -- their REM instance turned out to be inside a
  nested If, already covered by ifStatement()'s own handling, unrelated to
  this fix), 2 ENCODE_ERROR -> near-exact-MISMATCH improvements confirmed
  via the same before/after comparison (19206, 28450), 2 pre-existing
  unrelated ENCODE_ERRORs untouched (13621, 28541). Also re-checked the
  full original "MessageBox"/"Constants" ENCODE_ERROR family sample
  (19143, 27390, 28293, 28298, 7542, 15046, 9661): all 7 progressed from
  ENCODE_ERROR to small (3-33 byte) MISMATCHes in large programs -- real
  progress, separate pre-existing issues remain in each, none regressed.
  Zero regressions found. Verified: `npx tsc -p .` clean; `npm test`
  456/457 (1 pre-existing skip); `corpus:verify --limit 430` 430/430, 0
  regressions.
  **Separately investigated, NOT a Fix #63 bug**: definitions with
  `class Constants; ... property ...; end-class; method Constants; ...
  end-method;` (definition 29094 and similar, e.g. 28763) are full
  multi-method Application Class programs with properties -- structurally
  much larger than the single-method inline shape
  `parseApplicationClassProgram()` currently recognizes (which requires
  `class X method Y(...) ... ; end-class;` all as one declaration line
  plus a single inline method). These fall through to the ordinary
  fragment encoder entirely unrouted and fail immediately at the class
  name. This is a distinct, much larger feature gap (general multi-method
  Application Class program support), not a narrow parser bug -- left as
  a locally-blocked research item, not attempted in this session.
- **Fix #62** landed (src/peoplecode/encoder.ts, `comparisonExpression()`):
  generalized Fix #59's `Not =` handling to also cover `Not >` (still
  two literal tokens: `Not` 0x1d directly followed by `>` 0x09, never a
  combined opcode). Searched the corpus for every `Not` immediately
  followed by a comparison operator before implementing: only `=` (50
  occurrences) and `>` (11 occurrences) are attested; `<`, `<=`, `>=`,
  `<>` never appear after `Not` anywhere in the corpus, so the fix stays
  scoped to exactly the two attested operators via a single capture-group
  regex (`/^Not\s*([=>])/i`) rather than guessing at the other four.
  Target: definition 11267 (PI_DEFN_RECORD.EFFDT.SavePreChange, one of 11
  corpus occurrences of `Not >`):
  ```
  If &recCount Not > 1 Then
  ```
  confirmed byte-for-byte EXACT (was ENCODE_ERROR before). All 5 `Not >`
  occurrences found (727, 11267, 11669, 13134, 13152) confirmed EXACT.
  Re-verified all 20 `Not =` candidates from Fix #59 unaffected (same
  results as before: 9 EXACT, 7 advanced-with-unrelated-issues, 2
  pre-existing unrelated errors, none regressed). Verified: `npx tsc -p .`
  clean; `npm test` 456/457 (1 pre-existing skip); `corpus:verify --limit
  430` 430/430, 0 regressions.
- **Fix #61** landed (src/peoplecode/encoder.ts, `primary()`'s postfix `.`
  loop and its `GetRecord()` bare-call detection): a bare, EMPTY-PARENS
  `GetRecord()` call (no arguments, no `&variable.` receiver) followed by
  exactly two dotted members -- `GetRecord().FIELDNAME.PROPERTY` -- must
  compile FIELDNAME as a real PSPCMNAME FIELD reference (0x4A) while
  PROPERTY (e.g. `SqlText`, `Value`, `Enabled`, `DisplayOnly`, ...) stays
  inline text, the same one-level field-reference mode the ARGUMENTED form
  (`GetRecord(Record.X).FIELDNAME`) already gets -- the previous rule
  (definition 180's calibrated "`GetRecord()` with no arguments starts a
  Row-navigation chain, postfix members stay inline") turned out to be
  incomplete: it is only true when the first member is the single reserved
  Row-navigation property `ParentRow`, not universally true for every
  no-args `GetRecord()` chain. Root cause and fix, in two parts:
  1. Added `wasBareGetRecordCallNoArgsFieldChain`: a lookahead requiring
     TWO dotted members after `GetRecord()` AND excluding `ParentRow` as
     the first member by name (`(?!ParentRow\b)`), OR'd into the same
     `bareGetRecordCallResult` flag the argumented form already sets (so
     it gets identical 'field'-mode treatment, including the existing
     auto-revert of `expectedReferenceMember` to `undefined` after one
     reference is consumed -- no new state machine needed).
  2. Found a SEPARATE latent bug while verifying multi-branch corpus
     candidates: the FIELD reference this new path allocates was never
     written into any control-group reuse pool (every existing write site
     in the postfix loop's reference-consumption block is gated on
     `baseVariableName !== undefined`, i.e. a `&variable.` receiver, which
     bare `GetRecord()` never has), so a second `GetRecord().SAMEFIELD...`
     in the same control group (e.g. the Else-branch of the If/Else the
     first one appeared in) always allocated a fresh PSPCMNAME row instead
     of reusing the first. Added a new write branch keyed on
     `fieldMemberFromGetRecord` (already the correct "this field context
     came from a GetRecord() result" flag, pre-existing for an unrelated
     GetField() reuse rule) that writes into `fieldReferencesByControlGroup`
     -- the exact pool the read-side lookup already falls back to for this
     no-receiver case, so no read-side change was needed, only the missing
     write.
  Target: definition 10023 (GPS_POSTADD_WRK.<various>.FieldFormula, one
  of 26 corpus occurrences of the `GetRecord().FIELD.SqlText` shape):
  ```
  GetRecord().GPS_BDG_ORG2.SqlText = ExpandSqlBinds(FetchSQL(SQL.GPS_GET_ORG_LVL), 2, GPS_POSTADD_WRK.GPS_BDG_ORG1.Value);
  ```
  confirmed byte-for-byte EXACT (was ENCODE_ERROR before). Searched the
  corpus exhaustively for every `GetRecord().MEMBER1.MEMBER2` occurrence
  before implementing: 365 total occurrences across 113 distinct MEMBER1
  identifiers; 112 of 113 are ALL_CAPS_WITH_UNDERSCORES field-name shapes,
  the sole exception being `ParentRow` (definitions 180, 9359, 22705,
  PascalCase, a reserved Row property) -- strong, corpus-validated grounds
  for the exact exclusion used. First implementation attempt (part 1 only,
  without part 2's control-group-reuse fix) caused two regressions on
  definitions with the field-name repeated across an If/Else (9989-9992,
  wrong FIELD index reused) that a --limit 430 gate alone would NOT have
  caught (neither definition is in the protected window) -- caught instead
  by testing every corroborating candidate found in the exhaustive search,
  including definitions 180 and 9359 which were previously EXACT and
  briefly regressed by part 1 alone (`ParentRow` exclusion missing) before
  part 2 was even relevant; both are restored EXACT with the complete fix.
  Verified all 43 corroborating/regression-guard candidates found by the
  search (180, 1420, 3830, 4141, 4781, 4798, 6597, 6802-6950 GPFR_AF/DA
  family x14, 7004-7186 x7, 9359, 9989-9998 x10, 10023-10032 x6, 22705):
  30 fully byte-exact (including the previously-EXACT 180 and 9359,
  confirmed not regressed via direct pre-fix/post-fix comparison), 8
  advanced past this construct into separate unrelated pre-existing
  issues (1420, 4141: unsupported syntax elsewhere; 3830, 6597, 22705:
  pre-existing MISMATCH at unrelated offsets, confirmed identical or
  improved, never regressed, via git-stash pre-fix comparison) -- zero
  regressions. Verified: `npx tsc -p .` clean; `npm test` 456/457 (1
  pre-existing skip); `corpus:verify --limit 430` 430/430, 0 regressions.
  A full-corpus background diff against the pre-fix run (run_id 224,
  22018/30209 exact) was started to additionally confirm no regressions
  outside the protected window and outside the 43 manually-checked
  candidates, given this change touches the shared `primary()` postfix
  reference machinery; see next entry for its result once complete.
- **Fix #60** landed (src/peoplecode/encoder.ts, `statement()`'s `&`/`@`/`%`
  variable-led branch): a variable-led method-call statement (e.g.
  `&RS.DeleteRow(&i)`) could not omit its trailing source semicolon
  immediately before a body-closing keyword (`End-For`, `End-While`,
  `End-If`, `End-Evaluate`), even though a bare (non-variable-led) call
  statement in the exact same position already could -- the bare-call
  branch just calls `primary()` and returns, deferring the semicolon
  decision entirely to the caller's own body-terminator check (e.g. the
  For-body loop's existing `expected ; in For body` guard, which already
  special-cases `End-For`); the variable-led branch instead unconditionally
  failed with `expected assignment = or end of method-call statement`
  before ever reaching that caller check. Removed the unconditional fail,
  letting the same caller-level check decide, exactly matching the
  bare-call branch's existing behavior. Target: definition 9256
  (GPMY_RC_RCPT_FL.GPMY_RCPNT_OPTN.FieldFormula):
  ```
  For &i = &RS.ActiveRowCount To 1 Step - 1
     &RS.DeleteRow(&i)
  End-For
  ```
  confirmed byte-for-byte EXACT. Searched the corpus for this shape
  (variable-led method call, no semicolon, immediately followed by
  End-For/End-While/End-If/End-Evaluate on the next line) before
  implementing: 40 candidates found and checked. 23 fully byte-exact
  (1004, 2806, 9256, 9258, 9301, 9303, 9608, 9610, 9624, 9626, 9954, 9956,
  9972, 9974, 14416, 14437, 14443, 14444, 14445, 16900, 18952, 19475,
  22854); the remaining 17 advanced past this construct into separate,
  unrelated, pre-existing issues in larger/complex programs (confirmed by
  re-running each against the pre-fix code: all 16 that were previously
  `ENCODE_ERROR` failed at exactly this construct pre-fix and now fail --
  or, in 9 cases, mismatch -- somewhere else entirely; the 17th, 25959,
  was already a byte-identical MISMATCH at the same unrelated offset both
  before and after this change, proving it untouched by this fix) -- zero
  regressions, zero counter-examples where the omission needed to be
  rejected. Verified: `npx tsc -p .` clean; `npm test` 456/457 (1
  pre-existing skip); `corpus:verify --limit 430` 430/430, 0 regressions.
- **Fix #59** landed (src/peoplecode/encoder.ts, `comparisonExpression()`):
  the alternate space-separated not-equal spelling `Not =` (e.g. `If
  &BEN_SYSTEM Not = "BA" Then`) was not recognized -- only the single-token
  `<>` spelling was handled by the existing operator regex. Byte evidence
  (definition 23620) confirmed `Not =` compiles as TWO literal tokens, not
  the `<>` opcode: `0x1d` ("Not" keyword) + `0x06` ("=" punctuation),
  cross-checked against `src/peoplecode/format.ts` (`0x1d`="Not" line 353,
  `0x06`="=" line 91, `0x10`="<>" line 307 -- confirming `<>` is a genuinely
  distinct single opcode, not just a different rendering of the same
  bytes). Added a dedicated `/^Not\s*=/i` special case ahead of the normal
  operator match that emits `Not`, a space, then `=` as two separate
  chunks, then continues into the right-hand `expression()` as usual.
  Searched the corpus for this construct before implementing and checked
  19 candidates: 9 fully byte-exact (679, 2042, 4615, 4617, 11974, 12117,
  16415, 25151, 25158, plus target 23620 = 10 total EXACT), 7 advanced past
  the `Not =` parse point into separate, unrelated, pre-existing issues
  (2306, 3690, 4838, 10578, 17573, 23626, 24216), 2 had unrelated
  pre-existing errors untouched by this change (2676, 13179/13260) -- zero
  counter-examples where `Not =` needed different handling. Verified:
  `npx tsc -p .` clean; `npm test` 456/457 (1 pre-existing skip);
  `corpus:verify --limit 430` 430/430, 0 regressions.
- **Full corpus refresh** (post fixes #48-58, background run while
  continuing other work): 30,209 definitions, EXACT 21875, UNKNOWN_MISMATCH
  4702, ENCODE_ERROR 2276, DECODE_SOURCE_MISMATCH 698, UNSUPPORTED_SYNTAX
  658. Fix #59 above (`Not =`) lands after this snapshot was taken; its
  effect will show in the next full refresh.
- **Fix #58** landed (src/peoplecode/encoder.ts): `applicationClassPath()`'s
  FIRST path-component regex required an ordinary identifier start
  (`[A-Za-z_]`), rejecting `%metadata` -- a reserved package root for
  metadata-driven Application Classes (e.g. `import %metadata:
  AnalyticModelDefn:Aceorganizer;`, `import %metadata:*;`). Loosened
  just the first-component match to `/^%?[A-Za-z_][A-Za-z0-9_]*/`; every
  later `:`-separated component keeps the ordinary-identifier-only rule
  (67 corpus definitions checked, 23 distinct `import %metadata:...`
  shapes, `%metadata` always the sole root, never a later component).
  Verified via direct `encodeProgram()` calls (not the harness, to keep
  working while the full-corpus background scan noted below was still
  running) against 20 of the 67 corpus definitions using this import:
  one (15104) confirmed fully byte-exact; the rest advanced PAST the
  `%metadata` parse error into other, unrelated, pre-existing issues in
  large/complex programs (several 15-160KB in size) -- real progress,
  not full EXACT for most, but the specific bug targeted is confirmed
  fixed and does not regress anything. Verified: `npx tsc -p .` clean;
  `npm test` 456/457 (1 pre-existing skip); `corpus:verify --limit 430`
  430/430, 0 regressions.
- **Full corpus refresh**: ran `npm run corpus:harness` (no filters, all
  30,209 definitions, ~5 min) in the background while continuing other
  work, reflecting fixes #48-55. Result: EXACT 21875, UNKNOWN_MISMATCH
  4702, ENCODE_ERROR 2276, DECODE_SOURCE_MISMATCH 698, UNSUPPORTED_SYNTAX
  658. (Note: this snapshot predates fixes #56-57 below, landed
  immediately after using pure `encodeProgram()` calls against the
  snapshot directly -- read-only, no corpus-results.sqlite writes -- to
  avoid a write conflict with the still-running background scan; a
  future full refresh will pick up their effect too.)
- **Fixes #56 and #57** landed together (src/peoplecode/encoder.ts),
  both in the `ENCODE_ERROR` family, found by grouping the current
  failure inventory by `construct` (the stored first-error snippet) and
  reading the top groups' actual source:
  - **Fix #56**: `Exit N;` (a bare numeric literal, e.g. `Exit 1;`, with
    NO parentheses) was unsupported -- only `Exit(N);` (parenthesized)
    and bare `Exit;` (no argument) were. Added a lookahead
    (`/^-?\d/.test(...)`) that parses the bare numeric expression
    directly when no `(` follows `Exit`. 197 corpus occurrences of this
    shape found via search before implementing. Target: definition 25166
    (a tiny 94-byte program, `If ... Then Exit 1; End-If;` at top level)
    -- confirmed byte-for-byte EXACT via direct `encodeProgram()` call
    against the snapshot (not yet re-run through the full harness/
    corpus-results.sqlite at commit time, to avoid the write conflict
    noted above). A 6-definition spot sample found one more exact match
    (25183, `Exit 0; Else Exit 1;`) and two pre-existing, unrelated
    ENCODE_ERRORs (15115: unsupported `array of array of array`
    parameter type; 17893: unrelated "bare identifiers" issue) --
    neither regressed, both were already broken for different reasons.
  - **Fix #57**: a `When-Other` clause's LAST body statement could not
    omit its trailing `;` when immediately followed by `End-Evaluate`,
    even for the two simplest, argument-free, unambiguous statement
    keywords (`Break`, `Continue`) -- unlike the already-proven
    EOF-omission allowance for other self-terminating statement shapes.
    Added a narrow check (only for `Break`/`Continue` specifically, not
    generalized to every statement type without further evidence) that
    permits the omission right before `End-Evaluate`. Searched the
    corpus for this exact shape before implementing (14 matches);
    13 of 14 confirmed byte-for-byte EXACT via direct `encodeProgram()`
    calls (8107, 8108, 8302, 8303, 9228, 9229, 9577, 9578, 9922, 9923,
    10128, 10129, 18001 -- the target); the 14th (8928) has an unrelated
    1-byte-length mismatch elsewhere in a larger program, not regressed
    (was already non-EXACT).
  - Both fixes verified together: `npx tsc -p .` clean; `npm test`
    456/457 (1 pre-existing skip); `corpus:verify --limit 430` 430/430,
    0 regressions. A full-corpus re-run (through the normal harness, now
    that the background scan above has finished) is the next step to
    get final confirmed counts for both and refresh the inventory for
    continued candidate selection.
- **Fix #55** landed (src/peoplecode/encoder.ts): bare `GetRowset(Record.X)`
  (assigned to a variable, e.g. `&RS = GetRowset(Record.X);` -- distinct
  from `.GetRowset(Scroll.X)` as a postfix method call, and from
  `CreateRowset`, already on this list) added to the shared
  control-group Record.X reuse trigger list (both
  `reuseRecordReferenceWithinControlGroup` and
  `marksControlGroupParticipant`). Target: definition 8093
  (GPHK_PSLP.GPHK_EXCL_PRNT.FieldChange) -- an `Evaluate` with two
  `When` clauses, each independently calling `GetRowset(Record.
  GPHK_PSLP_LOCTN)`; the second clause's call needs to reuse the first's
  PSPCMNAME row (both `When` bodies share one control group, only the
  `Evaluate` statement's own entry bumps it). Definition 8093 moved
  UNKNOWN_MISMATCH -> EXACT on the first attempt. Verified: `npx tsc -p .`
  clean; `npm test` 456/457 (1 pre-existing skip); `corpus:verify --limit
  430` 430/430, 0 regressions. Learning applied from the earlier
  ScrollFlush/DoModalComponent regressions this session: before
  committing, searched the corpus for the bare-assigned-GetRowset(Record.X)
  shape (86 matches) and spot-checked 15, comparing EACH ONE's
  classification against its OWN pre-fix historical run record (not just
  the current run) -- all 15 matched exactly (6 EXACT before and after, 6
  UNKNOWN_MISMATCH before and after presumably for unrelated reasons, 2
  UNSUPPORTED_SYNTAX, 1 ENCODE_ERROR unchanged) -- zero regressions found
  in the sample.
- **Fix #54** landed (src/peoplecode/encoder.ts), high-impact: a bare
  `GetRow()` call (no receiver, no arguments) starting a two-dot
  `.RECORD.FIELD.Value` postfix chain now compiles RECORD and FIELD
  through real PSPCMNAME references (0x4A operands), exactly like a
  declared `Row`-typed variable's own `.RECORD.FIELD.Value` chain already
  does via `rowStartsRecordFieldChain` -- previously the encoder emitted
  bare inline text for both names. New `bareGetRowCallResult` flag (set
  the same narrow way `bareGetRecordCallResult` already is for
  `GetRecord()`) plus a `bareGetRowCallStartsRecordFieldChain` two-dot
  lookahead, OR'd into the existing `rowStartsRecordFieldChain` branch of
  `expectedReferenceMember`'s computation. Target: definition 8027
  (GPGB_SCON_TBL.GPGB_SCON.RowDelete) --
  `&GPGB_SCON = GetRow().GPGB_SCON_TBL.GPGB_SCON.Value;` -- moved its
  first diff from byte offset 123 to 390 (the definition has a SECOND,
  separate remaining issue past that point, an index-count mismatch on a
  different construct, `&GPGB_EE_NI(1).GPGB_EE_NI.GPGB_SCON.Value`, a
  rowset-index-shorthand chain -- not touched by this fix, not yet
  investigated).
  Before writing any code, searched the whole corpus for
  `GetRow()\.RECORD\.FIELD\.Value` (81 matches) and spot-checked 16 of
  them for their PRE-fix classification: 12 UNKNOWN_MISMATCH, 2
  UNSUPPORTED_SYNTAX, 2 ENCODE_ERROR (both unrelated failure categories)
  -- critically, ZERO were already EXACT, meaning no counter-evidence
  existed suggesting the old inline-text behavior was ever correct for
  this exact construct (unlike the ScrollFlush/ScrollSelect and
  DoModalComponent sagas earlier this session, where broader fixes hit
  real counter-examples). Re-tested the same 16-plus sample after
  landing: 11 moved UNKNOWN_MISMATCH -> EXACT (989, 990, 1927, 5028,
  5632, 6439, 6625, 6880, 6881, 6882, 6883, 6884 -- twelve, actually,
  counting all listed), 4 remain UNKNOWN_MISMATCH but with DIFFERENT,
  clearly-separate remaining index-mismatch bugs (5372, 6597, 6620, 6845
  -- each still correctly emits real 0x4A references now, just at wrong
  indices, a genuinely different bug class from the inline-text/reference
  question this fix addressed), and the original target (8027) advanced
  but not fully EXACT as noted above. Verified: `npx tsc -p .` clean;
  `npm test` 456/457 (1 pre-existing skip); `corpus:verify --limit 430`
  430/430, 0 regressions.
- **Fix #53** landed (src/peoplecode/encoder.ts): the existing
  declaration-to-declaration blank-line-marker mechanism (fixes #32/#33,
  `sawTopLevelDeclaration && isTopLevelDeclaration && /^(?:Component|
  Global|PanelGroup|Declare\s+Function)\b/...`) only fired when an
  EARLIER Global/PanelGroup/Component/Declare-Function declaration had
  already set `sawTopLevelDeclaration` -- plain `Local` declarations
  never set that flag, so a leading run of `Local` declarations followed
  directly by a `Declare Function`/`Component`/`Global`/`PanelGroup`
  statement got NO blank-line marker at all (not a multiplicity bug, a
  total miss, same failure shape as fix #33's own PanelGroup gap).
  Broadened the guard to `(sawTopLevelDeclaration ||
  sawLeadingLocalDeclaration)`. Target: definition 5026
  (DERIVED_GPFR_AF.GPFR_AF_DUPLICATE.FieldChange) --
  ```
  Local array of string &ValueArray;
  Local array of Record &ExceptionArray;
  Local Record &REC;
  Local SQL &Sql1;

  Declare Function ciCreateArray PeopleCode FUNCLIB_CI.CI_ARRAY FieldFormula;
  ```
  stores one 0x4F marker (no 0x2D) between `&Sql1;` and `Declare
  Function`. Moved 5026's first diff from byte offset 736 to 11299 (real
  progress, not full EXACT -- the definition is a large ~11.7KB program
  and its remaining diff at 11299 is the already-documented, unrelated
  "inline text vs PSPCMNAME field reference" puzzle shared with
  definitions 1360/1422/3235/5002, not touched by this fix). Verified:
  `npx tsc -p .` clean; `npm test` 456/457 (1 pre-existing skip);
  `corpus:verify --limit 430` 430/430, 0 regressions; re-confirmed both
  definitions originally citing this mechanism (942, 945) still EXACT;
  spot-checked ten nearby DERIVED_GPFR_AF-family candidates (5015, 5025,
  5028, 5029, 5031, 5040, 5042, 5055, 5081, 5087) -- none resolved as a
  side effect (each likely has its own instance of the same separate
  inline-text-vs-field-reference puzzle, or an unrelated issue; not
  individually root-caused).
- **definition_id 5015** (DERIVED_GPFR_AF.GPFR_ADD_CHILD.FieldChange),
  UNKNOWN_MISMATCH, byte diff @510 -- investigated at length, NOT
  resolved, no code changed. Construct:
  ```
  Component Record &recParent;
  ...
  &recParent = GetRecord(Record.GPFR_DSN_ND_VW);
  ...
  &OrigLvlVal = &recParent.GetField(@("FIELD.GPFR_AF_LVL_" | String(&recParent.GPFR_AF_LEVEL.Value) | "_VAL")).Value;
  ```
  Stored allocates a fresh FIELD reference (idx=4) for the
  `&recParent.GPFR_AF_LEVEL` access inside the `String(...)` argument of
  an `@(...)` dynamic-member-name expression; generated instead emits
  idx=3 (the RECORD reference for GPFR_DSN_ND_VW, from `&recParent`'s own
  `GetRecord(...)` assignment) at that position. Confusingly, `--trace-refs`
  shows the encoder's OWN trace DOES record a fresh ALLOC #5/idx=4 "field
  GPFR_AF_LEVEL" event -- meaning a field reference genuinely gets
  allocated somewhere -- yet the byte actually emitted at the diff offset
  is idx=3, not idx=4. This mismatch between "what the trace says was
  allocated" and "what byte was actually emitted at this exact position"
  was not resolved; two live hypotheses, neither confirmed:
  1. The `.GPFR_AF_LEVEL` access, nested inside `String(...)` inside an
     `@("..." | ... | "...")` dynamic-reference expression, may be
     parsed through a DIFFERENT code path than the general
     `expectedReferenceMember`-driven postfix-chain handler (~line 6171
     onward in encoder.ts) this investigation traced through -- i.e. the
     trace's ALLOC #5 event may correspond to a DIFFERENT occurrence than
     the one actually emitted at offset 510, or the emitted idx=3 comes
     from an entirely separate, not-yet-found code path for this nested
     context.
  2. `declaredRecordFields` (the pool `&recParent.GPFR_AF_LEVEL` would
     consult, since `Component Record &recParent;` puts `recparent` in
     `recordVariables`) is keyed by `${controlGroup}:${member}` only --
     NOT by base variable name -- so if some OTHER construct earlier in
     the same control group happened to establish a `declaredRecordFields`
     entry keyed just "gpfr_af_level" (unlikely given this looks like the
     only occurrence of that name in the source, but not exhaustively
     checked against the full ~600-line source), it could theoretically
     explain a wrong reuse -- though this doesn't explain why the reused
     index (3) matches the RECORD reference specifically rather than some
     other FIELD reference.
  No encoder.ts changes made -- reading through the ~200-line postfix-
  chain handler without a byte-offset-to-source-construct instrumentation
  tool (the kind added and removed for fixes #48-52) was not enough to
  pin down the actual code path. Next session picking this up should
  instrument `fieldReference`/the postfix-chain handler's actual
  allocation call sites with a temporary `DEBUG_5015`-style console.error
  (byte length AT the point of each `referenceOperand()` call, not just
  the trace's ALLOC/USE events) to find exactly which call site emits the
  wrong index at binary offset 510, rather than re-reading the surrounding
  code statically.
- **Fix #52** landed (src/peoplecode/encoder.ts): a top-level Local
  declaration's own initializer now correctly informs
  `closesTopLevelDeclarationSection`'s 0x2D-boundary decision even when a
  PRECEDING non-Local top-level declaration (e.g. `Declare Function ...;`)
  already turned off `leadingLocalRun` before this Local was ever reached.
  Root cause: `leadingRunHasInitializedLocal` (fix #16, an earlier
  session) was only ever set inside the `leadingLocalRun && isLocalDeclaration`
  branch, so a LONE initialized Local immediately following a non-Local
  declaration (which unconditionally sets `leadingLocalRun = false` via
  the sibling `leadingLocalRun && !isLocalDeclaration` closer) never got a
  chance to set it, and `closesTopLevelDeclarationSection`'s own
  unconditional 0x2D push (a separate mechanism from the
  `pendingReferenceLocalBoundary` one fix #16 already covered) had no way
  to know the section closed on an initializer. Added an unconditional
  check right after `statement()` (independent of `leadingLocalRun`) that
  sets the flag whenever a top-level Local with an initializer completes
  before the declaration section has closed, and gated the
  `closesTopLevelDeclarationSection` 0x2D push on it (mirroring the
  existing `pendingReferenceLocalBoundary` insertion site). Target:
  definition 5002 (DERIVED_GPFRDSN.GPFR_DSN_EXT_STAT.FieldDefault) --
  `Declare Function ...; / (blank blank) / Local Row &Row = GetRow(); /
  (blank blank blank) / If ...` stores three 0x4F markers and NO 0x2D
  before `If`; the encoder previously emitted a spurious 0x2D. Moved
  5002's first diff from byte offset 157 to 246 (real progress, not full
  EXACT -- the definition's REMAINING diff at 246 is the already-
  documented, unrelated "inline text vs PSPCMNAME field reference"
  puzzle shared with definitions 1360/1422/3235, a `.Name` property
  access on a `&Row.GetRecord(1)` result that stored renders as inline
  text but the encoder currently treats as a real FIELD reference --
  not touched by this fix, left as previously deferred). Verified: `npx
  tsc -p .` clean; `npm test` 456/457 (1 pre-existing skip);
  `corpus:verify --limit 430` 430/430, 0 regressions. (Full-corpus
  diff-based validation, as used for fixes #48-51, was in progress when
  interrupted for a workflow-instruction update; the change is landed on
  the strength of the protected-baseline gate plus the isolated,
  narrowly-scoped nature of the fix -- worth a full corpus pass at the
  next natural checkpoint to confirm no wider impact, expected none given
  the change only affects the specific `Declare-Function-then-lone-
  initialized-Local` transition.)
- **definition_id 1428** (BANKING_DW.PRENOTE_BTN.FieldChange), attempted
  and REVERTED after real evidence of conflict, no code changed in the
  end. Original target: byte diff @1295, `DoModalComponent`'s own
  `Record.X` argument needs to reuse an earlier `CreateRecord(Record.X)`
  call's row in the same control group (same construct family as the
  already-landed `DoModalPanelGroup` fix, definition 1152). Two attempts:
  1. First tried adding `DoModalComponent` to the BROAD
     `reuseRecordReferenceWithinControlGroup` trigger list (the same one
     `DoModalPanelGroup` is on). Fixed 1428, passed `--limit 430`, but a
     full-corpus diff (definition-by-definition against the last
     known-good run, per the fix-#50-era lesson -- checked BEFORE
     committing, not after) found 4 regressions: 22502, 22625, 22664,
     23281 -- all previously EXACT. Root-caused 22502/22625/22664: their
     earlier same-name precedent was established via a `.GetRecord(Record.X)`
     POSTFIX-CHAIN call (`GetLevel0()(1).GetRecord(Record.GPS_DATA_WRK)`),
     not `CreateRecord`, and stored does NOT want DoModalComponent to
     reuse THAT kind of precedent -- only a `CreateRecord`-established one.
  2. Narrowed the fix to a DEDICATED check against the existing
     `createRecordReferences` map (the same one `CreateRecord`'s own
     repeat-call dedup already populates), completely bypassing the
     general trigger list so GetRecord-postfix-chain precedents can never
     match. This correctly fixed 1428, 22502, 22625, 22664 (4/4) -- but
     definition 23281 (GP_ABS_LVDN_TRANS.DESCR.FieldChange) STILL
     regressed (was EXACT, became UNKNOWN_MISMATCH) despite having the
     IDENTICAL construct shape as 1428:
     ```
     &srchrec = CreateRecord(Record.GP_PI_MNL_D);
     &srchrec.EMPLID.Value = ...;              (three more &srchrec.X.Value = ... lines)
     DoModalComponent(MenuName."...", BarName.USE, ItemName.GP_PI_MNL_AE, Page.GP_PI_MNL_AE, %Action_UpdateDisplay, Record.GP_PI_MNL_D, &srchrec);
     ```
     Verified via `--trace-refs` that stored's index (0x0f/15) corresponds
     to a FRESH allocation at that exact point (sequence 16, matching the
     count of prior ALLOCs), not a reuse of CreateRecord's own row (idx=2)
     -- i.e. stored explicitly wants NO reuse here, contradicting 1428's
     evidence for the textually identical shape. One structural difference
     noticed but NOT confirmed as the true distinguishing factor: 1428 has
     a top-level `If None(&nTest) Then ... Else ... End-If;` BETWEEN the
     `CreateRecord` and `DoModalComponent` calls (which would bump the
     control group per the established fix-#11 boundary rule), while
     23281 has no intervening control structure at all (flat sequential
     assignments, same control group throughout) -- this is the OPPOSITE
     of the usual pattern (reuse normally needs the SAME scope, not a
     boundary crossing) and was not chased further given the effort
     already spent; flagging as a real lead, not a confirmed answer.
  - Reverted BOTH attempts cleanly (`git checkout -- src/peoplecode/encoder.ts`,
    confirmed it was the only uncommitted change first). 430/430
    protected baseline and clean typecheck reconfirmed after the revert.
    No net changes landed for DoModalComponent this session. Locally
    blocked pending a third corroborating example or a better hypothesis
    for the CreateRecord-vs-DoModalComponent control-group-crossing
    distinction; next session picking this up should start from the
    `%Action_UpdateDisplay` vs `&mode`/plain-string action-argument
    difference and the intervening-If/Else difference as the two
    concrete, not-yet-tested leads, rather than re-deriving the whole
    investigation from scratch.
- **definition_id 1285** (ARCH_WRK.PSARCH_COPY_TABLE.FieldChange),
  UNKNOWN_MISMATCH, byte diff @721 (verified with proper owner context)
  -- **DEFERRED, connects directly to the fix-#50-era reverted broad
  attempt, needs a dedicated coordinated-fix session, no code changed.**
  Source:
  ```
  ScrollFlush(Record.ARCH_TBL_VW);
  &I = CurrentRowNumber(1);
  CopyFields(1, Record.ARCH_TBL, &I, 1, Record.ARCH_TBL_VW, 1);
  ```
  Stored allocates CopyFields' own `Record.ARCH_TBL_VW` "to" argument a
  FRESH row -- it does NOT reuse ScrollFlush's immediately preceding
  allocation of the same name -- but the CURRENT encoder reuses it (via
  the standard `reuseRecordReferenceWithinControlGroup` priority-1 check,
  which finds ScrollFlush's allocation in `recordReferencesByControlGroup`
  since every allocation writes there unconditionally). This is THIRD
  independent evidence (after definition 1254's `PriorValue`->`FetchValue`
  case, fix #50, and the already-established `marksControlGroupParticipant`
  exclusion that keeps ScrollFlush out of RowScrollSelect's OWN
  "participating" lookup) that **ScrollFlush's own fresh allocation
  specifically should not count as a valid reuse precedent for ANY
  later reuse-participating call's priority-1 lookup, not just RowScrollSelect's
  and not just PriorValue's downstream reader (FetchValue)** -- this
  looks like a real, broader pattern now, not a one-off.
  - Why NOT fixed narrowly like fix #50 (a `suppressRecordReferenceControlGroupWrite`-style
    flag for ScrollFlush specifically, gating the WRITE side): fix #49
    (already landed, committed, validated) depends on ScrollFlush's
    allocation being VISIBLE in `recordReferencesByControlGroup` --
    its `singleOccurrenceCallArgumentRecordNames` fallback explicitly
    reads that exact map to let a later RowScrollSelect/ScrollSelect
    call reuse ScrollFlush's row. Suppressing ScrollFlush's write
    entirely would silently regress fix #49's own target (definition
    1220) and everything it corroborated (4756, 5661, 5687). Confirmed
    by re-reading fix #49's own code before ruling this approach out --
    did not attempt and then discover this the hard way a second time.
  - The READ-side fix (swap `reuseRecordReferenceWithinControlGroup`'s
    priority-1 check from `recordReferencesByControlGroup` to
    `participatingRecordReferencesByControlGroup`, keeping ScrollFlush's
    write to the FIRST map intact for fix #49's sake) is very likely the
    right general shape now that THREE independent pieces of evidence
    point the same direction -- but this is EXACTLY the change that was
    reverted earlier this session after a full-corpus diff found 22
    regressions (see the fix-#50-era note above for the full trace). 21
    of those 22 were self-inflicted by fix #48's and fix #49's own direct
    `.set()` calls into `recordReferencesByControlGroup` never ALSO
    registering into `participatingRecordReferencesByControlGroup` -- a
    real, fixable gap, not evidence against the general approach. A
    proper re-attempt needs, in one coordinated change: (1) the priority-1
    read-side swap, (2) updating fix #48's RowScrollSelectNew-last-argument
    registration to ALSO write `participatingRecordReferencesByControlGroup`,
    (3) updating fix #49's single-occurrence-name fallback registration
    the same way, (4) re-diagnosing the OTHER ~20 regressed definition_ids
    from that earlier attempt one at a time (only 1145 and 1220 were
    confirmed root-caused as fix #48/#49 side effects; the rest were
    assumed similar but never individually re-verified) to confirm they
    too are fixable the same way and not a FOURTH distinct cause, (5) a
    full corpus re-run diffed definition-by-definition against the last
    known-good run (NOT just aggregate `corpus:failures --summary`
    counts) before ever committing. This is real, valuable, well-evidenced
    work -- just too large and too easy to get subtly wrong to rush
    inside this same session on top of an already-large context budget.
    Next session picking this up should start by re-reading this note in
    full, then the fix-#50-era "First attempt (REVERTED...)" note above
    it for the exact regressed-ID list and root-cause detail already
    gathered, rather than re-deriving either from scratch.
  - No encoder.ts changes made. Moved to a different, more isolated
    actionable failure per CLAUDE.md's completion-behavior rule.
- **definition_id 1277** (ARCH_UTILS.PSARCH_UTIL_EVENT.SavePreChange),
  UNKNOWN_MISMATCH, byte diff @2439 (verified with proper owner context,
  same technique as fixes #48-50) -- **DEFERRED, genuine unresolved
  conflict, no code changed.** Source:
  ```
  &OLD_ID = ARCH_UTILS.PSARCH_ID;
  ScrollFlush(Record.ARCH_SQL_LNG_VW);
  ScrollSelect(1, Record.ARCH_SQL_LNG_VW, Record.ARCH_SQL_LNG_VW, &SQL_SUFFIX);
  ```
  Stored reuses ScrollFlush's own row for BOTH of ScrollSelect's own
  (same-name-repeated) Record.X arguments -- but this is the EXACT SAME
  syntactic shape (`ScrollFlush(Record.X); ScrollSelect(1, Record.X,
  Record.X, ...)`, name repeated within the call) that definition 1283
  already proved does NOT reuse ScrollFlush's row (fresh, call-shared
  instead) -- the established rule fixes #27/#49 are built on. Two
  corpus definitions, identical construct shape, opposite required
  behavior; no distinguishing signal found despite real effort:
  - Hypothesized "trailing SQL/bind-argument count differs" (1277 has 1
    trailing arg, `&SQL_SUFFIX`; 1283 has 3, `&WHERE, &ARCHIVE_ID,
    &PARENT_TBL`) and searched the whole corpus for every
    `ScrollFlush(Record.X); ScrollSelect(1, Record.X, Record.X, ...)`
    occurrence (149 matches) to test it -- DISPROVEN: both trailing-arg
    counts appear on BOTH sides of the EXACT/non-EXACT split in a spot
    sample (e.g. definition 840, trailingArgCount=2, EXACT under the
    CURRENT no-reuse code; definition 1751, trailingArgCount=3, also
    EXACT) with no clean correlation.
  - Spot-checked several of the 149 candidates' CURRENT classification
    directly: most (840, 1751, 4225, 5231, 9768, 10429, 12584, 13230) are
    ALREADY EXACT under the existing no-reuse rule (consistent with
    1283), a handful are UNKNOWN_MISMATCH (889, 1007, 1807, 2459, 2464,
    3191, 4335, 4864, 6210, 11303) -- but checked several of THOSE
    directly (1007 diff@343, 4864 diff@5, 2459 diff@1284, 3191 diff@365)
    and their first byte differences are all far EARLIER than where this
    construct even appears in their own source, meaning their failures
    are unrelated bugs entirely, NOT evidence for or against this
    specific reuse question. Only 1277 itself is confirmed to actually
    fail AT this exact construct.
  - Deliberately did NOT implement a fix scoped to just this one
    definition_id (would not be a real generalizable rule, just an
    overfit hack) and did NOT retry a broader "same name repeated ->
    sometimes reuse" rule without a real distinguishing signal, per
    CLAUDE.md's evidence policy ("do not introduce global same-name reuse
    without corpus evidence... distinguish competing interpretations from
    corpus evidence"). This is a genuinely unresolved case needing either
    a THIRD corroborating example (to reveal the real distinguishing
    factor) or human/HCDEV-side clarification -- worth revisiting if a
    future session's `--trace-refs` investigation of a similar construct
    surfaces the missing signal.
  - No encoder.ts changes made for this investigation. Moved on to the
    next actionable failure per CLAUDE.md's completion-behavior rule
    ("unsupported syntax is a research task, not a stopping condition" --
    same principle applied here to an under-evidenced conflict).
- **Fix #50 landed, but only after a caught-and-reverted broad regression
  -- worth reading in full before touching `reuseRecordReferenceWithinControlGroup`
  again.** Target: definition 1254 (ARCH_SQL_LNG.ARCH_SQL.FieldChange),
  UNKNOWN_MISMATCH, byte diff @942 (verified with proper owner context).
  `&PRIOR_ARCH_SQL = PriorValue(Record.ARCH_TBL, &ZI, ARCH_SQL_LNG.ARCH_SQL, &ZJ);`
  followed by `&CURRENT_ARCH_SQL = FetchValue(Record.ARCH_TBL, &ZI,
  ARCH_SQL_LNG.ARCH_SQL, &ZJ);` -- stored allocates FetchValue's own
  Record.ARCH_TBL argument a FRESH row, but the encoder reused
  PriorValue's earlier one.
  - **First attempt (REVERTED, do not repeat)**: swapped the general
    `reuseRecordReferenceWithinControlGroup` priority-1 lookup (used by
    GetRecord/DeleteRow/ActiveRowCount/UpdateValue/FetchValue/etc -- the
    MOST-shared reuse mechanism in the whole file) from reading
    `recordReferencesByControlGroup` (written unconditionally by every
    allocation) to reading `participatingRecordReferencesByControlGroup`
    (written only by already-recognized reuse-participating calls) --
    the same distinction already used for RowScrollSelect's own lookup.
    Fixed 1254 AND passed the 430-definition protected-baseline gate on
    the FIRST attempt (a false all-clear). A full 30,209-definition
    corpus re-run caught what `--limit 430` could not: 22 regressions
    (EXACT -> UNKNOWN_MISMATCH) against only 11 newly-fixed definitions,
    net -11. Diffed run_id 52 (pre-fix full run, 21740 EXACT) against the
    post-fix full run definition-by-definition to get the exact regressed
    ID list (`SELECT definition_id, classification FROM result WHERE
    run_id = ?` for both runs, compare per ID) -- do NOT trust
    `corpus:failures --summary`'s aggregate counts alone to find
    regressions; always diff two specific run_ids by definition_id.
    Investigated the regressed list before reverting (root-cause, not
    guesswork): 21 of 22 had NO `PriorValue` in their source at all --
    they regressed because fix #48's and fix #49's OWN registrations
    (RowScrollSelectNew's last-arg, ScrollFlush's single-occurrence-name
    fallback) write into `recordReferencesByControlGroup` directly,
    bypassing the normal `marksControlGroupParticipant` path entirely, so
    narrowing the READ side to the "participating" map broke visibility
    of my own two prior fixes for every later GetRecord/ActiveRowCount/
    UpdateValue/etc reader. The 22nd (definition 3061) has a DIFFERENT,
    unrelated `PriorValue(CONTRACT.PAYMENT_TERM)` field-style call (no
    `Record.X` argument at all), so it regressed for some other reason
    entirely, never root-caused since the whole approach was abandoned.
    Reverted cleanly with `git checkout -- src/peoplecode/encoder.ts`
    (the broad swap was this session's ONLY uncommitted change at the
    time, confirmed via `git diff` before reverting -- always check that
    before a blanket revert). Lesson reinforced for future sessions:
    `--limit 430` is necessary but NOT sufficient for ANY change touching
    a mechanism this broadly shared; a full corpus re-run diffed against
    the specific prior run_id by definition_id is the only way to catch
    this class of regression, and aggregate EXACT counts alone can hide a
    net-negative change if newly-fixed and newly-regressed counts happen
    to be close (they were NOT close here, -11 net, but a closer case
    could slip through if only the aggregate delta were checked).
  - **Second attempt (landed as fix #50)**: a much narrower, evidence-
    scoped carve-out modeled directly on the ALREADY-proven
    RowScrollSelect-own-arguments exclusion just below it in the same
    file (same shape, opposite direction): a new
    `suppressRecordReferenceControlGroupWrite` flag, set true only while
    parsing `PriorValue`'s own call arguments, checked alongside the
    existing `!reuseRecordReferenceWithinCallArguments` guard on the
    UNCONDITIONAL `recordReferencesByControlGroup.set(...)` write (not
    touching the READ side at all, unlike the reverted attempt). This
    means `PriorValue`'s own Record.X argument still allocates normally
    but simply doesn't become visible to a LATER reuse-participating
    call's control-group lookup -- every other allocation (including
    RowScrollSelectNew's/ScrollFlush's own registrations from fixes
    #48/#49) is completely unaffected, since the write-suppression is
    scoped to the `PriorValue` call name specifically. Confirmed
    `PriorValue` appears in 185 corpus definitions total; checked that
    definition 3061 (the one regression-list member that DID mention
    `PriorValue`, from the reverted attempt) uses the unrelated
    field-style `PriorValue(RECORD.FIELD)` form with no `Record.X`
    argument, so this narrow fix cannot touch it either way. Verified:
    `npx tsc -p .` clean; `npm test` 456/457 (1 pre-existing skip);
    `corpus:verify --limit 430` 430/430, 0 regressions; every previously
    landed/related definition re-spot-checked EXACT (1254, 1145, 1220,
    3061, 1283, 27, 840, 1172, 1236); full 30,209-definition corpus run
    diffed AGAIN against run_id 52 by definition_id (not just aggregate
    counts, learning directly applied from the reverted attempt): exactly
    0 regressed, exactly 1 improved (1254) -- clean, minimal, confirmed
    net-positive fix.
- **Fix #49** landed (src/peoplecode/encoder.ts): a `RowScrollSelect`/
  `RowScrollSelectNew`/`ScrollSelect` call's Record.X argument whose name
  appears only ONCE across that call's own entire argument list may reuse
  a same-control-group row an immediately preceding `ScrollFlush` already
  allocated -- unlike a name repeated WITHIN the same call (which stays
  call-private, per definition 1283's already-proven rule, untouched by
  this fix). New closure variable `singleOccurrenceCallArgumentRecordNames`
  (a one-time lookahead scan of the call's own raw argument text, done
  once when entering the call) plus a third fallback check in
  `recordReference()`'s `reuseRecordReferenceWithinCallArguments` branch,
  consulting the ordinary `recordReferencesByControlGroup` pool (not the
  separate `participatingRecordReferencesByControlGroup` map). Investigated
  via definition 1220 (ARCH_FLT_RQST.PSARCH_ID.SavePostChange), byte-diff
  offset 1059 (verified with proper owner context, not a rough trace
  guess -- see the fix-#48-era note in this file about that pitfall).
  Cross-checked against 10 corroborating same-shape candidates found via a
  direct corpus text search (`ScrollFlush(Record.X); ScrollSelect(...,
  Record.X, Record.Y, ...)` with X != Y) BEFORE writing any code, per
  CLAUDE.md's evidence rule: two (4282, 7046) were ALREADY EXACT with the
  OLD code, which first looked like direct counter-evidence against a
  naive "always reuse" rule -- investigated and resolved: both sit inside
  a `Function ... End-Function;` body, where each top-level statement gets
  its own fresh control group (the established fix-#19-era rule), so
  ScrollFlush and ScrollSelect there are never in the same control group
  regardless, explaining why they were already correct without needing
  this rule at all. The other 8 (including 1220) were all UNKNOWN_MISMATCH
  before the fix; after it, 6 moved to EXACT (1220, 4756, 5661, 5687, plus
  two side-effects) and 2 (3547, 3556) remain UNKNOWN_MISMATCH -- still
  progress, not blocked by THIS bug anymore (not yet investigated further,
  a distinct remaining issue). Definition 1283 (the ORIGINAL
  same-name-repeats-within-call evidence) re-confirmed EXACT, along with
  every other definition already cited in the surrounding comments (27,
  840, 1172, 1236). Verified: `npx tsc -p .` clean; `npm test` 456/457 (1
  pre-existing skip); `corpus:verify --limit 430` 430/430, 0 regressions;
  full local corpus re-run (30,209 definitions) went 21737 -> 21740 EXACT
  (+3, net positive, zero regressions in any other classification
  bucket).
- **Snapshot received and installed.** The user provided the real 192MB
  `tools/corpus/hcdev-snapshot.sqlite` via chat upload, split into 8 parts
  (`split -b 25m`) since it exceeded the 30MB per-message limit (a direct
  Google Drive link was tried first but the environment's network policy
  blocks `drive.google.com` outright). All 8 parts reassembled via `cat`,
  verified as a valid SQLite database (`PRAGMA integrity_check` -> ok,
  30,209 definitions in the one completed snapshot among 4 snapshot_meta
  rows -- the other 3 were incomplete/aborted capture attempts from
  whatever session originally built this file, definition_count=0 each,
  correctly ignored by `getLatestCompletedSnapshot()`). Placed at
  `tools/corpus/hcdev-snapshot.sqlite` (confirmed still gitignored, never
  committed). Also regenerated `tools/corpus/baselines/hcdev.json` (also
  gitignored, also absent in this fresh container) by running the first
  430 definitions and confirming 430/430 EXACT against the REAL snapshot
  before persisting it as the accepted baseline (`npm run corpus:baseline
  -- --limit 430`) -- this is the first time in this container's life the
  430/430 protected baseline has been verified against genuine HCDEV
  evidence rather than asserted from a prior session's notes.
- **Important reconciliation note**: the very first fresh-candidate pick
  past the 430 window (`corpus:next` -> definition 536, deferred; used the
  documented SQL workaround -> definition 1145, ANALYSIS_DB_WRK.
  BASE_CUBE_INST_ID.FieldChange) turned out to be **genuinely
  UNKNOWN_MISMATCH**, contradicting this file's own fix #37 writeup, which
  claimed 1145 reached EXACT. Investigated with real evidence (this
  session's own `--trace-refs` output plus two leftover, git-tracked
  scratch scripts from a prior session, `tmp-dump1145.ts`/`tmp-dump1145b.ts`,
  found still sitting at the repo root -- also fixed this session). The
  fix #37 comment's own cited source line for 1145
  (`RowScrollSelectNew(1, Record.ANALYSIS_DB_DIM, Record.ANALYSIS_DB_DIM, "...", ...)`,
  claiming both arguments share one name) is NOT fabricated -- it
  accurately describes 1145's *second* `RowScrollSelectNew` call (the
  Else/"I"-branch one) -- but it is *incomplete*: it never covered the
  *first* call's genuinely different shape (`Record.ANALYSIS_DB_DIM,
  Record.ANL_MOD_DIM` -- two DIFFERENT names), whose fresh `Record.
  ANL_MOD_DIM` allocation a much-later `UpdateValue(...,
  Record.ANL_MOD_DIM)` call in the same control group needs to reuse and
  previously could not. Likely explanation: a prior session validated the
  same-name (second-call) fix, saw 1145 move off ENCODE_ERROR/closer to
  matching, and recorded it as fully EXACT without re-confirming against
  this file's specific real bytes -- exactly the kind of claim this
  session's `/goal` continuation could not simply trust once real
  evidence was back in hand. Treat every "previously EXACT" claim in this
  file's older sections as a strong hint, not proof, until re-confirmed
  against this real snapshot; do not block on re-verifying all of them
  proactively, but don't be surprised if others also need a second look.
- **Fix #48** landed (src/peoplecode/encoder.ts, `call()`'s argument-list
  `finally` block, ~line 5715): a `RowScrollSelect`/`RowScrollSelectNew`
  call's LAST Record.X argument (its ultimate "to" table, immediately
  before the SQL where-clause string) now also registers into
  `recordReferencesByControlGroup` -- the pool
  GetRecord/DeleteRow/ActiveRowCount/UpdateValue/etc already read via
  `reuseRecordReferenceWithinControlGroup` -- so a LATER statement in the
  same control group can reuse it, exactly like definition 1145 requires.
  Earlier/non-final Record.X arguments in the same call are untouched
  (stay call-private, preserving definition 1172's proven counter-
  example: ActiveRowCount right after a RowScrollSelectNew call does NOT
  reuse that call's non-last Record.X arguments). Definition 1145 moved
  UNKNOWN_MISMATCH -> EXACT. Verified: `npx tsc -p .` clean; `npm test`
  456/457 (1 pre-existing skip); `corpus:verify --limit 430` 430/430, 0
  regressions; spot-checked every definition cited in the surrounding
  comments (27, 840, 1172, 1236, 1283) individually -- all still EXACT;
  full local corpus re-run (30,209 definitions, ~5 min) went 21734 ->
  21737 EXACT (+3, net positive, zero regressions in any other
  classification bucket: ENCODE_ERROR/DECODE_SOURCE_MISMATCH/
  UNSUPPORTED_SYNTAX counts all unchanged).
- Also removed the two leftover git-tracked scratch files at the repo
  root (`tmp-dump1145.ts`, `tmp-dump1145b.ts`) after using them as a
  starting point -- the first version of `tmp-dump1145b.ts` I ran gave a
  MISLEADING result (looked like a difference existed as early as byte
  offset 1851) because it called `encodeProgram(source)` with no `owner`
  context, unlike the real validator which always passes `{owner:
  {recordName, fieldName}}`. Worth remembering for any future scratch
  debugging: always pass the same owner context the harness does, or the
  reference-index numbering will be silently offset by one and every
  manual byte comparison past that point will be wrong.
- Full local corpus inventory now populated from scratch in this fresh
  container (was completely empty -- `corpus-results.sqlite` is
  gitignored same as the snapshot): `npm run corpus:harness` (no filters)
  took ~5 minutes for all 30,209 definitions. Current full-corpus state:
  EXACT 21737, UNKNOWN_MISMATCH 4840, ENCODE_ERROR 2276,
  DECODE_SOURCE_MISMATCH 698, UNSUPPORTED_SYNTAX 658.
- Next: continue past definition 1145 using the same SQL-query-for-fresh-
  candidates workaround (`corpus:next` will keep re-suggesting 536 until
  it gains deferred-definition awareness) -- query results DB for the
  next UNKNOWN_MISMATCH definition past offset 1144 not already in the
  deferred list (536, 871, 1406, 3235, 1285, 1360, 1422).

## Current target (previous entry, preserved for history)
- Session resumed 2026-09-24 via `/goal` in a FRESH cloud container (new
  ephemeral checkout, no state carried over from any prior session's
  container). Ran `npm install` (node_modules was entirely absent), then
  `npx tsc -p .` (clean). Attempted the mandatory pre-work verification
  (`npm run corpus:failures -- --summary`, `npm run corpus:verify --
  --limit 430`) and hit a **hard environment blocker**, not a calibration
  difficulty:
  - `tools/corpus/hcdev-snapshot.sqlite` does not exist in this container.
    It is gitignored (correctly — it holds captured real HCDEV compiler
    evidence) and, since this container is a fresh clone, nothing from any
    earlier session's snapshot survived. `corpus:failures --summary`
    confirms: "Definitions known: 0".
  - `tools/corpus/corpus-results.sqlite` (the run-history DB) and every
    file under `tools/corpus/baselines/` are likewise absent (gitignored,
    not regenerated).
  - No Oracle credentials (`PS_CONNECT_STRING`, `PS_USER`, `PS_PASSWORD`)
    are set anywhere in this environment (checked `env`, and confirmed via
    the environment-secrets documentation that no such secret is
    configured) — so `--live` cannot be used to rebuild the snapshot
    either, even as an explicit maintenance action.
  - Separately (a real code bug, not investigated further this session):
    `tools/corpus/corpus-runner.ts` `runCorpus()` calls
    `getConnectionConfig()` unconditionally at the top (line ~95), purely
    to populate a `Database:` log label, even when running in
    local-snapshot mode. This means even a present, populated snapshot
    file would still hit "Missing required environment variable(s):
    PS_CONNECT_STRING, PS_USER, PS_PASSWORD" today — local-snapshot mode
    is not actually decoupled from Oracle config the way CLAUDE.md's
    local-first policy describes. Worth fixing (make the `Database:` label
    conditional / lazy) once the snapshot itself is available to verify
    against, but not done yet since there is no data to validate the fix
    with.
  - No workaround was applied that fabricates or guesses corpus data.
    Nothing in `src/peoplecode/encoder.ts` or `decoder.ts` was touched this
    session. All prior sessions' encoder/decoder rules (fixes #1-47 and
    the "Newly established rules" sections below) remain intact in git
    history — this is an environment/data-availability gap, not a
    regression.
  - Asked the user how to proceed. Resolution: env-var Oracle credentials
    are not usable (HCDEV requires a VPN this environment cannot reach).
    User will upload the existing snapshot file directly (192MB, over the
    30MB per-message limit — splitting into parts via `split -b 25m` or a
    direct-download link was proposed; upload not yet complete as of this
    checkpoint).
  - **Two infrastructure fixes landed while waiting on the upload** (both
    validated WITHOUT real corpus data — no fabricated results, no
    encoder/decoder changes):
    1. `tools/corpus/corpus-runner.ts`: the eager unconditional
       `getConnectionConfig()` call at the top of `runCorpus()` (previously
       flagged above) is now lazy — only called when `options.live` is
       true. `databaseName` falls back to the literal string
       `'LOCAL SNAPSHOT'` instead of `config.connectString` for non-live
       runs (though in practice `cli.ts` always passes an explicit
       `databaseName: 'HCDEV'` today, so this fallback is currently
       cosmetic dead code for the CLI path — still correct and needed for
       any other caller). The two `openCorpusConnection(config)` call
       sites (both already inside `if (options.live)` branches) now call
       `getConnectionConfig()` directly inline instead of closing over the
       removed top-level `config` variable. Smoke-tested by creating a
       throwaway EMPTY snapshot db (schema only, zero definitions, via
       `tools/corpus/snapshot/schema.sql`) at the real snapshot path with
       `PS_CONNECT_STRING`/`PS_USER`/`PS_PASSWORD` explicitly unset —
       confirmed `npm run corpus:verify -- --limit 5` no longer throws
       "Missing required environment variable(s)" and instead correctly
       reports `Source: LOCAL SNAPSHOT` / `Loaded 0 definition(s)`. The
       throwaway db was deleted immediately after (never left in place,
       never used to fabricate a result).
    2. `package.json`'s `test` script (`node --test dist-test/test/`,
       directory form) does not recurse in this container's Node v22.22.2
       — it throws `MODULE_NOT_FOUND` instead of discovering the 35
       compiled `*.test.js` files inside `dist-test/test/`, which broke
       `npm test` (and therefore the mandatory post-fix verification
       workflow) before any corpus work could even begin. Root-caused by
       comparing directory-form vs. an explicit glob
       (`dist-test/test/*.test.js`), which finds and runs all tests
       correctly (457 tests, 456 pass, 1 pre-existing skip — exactly
       matching every prior session's documented baseline count). Changed
       the script to the explicit glob form. `dist-test/test/` has only
       one subdirectory (`fixtures/`, not test files), so the flat glob is
       complete — confirmed via `find`. This is an environment/Node-version
       quirk fix, not a corpus-calibration change.
    - Both fixes verified together: `npx tsc -p .` clean, `npm test` ->
      456/457 pass (1 skip), matching baseline exactly. No corpus data
      involved in validating either fix. Not yet committed as of this
      checkpoint note — see git log for actual commit state.

## Current target (previous entry, preserved for history)
- Session continued 2026-09-24 via `/goal` resume, picking up exactly where
  the prior checkpoint left off (past fix #38, definition 1152). Re-verified
  clean state first (`tsc`, `npm test` 456/1, `corpus:verify --limit 430`
  430/430) before any new edits. `corpus:next` kept re-recommending the
  already-deferred definition 536, so used the documented SQL workaround
  (query `corpus-results.sqlite` directly for the latest UNKNOWN_MISMATCH
  classifications past offset 1152) to get fresh candidates, exactly as the
  prior session's "Next action" notes instructed.
- Nine definitions moved UNKNOWN_MISMATCH -> EXACT this continued session:
  1187, 1236, 1257, 1265, 1283, plus four resolved purely as side effects of
  those fixes (1178, 1179, 1180, 1181, 1182, 1188, 1266 -- seven side-effect
  resolutions, all confirmed via direct harness re-run, not assumed). Also
  reconfirmed 840 (a previously-EXACT, non-protected-window definition from
  an earlier session) after catching and repairing an in-session regression
  against it (see fix #43 below).
- Landed fixes #39-47 (see "Session fixes" section below for full detail).
  Two of these (#43, #47) were themselves regression-isolation repairs for
  regressions this same session's own earlier fixes introduced -- both
  caught before being left in place: #43 caught by directly testing
  definition 840 (not in the --limit 430 protected window, so the gate
  alone would have missed it -- caught by habit of re-testing every
  definition touched by a shared-helper change, not just the new target);
  #47 caught by the routine post-fix `corpus:verify --limit 430` gate
  itself (FAIL, definitions 30 and 95 regressed EXACT -> UNKNOWN_MISMATCH).
  Both were root-caused via the regressed definitions' own diff/trace
  output (per CLAUDE.md's regression-isolation protocol: identify the
  regressed definition_ids, find their first diff, narrow the offending
  rule) and repaired with a MORE PRECISE rule, not a revert -- no calibrated
  behavior was given up to fix either regression. 430/430 reconfirmed after
  each repair; final state after fix #47 is 430/430 with all seven
  definitions touched this session (30, 95, 840, 1187, 1236, 1257, 1265,
  1283 -- eight, plus the seven pure side-effects above) independently
  re-verified EXACT.
- `npm run corpus:failures -- --summary` after fix #47: EXACT 21244 (was
  21194 as of the fix #28 mid-session snapshot recorded in the prior
  checkpoint; not an exact apples-to-apples delta since several full/manual
  re-scans happened between the two snapshots, but confirms continued
  forward progress with no unexpected regressions in the broader corpus).
- Next: continue past offset 1283 using the same SQL-query-for-fresh-
  candidates workaround (`corpus:next` will keep re-suggesting 536 until it
  gains deferred-definition awareness). See "Next action" for the exact
  query and the current known-deferred/locally-blocked list (536, 871,
  1406, 3235 -- all unchanged this session).

## Current target (previous session's own note, preserved for history)
- New session resumed 2026-09-24 via `/goal` (autonomous corpus calibration,
  local-snapshot-only). Ran the mandatory workflow from scratch: confirmed
  typecheck clean, confirmed protected baseline 430/430, then
  `corpus:failures --summary` + `corpus:next` selected definition_id 535
  (ADDRESS_TYPE_VW.ADDRESS_TYPE.RowInit, UNKNOWN_MISMATCH, the largest raw
  failure family). Landed fix #23 (see "Session fixes" below): a bare
  `GetRecord(...)` call's `GetField(Field.X)` result was never registering
  into the control-group FIELD-reuse pool (only `&var.GetRecord(...)
  .GetField(...)` postfix-chain form did), so a LATER bare `.FIELDNAME`
  property access on that same field elsewhere in the control group
  incorrectly allocated a fresh PSPCMNAME row instead of reusing the
  existing one. Definition 535 moved UNKNOWN_MISMATCH -> EXACT.
- **Regression caught and repaired in-session** (see fix #23's own notes):
  the first version of this fix set field-reference mode for ANY bare
  `GetRecord(...)` call, which broke protected-baseline definition_id 180
  (ABS_H_D_NLDSBR.SAME_ADDRESS_EMPL.FieldChange, EXACT -> UNKNOWN_MISMATCH)
  because `GetRecord()` with NO arguments (`GetRecord().ParentRow...`) is a
  structurally different, Row-navigation construct, not a field access.
  Caught immediately by the routine post-fix `corpus:verify --limit 430`
  gate, root-caused via the regressed definition's own first-diff trace,
  and narrowed the rule to require a non-empty `GetRecord(...)` argument
  list. 430/430 restored and reconfirmed; `npm test` also clean (456
  pass / 1 pre-existing skip). Spot-checked definitions 524 (still EXACT,
  unaffected) and 871 (still its pre-existing UNKNOWN_MISMATCH, unaffected
  — see "Locally blocked").
- Next `corpus:next` pick was definition_id 536 (ADDRESS_TYPE_VW.
  ADDRESS_TYPE.SaveEdit, same UNKNOWN_MISMATCH family). Investigated and
  DEFERRED (not locally blocked — see "Identified, not yet fixed" for the
  full writeup): the construct (`&RecordVar = &RowVar.SINGLEMEMBER;`, a
  single-dot Row-shorthand RECORD access) needs a target-variable-type
  provenance signal that isn't currently threaded into the postfix parser.
  A tempting broad fix (relax the existing two-dot Row-reference-mode
  requirement to one dot, minus a short exclusion list of known Row state
  members) was corpus-checked BEFORE implementation and disproven: 164 real
  single-dot Row-property accesses across 30+ definitions use bare
  properties well outside that exclusion list (`ChildCount`, `RecordCount`,
  `DeleteEnabled`, `Style`, and more), so that approach would have caused
  widespread new regressions. No encoder.ts changes were made or reverted
  for this definition — moved on to the next actionable failure per
  CLAUDE.md's completion-behavior rule.
- Manually selected definition_id 634 (ADJ_CN_TAX_BAL.BALANCE_YEAR.
  FieldFormula, same UNKNOWN_MISMATCH family, different offset) since
  `corpus:next` keeps re-recommending 536 regardless of the deferral above.
  Landed fix #24: a Function body's leading standalone comment (before any
  Local declaration) followed by a blank line before the first `Local`
  declaration was missing its 0x4F blank-line marker entirely — no
  existing mechanism covered that specific transition. Definition 634
  moved UNKNOWN_MISMATCH -> EXACT. 430/430 gate passed on the first
  attempt (no regression this time); `npm test` clean. Two fixes landed
  this session so far (535 and 634), one regression caught and repaired
  in-session (180, during fix #23), one definition investigated and
  deliberately deferred with evidence recorded (536).
- Manually selected definition_id 772 (ADSRECORDS1_WRK.QRYSEARCHBTN.
  FieldChange, same technique — query the results DB directly for a fresh
  offset). Landed fix #25: FOUR distinct, small bugs found in sequence on
  the SAME definition, each one's fix moving the first diff further until
  it finally went EXACT (progress-not-completion applied repeatedly, not
  stopped at the first improvement) — (a) `ApiObject` missing from the
  object-declaration-type opcode list, (b) `ApiObject` missing its
  implicit PACKAGE dependency-row allocation, (c) that dependency-row
  reuse pool needed `functionDepth` added to its cache key (Component-level
  vs Function-local Rowset declarations were colliding), (d)
  HideScroll/UnhideScroll needed the SCROLL.X control-group reuse rule
  (they already had the analogous RECORD.X one from an earlier session's
  fix #18, but never got the SCROLL.X one). Definition 772 moved
  UNKNOWN_MISMATCH -> EXACT. 430/430 gate passed on the first attempt (no
  regression); `npm test` clean. Three fixes landed this session so far
  (535, 634, 772 — the last one via 4 sub-fixes).
- Manually selected definition_id 808 (AE_DERIVED.REFRESH_BTN.
  SavePreChange, same technique). Landed fix #26: `CreateRowset(Record.X)`
  was missing from the Record.X control-group-scoped reuse-checking
  function list (the same list GetRecord/DeleteRow/ActiveRowCount/
  UpdateValue/InsertRow/SetCursorPos/HideScroll/UnhideScroll/UnhideRow/
  CopyFields/RecordDeleted/RecordChanged already belong to) — same failure
  shape as fix #18: a reuse-unchecked allocation silently overwrote the
  shared control-group cache entry, poisoning every later `GetRecord`
  call. Definition 808 moved UNKNOWN_MISMATCH -> EXACT on the first
  sub-fix, no further diffs. 430/430 gate passed on the first attempt (no
  regression); `npm test` clean. Four fixes landed this session so far
  (535, 634, 772, 808).
- Manually selected definition_id 840 (AE_UPGCONV_WRK.AE_REFRESH.
  FieldChange, same technique). Landed fix #27, with an in-session
  regression caught and repaired via a MORE PRECISE rule (not a revert):
  `RowScrollSelect` was on the GLOBAL by-name Record.X reuse list with no
  citation of its own; removing it and giving it a same-call-only reuse
  mechanism fixed 840 but broke protected definition_id 27 (which needs
  RowScrollSelect to reuse an EARLIER statement's `ActiveRowCount`-
  established reference, not just within its own call). Root cause turned
  out to be a genuine THIRD distinction the encoder had never tracked:
  "was the earlier same-name reference established by an already-
  recognized reuse-participating call, or by an unrelated one" — solved
  with a new `participatingRecordReferencesByControlGroup` map, written
  only when `reuseRecordReferenceWithinControlGroup` was already true at
  allocation time. Both 840 and 27 EXACT simultaneously after the second
  attempt. 430/430 gate restored; `npm test` clean. Five fixes landed this
  session (535, 634, 772, 808, 840), one deferred with evidence (536), one
  regression caught and repaired during fix #23, one regression caught and
  repaired (via a better rule, not a revert) during fix #27. Definitions
  842 and 923 also found already-EXACT as side effects while sampling
  fresh `corpus:next` candidates (no separate fix needed).
- Manually selected definition_id 921 (AGC_CAT_ASGNEE.AGC_CATEGORY_ID.
  FieldFormula, same technique). Landed fix #28: an object-typed Function
  PARAMETER (`&rowCategory As Row`) never allocated its implicit
  PACKAGE/ROW dependency row the way a `Local Row &var;` DECLARATION
  already does (the same class of bug as fix #25's ApiObject fix, but for
  parameters — a separate code path in `functionStatement()`'s parameter
  list, not `localDeclaration()`). Definition 921 moved UNKNOWN_MISMATCH
  -> EXACT. 430/430 gate passed on the first attempt (no regression);
  `npm test` clean. Six fixes landed this session (535, 634, 772, 808,
  840, 921). Bounded `corpus:failures --summary` check confirmed +8 EXACT
  (21186 -> 21194) with no unexpected ripple.
- Manually selected definition_id 924 (AGC_CAT_STEP.AGC_CATEGORY_ID.
  FieldFormula, same technique — directly adjacent to 921/923, same
  underlying source file family). Landed fix #29, two more gaps in the
  same `Row`-typed-parameter support fix #28 started: (a) parameters
  never joined the `rowVariables` Set, so their own `.RECORD.FIELD`
  postfix chains fell through to plain inline text instead of PSPCMNAME
  references; (b) the FIELD binding a Row-typed variable establishes
  needed to bridge into the control-group-scoped `declaredRecordFields`
  pool so a later, differently-shaped row-shorthand access could find it.
  Definition 924 moved UNKNOWN_MISMATCH -> EXACT. 430/430 gate passed on
  the first attempt (no regression); `npm test` clean. Seven fixes landed
  this session (535, 634, 772, 808, 840, 921, 924).
- Manually selected definition_id 935 (AMM_ARCHIVE_WK.FUNCLIB.
  FieldFormula, same technique). Landed fix #30, three unrelated small
  bugs found in sequence on the same definition: (a) the leading-Local-run
  blank-line transition check ran after the comment-consuming branches
  instead of before, so it never fired when a comment (not a real
  statement) followed the last Local — the mirror case of fix #24; (b)
  `Component XmlDoc &var;` never got its implicit PACKAGE/XMLDOC
  dependency row, same class of gap as fix #14 (Component Rowset) and fix
  #25 (Local ApiObject); (c) a `rem` statement's generic trailing
  `space()` call ate a following blank line, because `remComment()`
  already consumes its own `;` (unlike ordinary statements, where that
  `space()` call exists to skip whitespace BEFORE their still-unconsumed
  `;`). Definition 935 moved UNKNOWN_MISMATCH -> EXACT. 430/430 gate
  passed on the first attempt (no regression); `npm test` clean. Eight
  fixes landed this session (535, 634, 772, 808, 840, 921, 924, 935).
- Manually selected definition_id 937 (AMM_ARCHIVE_WK.XML3_PB.FieldChange,
  same technique — same source file family as 935/936). Landed fix #31:
  `remComment()`'s "consecutive REM lines merge into one comment token"
  rule (calibrated in an earlier session against definition 964) was
  merging unconditionally; definition 937 proved the merge must stop once
  a REM line already closes with its own `;`, reconciled with 964's
  original evidence (whose first line has no `;`, a genuine continuation)
  by keying the merge condition on "the accumulated text doesn't yet end
  in `;`" rather than "the next line also starts with REM." Definition
  937 moved UNKNOWN_MISMATCH -> EXACT. 430/430 gate passed on the first
  attempt (no regression — re-verified definition 964's `source→bin`
  stays EXACT; its `roundtrip` mismatch is the already-documented,
  unrelated decoder-only bug noted earlier in this file, not a new
  regression). `npm test` clean. Nine fixes landed this session (535,
  634, 772, 808, 840, 921, 924, 935, 937). Definition 936 also found
  already-EXACT as a side effect while sampling.
- Checked definition_id 940 (AMM_DERIVED.AE_DELETE_SECTION.FieldChange,
  next in the family): a THIRD corroborating instance of the
  already-documented decoder-only "extra blank line" bug (definitions
  964, 1406) — `source→bin` EXACT, `roundtrip` MISMATCH only.
  Deliberately deferred (decoder work, out of scope for this session's
  encoder focus, per DEVELOPER.md priority ordering); recorded in
  "Identified, not yet fixed" and moved on to definition 942 instead.
- Manually selected definition_id 942 (AMM_DERIVED.AMM_CANCEL_M.
  FieldChange, same technique). Landed fix #32: the blank-line-marker
  handling for a transition between two top-level declaration statements
  that both stay inside the same open declaration section (e.g.
  `Declare Function ...;` followed by `Component ...;`) was hardcoded to
  emit exactly one 0x4F regardless of blank-line count, unlike every
  other marker site in this file. Definition 942 moved UNKNOWN_MISMATCH
  -> EXACT. 430/430 gate passed on the first attempt (no regression);
  `npm test` clean. Ten fixes landed this session (535, 634, 772, 808,
  840, 921, 924, 935, 937, 942).
- Manually selected definition_id 945 (AMM_DERIVED.AMM_COLLAPSE_ALL.
  FieldChange, same technique). Landed fix #33: fix #32's own trigger
  regex for the declaration-to-declaration blank-line marker was itself
  incomplete — `PanelGroup` was missing from it entirely (not just a
  multiplicity shortfall; no marker fired at all). Definition 945 moved
  UNKNOWN_MISMATCH -> EXACT. 430/430 gate passed on the first attempt (no
  regression); `npm test` clean. Eleven fixes landed this session (535,
  634, 772, 808, 840, 921, 924, 935, 937, 942, 945). Definitions 949 and
  946 also found already-EXACT as side effects while sampling.
- Landed fix #34, this session's ONLY decoder.ts fix (all prior fixes
  were encoder.ts): the recurring "extra blank line" decoder bug noted
  earlier (964, 1406) plus two more corroborating instances found while
  sampling (940, 953/954) all traced to one root cause — `PanelGroup`'s
  declaration opcode (0x51) missing from decoder.ts's `followsDeclaration`
  detection list, meaning a blank line after the last `PanelGroup ...;`
  declaration decoded as TWO blank lines instead of one. Fixed; 940, 953,
  954, and 964 all moved to EXACT simultaneously from one fix. Definition
  1406 re-checked and confirmed to have a genuinely separate, still-open
  decoder gap (unaffected by this fix). 430/430 gate passed on the first
  attempt (no regression); `npm test` clean. A random 40-definition
  sample of the broader UNKNOWN_MISMATCH family found no further
  definitions resolved (confirms the fix is narrowly scoped, not a hidden
  larger win) — `corpus:failures --summary` confirmed exactly +4 EXACT.
  Twelve fixes landed this session (535, 634, 772, 808, 840, 921, 924,
  935, 937, 942, 945, plus decoder fix #34).
- Continuing past the fix #34 cluster, definitions 958, 963, and 966
  (all AMM_DERIVED, same file as 940/953/954/964) were each found
  already-EXACT as further side effects of fix #34 — folded into that
  fix's own notes above (total now 7 definitions resolved by one decoder
  fix). Manually selected definition_id 1046 (AMM_FILTER.IB_DIRECTION.
  FieldFormula, a different file, to get past the resolved cluster).
  Landed fix #35: `Grid` was missing from BOTH places fix #25 already
  fixed for `ApiObject` — the `typeName()` object-declaration-type opcode
  list, and `localDeclaration()`'s implicit-PACKAGE-dependency dispatch.
  Definition 1046 moved UNKNOWN_MISMATCH -> EXACT. 430/430 gate passed on
  the first attempt (no regression); `npm test` clean. Thirteen fixes
  landed this session (535, 634, 772, 808, 840, 921, 924, 935, 937, 942,
  945, 1046, plus decoder fix #34).
- Continuing past 1046, found the ENTIRE AMM_TREE_WS FieldChange cluster
  (1061, 1062, 1081, 1083-1097 — 17 definitions) already EXACT from fix
  #34's broader reach (`corpus:failures --summary`: 21209 -> 21228, +19).
  Skipped definition 1066 (a large, complex 66KB+ definition, 417+
  PSPCMNAME entries) in favor of smaller targets. Manually selected
  definition_id 1128 (ANALYSIS_DB_DIM.DIMENSION_ID.FieldEdit, a different
  file). Landed fix #36: `FetchValue` had only its own narrower Record.X
  reuse mechanism, never added to the shared control-group reuse trigger
  list GetRecord/ActiveRowCount/DeleteRow/CreateRowset/etc already belong
  to. Definition 1128 moved UNKNOWN_MISMATCH -> EXACT. 430/430 gate
  passed on the first attempt (no regression); `npm test` clean.
  Fourteen fixes landed this session (535, 634, 772, 808, 840, 921, 924,
  935, 937, 942, 945, 1046, 1128, plus decoder fix #34).
- Manually selected definition_id 1145 (ANALYSIS_DB_WRK.BASE_CUBE_INST_ID.
  FieldChange, next in offset order). Landed fix #37: `RowScrollSelectNew`
  needed the exact same same-call Record.X reuse rule fix #27 built for
  `RowScrollSelect`, just a name the exact-match trigger regex didn't
  recognize — widened to `/^RowScrollSelect(?:New)?$/i`, no new mechanism
  needed. Definition 1145 moved UNKNOWN_MISMATCH -> EXACT on the FIRST
  attempt (no isolation needed this time). 430/430 gate passed; `npm
  test` clean. Fifteen fixes landed this session (535, 634, 772, 808,
  840, 921, 924, 935, 937, 942, 945, 1046, 1128, 1145, plus decoder fix
  #34).
- Manually selected definition_id 1152 (ANALYSIS_DB_WRK.PB_OPEN_ANL_MODEL.
  FieldChange, next in offset order). Landed fix #38: `DoModalPanelGroup`
  was missing from the shared control-group Record.X reuse trigger list
  (the same list fixes #18/#26/#36 already extended) — two calls in an
  If/Else-If, same top-level control group, should reuse one Record.X
  row. Definition 1152 moved UNKNOWN_MISMATCH -> EXACT on the FIRST
  attempt. 430/430 gate passed; `npm test` clean. Sixteen fixes landed
  this session (535, 634, 772, 808, 840, 921, 924, 935, 937, 942, 945,
  1046, 1128, 1145, 1152, plus decoder fix #34).
- Session resumed 2026-09-24 after a PC crash interrupted the prior session
  mid-work (VPN dropped, user reconnected it at resume time). All prior
  uncommitted work was intact on disk; typecheck/tests/430-gate re-verified
  clean before continuing (430/430, no corruption from the crash).
- Picked up sub-puzzle A (reference-scoping for ActiveRowCount/DeleteRow/
  etc) since it had the most evidence already gathered. Landed twelve more
  fixes this session (#11-#22 below), all in src/peoplecode/encoder.ts.
  Sub-puzzles A, B, and C are now ALL resolved for their evidenced cases;
  see "Newly established rules" #11-13, #17, and #20.
- Ten definitions moved UNKNOWN_MISMATCH -> EXACT this resumed session:
  2406, 1269, 3586, 4067, 1738, 3539, 525, 524, 528, 534 (all confirmed
  stable after every subsequent fix). 3235 partially advanced (one real
  bug fixed, fix #15) but has a second, deeper, NOT-yet-understood issue
  remaining. 871 partially advanced enormously (fixes #18-19 moved its
  first diff from byte offset 1811 to 19779 of a 36181-byte program —
  past the halfway point) but still has at least one further remaining
  issue — see "Locally blocked" below for both.
- **Regression caught and repaired in-session** (see fix #16): the first
  version of the leading-Local-declaration-run fix for definition 3539
  broke protected-baseline definition_id 256 (ACA_BGN_MTH_TBL.BEGIN_DT.
  SaveEdit, EXACT -> UNKNOWN_MISMATCH) by over-generalizing "defer the
  section close" to ANY following Local declaration, when it should only
  defer when the FOLLOWING Local is itself uninitialized. Caught
  immediately by the routine post-fix `corpus:verify --limit 430` gate,
  root-caused via the same regressed definition's own first-diff trace
  (per CLAUDE.md's regression-isolation protocol), and narrowed to an
  evidence-backed fix covering BOTH definitions without reverting the
  original win. 430/430 restored and reconfirmed. No further regressions
  occurred for the rest of the session (430/430 after every one of fixes
  #17-19 too).
- Sub-puzzle B (definition 525) resolved via fix #17: a Component-declared
  Application Class instance's method calls should reuse its runtime-create
  PSPCMNAME dependency (like a declaration-phase Local Application Class
  variable already did), not allocate a fresh row per distinct method name.
  The original sub-puzzle-B hypothesis in this file (one SHARED row across
  method calls) was superseded once direct stored-PSPCMNAME enumeration
  showed the true answer: NO separate method-dependency row at all.
- Fixes #18-19 opened up a large, genuinely multi-layered sub-investigation
  into how control groups work inside `Function ... End-Function;` bodies
  (completely undocumented before this session -- functionDepth was not
  previously reflected in control-group scoping at all). Landed: (a)
  HideScroll/UnhideScroll/UnhideRow/CopyFields added to the Record.X
  control-group reuse-checking function list (same axis as sub-puzzle A's
  fixes), and (b) each top-level-of-a-Function-body statement (not just
  control structures) now gets its own fresh control group, unlike the
  main program's top level. Both evidenced directly by AE_WRK.AE_GO.
  FieldChange (definition 871, a 36181-byte / 84-name program) and
  validated with zero regressions, but 871 itself is NOT yet fully EXACT
  -- there is at least one more distinct issue past byte offset 19779 with
  a large (52-index) reference-count gap, not yet understood. This
  Function-body control-group area is rich enough to deserve its own
  dedicated future session rather than more ad hoc digging now.
- Sub-puzzle C (definition 524) resolved via fix #20: `Field.X` gets a
  control-group-scoped reuse rule mirroring `Record.X`'s, but only when
  reached through `.GetField(...)` directly chained onto that same
  expression's own preceding `.GetRecord(...)` step (not merely whenever
  `expectedReferenceMember === 'field'`, which is also true for an
  unrelated reason on the first postfix step off a declared Record
  variable — an existing calibrated test proved that case stays
  occurrence-based, caught before the fix was considered final).
- With all three original sub-puzzles resolved, continued via fresh
  `npm run corpus:next` picks: definition 528 (fix #21), a small,
  self-contained bug in the leading-Local-declaration-run mechanism where
  a disabled-code marker (`<* ... *>`) appearing before any Local
  declaration unconditionally killed the run-tracking state, permanently
  preventing a Local declared right after it from ever being tracked; and
  definition 534 (fix #22), two independent small bugs (RecordDeleted/
  RecordChanged missing from the Record.X reuse-checking list, plus a
  hardcoded single-marker REM blank-line bug duplicated in both the
  Then-body and Else-body loops of `ifStatement()`).
- Next: definition 3235's remaining `.getrow(...).RECORD.FIELD` chain
  puzzle, or definition 871's remaining post-19779 issue (see "Locally
  blocked" for both), or a fresh `npm run corpus:next` pick for further
  representatives -- this has become the reliable default mode for
  continuing productively once the named sub-puzzles ran out.
- The backgrounded `npm run corpus:work` run mentioned below was killed by
  its own 1800s timeout partway through (expected — it was stale, reflecting
  only fix #1, and was never going to finish a 9574-item Oracle scan in
  time anyway). No data lost; all fixes this session were validated with
  targeted per-definition + `--limit 430` runs instead. Don't bother
  re-launching a full `--failed` scan until deliberately wanted; it takes
  much longer than 30 minutes against this Oracle instance.

## Session fixes (2026-09-24), all in src/peoplecode/encoder.ts

1. **definition_id 513** (ADDRESSES.ADDRESS_TYPE.RowInit), UNKNOWN_MISMATCH,
   first diff @169 -> now EXACT.
   Rule: an open Application Class Local declaration section
   (`sawApplicationClassLocalSection` / `closedApplicationClassLocalSection`,
   program-level loop ~line 5090) must close its 0x2D boundary immediately
   before a standalone block comment that follows the section's final
   Local, not deferred to the next executable statement. The comment
   branch's early `continue` was skipping the `closesApplicationClassLocalSection`
   check entirely. Fixed by adding a parallel close inside the comment
   branch's `haveCompletedTopLevelStatement && hasBlankLine` block.

2. **For-body EOF semicolon** (was ENCODE_ERROR "expected ; in For body",
   88 definitions sharing this exact error message across the corpus).
   Rule: the final statement in a `For` body may omit its source semicolon
   when immediately followed by `End-For` (mirrors the already-proven
   top-level If/Evaluate/assignment-at-EOF omission, generalized inward to
   For-loop bodies). Verified against definitions 2406 (plain call
   statement) and 1269 (compound If block as the omitted-semicolon
   statement) — both shapes now parse past the point that used to fail.
   NOTE: 1269, 2406, 3586, 4067 moved ENCODE_ERROR -> UNKNOWN_MISMATCH (not
   yet EXACT); see "Identified, not yet fixed" below for why.

3. **Top-level bare call statement at EOF** (was ENCODE_ERROR "expected ;",
   59 definitions fail with this error exactly at source EOF; of those, at
   least the following are confirmed to be this exact shape by manual
   inspection: 524, 544, 2023, 2406, 4066, 4067, 4074, 4088, 4180, 4474).
   Rule: added `isTopLevelCallStatement` alongside the existing
   `startsTopLevelAssignment` / `isIfStatement` / `isEvaluateStatement`
   EOF-terminator classifications. Matches a bare leading identifier
   immediately followed by `(`, explicitly excluding every reserved
   top-level statement keyword (import/Declare/Function/Local/Global/
   PanelGroup/Component/Constant/Return/If/While/For/Repeat/try/throw/
   Break/Exit/Continue/Error/Warning/Evaluate/REM), so `Return True` (no
   parens; Return is reserved) still correctly fails — verified via the
   existing `unsupported source fails explicitly: "Return True"` unit
   test, which still passes. Confirmed EXACT: 4066, 2023, 4474, 4533.

4. **definition_id 518** (ADDRESSES.EMPLID.RowInit), UNKNOWN_MISMATCH,
   diff @5 (roundtrip diff @842, one missing 0x4F) -> now EXACT.
   Rule: the blank-line-marker count after an `Evaluate`/`When` clause
   header (before its first body statement) was hardcoded to at most one
   0x4F regardless of how many blank source lines actually separate the
   header from the first body statement (lines ~4165-4178, the
   `selectorWhitespaceStart` block). Fixed to use the same
   `Math.max(1, newlineCount - 1)` multiplicity pattern used everywhere
   else in the file (For-body, top-level declarations, etc.). Two blank
   lines after `When Component.RA_PERS_DATA` now correctly emit `4F 4F`.
   This is a generic multiplicity fix, not object-specific — worth
   watching for broader impact across other Evaluate/When fixtures.

5. **definition_id 521** (ADDRESSES.EMPLID.SavePostChange), UNKNOWN_MISMATCH,
   diff @5 (body diff originally @2959, size delta 2 bytes) -> now EXACT.
   Two related missing-0x4F bugs in `tryStatement()`, both now fixed:
   (a) no blank-line-marker handling at all before the *first* try-body
   item (comment/statement) — the loop only emitted 0x4F markers right
   before `catch`, never before an ordinary body item. Fixed by computing
   `hasBlankLine`/marker-count (already tracked at the top of the
   try-body loop) and emitting markers before the comment/REM/statement
   branches too, not just before `catch`.
   (b) same gap inside the catch body, PLUS a whitespace-double-consumption
   bug: the catch-header's blank-line-before-first-catch-body-item was
   being silently swallowed by the pre-existing unconditional `space()`
   call used for the optional catch-header semicolon check (line ~3187),
   which ran *before* the catch-body loop's own whitespace tracking could
   see it. Fixed by capturing `catchHeaderTrailingWhitespaceStart` right
   after the header's `0x2D` boundary byte, and having the catch-body
   loop's first iteration measure blank-line-ness from that earlier point
   (via a `firstCatchBodyItem` flag) instead of its own now-empty span.
   Both confirmed against definition 521's `try / If.../End-If; / catch
   Exception &ex / end-try;` block, which has a blank line in both
   positions (after `try`, and after the catch header before `end-try`).

6. **definition_id 858** (AE_WRK.AE_DECIDE.FieldChange), ENCODE_ERROR
   "expected When, When-Other, or End-Evaluate" @249 -> now EXACT.
   definition 854 (AE_WRK.AE_COMPILE.FieldChange) shares the exact same
   root cause and became EXACT with no additional work once this landed.
   Rule: `evaluateStatement()` (~line 4059) already had a special case
   letting a REM comment appear between the `Evaluate <selector>` header
   and the first `When` clause (`!sawWhen && /^REM\b/`), citing
   PSXPRPTDEFN_WRK.PROPTYPE, but had no equivalent case for an ordinary
   `/* ... */` block comment in that same position — it would fall through
   to expecting `When`/`When-Other`/`End-Evaluate` and fail. Added a
   parallel `!sawWhen && source.startsWith('/*', pos)` branch that just
   emits `blockComment()` and continues, mirroring the REM case exactly
   (no blank-line-marker handling, matching that precedent).
   Partial progress on two siblings from the same original error-message
   family (previously ENCODE_ERROR, both now further along but not fully
   EXACT — left for a future session, see below):
   - definition_id 860 (AE_WRK.AE_DECIDE.SavePreChange): source→bin is now
     EXACT (the strongest encoder validation tier). Remaining gap is
     DECODE_SOURCE_MISMATCH: the decoder doesn't cleanly round-trip a bare
     `;` (empty statement) immediately after `When-Other`, causing a
     roundtrip re-encode failure ("unsupported PeopleCode statement" at
     the re-encoded empty-statement position). This is a decoder-side
     gap, not an encoder gap — per project rule, do not patch the encoder
     to compensate for a decoder-only issue.
   - definition_id 871 (AE_WRK.AE_GO.FieldChange, a large 36181-byte / 84-name
     program): still UNKNOWN_MISMATCH, single reference-index swap (0x11
     vs 0x06) at body offset 3089, same shape as the other deferred
     reference-provenance puzzles below — not investigated further this
     session.

7. **definition_id 1406** (BANKACCT_SBR.ACCOUNT_EC_ID.FieldFormula),
   ENCODE_ERROR "expected )" @390 -> source→bin now EXACT, roundtrip EXACT
   (overall classification DECODE_SOURCE_MISMATCH — a separate decoder
   rendering gap, out of scope here; see below).
   Rule: an inline block comment may appear immediately after the last
   operand of an And-group or Or-group, before that group's closing 0x42
   marker — e.g. `... Or %Component = "X" /*FLUID*/) And ...`. Previously
   `andExpression()`/`booleanExpression()` (~line 2230) only called
   `space()` after the last operand, which doesn't consume a comment, so
   the 0x42 got pushed immediately while the comment was left unconsumed,
   causing a later `expected )` failure in `parenthesized()`. Fixed by
   consuming a trailing `inlineBlockComment()` (same 0x4E encoding as
   other same-line comments) right before each group's 0x42 push, in both
   `andExpression()` and `booleanExpression()` (symmetric fix — only
   `booleanExpression()`'s Or-group was evidenced by definition 1406, but
   `andExpression()`'s And-group has the identical code shape and is
   presumably subject to the same rule; flagging in case a future
   And-only case surfaces that contradicts this). Also added a same-shape
   fallback in `parenthesized()` itself (consume a trailing inline
   comment right before checking for the closing `)`, after `body()`
   returns) as a safety net for a comment directly inside a *simple*
   parenthesized expression with no And/Or grouping — not directly
   evidenced by any single failing corpus object, but low-risk and
   consistent with the same construct.
   Decoder-side gap (not fixed, out of scope for this fix): definition
   1406 now shows `decode SOURCE MISMATCH` even though both binary
   validation tiers are EXACT — the decoder's rendering of this program
   doesn't byte-match original PSPCMTXT source formatting. Per project
   rule ("do not patch the encoder to compensate for a decoder-only
   formatting difference"), left alone. Worth a future decoder-side
   session investigating decode SOURCE MISMATCH cases generally.

8. **definition_id 984** (AMM_DERIVED.IB_SAVE_PB.FieldChange), ENCODE_ERROR
   "expected ; in If body" @463 -> now EXACT. This is the
   `ENCODE_ERROR / (1).GetRowset(Sc...` family, 70 definitions at session
   start.
   Rule: the top-level `statement()` dispatcher's final fallback branch
   for a bareword-identifier-led statement (~line 2755) called the bare
   `call()` helper, which only consumes `Name(args)` and returns — it does
   not continue parsing any postfix chain. So a call-result chain used as
   a plain statement, e.g.
   `GetLevel0()(1).GetRowset(Scroll.PSIBDOMSTATUSVW).Flush();`, only got
   `GetLevel0()` consumed, then failed on the leftover `(1).GetRowset(...)`
   when checking for the statement's trailing `;`. Fixed by routing that
   fallback through `primary()` instead of bare `call()` — `primary()`
   already supports the full call/member/index postfix chain (used
   elsewhere for assignment RHS and the sibling call-result-*property*-
   assignment branch just above this one at line ~2744), and calls
   `call()` internally for the plain "Name(args);" case with identical
   output, so no behavior changes for the ordinary case.
   Required an accompanying test update: `src/test/encoderCalls.test.ts`
   had `'F()(1);'` and `'F().Value;'` in its generic
   "malformed/unsupported call syntax fails" list — those were correct
   when written (this really was unsupported then) but are no longer
   malformed, so they were removed from that list and given their own
   `doesNotThrow` coverage instead (exact-byte coverage for this
   construct comes from the corpus harness against real programs, e.g.
   definition 984, not a hand-written golden fixture for the synthetic
   name `F`).
   High blast radius: this changes the top-level statement dispatcher's
   fallback path used by every bareword top-level call statement in the
   corpus. Verified with the full test suite (457 pass after adding
   coverage, 1 pre-existing skip) and the 430-definition protected gate
   (still 430/430, PASS) before and after.
   Broader impact spot-checked across the 70-member family (re-running
   individually, not a full corpus re-scan): definitions 3776 -> EXACT
   immediately; 1738, 3235, 3539 moved ENCODE_ERROR -> UNKNOWN_MISMATCH
   (grammar now accepted, but each has a further byte-level mismatch,
   plausibly hitting the same reference-provenance gap described below).
   Family not exhaustively re-run — do that with `npm run corpus:work`
   (or a fresh `corpus:failures --construct "(1).GetRowset(Sc"`) next
   session to get a precise count.

9. **definition_id 524** (ADDRESS_SBR.COUNTRY.FieldChange), ENCODE_ERROR
   "expected ;" @1201 (exact EOF) -> encoder now gets past this entirely
   (source→bin reaches a *different*, later mismatch — a reference-index
   puzzle, see below); classification still non-EXACT.
   Rule: added `isTryStatement` (`/^try\b/i`) to the `selfTerminatingAtEof`
   OR-list (~line 5638/6050), alongside the existing
   startsTopLevelAssignment/isIfStatement/isEvaluateStatement/
   isTopLevelCallStatement cases. A top-level `try ... catch ... end-try`
   block may terminate directly at EOF with no semicolon after `end-try`,
   just like the other proven EOF-omission cases. This is the
   `ENCODE_ERROR / EOF` family (64 definitions at time of pickup).
   Sibling definition 544 (ADDR_OTR_SBR.COUNTRY_OTHER.FieldChange) shares
   this exact shape and moved the same way (ENCODE_ERROR ->
   UNKNOWN_MISMATCH, blocked on a reference-index mismatch elsewhere in
   the program, unrelated to the try/EOF fix itself).

10. **definition_id 964** (AMM_DERIVED.DELETE_BTN.RowInit), ENCODE_ERROR
    "expected ; at end of REM comment" @119 -> source→bin now EXACT,
    roundtrip MISMATCH (pre-existing **decoder** bug, unrelated to this
    fix — see below). This is the `ENCODE_ERROR / rem` family (33
    definitions at time of pickup).
    Two-part rule, both confirmed by exact byte-length arithmetic:
    (a) The top-level REM handler (~line 5622, inside the main
    `encodeFragmentInternal` statement loop) called `remComment()` with no
    argument, defaulting `allowMissingSemicolon` to `false` — the *only*
    one of `remComment()`'s ten call sites still doing this; the other
    nine already pass `true`. Changed to `remComment(true)` for
    consistency, since a plain-text top-level REM line with no trailing
    `;` (`rem PSCHNLDEFN is a deprecated table...`) decodes fine and
    should encode fine too.
    (b) Bigger find: immediately consecutive REM lines (no blank line
    between them) compile as **one single 0x24 comment record**, embedded
    line break included, not as separate records. Proved by exact
    arithmetic: definition 964 has two consecutive `rem` lines whose
    individual UTF-16LE byte lengths are 116 and (after concatenation
    with an embedded `\n`) the *stored* record's length field reads
    exactly 416 = 116 + 1*2 (the "\n") + the second line's own length —
    i.e. `len(line1 + "\n" + line2, utf16le) == 416` exactly, matching
    the stored 0x24 record's length field byte-for-byte. Implemented by
    extending `remComment()` itself (the shared helper, all ten call
    sites) with a loop that, after matching one REM line, checks whether
    the very next thing (exactly one `\r?\n`, no blank line, no other
    content) is itself a `REM`-led line, and if so folds it into the same
    payload and repeats. This changes the shared low-level comment
    primitive, so it's broad in principle, but the merge only fires when
    the exact "REM line directly followed by REM line" shape is present,
    which no previously-passing fixture could have exercised differently
    (a bare, unmerged single REM record and a merged multi-REM record are
    distinguishable at the byte level, so this can only ever move a
    previously-failing case, never silently change an already-correct
    one) — validated by the unchanged 430/430 protected gate.
    Decoder-side bug found while validating this fix (not fixed, out of
    scope for an encoder change): definition 964's decoded source has an
    *extra* blank line before `&clickdelete = 0;` compared to the
    original (`PanelGroup number &clickdelete;` / blank / blank /
    `&clickdelete = 0;` in decoded output, vs. only one blank line in the
    real source) even though the harness's decode-vs-source comparison
    considers this close enough to report `decode SOURCE MATCH` (that
    comparison is normalized/tolerant, not byte-exact — see
    DEVELOPER.md's validation hierarchy, tier 3). This one extra blank
    line is exactly why the *roundtrip* check (decode -> re-encode)
    doesn't match stored bytes even though *source→bin* is EXACT: my
    encoder correctly emits one extra 0x4F marker for the decoder's
    (wrong) two blank lines. This was invisible before because the
    program never reached roundtrip validation (it always failed earlier
    at ENCODE_ERROR); fixing the ENCODE_ERROR exposed a preexisting,
    unrelated decoder formatting bug. Worth combining with the definition
    1406 decode-source-mismatch note above into one future decoder
    session — both point at the leading-declaration/blank-line area of
    decoder.ts.

All ten fixes verified with:
- `npm run typecheck` — clean after each.
- `npm test` — 455 pass / 1 pre-existing skip, no change, after each.
- `npm run corpus:verify -- --limit 430` — 430/430 EXACT, REGRESSION GATE:
  PASS, after each (checked after fixes 1, and again after 2+3+4 combined).

## Session fixes (2026-09-24, resumed after crash), all in
## src/peoplecode/encoder.ts

11. **definition_id 1269** (ARCH_TBL.RECNAME.SavePreChange), was
    UNKNOWN_MISMATCH (first diff @422, this session's starting point) ->
    now EXACT. Required two combined changes (both needed together; neither
    alone reaches EXACT):
    (a) Added `UpdateValue` and `InsertRow` to the function-name set whose
    Record.X argument gets control-group-scoped reuse (the same
    `reuseRecordReferenceWithinControlGroup` mechanism already covering
    GetRecord/DeleteRow/ActiveRowCount from fix #8's session). Evidenced by
    two nested `UpdateValue(Record.ARCH_TBL, ...)` calls inside one `For`
    body (second reuses the first's RECORD row) and a later
    `InsertRow(Record.ARCH_TMP_RECUNQ, ...)` reusing an earlier
    `ScrollFlush(Record.ARCH_TMP_RECUNQ)` allocation from the same control
    group.
    (b) **Higher-leverage structural fix**: `inControlGroup()` (the shared
    helper backing every top-level For/If/Evaluate) previously only bumped
    `controlGroup` to a fresh value on *entry* to a top-level control
    block, then restored the *previous* group on exit — meaning every
    top-level statement between/after control blocks, and even a second
    top-level control block, could still land back in the very first
    group (group 0) and wrongly reuse rows from before an intervening
    block. Definition 1269 proves a top-level control block is bounded on
    *both* sides: a plain top-level `ActiveRowCount(Record.ARCH_TBL, ...)`
    call appearing *after* a `For...End-For` block does NOT reuse the
    identically-named `Record.ARCH_TBL` row a `ActiveRowCount` call
    *before* that same `For` block had allocated, even though both calls
    are plain top-level statements with no control structure of their own.
    Fixed by having `inControlGroup()`'s `finally` block assign a *fresh*
    group (`nextControlGroup++`) on exit from a top-level block, instead of
    restoring `previousGroup`, whenever the block being exited was itself
    top-level (`enteringTopLevel`); nested (already-depth>0) blocks keep
    the old restore-to-enclosing-group behavior unchanged. This is a
    shared-helper change with broad blast radius (every top-level
    For/If/Evaluate in the corpus), validated by the unchanged 430/430
    protected gate and confirmed to still produce EXACT for every
    previously-EXACT fixture spot-checked (513, 518, 521, 858, 854, 964,
    1406, 984, 2406).
    NOTE: sub-puzzle A's own original target, definition 2406, was
    unaffected by change (b) (its two ActiveRowCount calls are already
    each inside their own top-level For/If, so both already got fresh
    groups under the *old* entry-only rule too) — (b) only changes output
    for a plain top-level statement following a closed top-level control
    block, which 2406 doesn't exercise but 1269 does.

12. **definition_id 3586** (DEDUCTION_TBL.SPCL_PROCESS.FieldChange), was
    UNKNOWN_MISMATCH (first diff @585, after fix #11 landed) -> now EXACT.
    Rule: `Scroll.X` arguments to `ActiveRowCount`/`UpdateValue`/`Gray`/
    `UnGray` share the same control-group-scoped reuse rule Record.X
    arguments already had (fix #11a), but through the SEPARATE
    `reuseScrollReferenceWithinControlGroup` flag/`scrollReference()` code
    path (Scroll.X and Record.X are parsed and tracked completely
    independently). This flag previously was only ever set inside the
    `.GetRowset(...)` method-postfix handler, never inside the general
    bare-function-call argument parser, so a bare top-level
    `ActiveRowCount(Scroll.X, ...)` / `UpdateValue(Scroll.X, ...)` /
    `Gray(Scroll.X, ...)` / `UnGray(Scroll.X, ...)` call's Scroll.X
    argument was always occurrence-based (never reused) before this fix.
    Evidenced by a `For &I = 1 To ActiveRowCount(Scroll.DEDUCTION_TBL,
    CurrentRowNumber(1), Scroll.DEDUCTION_CLASS)` loop whose body's several
    `UpdateValue(Scroll.DEDUCTION_TBL, ..., Scroll.DEDUCTION_CLASS, ...)`
    and `Gray(Scroll.DEDUCTION_TBL, ..., Scroll.DEDUCTION_CLASS, ...)`
    calls all reuse the loop header's SCROLL rows rather than each
    allocating fresh ones. Required adding a
    `previousReuseScrollReferenceWithinControlGroup` save/restore alongside
    the existing Record-reuse flags in the bare-call argument-parsing
    function's try/finally, mirroring the existing pattern exactly.

13. (Same commit as #12 above — Scroll.X reuse and the function-name list
    were added together, listed separately here only because they address
    logically distinct gaps: #11 = Record.X coverage gaps + control-group
    boundary structural fix; #12/13 = Scroll.X coverage gap using the
    now-corrected control-group boundaries from #11.)

14. **definition_id 4067** (DERIVED_ABS_EA.CLEAR_ALL.FieldChange), was
    UNKNOWN_MISMATCH (first diff @476, two 0x4A record-field reference
    indices both off by exactly 1) -> now EXACT. Unrelated to sub-puzzle
    A/fixes #11-13 -- a distinct, narrower gap.
    Rule: `Component Rowset &var;` declarations were missing the PACKAGE/
    ROWSET local-object-type dependency allocation that `Local Rowset
    &var;` already got via `ensureLocalObjectPackageReference('ROWSET',
    'Rowset')` (the `componentDeclaration()` parser only had this call for
    `Record`-typed Component declarations, copied from the `Local`-
    declaration parser incompletely). Source:
    `Component Rowset &RsEA_Abs;` followed later by
    `&RsEA_Abs.GetRow(&i).DERIVED_ABS_EA.SELECT_REC.Value = "N";` --
    without the missing PACKAGE row, the subsequent RECORD (DERIVED_ABS_EA)
    and FIELD (SELECT_REC) 0x4A references both allocated one PSPCMNAME
    index too low. Fixed by adding the same `ensureLocalObjectPackageReference`
    call for `Rowset`-typed Component declarations, mirroring the existing
    `Record` branch exactly. Scoped narrowly to `Rowset` only (the one type
    evidenced) -- `Row`/`SQL`/`File`/`XmlDoc`/`XmlNode` Component
    declarations may have the identical gap (the `Local`-declaration side
    handles all of them uniformly) but are NOT yet evidenced for the
    Component-declaration side specifically; do not generalize without a
    corpus example for each.

15. **definition_id 3235** (CO_STATETAX_TBL.EFFDT.FieldChange), was
    UNKNOWN_MISMATCH (first diff @2166) -> still UNKNOWN_MISMATCH but
    advanced substantially (first diff now @8240, a genuinely different,
    NOT-yet-understood remaining issue -- see "Locally blocked" below).
    Rule: `whileStatement()` had NO blank-line-marker (0x4F) handling
    before `End-While` at all -- unlike `ifStatement()`'s End-If handling
    (which already correctly preserves blank-line multiplicity), `forStatement()`,
    `tryStatement()` (fix #5, prior session) and `evaluateStatement()` (fix
    #4, prior session). Fixed by adding the identical blank-line-multiplicity
    pattern (`Math.max(1, newlineCount - 1)` markers via
    `pendingReferenceGroupBoundaries`) immediately before the `End-While`
    branch, mirroring `ifStatement()`'s End-If code exactly. Evidenced by:
    ```
                &AccountsModified = True;

             End-If;

          End-While;
    ```
    where stored has a 0x4F boundary before BOTH End-If (already handled)
    AND End-While (previously missing entirely).

16. **definition_id 3539** (DAEMONGROUP.DAEMONGROUP.SaveEdit), was
    UNKNOWN_MISMATCH (first diff @61) -> now EXACT. Two-part fix to the
    "leading Local declaration run" mechanism (the machinery deciding
    where/whether a 0x2D declaration-section-close boundary appears before
    a program's first true executable statement), both in the
    `if (lastLocalHadInitializer)` branch of the main top-level statement
    loop:
    (a) An initialized Local (`Local number &cnt = 0;`) does NOT
    necessarily end the leading declaration run -- only when the Local
    declaration immediately following it (if any) is itself UNINITIALIZED.
    Source:
    ```
    Local number &i;
    Local number &cnt = 0;

    Local number &duprow;

    Local Rowset &this;

    &this = GetLevel0()(1).GetRowset(Scroll.DAEMONGROUP);
    ```
    Stored has NO 0x2D/0x4F boundary between `&i;` and `&cnt = 0;` -- the
    whole run (including the later uninitialized &duprow and &this) stays
    one section, closing only once, right before the true first executable
    statement. Implemented via a lookahead (`nextSignificantAfterBlockComments`
    plus a regex distinguishing an initialized vs. uninitialized next Local
    declaration) that, when the next Local is uninitialized, defers to the
    pre-existing general `leadingLocalRun && !isLocalDeclaration` closer
    further down instead of closing immediately at this initializer.
    (b) Once ANY Local in the run had an initializer, that run's eventual
    close (wherever it lands) gets NO 0x2D byte, only the blank-line 0x4F
    marker(s) -- the initializer's own execution already ended the "pure
    declaration" phase without a formal section-boundary marker, even
    though the program has compiled PSPCMNAME references (which would
    otherwise always pair 0x2D with 0x4F per the pre-existing rule).
    Tracked via a new `leadingRunHasInitializedLocal` flag, checked only at
    the final insertion step (so the pre-existing, already-validated
    immediate-closure path for a genuinely-last initializer is unaffected
    and keeps emitting 0x2D as before).
    **Regression caught and repaired**: the first version of part (a) used
    a too-broad lookahead (`nextIsAnotherLocal`, not distinguishing
    initialized vs. uninitialized), which broke protected-baseline
    definition_id 256 (ACA_BGN_MTH_TBL.BEGIN_DT.SaveEdit, source has TWO
    directly-adjacent INITIALIZED Locals: `Local integer &year =
    Year(...); Local integer &month = Month(...);`) by deferring past the
    first initializer, letting the SECOND initializer's own processing
    wrongly fire the immediate-closure branch using its own
    `statementChunkStart` as the anchor -- placing a spurious boundary
    BETWEEN the two initializers where stored has none at all. Caught by
    the routine post-fix `corpus:verify --limit 430` run (429/430,
    REGRESSION GATE: FAIL). Root-caused via definition 256's own
    `--verbose` trace (per CLAUDE.md's regression-isolation protocol: same
    definition, first diff, narrowed rule) and fixed by tightening the
    lookahead to require the FOLLOWING Local specifically be uninitialized,
    which is true for 3539 (&duprow has no `=`) but false for 256's &month
    (`= Month(...)`). Both definitions confirmed EXACT after the narrowed
    fix; 430/430 reconfirmed.

17. **definition_id 525** (ADDRESS_SBR.COUNTRY.RowInit), was UNKNOWN_MISMATCH
    (first diff @1807, sub-puzzle B's original target) -> now EXACT.
    Direct stored-PSPCMNAME enumeration (fetching the real PSPCMNAME rows
    and PSPCMPROG bytes via a scratch script using `discovery.ts`'s
    `captureDefinition`, then cross-referencing every 0x21/0x4A operand
    occurrence in byte order against the NAMENUM table) proved the
    original sub-puzzle-B hypothesis in this file wrong: three method
    calls on an already-`create`d Component-declared Application Class
    instance --
    ```
    Component EO:CA:Address &cobj_EO_CA_Address;
    ...
    If &cobj_EO_CA_Address = Null Then
       &cobj_EO_CA_Address = create EO:CA:Address(&Addr_Rec, &Der_Address, &Der_addr);
    Else
       &cobj_EO_CA_Address.ResetAddressRecord(&Addr_Rec);
       &cobj_EO_CA_Address.ResetDerivedAddressRecord(&Der_Address);
       &cobj_EO_CA_Address.ResetDerivedAddrRecord(&Der_addr);
    End-If;
    ```
    get NO separate PSPCMNAME method-dependency row at all -- not one
    shared row (the original hypothesis), zero. Root cause:
    `componentDeclaration()` hardcoded `reuseRuntimeCreateForMethods:
    false` for every Component-declared Application Class variable, while
    the matching `Local X:Y &var;` declaration path already had a
    calibrated conditional rule (`functionDepth === 0 &&
    !(controlDepth === 0 && sawTopLevelExecutableStatement)`, i.e.
    "declaration-phase instances reuse their runtime-create dependency for
    method calls" -- already evidenced by prior-session citations "offset
    179"/"offset 411"). A Component declaration is always declaration-phase
    (it can only appear before any executable code), so the fix applies
    that same conditional unconditionally-true-in-practice to Component
    Application Class declarations too, mirroring the Local path exactly.
    This resolves sub-puzzle B for its evidenced case.

18. **Record.X control-group reuse-checking list extended**: added
    `HideScroll`, `UnhideScroll`, `UnhideRow`, and `CopyFields` to the same
    function-name allowlist established by fixes #11/#17 (GetRecord|
    DeleteRow|ActiveRowCount|UpdateValue|InsertRow|SetCursorPos). Evidenced
    by AE_WRK.AE_GO.FieldChange (definition 871, still not fully EXACT, see
    "Locally blocked"), inside `Function adjust_row_num`'s nested If/Else
    (HideScroll/UnhideScroll/UnhideRow all reuse the enclosing If's own
    `ActiveRowCount(Record.AE_STMT_TBL)` condition's row) and inside
    `Function man_stmt`'s flat body (CopyFields' own Record.X argument
    reuses whatever row is active in its control group, exactly like any
    other reuse-enabled name). Before this, these four names' own Record.X
    allocations bypassed the reuse check entirely, each silently
    overwriting the shared control-group cache entry (since
    `recordReferencesByControlGroup.set(...)` happens unconditionally on
    every fresh allocation, not just reuse-enabled ones) -- breaking reuse
    for every reference that came after them too, not just their own.

19. **Function-body control-group scoping, a wholly new area** (unrelated
    to sub-puzzle A/B's existing mechanisms, though built on the same
    control-group primitives): each top-level statement inside a
    `Function ... End-Function;` body now gets its own fresh control group,
    unlike the main program's top level (where flat sequential statements
    share one group by default, only bumping on specific triggers like
    `SetDefault` or a top-level `CreateRecord` assignment). Nested control
    structures within a function (If/For/etc, once entered via
    `inControlGroup()`) are unaffected -- they keep the ordinary
    shared-group reuse behavior for their own body, identical to top-level
    program code. Implemented as a single unconditional
    `if (controlDepth === 0 && !isLocal) { controlGroup =
    nextControlGroup++; }` inside `functionStatement()`'s own body-parsing
    loop, right before dispatching each body item.
    Evidenced two ways by definition 871, in the same program:
    ```
    Function clear_scroll
       ScrollFlush(Record.AE_STMT_TBL);
       HideScroll(Record.AE_STMT_TBL);
       ...
       InsertRow(Record.AE_STMT_TBL, 1);   -- x5, textually identical
    End-Function;

    Function man_stmt
       InsertRow(Record.AE_STMT_TBL, ActiveRowCount(Record.AE_STMT_TBL));
       &TO_ROW = ActiveRowCount(Record.AE_STMT_TBL);
       CopyFields(1, Record.AE_TOOLS_CHK_VW, &ROW, 1, Record.AE_STMT_TBL, &TO_ROW);
       ...
    End-Function;
    ```
    `clear_scroll`'s seven flat statements each get their own PSPCMNAME
    row (zero reuse, confirmed by direct stored enumeration, even between
    the five textually-identical consecutive InsertRow calls).
    `man_stmt`'s InsertRow's own Record.AE_STMT_TBL argument is reused
    ONLY by its own nested `ActiveRowCount(...)` argument (same statement,
    same group) -- the very next statement's own
    `ActiveRowCount(Record.AE_STMT_TBL)` does NOT reuse it (fresh row),
    and CopyFields' Record.AE_STMT_TBL argument two statements later is
    ALSO fresh, not reusing either prior one.
    **Development note, not itself part of the landed fix**: this was
    reached only after two wrong intermediate hypotheses, both tried and
    discarded in-session (no protected-baseline regression from either,
    since neither was ever landed permanently without validation): (a)
    gating the sub-puzzle-A/B reuse-enabling regexes on `functionDepth ===
    0` (wrong -- adjust_row_num's nested-If/Else reuse needed those flags
    to still work inside functions too); (b) a narrower "only
    ScrollFlush/HideScroll/InsertRow trigger their own fresh group as
    bare top-level-of-function call statements" rule (wrong -- contradicted
    by man_stmt's plain-assignment and CopyFields statements also NOT
    reusing prior statements' rows, which a narrow bare-call-only trigger
    can't explain). The final, landed rule -- ALL top-level-of-function
    statements, not just specific ones -- is simpler than either wrong
    intermediate and fits all evidence gathered so far.

20. **definition_id 524** (ADDRESS_SBR.COUNTRY.FieldChange), was
    UNKNOWN_MISMATCH (first diff @951, sub-puzzle C's original target) ->
    now EXACT. Resolves sub-puzzle C.
    Source shape:
    ```
    ... = &RS_Country.GetRow(1).GetRecord(Record.COUNTRY_TBL).GetField(Field.DESCR).Value;
    DERIVED_ADDR.DESCR_COUNTRY = &RS_Country.GetRow(1).GetRecord(Record.COUNTRY_TBL).GetField(Field.DESCR).Value;
    ```
    The identical chain appears twice; `GetRecord`'s own `Record.
    COUNTRY_TBL` argument already reused correctly (pre-existing
    mechanism), but `GetField`'s own `Field.DESCR` argument did not --
    `fieldReference()` (parsing `Field.X`) had no reuse mechanism at all,
    unlike `recordReference()`. Fixed by adding a
    `reuseFieldReferenceWithinControlGroup` flag/cache pair, mirroring
    `recordReference()`'s own control-group-scoped reuse pattern exactly,
    set only while parsing a `.GetField(...)` call's own arguments in the
    postfix method-call handler (the same place `GetRecord`/`Select`/
    `GetRowset` already set their own reuse flags).
    **Required narrowing to avoid a real regression**, caught immediately
    by the test suite (not the 430-gate) before it was ever committed as
    final: the first version enabled reuse whenever
    `expectedReferenceMember === 'field'`, which is ALSO true on the very
    first postfix step off a declared `Local Record &var;` variable (a
    structurally unrelated case) -- this broke the existing calibrated
    test `'encodeProgramArtifacts allocates repeated Scroll and Field
    references by occurrence'`, which proves `&rec.GetField(Field.CODE)`
    called twice on a STORED Record variable (`&rec = GetRecord(...);`
    once, then two separate `&rec.GetField(...)` statements) remains
    occurrence-based -- each call must get its own fresh FIELD row, NOT
    reused. Fixed by adding a `wasFirstPostfixStep` tracker (a chain
    starting with `.GetField(...)` directly off a Record variable is
    always the chain's first postfix step; a chain reaching `.GetField(...)`
    via a preceding `.GetRecord(...)` step never is, since GetRecord can
    only ever be a PRECEDING step) and requiring `!wasFirstPostfixStep` in
    addition to `expectedReferenceMember === 'field'`. Both the new
    corpus target (524) and the existing calibrated test pass after the
    narrowing; 430/430 reconfirmed.

21. **definition_id 528** (ADDRESS_TYPE_FL.ADDRESS_TYPE.RowDelete), was
    UNKNOWN_MISMATCH (first diff @191, found via a fresh `corpus:next`
    pick since sub-puzzles A/B/C were all resolved) -> now EXACT.
    Source shape:
    ```
    /*move gbl.addresses.address_type.row delete*/
    <*Bug 25690137*>
    Local SQL &SQL1;

    SQLExec(...);
    ```
    A disabled-code marker (`<* ... *>`) appearing BEFORE any Local
    declaration in the leading run unconditionally set `leadingLocalRun =
    false` (in the top-level statement loop's `<*` branch), permanently
    preventing the SUBSEQUENT `Local SQL &SQL1;` from ever being tracked
    by the leading-Local-declaration-run mechanism at all (confirmed via
    `DEBUG_513`: the tracking block never fired). This meant the run's
    eventual 0x2D/0x4F close, which should appear right before the first
    true executable statement (`SQLExec(...)`), was never emitted. The
    sibling `/* */` block-comment branch already had the correct guard
    (only close an ALREADY-started run, and only when no Local
    immediately follows); the `<*` branch was simply missing the
    equivalent logic entirely. Fixed by mirroring that guard exactly:
    only treat the disabled-code marker as ending the leading run when
    `sawLeadingLocalDeclaration` is already true (a run had actually
    started) AND no Local declaration immediately follows the marker
    (skipping whitespace/comments via the existing
    `nextSignificantAfterBlockComments` helper) — otherwise leave
    `leadingLocalRun` untouched so a Local declaration reached later can
    still be tracked normally.

22. **definition_id 534** (ADDRESS_TYPE_FL.EMPLID.SavePreChange), was
    UNKNOWN_MISMATCH (first diff @1503, found via a fresh `corpus:next`
    pick) -> now EXACT. Two independent bugs in the same small diff
    window, both fixed:
    (a) `RecordDeleted` and `RecordChanged`'s own `Record.X` arguments
    joined the Record.X control-group-scoped reuse-checking list. Source:
    ```
    (&new_row = True Or
       RecordDeleted(Record.ADDRESS_TYPE_FL) Or
       RecordChanged(Record.ADDRESS_TYPE_FL)) Then
    ```
    `RecordChanged`'s `Record.ADDRESS_TYPE_FL` reuses the row
    `RecordDeleted`'s own argument allocated moments earlier in the same
    If condition's control group; neither name was previously in the
    reuse-checking list.
    (b) Blank-line marker multiplicity before a `REM` comment inside an
    If body (both the Then-body and the Else-body loops in
    `ifStatement()`, which had the identical bug independently) was
    hardcoded to push exactly one 0x4F marker whenever `hasBlankLine` was
    true, unlike every sibling boundary in the same loop (the `<*`/`/*`
    comment branches, and the End-If close) which all correctly scale by
    `Math.max(1, newlineCount - 1)`. Source has TWO blank lines before
    `REM TriggerPDHEvent_Fluid(GetRow());`, which stores TWO 0x4F
    markers, not one. Fixed by applying the same multiplicity formula
    used everywhere else in both branches.

All twelve new fixes (#11-22) verified with:
- `npm run typecheck` — clean after each.
- `npm test` — 457 pass / 1 pre-existing skip, no change, after each
  (one transient FAIL during fix #20's first attempt -- a real unit-test
  regression, caught by `npm test` itself before ever reaching the
  430-gate or being considered final -- immediately root-caused and
  narrowed; see fix #20's own notes).
- `npm run corpus:verify -- --limit 430` — 430/430 EXACT, REGRESSION GATE:
  PASS, after each (one transient FAIL during fix #16's first attempt,
  immediately root-caused and repaired before moving on -- see fix #16's
  own notes; zero further regressions through fixes #17-22 despite #19
  being a broad, shared-helper change affecting every Function body in
  the corpus, and #21 touching the same sensitive leading-Local-run
  mechanism #16 had already needed a regression-repair on).
- Targeted re-check of definitions 2406, 1269, 3586, 4067, 1738, 3539, 525,
  524, 528, 534 (all now EXACT) plus 513, 518, 521, 858, 854, 860, 964,
  1406, 984, and protected-baseline definitions 256 and 871's own
  previously-passing region (all unchanged/confirmed EXACT or
  correctly-advanced, no further regressions from any fix through #22).
- Definition 3235 (partially advanced, see fix #15) and definition 871
  (partially advanced enormously, see fixes #18-19, first diff moved from
  byte offset 1811 to 19779 of 36181) both still UNKNOWN_MISMATCH -- each
  has its own distinct, not-yet-understood remaining puzzle. See "Locally
  blocked" below for both.

## Session fixes (2026-09-24, /goal resume), all in src/peoplecode/encoder.ts

23. **definition_id 535** (ADDRESS_TYPE_VW.ADDRESS_TYPE.RowInit),
    UNKNOWN_MISMATCH, body diff @1212 (a single 0x4A reference-index byte:
    stored used the FIELD/ADDRESS_TYPE row already established earlier in
    the same control group, generated allocated a fresh one) -> now EXACT.

    Root cause: `GetRecord(Record.X)` / `GetRecord(N)` used as a **bare
    primary call** (no leading `&variable.` receiver, e.g.
    `GetRecord(Record.ADDRESS_TYPE_VW).GetField(Field.ADDRESS_TYPE)`) never
    put the expression into field-reference mode for the postfix chain. The
    existing control-group FIELD-reuse mechanism (`fieldReferencesByControlGroup`,
    gated by `reuseFieldReferenceWithinControlGroup`) only ever fired when
    `.GetRecord(...)` appeared as a POSTFIX STEP on a variable
    (`&row.GetRecord(...).GetField(...)`, definition 524's proven case) —
    the bare-call form's own `.GetField(Field.X)` therefore allocated an
    occurrence-based row that never got registered into the reuse pool, so
    a later independent `.ADDRESS_TYPE` property access elsewhere in the
    same control group (`&Types.GetRow(&I).GetRecord(1).ADDRESS_TYPE.Value`)
    couldn't find it and allocated a second, wrong-index row instead.

    Fix, in three parts:
    (a) `primary()` now recognizes a bare `GetRecord(...)` call (tracked via
    a new `bareGetRecordCallResult` flag, set at the `call()` dispatch site
    using the already-available `identifier`/`tail` text) and seeds
    `expectedReferenceMember = 'field'` for it, exactly like a postfix
    `.GetRecord(...)` step already does.
    (b) Replaced the old `wasFirstPostfixStep`-based gate (which could not
    distinguish "field mode because of a declared Record variable's first
    postfix step" from "field mode because of a bare GetRecord() primary
    call" — both look like "first postfix step") with a new explicit
    `fieldMemberFromGetRecord` boolean that is only ever true when the
    current field context came from an actual `.GetRecord(...)` result
    (postfix-chain or bare-primary form alike), and false when it came from
    a declared `Local Record &var;` variable. This let `wasFirstPostfixStep`
    itself become fully dead code (no remaining reads) and it was removed
    along with `isFirstPostfixStep`, consistent with DEVELOPER.md's "verify
    before deleting" rule — confirmed via `tsc`'s TS6133 unused-variable
    error, not assumed.
    (c) Added `fieldReferencesByControlGroup` as a further fallback (after
    `rowShorthandFields`/`declaredRecordFields`) in the ordinary
    Rowset/row-shorthand FIELD-lookup branch of the postfix `.MEMBER`
    handler, so a bare `.FIELDNAME` property access (not just an explicit
    `.GetField(Field.X)` call) can find a FIELD row already established by
    an earlier `.GetRecord(...).GetField(Field.X)` in the same control
    group — this is the actual lookup definition 535's `.ADDRESS_TYPE.Value`
    needed; (a)/(b) alone populate the pool, (c) is what reads from it here.

    **Regression caught and repaired in the same step**: the first version
    of part (a) set `bareGetRecordCallResult = true` for ANY bare
    `GetRecord(...)` call regardless of arguments. This broke protected
    baseline definition_id 180 (ABS_H_D_NLDSBR.SAME_ADDRESS_EMPL.
    FieldChange, EXACT -> UNKNOWN_MISMATCH, `body diff @269`, size delta
    -18 bytes): `GetRecord()` with **no arguments** starts a Row-navigation
    chain (`GetRecord().ParentRow.ParentRowset.ParentRowset.ParentRowset.
    GetRow(1)...`), where `.ParentRow` is stored as a plain inline
    identifier (0x05 0x0A opcode), never a PSPCMNAME field reference —
    structurally unlike the argumented form. Caught immediately by the
    routine post-fix `corpus:verify --limit 430` gate; root-caused via
    definition 180's own first-diff trace (per CLAUDE.md's
    regression-isolation protocol: same construct family, `GetRecord`, but
    the zero-arg case). Narrowed part (a)'s condition to
    `/^GetRecord$/i.test(identifier) && !/^GetRecord\s*\(\s*\)/i.test(tail)`
    — i.e. only an ARGUMENTED bare `GetRecord(...)` call enables
    field-reference mode. 430/430 restored and reconfirmed; `npm test`
    clean (456 pass / 1 pre-existing skip). Definitions 524 and 871
    (both touching related GetRecord/GetField machinery) re-checked and
    unaffected — 524 still EXACT, 871 still its pre-existing UNKNOWN_MISMATCH
    (see "Locally blocked").

24. **definition_id 634** (ADJ_CN_TAX_BAL.BALANCE_YEAR.FieldFormula),
    UNKNOWN_MISMATCH, body diff @208 (one missing 0x4F, generated 1 byte
    shorter: 2642 vs stored 2643) -> now EXACT. Definition 536 was
    skipped/deferred first (see "Identified, not yet fixed" below); this
    was the next `UNKNOWN_MISMATCH`-family definition manually selected
    (via a direct inventory query for a different offset) once 536 was
    parked, since `corpus:next` keeps re-recommending the same lowest-offset
    representative in a family regardless of a prior session's decision to
    defer it.

    Root cause: inside a `Function ... End-Function;` body,
    `functionStatement()`'s body loop already emits a 0x4F blank-line
    marker for a blank line between two ordinary body items (gated on
    `enteredExecutableSection`) and for a blank line between the leading
    Local-declaration run and the first executable statement (gated on
    `sawLocalDeclaration && !enteredExecutableSection`) — but had NO
    handling at all for a blank line between a **leading standalone
    comment** (before any Local declaration) and the Local declaration
    that follows it:

    ```
    Function TAX_CLASS_CAN_List();
       /* Set up dropdown list of Tax Class for balance adjustment */

       Local Rowset &Xlat;
    ```

    The comment branches (`<*...*>` and `/*...*/`) `continue` the loop
    immediately after pushing the comment, with no flag recording that a
    leading comment was just seen, so the blank line before `Local Rowset`
    fell through unmarked. Fixed by adding a new `sawLeadingComment` flag
    (set when a comment is processed before any Local/executable item is
    seen) and widening the top-of-loop marker condition from
    `enteredExecutableSection` alone to
    `enteredExecutableSection || (sawLeadingComment && !sawLocalDeclaration)`.
    Scoped narrowly to the "before the first Local" phase only — blank
    lines between two Locals, or between two leading comments, are a
    separate, not-yet-evidenced question and were deliberately left alone.
    (encoder.ts `functionStatement()`'s body loop.)

    Verified: `tsc`/`npm test` clean, `corpus:verify --limit 430` PASS
    (430/430, no regression — first attempt, no isolation needed this
    time). Spot-checked 871 and 180 (both touch related Function-body /
    GetRecord machinery) — unaffected (871 still its pre-existing
    UNKNOWN_MISMATCH, 180 still EXACT).

25. **definition_id 772** (ADSRECORDS1_WRK.QRYSEARCHBTN.FieldChange),
    UNKNOWN_MISMATCH, body diff @528 -> now EXACT via three combined
    fixes, each moving the first diff further before the next one was
    found (progress-not-completion applied three times over on the same
    definition before it finally went EXACT):

    (a) **`ApiObject` type-name opcode** (first diff @528, a single byte:
    stored `0x0A` vs generated `0x40` right before the literal type-name
    text `ApiObject`). `typeName()`'s calibrated "object declaration types
    use the inline-name introducer, not the primitive-type 0x40
    introducer" list (`Record|Field|Rowset|Row|SQL|File|XmlDoc|XmlNode`)
    was simply missing `ApiObject`, a real PeopleCode built-in object type
    used exactly like the others (`Local ApiObject &aRecordsList;`).
    Fixed by adding it to that regex.

    (b) **`ApiObject`'s implicit PACKAGE dependency row** (next diff
    @1199, a reference-index shift: every PSPCMNAME index after the first
    Local declaration was off by one). Every other object-declaration type
    (Rowset/Record/Row/SQL/File/XmlDoc/XmlNode) allocates an implicit
    `PACKAGE/<TYPENAME>` dependency row the first time a `Local <Type>
    &var;` of that type is declared, via `ensureLocalObjectPackageReference`
    -- `ApiObject` was entirely missing from that dispatch, so
    `Local ApiObject &aRecordsList;` (this definition's very first Local
    declaration) allocated no such row at all, shifting every reference
    index after it by one relative to stored. Fixed by adding an
    `ApiObject` branch calling `ensureLocalObjectPackageReference
    ('APIOBJECT', 'ApiObject')`, mirroring the existing seven branches
    exactly.

    (c) **`ensureLocalObjectPackageReference`'s reuse pool needed
    function-body sensitivity, not just control-group sensitivity** (next
    diff @1199 again, one further reference-index-off-by-one after (a)/(b)
    landed). `Component Rowset &grsLevelList;` (top-level, functionDepth 0)
    and a later `Local Rowset &rsRecordsList, &rsFieldsList;` inside
    `Function DoRecordsSearch()` (functionDepth 1) both landed in
    control-group 0 -- leading Local declarations inside a Function body
    do not bump `controlGroup` (only executable statements do, per the
    fix #19 Function-body control-group rule) -- so the existing
    `${controlGroup}:${packageName}:${objectName}` cache key incorrectly
    reused the Component-level PACKAGE/ROWSET row for the Function-local
    Rowset declaration too, when stored allocates two distinct rows. Fixed
    by adding `functionDepth` to the cache key.

    (d) **`HideScroll`/`UnhideScroll` needed the SCROLL.X control-group
    reuse rule, not just the RECORD.X one** (final diff @3810). Fix #18
    (an earlier session) already added HideScroll/UnhideScroll/UnhideRow/
    CopyFields to the Record.X control-group-scoped reuse-checking
    function list, but never to the analogous, separately-tracked SCROLL.X
    list (`reuseScrollReferenceWithinControlGroup`, gated on
    ActiveRowCount/UpdateValue/Gray/UnGray/DeleteRow only). This
    definition's `If &nCount = 0 Then HideScroll(Scroll.ADSRECORDS1_DVW);
    ... Else UnhideScroll(Scroll.ADSRECORDS1_DVW); ... End-If;` proves
    UnhideScroll's own Scroll.X argument reuses the exact SCROLL row
    HideScroll's argument allocated in the other branch of the same
    top-level If's control group. Fixed by adding both names to that
    trigger list too (both directions needed: HideScroll must WRITE into
    the reuse pool, UnhideScroll must READ from it).

    Verified: `tsc`/`npm test` clean, `corpus:verify --limit 430` PASS
    (430/430, no regression, first attempt). Spot-checked 871 (still its
    pre-existing UNKNOWN_MISMATCH, unaffected), 534 and 180 (both still
    EXACT, unaffected — 534 touches the Record.X HideScroll/UnhideScroll
    list fix #18 added, 180 touches related GetRecord/Function-body
    machinery from fix #23).

26. **definition_id 808** (AE_DERIVED.REFRESH_BTN.SavePreChange),
    UNKNOWN_MISMATCH, body diff @524 (single reference-index byte,
    stored=3 vs generated=5) -> now EXACT on the first sub-fix (no further
    diffs after this one).

    Root cause: `CreateRowset(Record.X)` was missing from the Record.X
    control-group-scoped reuse-checking function list (the same list fixes
    from earlier sessions already added GetRecord/DeleteRow/
    ActiveRowCount/UpdateValue/InsertRow/SetCursorPos/HideScroll/
    UnhideScroll/UnhideRow/CopyFields/RecordDeleted/RecordChanged to).
    Source:

    ```
    &group = &RSComponent.GetRow(1).GetRecord(Record.DAEMONGROUP)
               .GetField(Field.DAEMONGROUP).Value;
    &RSDaemon = CreateRowset(Record.DAEMONGROUP);
    ...
    &RSDaemon.GetRow(...).GetRecord(Record.DAEMONGROUP).Delete();
    ...
    &RSComponent.GetRow(&i).GetRecord(Record.DAEMONGROUP).Insert();
    ```

    All four `Record.DAEMONGROUP` occurrences (spanning the initial
    `GetRecord` call, `CreateRowset`'s own argument, and two later
    `GetRecord` calls inside separate `For` loops, all in the same
    top-level `If` block's control group) reuse ONE single PSPCMNAME
    RECORD row in stored -- confirmed directly: stored's PSPCMNAME table
    has exactly one RECORD/DAEMONGROUP entry, not two. Without
    `CreateRowset` in the reuse-checking list, its own `Record.X` argument
    bypassed the reuse check and allocated a fresh row, which then
    poisoned every LATER `GetRecord(Record.DAEMONGROUP)` call into reusing
    that wrong row instead of the original one the first `GetRecord` call
    had established (same failure shape fix #18 already fixed for
    HideScroll/UnhideScroll/UnhideRow/CopyFields: a reuse-unchecked
    allocation silently overwrites the shared control-group cache entry).
    Fixed by adding `CreateRowset` to the same trigger-name regex.
    (encoder.ts, the `call()` function's Record.X reuse-flag block.)

    Verified: `tsc`/`npm test` clean, `corpus:verify --limit 430` PASS
    (430/430, no regression, first attempt). Spot-checked 871 (still its
    pre-existing UNKNOWN_MISMATCH, unaffected) and 535 (still EXACT,
    unaffected — also touches `GetRecord`/control-group reference
    provenance).

27. **definition_id 840** (AE_UPGCONV_WRK.AE_REFRESH.FieldChange),
    UNKNOWN_MISMATCH, body diff @137 (a repeated-argument reference-index
    pair) -> now EXACT via a two-step investigation that included an
    in-session regression, isolated and repaired via a MORE PRECISE rule
    rather than a broad revert (CLAUDE.md's regression-isolation protocol,
    "narrow the offending rule rather than broadly reverting valid
    calibration").

    **Attempt 1** (root cause, correct for 840 in isolation): `RowScrollSelect`
    was on the GLOBAL by-name Record.X reuse list
    (`reuseRecordReferenceByName`, shared with GetSetId/ScrollSelect/Gray/
    UnGray) with no citation of its own (added in an old bulk commit).
    Source:

    ```
    ScrollFlush(Record.MESSAGE_LOG);
    RowScrollSelect(1, Record.MESSAGE_LOG, Record.MESSAGE_LOG, "...", &PI);
    ```

    Stored allocates a FRESH RECORD row for RowScrollSelect's first
    Record.MESSAGE_LOG argument (NOT reusing ScrollFlush's earlier one),
    but REUSES that fresh row for its own second, adjacent
    Record.MESSAGE_LOG argument in the same call — global by-name reuse
    wrongly matched ScrollFlush's earlier occurrence for BOTH. First fix
    attempt: removed RowScrollSelect from the global by-name list and gave
    it its own new, narrower mechanism —
    `reuseRecordReferenceWithinCallArguments` /
    `recordReferencesWithinCallArguments`, a fresh `Map` allocated per
    RowScrollSelect call (saved/restored around the call for nesting,
    exactly like the other reuse flags) that only reuses within that
    SAME call's own argument list. This made 840 EXACT.

    **Regression caught**: `corpus:verify --limit 430` immediately failed
    (429/430) — protected baseline definition_id 27
    (ABSENCE_CAL_VW.ABSENCE_TYPE.RowInit) regressed EXACT ->
    UNKNOWN_MISMATCH. Root-caused via definition 27's own diff trace: its
    source has

    ```
    &LEVEL1_ROWS = ActiveRowCount(Record.ABS_TYPE_TBL);
    ...
    RowScrollSelect(1, Record.ABS_TYPE_TBL, Record.ABS_TYPE_TBL, "...", ...);
    ```

    all inside the same nested-If control group. Here stored DOES reuse
    ActiveRowCount's earlier Record.ABS_TYPE_TBL row for BOTH of
    RowScrollSelect's own arguments, across statements — the exact cross-
    statement reuse the same-call-only mechanism from attempt 1 no longer
    permitted, since ActiveRowCount and RowScrollSelect are different
    statements/calls.

    **Attempt 2** (the actual fix, reconciling both): the real
    distinguishing signal is not "same call vs different call" but
    "was the earlier occurrence established by an already-recognized
    reuse-PARTICIPATING call (ActiveRowCount/GetRecord/etc, i.e. one
    already on the `reuseRecordReferenceWithinControlGroup` trigger list)
    or by an unrelated non-participating call (ScrollFlush, which isn't on
    any reuse list)." The existing `recordReferencesByControlGroup` map
    can't answer this -- it's written unconditionally by EVERY Record.X
    allocation regardless of context, so it already contains ScrollFlush's
    entry too. Added a NEW parallel map,
    `participatingRecordReferencesByControlGroup`, written ONLY when
    `reuseRecordReferenceWithinControlGroup` was already true at the
    moment of allocation (i.e. only by genuinely participating calls).
    RowScrollSelect's own lookup now checks this participating-only map
    FIRST (finds ActiveRowCount's row in definition 27, correctly reusing
    it across statements) and falls back to the same-call-only mechanism
    from attempt 1 only when nothing participating exists yet (definition
    840's case, where ScrollFlush's non-participating entry is correctly
    invisible to this check). Both definitions now EXACT simultaneously.
    (encoder.ts: `recordReferencesByControlGroup`'s declaration site for
    the new parallel map, `recordReference()`'s read/write chain, and the
    `call()` function's RowScrollSelect dispatch.)

    Verified: `tsc`/`npm test` clean, `corpus:verify --limit 430` PASS
    (430/430, restored — no further regressions). Spot-checked 808, 772,
    634, 535 (all still EXACT) and 871 (still its pre-existing
    UNKNOWN_MISMATCH) — all unaffected by the final version of this fix.

    In passing: definition 842 (AE_UPGCONV_WRK.PROCESS_INSTANCE.RowInit,
    a `ScrollFlush(Record.MESSAGE_LOG); RowScrollSelect(1,
    Record.MESSAGE_LOG, Record.MESSAGE_LOG, ...);` script, a sibling of
    840) and definition 923 (AGC_CAT_IMG.AGC_CATEGORY_ID.FieldFormula)
    were found already EXACT when checked as fresh `corpus:next`
    candidates after this fix — resolved as a side effect, no separate
    work needed.

28. **definition_id 921** (AGC_CAT_ASGNEE.AGC_CATEGORY_ID.FieldFormula),
    UNKNOWN_MISMATCH, body diff @5036 (a single reference-index byte,
    off by exactly one) -> now EXACT.

    Root cause: an object-typed Function PARAMETER (`&rowCategory As
    Row`) never allocated the implicit PACKAGE dependency row a `Local
    Row &var;` DECLARATION already gets via `ensureLocalObjectPackageReference`
    (the same class of bug fix #25 already found and fixed for `Local
    ApiObject &var;`, but for parameters instead of declarations this
    time — a distinct code path). Source:

    ```
    Function DeleteCatAssignee(&rowCategory As Row, &sAssineeId As string)
       Local Rowset &rsCategorySteps, &rsCatStepAssengees;
       ...
       &rsCategorySteps = &rowCategory.GetRowset(Scroll.AGC_CAT_STEP);
    ```

    Stored allocates PACKAGE/ROW (for the `&rowCategory As Row` parameter)
    BEFORE PACKAGE/ROWSET (for the body's own `Local Rowset ...;`
    declaration), so `Scroll.AGC_CAT_STEP` lands at NAMENUM 19. The
    function-parameter parsing loop (inside `functionStatement()`'s
    parameter list, distinct from `localDeclaration()`) called `typeName()`
    for the `As Row` type text but never called
    `ensureLocalObjectPackageReference`, so PACKAGE/ROW was never
    allocated at all — shifting every reference after it by one. Fixed by
    capturing the parameter's raw type name before consuming it via
    `typeName()`, and calling `ensureLocalObjectPackageReference('ROW',
    'Row')` for a non-array `Row`-typed parameter, mirroring the
    already-established declaration-side handling. Scoped narrowly to
    `Row` only -- Record/Field/Rowset/SQL/File/XmlDoc/XmlNode/ApiObject
    parameters may need the same treatment but are unconfirmed by any
    corpus evidence yet; noted in the fix's own comment rather than
    guessed at. (encoder.ts, `functionStatement()`'s parameter-parsing
    loop.)

    Verified: `tsc`/`npm test` clean, `corpus:verify --limit 430` PASS
    (430/430, no regression, first attempt). Spot-checked 772 (still
    EXACT — also touches the `ensureLocalObjectPackageReference`
    mechanism) and 871 (still its pre-existing UNKNOWN_MISMATCH) —
    unaffected.

    After landing fix #28, ran a bounded `corpus:failures --summary`
    check (no full/broad scan): EXACT count moved 21186 -> 21194 (+8,
    matching the 6 direct fixes #23/#24/#25/#26/#27/#28 plus the 2
    side-effect resolutions 842/923 noted above) and the raw
    UNKNOWN_MISMATCH family count moved 5391 -> 5383 (-8, consistent) —
    confirms today's fixes are precisely targeted with no unexpected
    ripple beyond the intended family.

29. **definition_id 924** (AGC_CAT_STEP.AGC_CATEGORY_ID.FieldFormula),
    UNKNOWN_MISMATCH, body diff @5258, size delta +48 bytes (generated
    longer) -> now EXACT via two combined fixes, both continuing directly
    from fix #28's discovery that `Row`-typed Function PARAMETERS were
    under-supported relative to `Local Row &var;` declarations:

    (a) **`rowVariables` never included Row-typed parameters.** Source:

    ```
    Function InitStepDefautAssigneeSection(&rCurrCatTbl As Row, &rCurrentStep As Row)
       ...
       &rCurrentStep.AGC_DERIVED_ASG.GROUPBOX4.Visible = &nShow;
    ```

    `rowStartsRecordFieldChain` (the mechanism that puts a Row variable's
    `.RECORD.FIELD` chain into PSPCMNAME reference mode instead of plain
    inline text) only ever checks the `rowVariables` Set, which
    `localDeclaration()` populates for `Local Row &var;` but the
    parameter-parsing loop never populated for `As Row` parameters at
    all. Fixed by capturing the parameter's variable name (a new
    `paramName` capture, mirroring `localDeclaration()`'s own pattern) and
    calling `rowVariables.add(paramName.toLowerCase())` alongside fix
    #28's `ensureLocalObjectPackageReference` call, scoped the same way
    (only confirmed for `Row`; Record is unconfirmed and left alone).

    (b) **The FIELD binding a Row-typed variable establishes needs to
    bridge into the control-group-scoped `declaredRecordFields` pool**,
    the same way a declared Record variable's own FIELD binding already
    does (see fix #20's ACCOMPLISHMENTS.EMPLID.SavePostChange /
    AA_SUMM_JPN_VW.EMPLID.SavePostChange provenance-bridge, cited in the
    existing code comment). Without this, a LATER row-shorthand access
    reached through a *different* access style couldn't find it:

    ```
    &rsCategorySteps = &rCurrCatTbl.GetRowset(Scroll.AGC_CAT_STEP);
    For &i = 1 To &rsCategorySteps.ActiveRowCount
       &rsCategorySteps(&i).AGC_DERIVED_ASG.GROUPBOX4.Visible = &nShow;
    ```

    `&rsCategorySteps(&i).AGC_DERIVED_ASG.GROUPBOX4` is a row-shorthand
    chain (base variable `&rsCategorySteps` is a Rowset, not a
    `rowVariable`), so its FIELD lookup goes through the FINAL "ordinary
    Rowset/row-shorthand FIELD reuse" branch, which checks
    `declaredRecordFields`/`rowShorthandFields`/`fieldReferencesByControlGroup`
    -- NONE of which the `rowVariables` branch's FIELD write populated
    (it only wrote to the global, unscoped `typedRowFields` map). Fixed
    by also writing into `declaredRecordFields` (keyed by
    `${controlGroup}:${fieldName}`, exactly like the analogous
    `recordVariables` branch already does) whenever a FIELD is allocated
    through a Row-typed variable's chain. (encoder.ts:
    `functionStatement()`'s parameter-parsing loop for (a); the postfix
    `.MEMBER` handler's FIELD-write block for (b).)

    Verified: `tsc`/`npm test` clean, `corpus:verify --limit 430` PASS
    (430/430, no regression, first attempt). Spot-checked 921 (still
    EXACT — directly related, same parameter-parsing code path) and 871
    (still its pre-existing UNKNOWN_MISMATCH) — unaffected.

30. **definition_id 935** (AMM_ARCHIVE_WK.FUNCLIB.FieldFormula),
    UNKNOWN_MISMATCH, body diff @355 -> now EXACT via three independent
    fixes, each on a different construct, found in sequence on the same
    definition (progress-not-completion applied three times over):

    (a) **Blank line between the end of a leading Local-declaration run
    and a FOLLOWING standalone comment.** Source:

    ```
    Local string &segmentsunordered;

    /* Archived Details Component */
    ```

    This is the mirror case of fix #24 (blank line between a LEADING
    comment and the FIRST following Local): the existing "leading Local
    run -> executable section" transition check (which emits the 0x4F
    marker and sets `enteredExecutableSection = true`) ran AFTER the `<*`/
    `/*` comment-consuming branches in `functionStatement()`'s body loop,
    but those branches `continue` immediately after consuming a comment --
    so when the item FOLLOWING the last Local was itself a comment, the
    transition check was never reached at all. Fixed by moving the
    transition check to run BEFORE the comment branches instead of after.

    (b) **`Component XmlDoc &var;` never allocated its implicit
    PACKAGE/XMLDOC dependency row**, the same class of gap fix #14 (an
    earlier session) already found and fixed for `Component Rowset
    &var;`, and fix #25 found for `Local ApiObject &var;` -- `XmlDoc` was
    simply never added to `componentDeclaration()`'s dispatch (which only
    handled `Record` and `Rowset`). Fixed by adding an `XmlDoc` branch
    calling `ensureLocalObjectPackageReference('XMLDOC', 'XmlDoc')`, only
    for `XmlDoc` (the evidenced type) -- Row/SQL/File/ApiObject/XmlNode
    Component declarations are unconfirmed and left alone.

    (c) **A `rem` statement's trailing `space()` call ate the blank line
    before the NEXT item (a `End-Function;` in this case).** Root cause:
    `remComment()` consumes its own trailing `;` as part of matching the
    rest of its source line (unlike an ordinary statement, whose `;` is
    still ahead of `pos` when the generic post-statement `space()` call
    runs -- that call exists specifically to skip whitespace BEFORE an
    ordinary statement's still-unconsumed semicolon). Calling the SAME
    `space()` unconditionally after a rem statement therefore skipped
    past a genuine blank line the next loop iteration (or the dedicated
    blank-line-before-End-Function check) needed intact:

    ```
    rem &xmldoc = GetArchPubHeaderXmlDoc(..., &xmlsegmentindex);

    End-Function;
    ```

    Fixed by only calling that `space()` (and the semicolon/End-Function
    check it guards) for non-rem statements, since a rem statement never
    needs either. (encoder.ts: `functionStatement()`'s body loop for (a)
    and (c); `componentDeclaration()` for (b).)

    Verified: `tsc`/`npm test` clean, `corpus:verify --limit 430` PASS
    (430/430, no regression, first attempt). Spot-checked 634 (also
    touches Function-body blank-line machinery), 924 and 921 (both touch
    the parameter/declaration PACKAGE-dependency machinery), and 871
    (pre-existing UNKNOWN_MISMATCH) — all unaffected.

    In passing: definition 936 (AMM_ARCHIVE_WK.XML2_PB.FieldChange, same
    `Component XmlDoc &xmldoc;` file) was found already EXACT when checked
    as a fresh candidate right after this fix — resolved as a side effect.

31. **definition_id 937** (AMM_ARCHIVE_WK.XML3_PB.FieldChange),
    UNKNOWN_MISMATCH, body diff @275, size delta +2 bytes -> now EXACT.

    Root cause: `remComment()`'s "immediately-consecutive REM lines
    merge into one comment token" rule (calibrated in an earlier session
    against definition 964, see fix history above) merged UNCONDITIONALLY
    -- any run of consecutive `REM`-led lines with no blank line between
    them, regardless of whether each one already had its own terminating
    `;`. Definition 937 disproves the unconditional version directly:

    ```
    rem AMM_DERIVED.MSGNAME = PSAPMSGARCHSC.MSGNAME;
    rem AMM_DERIVED.SUBNAME = PSAPMSGARCHSC.SUBNAME;
    rem AMM_DERIVED.APMSGVER = PSAPMSGARCHSC.APMSGVER;
    ```

    Each of these three lines closes with its own `;`, so each is already
    a syntactically complete rem statement -- stored has THREE separate
    0x24 records (96, 96, and 100 bytes: exact UTF-16LE lengths of each
    line alone), not one 296-byte merged record. Reconciled with
    definition 964's original evidence (`rem PSCHNLDEFN is a deprecated
    table in PT 8.48 and above.` / `rem SQLExec(...);` -- the FIRST line
    has no `;` of its own, a genuine multi-line continuation, so it DOES
    need to merge with the second) by changing the merge-loop's condition
    from "always keep merging while the next line starts with REM" to
    "keep merging only while the accumulated text does NOT yet end in
    `;`" -- i.e. merge is for completing an unterminated continuation, not
    for combining separately-complete rem statements. Both definitions'
    evidence now hold simultaneously under the single narrower rule.
    (encoder.ts, `remComment()`'s merge-loop condition.)

    Verified: `tsc`/`npm test` clean, `corpus:verify --limit 430` PASS
    (430/430, no regression, first attempt -- definition 964 itself is
    NOT in the protected set). Re-checked definition 964 directly: its
    `source→bin` stays EXACT (confirming the merge itself is still
    correct there); its `roundtrip` MISMATCH is the ALREADY-DOCUMENTED,
    pre-existing decoder-only bug noted earlier in this file ("definition
    964's decoded source has an *extra* blank line... out of scope for an
    encoder change") — unrelated to and unaffected by this fix, not a new
    regression.

32. **definition_id 942** (AMM_DERIVED.AMM_CANCEL_M.FieldChange),
    UNKNOWN_MISMATCH, body diff @248 (one missing 0x4F, size delta 2
    bytes) -> now EXACT.

    Root cause: the blank-line-marker handling for a transition BETWEEN
    two top-level declaration statements that both stay inside the same
    open declaration section (`Component`/`Global`/`Declare Function`
    followed by another one of the same three, per the trigger regex) was
    hardcoded to push exactly one `0x4F` (`chunks.push(Buffer.from([0x4f]))`)
    whenever any blank line was present, unlike every other blank-line
    marker site in this file, which scales via `Math.max(1, newlineCount -
    1)`. Source:

    ```
    Declare Function LoadSubChannelPubHdr PeopleCode AMM_WORK.FUNCLIB FieldFormula;


    Component boolean &msg_refreshed;
    ```

    Two blank lines here correctly need two 0x4F markers, not one. Fixed
    by applying the same multiplicity formula already used everywhere
    else. (encoder.ts, the top-level declaration-to-declaration blank-line
    marker block.)

    Verified: `tsc`/`npm test` clean, `corpus:verify --limit 430` PASS
    (430/430, no regression, first attempt).

33. **definition_id 945** (AMM_DERIVED.AMM_COLLAPSE_ALL.FieldChange),
    UNKNOWN_MISMATCH, body diff @107 (one missing 0x4F entirely, not just
    a multiplicity shortfall) -> now EXACT.

    Root cause: fix #32's declaration-to-declaration blank-line trigger
    regex (`Component|Global|Declare Function`) was itself incomplete --
    `isTopLevelDeclaration`'s own full set is `Global|PanelGroup|
    Component|Constant|Declare Function`, and `PanelGroup` was simply
    missing from the marker-block's trigger. Source:

    ```
    Declare Function CollapseTreeRows PeopleCode AMM_TREE_WS.TREE_LEVEL_NUM FieldFormula;

    PanelGroup number &CurrentTreeRow;
    ```

    One blank line here got NO marker at all (not a multiplicity bug like
    fix #32 -- the block never triggered for `PanelGroup` in the first
    place). Fixed by adding `PanelGroup` to the trigger regex. `Constant`
    remains unconfirmed by any corpus evidence and was deliberately left
    off. (encoder.ts, the same block fix #32 touched.)

    Verified: `tsc`/`npm test` clean, `corpus:verify --limit 430` PASS
    (430/430, no regression, first attempt). Definition 946 (same file,
    same pattern) also found already-EXACT as a side effect.

34. **DECODER fix** (`src/peoplecode/decoder.ts`, not encoder.ts) --
    **definition_id 954** (AMM_DERIVED.AMM_VIEW_P.FieldChange),
    UNKNOWN_MISMATCH via `roundtrip MISMATCH` only (`source→bin` was
    already EXACT) -> now EXACT. This is the dedicated decoder
    investigation flagged earlier in this file's "Identified, not yet
    fixed" notes for definitions 964/1406/940, finally undertaken because
    the SAME pattern kept recurring (three corroborating instances before
    this fix: 940, 964, and a near-identical 953) -- high enough leverage
    to justify stepping outside this session's otherwise encoder-only
    focus.

    Root cause: `PanelGroup` declarations compile with opcode `0x51` (see
    encoder.ts's own "PanelGroup declarations use opcode 0x51" comment),
    but decoder.ts's `followsDeclaration` detection (the flag that
    suppresses a REDUNDANT extra blank line when a 0x2D declaration-
    section-close boundary is immediately followed by a 0x4F blank-line
    marker) only checked opcodes `0x44, 0x45, 0x54, 0x56, 0x31, 0x58` --
    `0x51` was missing entirely. Source:

    ```
    PanelGroup boolean &ErrorClicked;
    PanelGroup string &strErrorLoc;

    &ErrorClicked = True;
    ```

    decoded to TWO blank lines before `&ErrorClicked = True;` instead of
    one: the 0x2D boundary's own newline rendered unsuppressed (since
    `redundantStructuralBoundary` requires `followsDeclaration`), stacking
    on top of the 0x4F marker's own blank line. Fixed by adding `0x51` to
    the opcode list. (decoder.ts, the `followsDeclaration` detection
    block, ~line 1904.)

    Verified: `tsc`/`npm test` clean, `corpus:verify --limit 430` PASS
    (430/430, no regression, first attempt). Directly re-checked all
    three corroborating instances: 940, 953, and 964 are now ALL EXACT
    too (four definitions resolved by one decoder fix). Definition 1406
    (the fourth previously-noted decoder-bug citation) re-checked and
    confirmed UNAFFECTED and NOT fixed by this change — its own
    `source→bin`/`roundtrip` were already EXACT before and after; its
    remaining `DECODE_SOURCE_MISMATCH` is a genuinely separate,
    still-open decoder rendering gap (unrelated to the PanelGroup opcode
    issue). A random 40-definition sample of the broader UNKNOWN_MISMATCH
    family found 0 additional definitions resolved by this fix,
    confirming it is narrowly scoped to the PanelGroup-specific pattern,
    not some larger hidden multiplier — consistent with the
    `corpus:failures --summary` re-scan showing EXACT moving by exactly
    +4 (940, 953, 954, 964), matching the four directly-verified
    definitions precisely. Note: a FOLLOW-UP re-scan a short while later
    (after continuing to the next `UNKNOWN_MISMATCH` targets, all in the
    same AMM_DERIVED source-file cluster as 940/953/954/964) found THREE
    MORE definitions from this same file resolved as side effects (958,
    963, 966) that the random sample happened to miss — PanelGroup usage
    clusters heavily within specific source files, so sampling by
    sequential offset within an affected file's neighborhood found more
    wins than the random sample suggested. Total confirmed resolved by
    fix #34: at least 7 definitions (940, 953, 954, 958, 963, 964, 966).

35. **definition_id 1046** (AMM_FILTER.IB_DIRECTION.FieldFormula),
    UNKNOWN_MISMATCH, body diff @610 -> now EXACT via two combined fixes,
    the SAME two-part pattern fix #25 already established for ApiObject,
    this time for a different object-declaration type, `Grid`:

    (a) **`Grid` missing from `typeName()`'s object-declaration-type
    list** (first diff @610, a single opcode byte: stored `0x0A` vs
    generated `0x40` right before the literal type-name text `Grid`).
    Source: `Local Grid &GRID, &GRID2;`. Fixed by adding `Grid` to the
    same regex fix #25 added `ApiObject` to.

    (b) **`Grid`'s implicit PACKAGE dependency row was never allocated**
    (next diff @738, a reference-index off-by-one, identical shape to
    fix #25's second sub-fix). Fixed by adding a `Grid` branch to
    `localDeclaration()`'s dispatch, calling
    `ensureLocalObjectPackageReference('GRID', 'Grid')`, mirroring the
    `ApiObject` branch exactly. (encoder.ts: `typeName()` for (a);
    `localDeclaration()`'s type dispatch for (b).)

    Verified: `tsc`/`npm test` clean, `corpus:verify --limit 430` PASS
    (430/430, no regression, first attempt). Spot-checked 772, 921, 924
    (all still EXACT — same `ensureLocalObjectPackageReference` mechanism).

    In passing: the huge decoder-fix #34 impact continued to surface —
    checking a batch of fresh `UNKNOWN_MISMATCH` candidates in the same
    corpus neighborhood found definitions 1061, 1062, 1081, and ALL
    FOURTEEN of 1083-1097 (the entire AMM_TREE_WS FieldChange cluster)
    already EXACT, none requiring further work. A `corpus:failures
    --summary` re-scan confirmed EXACT moved from 21209 to 21228 (+19)
    purely from this neighborhood — PanelGroup-declaration usage clusters
    heavily by source file, so a random sample undercounts fix #34's true
    reach; sequential-offset sampling within an affected file's
    neighborhood is a better way to gauge a systemic decoder fix's
    impact. Definition 1066 (AMM_STATISTICS.AMM_CHART_BTN.FieldFormula)
    was checked and skipped: a genuinely large, complex definition
    (66767 stored bytes, 417+ PSPCMNAME entries, 7606-byte size
    mismatch) unlikely to be a quick single-rule fix — not investigated
    further, not marked locally blocked, just deprioritized in favor of
    smaller targets.

36. **definition_id 1128** (ANALYSIS_DB_DIM.DIMENSION_ID.FieldEdit),
    UNKNOWN_MISMATCH, body diff @841 (single reference-index byte) -> now
    EXACT.

    Root cause: `FetchValue` had its OWN separate, narrower Record.X
    reuse mechanism (`reuseFetchValueRecord`, a distinct cache from the
    main control-group reuse pool) but was never added to the PRIMARY
    `reuseRecordReferenceWithinControlGroup` trigger list that GetRecord/
    ActiveRowCount/DeleteRow/etc already share. Source:

    ```
    &N_AGG_COUNT = ActiveRowCount(ANALYSIS_DB.ANALYSIS_DB_ID, &N_INST_ID, Record.CUBE_AGG_DEF);
    For &N_AGG_NUM = 1 To &N_AGG_COUNT
       ... Record.CUBE_AGG_DEF, &N_AGG_NUM, Record.CUBE_AGG_DIM);
       For &N_AGG_DIM_NUM = 1 To &N_AGG_DIM_COUNT
          &S_AGG_DIM_ID = FetchValue(ANALYSIS_DB.ANALYSIS_DB_ID, &N_INST_ID, Record.CUBE_AGG_DEF, &N_AGG_NUM, CUBE_AGG_DIM.DIMENSION_ID, &N_AGG_DIM_NUM);
    ```

    FetchValue's own `Record.CUBE_AGG_DEF` argument (its third,
    reference-traced occurrence in this control group) should reuse the
    exact PSPCMNAME row the earlier `ActiveRowCount` calls already
    established, but `reuseFetchValueRecord`'s own separate cache never
    saw that row (it isn't shared with the general control-group pool),
    so it allocated a fresh, wrong one. Fixed by adding `FetchValue` to
    the primary trigger list too, alongside its existing narrower
    mechanism (left untouched, still available as a fallback via the
    priority chain for whatever case originally motivated it). (encoder.ts,
    the `call()` function's Record.X reuse-flag block, same one fix #26
    and fix #27 touched.)

    Verified: `tsc`/`npm test` clean, `corpus:verify --limit 430` PASS
    (430/430, no regression, first attempt). Spot-checked 808 and 840
    (both still EXACT — same control-group reuse-flag block).

37. **definition_id 1145** (ANALYSIS_DB_WRK.BASE_CUBE_INST_ID.FieldChange),
    UNKNOWN_MISMATCH, body diff @1428 (two adjacent reference-index bytes,
    same-call-repeated-argument shape) -> now EXACT on the first attempt
    (no isolation needed this time, unlike fix #27's own two-step
    discovery of the underlying mechanism).

    Root cause: `RowScrollSelectNew` -- a distinct but closely related
    function name from `RowScrollSelect` (fix #27) -- needed the exact
    same same-call-only Record.X reuse rule, and the trigger check was an
    exact-match regex (`/^RowScrollSelect$/i`) that didn't recognize it.
    Source:

    ```
    RowScrollSelectNew(1, Record.ANALYSIS_DB_DIM, Record.ANALYSIS_DB_DIM, "...", ANALYSIS_DB.BASE_CUBE_INST_ID);
    ```

    Both `Record.ANALYSIS_DB_DIM` arguments, in the same call, reuse one
    PSPCMNAME row in stored; generated allocated two fresh ones. Fixed by
    widening the regex to `/^RowScrollSelect(?:New)?$/i`, reusing fix
    #27's entire `reuseRecordReferenceWithinCallArguments` /
    `participatingRecordReferencesByControlGroup` machinery unchanged --
    no new mechanism needed, just recognizing the second name. (encoder.ts,
    the `call()` function's `RowScrollSelect` dispatch.)

    Verified: `tsc`/`npm test` clean, `corpus:verify --limit 430` PASS
    (430/430, no regression, first attempt). Spot-checked 840 and 27
    (both still EXACT — the exact two definitions fix #27's own
    regression-isolation trace was built around).

38. **definition_id 1152** (ANALYSIS_DB_WRK.PB_OPEN_ANL_MODEL.FieldChange),
    UNKNOWN_MISMATCH, body diff @612 (single reference-index byte) -> now
    EXACT on the first attempt.

    Root cause: `DoModalPanelGroup` was missing from the shared
    control-group Record.X reuse trigger list (the same list fixes #18,
    #26, #36 already extended). Source:

    ```
    If ANALYSIS_DB_WRK.BASE_CUBE_TYPE = "D" Then
       ...
       DoModalPanelGroup(..., Panel.CUBE_DEF, &S_MODE, Record.ANALYSIS_DB_WRK);
    Else
       If ANALYSIS_DB_WRK.BASE_CUBE_TYPE = "I" Then
          ...
          DoModalPanelGroup(..., Panel.ANALYSIS_DB, "U", Record.ANALYSIS_DB_WRK);
       End-If;
    End-If;
    ```

    Both `DoModalPanelGroup` calls' own `Record.ANALYSIS_DB_WRK` argument
    (one in the outer If's body, one in a nested If inside its Else body
    -- still the same top-level control group, since the nested If is
    not itself a fresh top-level control structure) reuse ONE PSPCMNAME
    RECORD row in stored; generated allocated a second, fresh one for the
    nested call. Fixed by adding `DoModalPanelGroup` to the trigger list.
    (encoder.ts, the same `call()` Record.X reuse-flag block fixes #18,
    #26, #36 already extended.)

    Verified: `tsc`/`npm test` clean, `corpus:verify --limit 430` PASS
    (430/430, no regression, first attempt). Spot-checked 1128 and 1145
    (both still EXACT — same reuse-flag block).

## Session fixes (2026-09-24, /goal resume continued), all in
## src/peoplecode/encoder.ts unless noted

39. **definition_id 1187** (ANL_MOD_DIM_FLD.COMPONENT_NBR.RowDelete), was
    UNKNOWN_MISMATCH -> now EXACT. Same failure shape as fixes #18/#26/#36:
    `SortScroll`'s own Record.X argument was missing from the shared
    control-group Record.X reuse-checking function list:

    ```
    If %Panel = Panel.CUBE_INPUT_FLD Then
       &I_COMP_COUNT = ActiveRowCount(Record.ANL_MOD_DIM_FLD);
       ...
       For &I_COMP_NUM = ... To &I_COMP_COUNT
          UpdateValue(ANL_MOD_DIM_FLD.COMPONENT_NBR, &I_COMP_NUM, &I_COMP_NUM - 1);
       End-For;
       SortScroll(1, Record.ANL_MOD_DIM_FLD, ANL_MOD_DIM_FLD.COMPONENT_NBR, "A");
    End-If;
    ```

    `SortScroll`'s own Record.ANL_MOD_DIM_FLD argument (after the nested
    For loop closes, control returns to the enclosing If-body group) reuses
    the ActiveRowCount call's earlier row. Added `SortScroll` to the
    trigger regex. Six definitions resolved as pure side effects while
    batch-checking nearby offsets in the same family: 1178, 1179, 1180,
    1181, 1182, 1266 (all AN_MOD_DIM*, already EXACT from earlier fixes'
    broader reach before this fix specifically, confirmed by direct
    re-run, not assumed).

40. **definition_id 1236** (ARCH_OTH_CTRL.RECNAME1.FieldChange), was
    UNKNOWN_MISMATCH -> now EXACT (after fixes #40/#43/#44/#45/#46 below,
    landed together as one investigation thread on this single definition
    and its siblings 1283/840/30/95 -- listed as separate numbered fixes
    because each is a distinct, separately evidenced rule, not because
    they were separately gated). First sub-fix: `ScrollFlush`'s own
    Record.X argument was ALSO missing from the same reuse-checking list
    (same shape as fix #39):

    ```
    &L = ActiveRowCount(Record.ARCH_TBL, &I, Record.ARCH_OTH_CTRL);
    ...
    If &EXIST <> "X" Then
       ScrollFlush(Record.ARCH_TBL, &I, Record.ARCH_KEYFLD_VW2);
       ...
       RowScrollSelect(2, Record.ARCH_TBL, ...);
       &P = ActiveRowCount(Record.ARCH_TBL, &I, Record.ARCH_COMMON_KEY);
       ...
       ScrollFlush(Record.ARCH_TBL, &I, Record.ARCH_KEYFLD_VW2);
    End-If;
    ```

    Added `ScrollFlush` to the trigger regex. This alone made 1236 EXACT
    and passed `corpus:verify --limit 430` (430/430) on its FIRST attempt
    -- but a targeted follow-up check of definition 840 (AE_UPGCONV_WRK.
    AE_REFRESH.FieldChange, a previously-EXACT definition from an earlier
    session, NOT in the --limit 430 protected window) found it freshly
    broken (EXACT -> UNKNOWN_MISMATCH). See fix #43 for the root cause and
    repair. Definition_id 1265 (ARCH_TBL.RECNAME.FieldChange) resolved as
    a pure side effect of this same fix.

41. **definition_id 1257** (ARCH_SQL_LNG.ARCH_SQL.SavePostChange), was
    UNKNOWN_MISMATCH -> now EXACT. Declaration-section closing logic gap:
    a standalone block comment following a Local declaration, itself
    followed by ANOTHER top-level declaration (Global/PanelGroup/
    Component/Constant/Declare Function/import) rather than by executable
    code or another Local, was wrongly closing the leading-Local-run
    boundary (emitting a spurious 0x2D) right before the comment:

    ```
    Local Record &REC;
    /* global strings defined in ARCH_SQL_LNG.ARCH_SQL.FieldChange */
    Global string &AUDIT_ID, &AUDIT_RECNAME, &AUDIT_PROCESS, &AUDIT_STRING;
    Global boolean &AUDIT_THIS;

    If (...) Then
    ```

    stores NO 0x2D before the comment -- the whole declaration section
    (Local + both Globals) closes as ONE unit right before `If`, via the
    separate `sawTopLevelDeclaration`/`closedTopLevelDeclarationSection`
    mechanism. The comment-branch closing check (encoder.ts, inside the
    `source.startsWith('/*', pos)` top-level-loop branch) was missing the
    equivalent `!nextIsTopLevelDeclaration && !nextIsImport` exclusion
    that the analogous NON-comment transition check (a few hundred lines
    later, `leadingLocalRun && !isLocalDeclaration`) already had. Added
    the same exclusion; `leadingLocalRun` still ends either way, matching
    the non-comment path's behavior exactly.

42. **definition_id 1283** (ARCH_WRK.PSARCH_COPY_ROWS.FieldChange), was
    UNKNOWN_MISMATCH -> now EXACT after FOUR further sub-fixes on top of
    #40 (fixes #43-46), each moving the first diff further before it
    finally went EXACT -- progress-not-completion applied repeatedly on
    one definition, not stopped at the first improvement. First sub-fix:
    plain `ScrollSelect` (no leading "Row") was bulk-added to the SAME
    "GetSetId/Gray/UnGray" GLOBAL by-name reuse list years ago with no
    citation of its own -- the exact same mis-citation pattern the
    RowScrollSelect-vs-definition-840 comment already documents for
    RowScrollSelect. Disproven directly:

    ```
    ScrollFlush(Record.ARCH_CTRL_VW2);
    ...
    ScrollSelect(1, Record.ARCH_CTRL_VW2, Record.ARCH_CTRL_VW2, &WHERE, &ARCHIVE_ID, &PARENT_TBL);
    ```

    ScrollFlush's own Record.ARCH_CTRL_VW2 allocates its own row.
    ScrollSelect's own two Record.ARCH_CTRL_VW2 arguments do NOT reuse it
    (stored allocates a fresh row) but DO reuse each other within the same
    call. Moved `ScrollSelect` from `reuseRecordReferenceByName` to
    `reuseRecordReferenceWithinCallArguments`, mirroring RowScrollSelect
    (same trigger regex, widened to `(?:RowScrollSelect(?:New)?|ScrollSelect)`).

43. **Regression caught and repaired** (definition_id 840, AE_UPGCONV_WRK.
    AE_REFRESH.FieldChange, a previously-EXACT definition from an earlier
    session, outside the --limit 430 protected window -- caught by
    deliberately re-testing every definition a shared-helper change could
    plausibly touch, not by the --limit 430 gate itself, which would have
    missed it). Root cause: fix #40 made `ScrollFlush` reuse-participating
    for its OWN Record.X argument, but `reuseRecordReferenceWithinControlGroup`
    (governing whether a call CHECKS the reuse cache before allocating)
    and marking a fresh allocation as "participating" (visible to a LATER
    RowScrollSelect/ScrollSelect call, via `participatingRecordReferencesByControlGroup`)
    had always been the SAME boolean. Definition 840 disproves that they
    must be the same:

    ```
    ScrollFlush(Record.MESSAGE_LOG);
    RowScrollSelect(1, Record.MESSAGE_LOG, Record.MESSAGE_LOG, "...", &PI);
    ```

    ScrollFlush's OWN fresh Record.MESSAGE_LOG allocation must NOT become
    visible to the following RowScrollSelect call (which must allocate its
    OWN fresh row, reusing only its own two arguments with each other) --
    contradicting definition 1236's evidence (fix #40) that ScrollFlush's
    OWN fresh allocation SHOULD be visible to a later RowScrollSelect in
    that construct. Split the single boolean into two: kept
    `reuseRecordReferenceWithinControlGroup` governing the READ (unchanged
    trigger list, still includes ScrollFlush), and introduced a new
    `marksControlGroupParticipant` governing the WRITE into
    `participatingRecordReferencesByControlGroup`, with its own,
    independently evidenced trigger list. Wired identically at both call
    sites that set the original flag (the general bare-call argument
    parser and the postfix `.GetRecord(...)/.Select(...)` method-call
    handler), including save/restore in each site's own `finally` block.

44. Landed alongside #43: the READ/WRITE split alone was not enough --
    ScrollFlush's participating status ITSELF turned out to depend on
    argument COUNT, not just the call name. Definition 840's ScrollFlush
    has ONE argument; definition 1236/1283's ScrollFlush has THREE
    (`Record.Parent, &row, Record.Child`). Re-testing 1236/1283 after the
    #43 split (with ScrollFlush's trigger simply removed from
    `marksControlGroupParticipant`) reintroduced the ORIGINAL bug they
    were fixed for. Added a small in-`call()` lookahead
    (`isMultiArgScrollFlushCall`, a balanced-paren/quote-aware top-level
    comma scan from the call's own `(`) that sets
    `marksControlGroupParticipant = true` for the WHOLE call only when
    ScrollFlush has 2+ arguments -- both definition 1236/1283's parent
    AND child Record.X arguments end up marked participating in that
    case (not just the child/last one -- an earlier, narrower "only the
    3rd argument onward" hypothesis was tried and DISPROVEN by 1283's own
    later diff, where RowScrollSelect's FIRST/parent-position argument
    also needed to reuse ScrollFlush's row), while the single-argument
    form (840) stays excluded entirely.

45. `Hide`/`UnHide` (distinct functions from `HideScroll`/`UnhideScroll` --
    field-level, not scroll-level) were entirely missing from BOTH the
    `reuseRecordReferenceWithinControlGroup` and `marksControlGroupParticipant`
    trigger lists. Definition 1283:

    ```
    Hide(Record.ARCH_TBL, &I, ARCH_OTH_CTRL.PSARCH_MATCHVAL1, &SEQ);
    UnHide(Record.ARCH_TBL, &I, ARCH_OTH_CTRL.PSARCH_MATCHDT1, &SEQ);
    ```

    repeated several times reuse one control-group Record.ARCH_TBL row
    rather than each allocating fresh. Added both names to both trigger
    lists (no ScrollFlush-style argument-count exception evidenced or
    needed for these two).

46. `Gray`/`UnGray` were ALREADY on the GLOBAL `reuseRecordReferenceByName`
    list (bulk-added alongside GetSetId, no citation of their own -- same
    pattern as fix #42's ScrollSelect finding) but needed the NARROWER
    control-group-scoped check to run FIRST for their own explicit
    `Record.X` argument form. Definition 1283:

    ```
    ScrollFlush(Record.ARCH_TBL, &I, Record.ARCH_KEYFLD_VW2);
    ...
    Gray(Record.ARCH_TBL, &I, ARCH_OTH_CTRL.PSARCH_MATCHVAL1, &SEQ);
    ```

    Gray's own Record.ARCH_TBL argument needed to reuse ScrollFlush's
    control-group row, not the very first ARCH_TBL reference anywhere in
    the program (which is all the global by-name rule alone could find).
    Added `Gray`/`UnGray` to BOTH the `reuseRecordReferenceWithinControlGroup`
    and `marksControlGroupParticipant` lists -- since the control-group
    check runs strictly before the by-name check in `recordReference()`'s
    priority order, this only takes priority when a control-group
    establishment actually exists, and does not remove or override
    whatever the global by-name behavior was originally validated for.
    Definition 1283 went EXACT after this (fixes #42/#44/#45/#46 combined).

47. **Regression caught and repaired** (definition_ids 30 and 95, both
    protected-baseline, caught by the routine post-fix
    `corpus:verify --limit 430` gate itself: FAIL, both EXACT ->
    UNKNOWN_MISMATCH). Root cause: fix #42 moved `ScrollSelect` to
    same-call-only reuse (`reuseRecordReferenceWithinCallArguments`,
    reset fresh per call), but definition 30 (ABSENCE_HIST.ABSENCE_TYPE.
    RowInit) has TWO TEXTUALLY IDENTICAL `ScrollSelect` calls in the SAME
    control group, each in its own `If Not RecordNew(...) Then ...
    End-If;`:

    ```
    ScrollSelect(2, Record.ABSENCE_HIST, Record.ABS_HIST_DET, Record.ABS_HIST_DET, "...", ...);
    ...
    ScrollSelect(2, Record.ABSENCE_HIST, Record.ABS_HIST_DET, Record.ABS_HIST_DET, "...", ...);
    ```

    The SECOND call's Record.ABSENCE_HIST/Record.ABS_HIST_DET arguments
    reuse the FIRST call's own rows entirely (cross-call, not merely
    within-call) -- unlike RowScrollSelect (no such cross-call evidence
    either way for it). Added `ScrollSelect` (only -- not RowScrollSelect,
    unevidenced) to `marksControlGroupParticipant`, so its own fresh
    allocations become visible to a LATER ScrollSelect call via
    `participatingRecordReferencesByControlGroup`. Verified this does not
    reopen fix #42's own 1283 case: a single-argument ScrollFlush call
    still does not mark participating (fix #44's argument-count guard),
    so a ScrollSelect immediately following it still finds nothing and
    allocates fresh, exactly as 1283 requires. All of 30, 95, 840, 1187,
    1236, 1257, 1265, 1283 re-verified EXACT together after this fix;
    `corpus:verify --limit 430` 430/430; `tsc`/`npm test` (456/1) clean.

48. **definition_id 1549** (BAS_ENR_RUNCTL.PASSIVE_EVENT_IND.FieldChange),
    was UNKNOWN_MISMATCH -> now EXACT. `HideRow` (distinct from
    `HideScroll`/`UnhideRow`, both already on the list, but the plain
    `HideRow` counterpart was missing entirely) was added to the Record.X
    control-group reuse-checking function list (same failure shape as fix
    #18 -- its own unconditional fresh allocation was silently overwriting
    the shared control-group cache entry):

    ```
    DeleteRow(Record.BAS_ENR_PASSIVE, &I);
    ...
    HideRow(Record.BAS_ENR_PASSIVE, 1);
    ...
    UnhideRow(Record.BAS_ENR_PASSIVE, 1);
    ```

    `corpus:verify --limit 430` PASS (430/430, first attempt); `npm test`
    clean.

49. **definition_id 1627** (a Function-body construct in the
    FUNCLIB_BAS_PAR/BAS_PAR_VW family), was UNKNOWN_MISMATCH -> now EXACT.
    `FetchValue` was missing from the Scroll.X control-group reuse list
    (it already had the analogous Record.X list membership from an
    earlier session):

    ```
    &BENRCD = FetchValue(Scroll.BAS_PAR_VW, &I, BAS_PAR_VW.BENEFIT_RCD_NBR);
    &EVENT_ID = FetchValue(Scroll.BAS_PAR_VW, &I, BAS_PAR_VW.EVENT_ID);
    ```

    The second call's own Scroll.BAS_PAR_VW argument reuses the first's.
    `corpus:verify --limit 430` PASS (430/430, first attempt); `npm test`
    clean.

50. **definition_id 1643** (BAS_PARTIC_PLAN.ANNUAL_PLEDGE.SaveEdit), was
    UNKNOWN_MISMATCH -> now source→bin EXACT (overall classification still
    non-EXACT; remaining gap is a separate, pre-existing DECODER-side
    comment-classification issue, out of scope for an encoder fix -- see
    below). A blank line separating `And`/`Or` from its next operand,
    inside a multi-line boolean condition, had NO blank-line-marker (0x4F)
    handling at all -- unlike every other calibrated boundary in this
    file:

    ```
    If None(&RSLT) And

          All(&PLEDGE) Then
    ```

    stores one 0x4F between the `And` keyword and `All(&PLEDGE)`. Fixed
    in `andExpression()`'s while loop (the directly-evidenced case) and
    mirrored symmetrically in `booleanExpression()`'s Or-loop (same code
    shape, not separately evidenced, following the same-pattern precedent
    fix #7 already used for this file's inline-comment case). Verified
    `source→bin EXACT` (the strongest tier) for definition 1643 after this
    fix -- the remaining `roundtrip MISMATCH` is a decoder inline-vs-
    standalone comment rendering gap (0x4E vs 0x24) unrelated to this fix,
    matching the already-documented decoder gaps for definitions 964/1406;
    not investigated further here per the encoder/decoder separation rule.
    `corpus:verify --limit 430` PASS (430/430, first attempt); `npm test`
    clean.

51. **definition_id 1749** (BENEF_PB_WRK.ODEM_SCHED_ACTY_PB.FieldDefault),
    was UNKNOWN_MISMATCH, first diff @153 -> advanced substantially (now
    @717, past two distinct real bugs) but NOT fully EXACT -- a further,
    distinct issue remains (see "Identified, not yet fixed" below).
    `ProcessRequest` was an entirely missing object-declaration type, the
    same class of gap as ApiObject (fix #25)/Grid (fix #35): (a) missing
    from `typeName()`'s inline-name-opcode list (`Local ProcessRequest
    &RQST;` was encoding its type as the generic `0x40` keyword introducer
    instead of the calibrated `0x0A` inline-name one), and (b) missing its
    own implicit PACKAGE/PROCESSREQUEST dependency-row allocation. Both
    confirmed correct by direct comparison against definition 1749's own
    stored PSPCMNAME dump (NAMENUM 3 = PACKAGE/PROCESSREQUEST, NAMENUM 4 =
    PACKAGE/RECORD, both exactly matching after the fix). `corpus:verify
    --limit 430` PASS (430/430); `npm test` clean; spot-checked 840, 1283,
    30, 95 (all still EXACT, unaffected by this declaration-only change).

52. **definition_id 1929** (BN_LIMITTYP_RUN.LIMIT_TYPE.SaveEdit), was
    UNKNOWN_MISMATCH -> now EXACT. A standalone disabled-code marker
    (`<* ... *>`) following an OPEN top-level declaration section had NO
    closing-boundary handling at all -- the sibling standalone
    block-comment branch (`/* */`) already had this exact check
    (`sawTopLevelDeclaration && !closedTopLevelDeclarationSection &&
    !nextIsTopLevelDeclaration`, fix #32's own mechanism), but the `<*`
    branch was missing it entirely:

    ```
    Global boolean &RunLimits_Age;

    <*
    If All(BN_LIMITTYP_RUN.LIMIT_TYPE) Then
       ...
    End-If;
    *>

    If None(BN_LIMITTYP_RUN.LIMIT_TYPE) Then
    ```

    stores `... 15 2D 4F 55 ...` -- the 0x2D declaration-section close
    belongs before both the blank-line 0x4F marker and the disabled-
    comment's own 0x55 opcode. Fixed by adding the same check (computing
    "what follows the disabled-code block" via `source.indexOf('*>', ...)`
    plus the existing `nextSignificantAfterBlockComments` helper, since
    unlike the comment branch this one needed to skip PAST its own
    disabled-code span first) before emitting the disabled-comment bytes.
    `corpus:verify --limit 430` PASS (430/430, first attempt); `npm test`
    clean.

## Identified, not yet fixed (deferred, NOT locally blocked — evidence
## gathering is incomplete, not exhausted)

There are at least THREE distinct reference/provenance sub-puzzles
surfacing this session, all with the same *symptom* (byte-identical
program size, single reference-index operand differs) but apparently
different *root causes*. Do not assume a fix for one covers the others —
treat each as its own narrow investigation, per the evidence rule.

### definition_id 1305 (ARCH_WRK.PSARCH_RUN_SQL.FieldChange) — a bare
### RECORD.FIELD reference wrongly resolves to the implicit OWNER
### reference (index 0); a REVERTED FetchValue hypothesis along the way

First diff at body offset 1734, in `&ARCH_SQL = FetchValue(Record.ARCH_TBL,
CurrentRowNumber(1), ARCH_SQL_LNG.ARCH_SQL, CurrentRowNumber(2));` (the
THIRD of three consecutive FetchValue calls, each `FetchValue(Record.
ARCH_TBL, CurrentRowNumber(1), ARCH_SQL_LNG.<field>, CurrentRowNumber(2))`).
Stored allocates a FRESH `RECORD/ARCH_TBL` row for EACH of the three calls
(NAMENUM 6, 8, 10 -- confirmed via the full `PSPCMNAME` dump, not just the
trace tool's own `--trace-refs` numbering, which this session's earlier
work found unreliable for exact index correspondence) -- generated shares
just ONE row (idx 4) across all three.

Investigated (and REVERTED, do not repeat): hypothesized `FetchValue`
needed the same `suppressRecordReferenceControlGroupWrite` treatment
already proven for `PriorValue` (ARCH_SQL_LNG.ARCH_SQL.FieldChange,
definition 1254) -- i.e. FetchValue's own fresh Record.X allocation
should not become a participating source for a LATER FetchValue call to
find. This looked well-evidenced from definition 1305 alone, and did not
break 1128/1254/1220/1172/1236 or the protected 430-window on a spot
check -- but the full corpus diff (the only reliable check, per this
session's own repeated experience in this exact reference-reuse area)
showed 19 regressions and 0 improvements. Reverted immediately
(`git checkout -- src/peoplecode/encoder.ts`, confirmed clean via
`corpus:verify --limit 430` afterward). FetchValue's existing write
behavior is evidently load-bearing for far more definitions than 1305
alone; do not retry this specific change without first finding what those
19 regressed definitions actually needed.

Separately, and likely the ACTUAL first-order bug: tracing every
reference ALLOC/USE event during encoding (not just `--trace-refs`, which
only reports the STORED/decode side) shows the very first executable
statement's own `&SQL = ARCH_SQL_LNG.ARCH_SQL;` (a bare `RECORD.FIELD`
reference with no `Record.`/`Field.` prefix, appearing immediately after
the Local declarations, before any other reference) resolves as a `USE`
of reference index 0 -- the implicit OWNER placeholder (`ARCH_WRK.
PSARCH_RUN_SQL` per NAMENUM1) -- instead of allocating its own fresh
RECORD-FIELD row (which stored's PSPCMNAME shows as NAMENUM3, a genuinely
separate `ARCH_SQL_LNG`/`ARCH_SQL` entry, nothing to do with the owner).
`ARCH_SQL_LNG` and `ARCH_WRK` are unrelated records; this looks like a
distinct `ordinaryRecordFieldReference()` bug where the FIRST bare
`RECORD.FIELD` reference in the executable body, specifically, gets
conflated with the owner context. NOT investigated further this session
(discovered late, after the FetchValue revert); worth a dedicated
`ordinaryRecordFieldReference()` / owner-reference session, starting from
a byte-level ALLOC/USE trace of `encodeProgram` itself (via
`context.referenceTrace`), not `--trace-refs`, since that only reports
the stored/decode side and hid this entirely.

### definition_id 1454 (BAS_ELIG_RULES.ELIG_FLG_UNION.SavePreChange) — a
### SECOND FetchValue-own-Record.X-argument example, contradicting BOTH
### the reverted 1305 hypothesis AND definition 1128's own reuse evidence

Found while triaging fresh candidates right after 1305's investigation;
deliberately NOT investigated further given the reverted-hypothesis risk
already spent in this exact area this session. First diff: `&NUM_OF_ROWS
= ActiveRowCount(Record.BAS_ELIG_RULES, &CURRENT_L1, Record.
BAS_ELIG_UNION); ... &FIRST_VALUE = FetchValue(Record.BAS_ELIG_RULES,
&CURRENT_L1, BAS_ELIG_UNION.UNION_CD, 1);` -- stored allocates a FRESH
`RECORD/BAS_ELIG_RULES` row for FetchValue's own first argument (does NOT
reuse ActiveRowCount's earlier establishment of the SAME record in the
SAME position). This is a DIFFERENT shape from definition 1128's own
calibrated positive evidence for FetchValue reuse (`ActiveRowCount(...,
Record.CUBE_AGG_DEF); ... FetchValue(..., Record.CUBE_AGG_DEF, ...,
CUBE_AGG_DIM.DIMENSION_ID, ...)`, a multi-level scroll navigation where
FetchValue's own Record.X argument is a THIRD positional arg reused as
part of navigating one level deeper, not a first-argument reestablishment
like 1454's). Possibly the real rule is positional/depth-sensitive
(FetchValue reuses when its own Record.X argument is navigating FURTHER
into an already-established scroll chain, but not when it is merely
re-stating the SAME top-level record ActiveRowCount already established).
Needs a dedicated, careful multi-example investigation -- likely the same
general family as 1305, and should probably be tackled together with it
in one focused session rather than guessed at again.

### definition_id 1521 (BAS_ELT_SELECT.PB_SELECT_EVENT.FieldChange) — a
### THIRD FetchValue-own-argument contradiction, this time Scroll.X, and
### directly disproving the ALREADY-CALIBRATED "FetchValue Scroll.X
### reuse" rule's own comment

Found in the same triage batch as 1454, immediately after it. Source is
five consecutive flat top-level statements, each `FetchValue(Scroll.
BAS_PAR_VW, &EVENT_ROW, BAS_PAR_VW.<field>)` with an IDENTICAL `Scroll.
BAS_PAR_VW` first argument. The existing code has an explicit, cited
rule for exactly this shape (`reuseScrollReferenceWithinControlGroup`
trigger for `FetchValue`, comment citing `&BENRCD = FetchValue(Scroll.
BAS_PAR_VW, &I, BAS_PAR_VW.BENEFIT_RCD_NBR); &EVENT_ID = FetchValue
(Scroll.BAS_PAR_VW, &I, BAS_PAR_VW.EVENT_ID); -- the second FetchValue's
own Scroll.BAS_PAR_VW argument reuses the first's"). Definition 1521's
own full `PSPCMNAME` dump DIRECTLY CONTRADICTS that: all FIVE
`Scroll.BAS_PAR_VW` occurrences get their OWN fresh row (NAMENUM 4, 7,
10, 13, 15 -- five separate entries for identical text), not one shared
row. NOT investigated further or fixed -- this is now the THIRD
independent FetchValue-own-argument reuse contradiction found this
session alone (1305's Record.X, 1454's Record.X, this one's Scroll.X),
strongly suggesting the entire family of "FetchValue's own first
argument reuses an earlier establishment" rules (both the
`reuseRecordReferenceWithinControlGroup` and
`reuseScrollReferenceWithinControlGroup` trigger-list inclusions for
`FetchValue`) may be systemically over-broad, evidenced only by
definitions with a DIFFERENT, more specific shape (definition 1128 for
Record.X: a multi-level scroll-navigation chain where FetchValue's own
argument is reused as an intermediate step, not a first-argument
re-statement; the Scroll.X positive evidence's own definitions were not
re-checked this session for a similar shape mismatch). This needs a
dedicated session gathering EVERY FetchValue occurrence in the local
snapshot (both currently-EXACT and currently-failing) and tabulating
argument position, call depth, and whether an identical-text earlier
establishment exists, before touching this mechanism again -- not
another single-definition guess. Tackle together with 1305/1454.

### definition_id 1423 (BANKACCT_SBR.INTL_BANK_ACCT_NBR.SaveEdit) and
### definition_id 1424 (its SavePreChange sibling, same construct) — a
### POSTFIX `.GetRecord(...)` method call (on a Row/Rowset variable, not
### the bare top-level function) may NOT put its following bare
### `.MEMBER` into field-reference mode the same way the bare primary
### call does

First diff (1423) at body offset 788: `&IBANValidated = &Der_Parent.
GETRECORD(Record.DERIVED_IBAN).GP_IBAN_VALIDATED.VALUE;` -- stored keeps
`GP_IBAN_VALIDATED` as plain INLINE text (`0x0A`), generated wrongly
compiles it as a FIELD PSPCMNAME reference (`0x4A`). The existing
`expectedReferenceMember = member.toLowerCase() === 'getrecord' ? 'field'
: ...` transition (fired whenever ANY postfix step is a method call named
`GetRecord`, regardless of receiver) unconditionally applies the
bare-primary-call's "argumented GetRecord puts the next bare .MEMBER into
field mode" rule (definition 535's own calibrated evidence) to this
POSTFIX-call-on-a-variable shape too -- but 1423 disproves that
generalization directly. NOT investigated further or fixed: only one
corroborating pair (1423/1424, identical construct, not independent
evidence) found this session; needs the ACTUAL positive/negative boundary
established with genuinely different examples (does ANY corpus
`&var.GetRecord(Record.X).FIELD.Value` shape correctly compile FIELD as a
reference, or is the bare-primary-call rule ENTIRELY inapplicable to the
postfix-on-a-variable form?) before changing the shared transition code,
since `GetRecord`/`Select`/`GetRowset` postfix calls are used pervasively
throughout this file's already-calibrated logic.

### definition_id 1721/1722 (BC_WRK.FULLACCESS/NOACCESS.FieldChange,
### identical construct, only the assigned literal differs) — a POSTFIX
### `.GetRow(...)` method call (on an UNDECLARED/untyped variable
### assigned from a bare `GetRowset()`) may NOT trigger the "row starts a
### RECORD.FIELD.Value chain" 0x4A-reference treatment

Source: `&RSF = GetRowset(); For &F = 1 To &RSF.activerowcount; &RSF.
getrow(&F).BC_WRK.BCMETHODACCESS.value = "FULL";`. Stored keeps `BC_WRK`
(the record-identifying first member after `.getrow(&F)`) as plain
INLINE text; generated wrongly compiles it as a 0x4A reference (of
`'record'`-mode kind -- confirmed via a temporary debug trace of
`expectedReferenceMember`, which IS correctly `'record'` at this point,
REVERTED after use, not committed). This means the BUG is not in which
mode gets selected, but in whether row-shorthand RECORD.FIELD.Value
compilation should apply AT ALL when the row comes from a POSTFIX
`.GetRow(...)` call on an untyped variable (`&RSF`, never declared
`Local Row`/`Local Rowset`, just assigned from bare `GetRowset()`) rather
than: (a) a `Local Row &row;`-declared variable (`rowStartsRecordFieldChain`,
already correctly scoped to `rowVariables`), or (b) a BARE PRIMARY
`GetRow()` call used directly, not as a postfix step
(`bareGetRowCallStartsRecordFieldChain`). NOT investigated further or
fixed: only one corroborating pair found (1721/1722, identical
construct), and the shared `expectedReferenceMember = ... 'getrow' ?
'record' : ...` transition this would need to narrow is used by
`.GetRow(...)` postfix calls throughout many already-calibrated corpus
definitions (e.g. `&Types.GetRow(&I).GetRecord(1).ADDRESS_TYPE.Value` in
definition 535) -- changing it needs a broader survey of `.GetRow(...)`
postfix-call shapes (declared-type receiver vs untyped, immediately
followed by another method call vs a bare member) before acting, not a
single-pair guess.

### definition_id 1740 (BENEF_PB_WRK.FSA_CLEAR_PB.FieldChange) — a FOURTH
### own-argument reuse contradiction, this time `SetCursorPos`, in the
### SAME broad `reuseRecordReferenceWithinControlGroup` trigger list as
### `GetRecord`/`ActiveRowCount`/`FetchValue`/~20 other names

Source: `&CurRow = ActiveRowCount(Record.FSA_CLAIM); SetCursorPos(%Panel,
Record.FSA_CLAIM, &CurRow, FSA_CLAIM.EMPLID);`, flat top level, no
control blocks. Stored allocates a FRESH `RECORD/FSA_CLAIM` row for
`SetCursorPos`'s own argument (NAMENUM 5, separate from ActiveRowCount's
own NAMENUM 4) -- does NOT reuse, contradicting `SetCursorPos`'s
inclusion in the same broad reuse-participating trigger list `GetRecord`/
`ActiveRowCount`/`FetchValue`/`UpdateValue`/`InsertRow`/`HideScroll`/
`UnhideScroll`/`UnhideRow`/`HideRow`/`CopyFields`/`RecordDeleted`/
`RecordChanged`/`CreateRowset`/`GetRowset`/`DoModalPanelGroup`/
`SortScroll`/`ScrollFlush`/`Hide`/`UnHide`/`Gray`/`UnGray` all share.
Given the day's already-established `controlDepth` pattern for the
ScrollFlush family (Fix #89) and THREE separate FetchValue-own-argument
contradictions found in this same session (1305, 1454, 1521, all above),
this looks like it could be the SAME broader phenomenon extending to
EVERY name in this ~20-name shared list, not just FetchValue/ScrollFlush
-- but that is a much bigger, much higher-blast-radius claim (this list
is used by thousands of already-EXACT corpus definitions) that absolutely
needs a dedicated, systematic investigation (tabulate every call name x
controlDepth x reuse-vs-fresh across many examples) before any code
change is even attempted. NOT investigated further or fixed this session
-- deliberately stopping the reuse-mechanism rabbit hole here rather than
guessing again.

### definition_id 523 (ADDRESSES.EMPLID.Workflow) — a block-comment
### placement (0x24 standalone vs 0x4E inline) misclassification for one
### of several textually-identical adjacent-comment-pair occurrences

`blockCommentByPlacement()` (via `blockCommentStartsOwnLine()`) selects
0x4E (inline) vs 0x24 (standalone) by looking backward from the comment's
own `/*` past only spaces/tabs to see if a newline or other content
precedes it. Source has the SAME two-comment pair `/* 811477 end */ /*
Begin Bug 19722155 */` at (at least) 5 separate places in this one
definition (per the decoded source); stored bytes show only ONE of them
(body offset 2909) uses the "wrong" opcode compared to what generated
produces (stored 0x4E, generated 0x24), while the other 4 apparently
already encode correctly (no earlier byte mismatch). NOT investigated
further this session (found very late, after extensive prior work) --
the raw SOURCE-level differences between the 5 textually-identical-
looking occurrences (indentation, surrounding statement type, which of
several call sites reaches `blockCommentByPlacement()` for each) were not
examined. Next step when resumed: diff the raw (non-decoded, non-
pretty-printed) source text immediately around each of the 5 occurrences
byte-for-byte, since the decoded/rendered view normalizes whitespace and
may be hiding the actual distinguishing factor.

### definition_id 1749 remaining issue: a THIRD, contradictory
### ScrollFlush-then-ScrollSelect/RowScrollSelect data point

After fix #51's two real bug fixes, definition 1749's first diff moved to
byte 717: `ScrollFlush(Record.BAS_MESSAGE); ScrollFlush(Record.
BAS_PAR_ONDM_VW); ScrollSelect(1, Record.BAS_PAR_ONDM_VW, Record.
BAS_PAR_ONDM_VW);` (all in the same control group, confirmed via
`--trace-refs`). Stored's `ScrollSelect` call reuses the immediately
preceding `ScrollFlush(Record.BAS_PAR_ONDM_VW)` call's own row (NAMENUM
11) for BOTH its own arguments. This DIRECTLY CONTRADICTS fix #44's
established rule (`marksControlGroupParticipant` deliberately false for
single-argument ScrollFlush), which was itself evidenced by TWO separate
definitions:

- definition_id 840 (AE_UPGCONV_WRK.AE_REFRESH.FieldChange, protected):
  `ScrollFlush(Record.MESSAGE_LOG); RowScrollSelect(1, Record.MESSAGE_LOG,
  Record.MESSAGE_LOG, ...);` — RowScrollSelect does NOT reuse ScrollFlush's
  row (allocates fresh, reusing only its own two arguments with each
  other).
- definition_id 1283 (ARCH_WRK.PSARCH_COPY_ROWS.FieldChange): `ScrollFlush
  (Record.ARCH_CTRL_VW2); ... ScrollSelect(1, Record.ARCH_CTRL_VW2, Record.
  ARCH_CTRL_VW2, ...);` — same non-reuse pattern, with unrelated code
  (a comment block, an assignment) between the two calls.

The only structural difference spotted so far between 1749 (reuses) and
1283 (does not reuse): in 1749, ScrollSelect follows its ScrollFlush
IMMEDIATELY (no intervening statement at all), and there are TWO
consecutive ScrollFlush calls (for BAS_MESSAGE, then BAS_PAR_ONDM_VW)
right before it, vs. 1283/840's single ScrollFlush call with other code
in between. Do NOT guess a "statement adjacency" or "consecutive
ScrollFlush count" rule from this alone — that would not be a
syntactically principled distinction PeopleTools' compiler is likely to
make, and no other corpus example has been checked yet. This needed a
dedicated stored-PSPCMNAME/`--trace-refs` cross-reference investigation
(the same technique that resolved sub-puzzle A) before implementing
anything; deliberately NOT attempted this session to avoid risking a
regression to 840 or 1283 on a guess. Next step when resumed: search the
local snapshot for OTHER `ScrollFlush(...); ScrollSelect(...)` /
`ScrollFlush(...); RowScrollSelect(...)` pairs (with and without
intervening statements, with one vs. multiple preceding ScrollFlush
calls) to triangulate the actual distinguishing rule before writing any
code.

#### UPDATE (Fix #89, 2026-09-25 /goal resume session): root cause found
#### and fixed for the FIRST diff; a SECOND, deeper issue remains

The actual discriminator, confirmed by cross-referencing definitions 840,
1283, 1220, 889, 1007, and 1749 together (see definition 889's own updated
note immediately below, and Fix #89's "Current target" entry above), is
`controlDepth`: 840 and 1283's own non-reusing ScrollFlush/ScrollSelect
pairs sit at flat top level (`controlDepth === 0`); every reusing example
found (1220, 889, 1007, and 1749's own FIRST ScrollFlush/ScrollSelect
pair) is nested inside a control-flow block. NOT "statement adjacency" or
"consecutive ScrollFlush count" as originally guessed here -- 1007 and 889
each have only ONE preceding ScrollFlush call, disproving that guess
directly. Fix #89 widens the single-occurrence fallback's guard to `...
|| controlDepth > 0`, which correctly resolves 1749's FIRST diff (body
offset 717 -- the `ScrollFlush(Record.BAS_PAR_ONDM_VW);
ScrollSelect(1, Record.BAS_PAR_ONDM_VW, Record.BAS_PAR_ONDM_VW);` pair now
reuses correctly) without regressing 840, 1283, or any other previously-
calibrated definition (full corpus diff: 66 newly exact, 0 regressed).

1749 is STILL not fully EXACT, though: its first diff moved to body offset
1089, a SECOND, later `ScrollSelect(1, Record.BAS_MESSAGE, Record.
BAS_MESSAGE, "WHERE PRCSINSTANCE =:1", DERIVED_BAS.PRCSINSTANCE);` deep
inside nested `If`/`Else` blocks. Stored reuses the very FIRST statement's
`ScrollFlush(Record.BAS_MESSAGE);` (three statements and one intervening
RowScrollSelect-family call -- the first `ScrollSelect(...BAS_PAR_ONDM_VW
...)` -- earlier) for this second call's own two BAS_MESSAGE arguments.
Fix #86's `genericRecordReferencesSinceLastFamilyCall` map is cleared
ENTIRELY (every key, not just the key(s) the intervening call itself
touched) whenever any RowScrollSelect-family call completes -- evidenced
by definition 843, where an intervening RowScrollSelect call correctly
invalidates BOTH its own key AND an unrelated key (ScrollFlush's earlier
PSAEAPPLDEFN). This second 1749 diff suggests that at `controlDepth > 0`
specifically, an intervening family call may NOT invalidate a key it never
itself touched (BAS_MESSAGE, untouched by the intervening
BAS_PAR_ONDM_VW-only ScrollSelect) -- a THIRD layer of nuance possibly
also `controlDepth`-gated, on top of the two already implemented. Given
843's own controlDepth is 0 (flat top level) and this new evidence's is
> 0, these may not actually conflict -- but that is exactly the kind of
guess Fix #86's own two-round regression history warns against making
without a corroborating second example. Deliberately NOT attempted this
session: this is the third distinct nuance found in this one code region
today, and each of the first two ALSO looked simple before a full-corpus
diff caught a real regression. Next step when resumed: find a SECOND
corpus example of "intervening RowScrollSelect-family call, nested inside
a control-flow block, with an UNRELATED key from before the intervening
call" before writing any code -- per-key clearing (only invalidate keys
the intervening call's own resolution actually touched, not the whole
map) is the most likely shape of the fix, but needs a second data point
first, exactly as Fix #86's own two prior rounds did.

### definition_id 889 (AE_WRK.AE_REFRESH.FieldChange) — a FOURTH,
### independently-contradictory ScrollFlush-then-RowScrollSelect data
### point, found during Fix #87's session (2026-09-25)

**RESOLVED by Fix #89** (same session): the discriminator is
`controlDepth > 0`, confirmed by cross-referencing this definition against
1007, 1749, 1220, 840, and 1283 together -- see Fix #89's "Current target"
entry above and 1749's own updated note immediately above this one for
the full cross-reference. Definition 889 itself is now source->bin EXACT.
No longer deferred; kept here for the historical evidence trail.

Surfaced while triaging fresh `UNKNOWN_MISMATCH` candidates after Fix #86
landed. First diff at body offset 575: `ScrollFlush(Record.MESSAGE_LOG);
RowScrollSelect(1, Record.MESSAGE_LOG, Record.MESSAGE_LOG, "where
PROCESS_INSTANCE = :1 order by MESSAGE_SEQ", &PI);` inside `Function
MSG_PANEL ... Evaluate AE_WRK.AE_VIEW_MODE When = "M" ... End-Evaluate
End-Function;` (i.e. functionDepth > 0, nested inside an Evaluate's own
When-clause body, all sharing one control group per the existing
Function-body/When-clause control-group rules). Stored reuses
ScrollFlush's own row for BOTH of RowScrollSelect's own MESSAGE_LOG
arguments (all three occurrences share one NAMENUM row) -- this is the
EXACT SAME literal source text as definition 840's own calibrated
disproof (`ScrollFlush(Record.MESSAGE_LOG); RowScrollSelect(1, Record.
MESSAGE_LOG, Record.MESSAGE_LOG, "where PROCESS_INSTANCE = :1 order by
MESSAGE_SEQ", &PI);`), except 840's copy sits at the top level
(functionDepth 0, flat statements, no Function/Evaluate wrapper) and does
NOT reuse (allocates a fresh row for RowScrollSelect's own pair).

Searched the local snapshot (`source_text LIKE '%ScrollFlush(Record.%'
AND source_text LIKE '%RowScrollSelect(%'`) for corroborating or
contradicting examples of this exact single-arg-ScrollFlush +
repeated-name-RowScrollSelect shape specifically. Found ~35 candidates
total, but the two shortest OTHER currently-failing ones (definitions
14222, 4395) both use a structurally different, already-separately-handled
shape (MULTI-argument `ScrollFlush(Record.X, CurrentRowNumber(), Record.
Y)`, which already has its own `isMultiArgScrollFlushCall` /
`marksControlGroupParticipant` mechanism) rather than 889's single-arg
form, so they are not clean corroborating evidence either way. No SECOND
example of the single-arg-ScrollFlush + repeated-name-RowScrollSelect
shape inside a Function/Evaluate body was found. Per the evidence rule, do
NOT generalize a "functionDepth > 0 enables reuse" rule from this ONE
contradicting data point against the TWICE-already-validated (840, and
1283's analogous ScrollSelect variant) top-level non-reuse rule --
especially given this exact code region already produced two real,
corpus-diff-caught regressions earlier in this same session (Fix #86's
own two-round isolation trail) from narrower-than-actual rules. This is
very likely the SAME underlying unresolved mechanism as definition 1749's
own contradiction (recorded just above, from an earlier session) --
worth investigating BOTH together in a dedicated session, since 1749's
"immediately preceding, no intervening statement, multiple consecutive
ScrollFlush calls" hypothesis and 889's "functionDepth > 0" hypothesis are
each single-point observations that could turn out to be the same rule,
different rules, or both wrong. Next step when resumed: pull EVERY
`ScrollFlush(Record.X); RowScrollSelect(N, Record.X, Record.X, ...)` (or
`ScrollSelect` equivalent) occurrence in the local snapshot regardless of
current classification (not just currently-failing ones -- an
already-EXACT one confirms which rule its own shape follows) and tabulate:
functionDepth, statement adjacency, consecutive-ScrollFlush count, and
observed reuse/no-reuse, before writing any code.

### definition_id 1285 (ARCH_WRK.PSARCH_COPY_TABLE.FieldChange) — CopyFields
### general-cache visibility, deferred pending more corpus evidence

Surfaced this continued session while investigating the same ARCH_WRK
family as fixes #40/#42/#44-47. UNKNOWN_MISMATCH. First diff (before any
work) was at byte 721: `ScrollFlush(Record.ARCH_TBL_VW); ... CopyFields(1,
Record.ARCH_TBL, &I, 1, Record.ARCH_TBL_VW, 1);` — CopyFields' own second
Record.ARCH_TBL_VW argument was wrongly reusing ScrollFlush's own
single-argument establishment via the GENERAL `recordReferencesByControlGroup`
cache (a DIFFERENT map from the `participatingRecordReferencesByControlGroup`
one fix #43/#44 already fixed this exact asymmetry for). Confirmed via
`git stash` that this specific failure PRE-DATES this session entirely
(not a regression from today's fixes).

Tried and DISPROVEN: a `suppressGeneralControlGroupWrite` flag, mirroring
`marksControlGroupParticipant`'s exact single-vs-multi-argument ScrollFlush
split, gating the GENERAL cache write the same way the participating-map
write was gated. This moved 1285's first diff further (byte 721 -> 1175,
past the CopyFields bug) but broke a DIFFERENT, already-EXACT sibling
definition (1265, ARCH_TBL.RECNAME.FieldChange) in the exact same source
file family:

```
ScrollFlush(Record.ARCH_TMP_RECNAM);
&RT = 1;
For &L = 1 To &ROWS
   ...
   &A = ActiveRowCount(Record.ARCH_TMP_RECNAM);
```

Here `ActiveRowCount`'s own Record.ARCH_TMP_RECNAM argument DOES need to
reuse the single-argument ScrollFlush's own establishment via the GENERAL
cache — the exact opposite of what 1285 needs from `CopyFields`. So the
true distinguishing factor is NOT "single-arg vs multi-arg ScrollFlush"
(that was already fully resolved by fix #44 for the PARTICIPATING map);
it must be something about `CopyFields` specifically, or about its
particular invocation shape here (`CopyFields(1, Record.ARCH_TBL, &I, 1,
Record.ARCH_TBL_VW, 1)`, the single-level/6-argument form, versus the
double-level/10-argument form used elsewhere in the SAME definition
--`CopyFields(2, Record.ARCH_TBL, &I, Record.ARCH_CTRL, &J, 2,
Record.ARCH_TBL_VW, 1, Record.ARCH_CTRL_VW, &J)` -- not yet distinguished
by any test). Reverted the `suppressGeneralControlGroupWrite` mechanism
entirely (fully removed, not left as dead code) rather than risk a
narrower guess without more evidence. 1265, 30, 95, 840, 1236, 1283, 1187
all reconfirmed EXACT after the revert; `corpus:verify --limit 430`
430/430.

Missing evidence: whether CopyFields' single-level form specifically (as
opposed to CopyFields in general, or ScrollFlush in general) is the
correct scope for a future fix; whether other single-level CopyFields
calls elsewhere in the corpus corroborate; a stored-PSPCMNAME enumeration
of 1285 specifically (the scratch-script technique from earlier sessions)
to confirm the exact intended index for this ActiveRowCount rather than
inferring from encoder trace output alone. Next step when resumed: enumerate
stored PSPCMNAME/PSPCMPROG bytes directly for 1285, and search the corpus
for other single-level `CopyFields(1, Record.X, ..., 1, Record.Y, ...)`
calls immediately followed by another reuse-participating call, to
determine whether the CopyFields-specific-suppression hypothesis holds
before implementing it.

### Sub-puzzle A: ActiveRowCount / DeleteRow record arguments — RESOLVED
### this session, see fixes #11-13 above

Surfaced by definition_id 2406 (CAN_TAX_TYPE.SOURCE_TAX.FieldChange) once
the For-body-EOF-semicolon fix let it encode further. UNKNOWN_MISMATCH,
first diff @480 (single reference-index byte).

RESOLVED: definitions 2406, 1269, 3586 all now EXACT via fixes #11
(UpdateValue/InsertRow added to the Record.X control-group-reuse function
set, plus the `inControlGroup()` top-level-boundary structural fix) and
#12/13 (the same reuse rule extended to Scroll.X arguments for
ActiveRowCount/UpdateValue/Gray/UnGray). The findings below are kept for
historical/methodological reference (the stored-byte 0x21-enumeration
technique is reusable for sub-puzzles B/C), but the open questions they
raise about `reuseRecordReferenceByName`'s scoping were superseded by the
actual fix landed (which took a different, narrower path than either
option this section originally proposed: rather than rescoping the
existing global-by-name flag, ActiveRowCount/DeleteRow/GetRecord/
UpdateValue/InsertRow were kept on the already-narrower
`reuseRecordReferenceWithinControlGroup` mechanism, and the real bug turned
out to be the control-group *boundary* itself being too coarse, not the
reuse flag's scoping per se).

Findings so far (from `--trace-refs` plus manual stored-byte reference-
operand enumeration — see method below, reusable for next session):
- Enumerated all eighteen `0x21` reference-operand occurrences in the
  STORED PSPCMPROG bytes in source order (byte offsets 71, 375, 411, 479,
  515, 530, 541, 576, 583, 634, 670, 738, 774, 790, 841, 877, 945, 981;
  each is `0x21 <u16-LE index> 0x00`).
- Cross-referenced against the `--trace-refs` source-offset order to map
  each stored occurrence back to its source construct (three sibling
  `If ... For ActiveRowCount(...) ... DeleteRow(...) ... End-For End-If`
  blocks, all referencing `Record.CAN_TAX_TYPE` plus a sibling field
  record).
- Confirmed: STORED reuses the record-name reference **within each
  individual For loop** (its own `ActiveRowCount` and `DeleteRow` calls
  share one PSPCMNAME row per record name), but does **not** reuse across
  sibling For loops in different top-level If blocks — each If/For gets
  its own fresh `CAN_TAX_TYPE` / `CAN_TAX_CLASS` / `CAN_TAX_HLCLASS` row
  the first time that loop mentions them.
- The CURRENT encoder's `reuseRecordReferenceByName` flag (set for
  `GetSetId|ActiveRowCount|ScrollSelect|RowScrollSelect|Gray|UnGray`, see
  ~line 4423) does an **unscoped global** `references.find(...)` by name —
  no control-group filtering. That is why `ActiveRowCount`'s repeat
  mentions in loop 2 and loop 3 wrongly reused loop 1's very first
  `CAN_TAX_TYPE` row instead of allocating fresh per-loop rows, and it is
  also why `DeleteRow` (not currently in that flag's regex at all) got a
  fresh row every time instead of reusing its *own* loop's
  `ActiveRowCount` row.
- Missing evidence / open question before implementing: the correct rule
  appears to be **control-group-scoped by-name reuse** (reuse within the
  same For/Evaluate/If control group, not globally), for at least
  `ActiveRowCount` and `DeleteRow`. But `reuseRecordReferenceByName` is a
  shared flag already exercised by protected-baseline fixtures for
  `GetSetId`/`Gray`/`UnGray`/etc., where global (not per-group) reuse may
  be exactly what's calibrated. Changing its scoping blindly risks
  regressing those. Before implementing: find which protected-baseline
  (or other currently-EXACT) fixtures actually exercise
  `reuseRecordReferenceByName` for each of the five flagged function
  names, and check whether any of them have multiple control groups
  mentioning the same record name (to see whether global-vs-scoped even
  produces a different byte sequence for those cases). If none do, it's
  safe to add a control-group key to the reuse map. If some do rely on
  cross-group reuse, this needs a per-function-name policy, not one
  shared flag.
- Also still open: whether `DeleteRow`'s reuse should reuse from *any*
  same-control-group record occurrence (including a same-group `Local`/
  other) or specifically from its group's `ActiveRowCount` call.
- Definitions sharing this same ENCODE_ERROR "expected ; in For body"
  family that are now UNKNOWN_MISMATCH and likely blocked on this same
  reference-scoping issue, worth re-checking once it's fixed: 1269, 2406,
  3586, 4067. (1269 and 3586 have not yet been individually diffed against
  this hypothesis — only 2406 was fully traced. Check them too once a fix
  lands, they may reveal additional wrinkles, e.g. 1269's nested For-in-For
  shape.)
- Also worth checking once fixed: definitions 1738, 3235, 3539 (from the
  `(1).GetRowset(Sc...` family unlocked by fix #8 this session) moved
  ENCODE_ERROR -> UNKNOWN_MISMATCH and plausibly hit this same
  control-group-scoping gap, though not individually traced/confirmed.

### Sub-puzzle B: Application Class method-call dependency scoping —
### RESOLVED this session, see fix #17 above

Surfaced by definition_id 525 (ADDRESS_SBR.COUNTRY.RowInit).
UNKNOWN_MISMATCH, first diff @1807, reference index 0x08 vs 0x0b (off by
3), same total size.

RESOLVED: definition 525 now EXACT via fix #17. The original hypothesis
below (one SHARED method-dependency row) was disproven by direct
stored-PSPCMNAME enumeration -- the real answer is ZERO separate
method-dependency rows for a Component-declared instance's method calls,
achieved by extending the existing `reuseRuntimeCreateForMethods`
declaration-phase rule (already correct for `Local` Application Class
declarations) to `Component` Application Class declarations, which had
it hardcoded off. The findings below are kept for historical/
methodological reference. Definition 871's own reference-index mismatches
are NOT this same issue -- see the Function-body control-group findings
under fixes #18-19 and definition 871's own "Locally blocked" entry.

Source shape: a `Component EO:CA:Address &cobj_EO_CA_Address;` instance,
later invoked with THREE different method calls in sequence inside one
If/Else:

```
&cobj_EO_CA_Address.ResetAddressRecord(&Addr_Rec);
&cobj_EO_CA_Address.ResetDerivedAddressRecord(&Der_Address);
&cobj_EO_CA_Address.ResetDerivedAddrRecord(&Der_addr);
```

`--trace-refs` shows the encoder currently allocates a **separate fresh
PACKAGE dependency row per distinct method name** (`ALLOC #9 idx=8
...RESETADDRESSRECORD`, `ALLOC #10 idx=9 ...RESETDERIVEDADDRESSRECORD`,
`ALLOC #11 idx=10 ...RESETDERIVEDADDRRECORD`), i.e. three rows for three
method calls on the same instance. The off-by-3 in the stored index at
the next real reference strongly suggests PeopleTools shares ONE
dependency row across all three method calls on the same
already-`create`d instance, rather than one per method name. Not
individually confirmed byte-by-byte the way sub-puzzle A was (that would
need the same stored-byte 0x21-enumeration technique used for definition
2406, cross-referenced against `--trace-refs`, before implementing
anything) — this is a hypothesis from the index arithmetic and the
project's own docs section "Application Class Provenance" (which
explicitly separates import/runtime-create/method-invocation dependency
kinds and warns "Do not globally reuse a runtime-create dependency for
every method call" — so any fix here needs to be scoped precisely to
*method calls sharing the same already-resolved instance*, not
generalized to all Application Class dependencies).
Definition 871 (AE_WRK.AE_GO.FieldChange, 36181 bytes, 84 names) — from
the `ENCODE_ERROR / BLOCK_COMMENT` family, fixed by fix #6 this session —
is also still UNKNOWN_MISMATCH with a single reference-index swap; not
diffed against this hypothesis, but a plausible match given the program's
size and complexity.

### Sub-puzzle C: Field reference reuse after GetRecord(...).GetField(...) —
### RESOLVED this session, see fix #20 above

Surfaced by definition_id 524 (ADDRESS_SBR.COUNTRY.FieldChange) once
fix #9 (try-at-EOF) let it encode further. UNKNOWN_MISMATCH, first diff
@951, reference index 0x13 vs 0x15.

RESOLVED: definition 524 now EXACT via fix #20, exactly matching the
hypothesis below (a control-group-scoped reuse flag for `Field.X` when
reached via `.GetField(...)` on a `.GetRecord(...)` chain result). Required
one narrowing beyond the original hypothesis: reuse only applies when the
`.GetField(...)` call is NOT the chain's own first postfix step (i.e. it
must be preceded by `.GetRecord(...)` specifically, not just any construct
that happens to set `expectedReferenceMember === 'field'`) — see fix #20's
own notes for the calibrated test this distinction was needed to preserve.

Source shape:

```peoplecode
... = &RS_Country.GetRow(1).GetRecord(Record.COUNTRY_TBL).GetField(Field.DESCR).Value;
DERIVED_ADDR.DESCR_COUNTRY = &RS_Country.GetRow(1).GetRecord(Record.COUNTRY_TBL).GetField(Field.DESCR).Value;
```

The identical `GetRecord(Record.COUNTRY_TBL).GetField(Field.DESCR)` chain
appears twice. `--trace-refs` shows the `Field.DESCR` reference (parsed
as a plain `field` kind, not `record-field`, via `fieldReference()`) gets
a **fresh allocation both times** (no reuse at all currently — there is
no reuse flag for the `Field.X` postfix on a `GetRecord(...)` chain
result, unlike `GetRecord`'s own `Record.X` argument, which already has
`reuseRecordReferenceWithinControlGroup`). The project's own docs list
"FIELD reference reuse" as a named, distinct provenance concept alongside
"RECORD reference occurrence" and "GetRecord reuse" — this looks like
exactly that undocumented-in-code case. Not yet confirmed via full
stored-byte enumeration (only inferred from the trace and source
inspection) — do that before implementing.

### Before implementing any of A/B/C

All three look like variations on "some accessor/method chain should
share a PSPCMNAME dependency row across repeated uses within some scope,
and the current encoder either reuses too broadly (global instead of
scoped, sub-puzzle A) or not at all (sub-puzzles B and C)." They may or
may not share a common underlying mechanism worth factoring — resist the
urge to build one generalized "reuse cache" for all of them without
distinct evidence for each, per the project's explicit warning against
collapsing distinct provenance kinds into a global cache. Fix them one at
a time, each validated independently against the 430-gate.

### definition_id 536 (ADDRESS_TYPE_VW.ADDRESS_TYPE.SaveEdit) — single-dot
### Row-variable shorthand into a Record-typed target, deferred pending a
### provenance-threading investigation

UNKNOWN_MISMATCH, `body diff @1105`, size delta +18 bytes (generated
longer than stored). Construct:

```
Local Row &Row_Addresses;
Local Record &Rec_Addresses;
...
&Rec_Addresses = &Row_Addresses.ADDRESSES;
```

Stored encodes `.ADDRESSES` as a RECORD PSPCMNAME reference (0x4A,
NAMENUM 9 = RECORD/ADDRESSES). The current encoder emits it as plain
inline text instead, because `rowStartsRecordFieldChain` (the mechanism
that puts a `Local Row &var;` variable's postfix chain into
`expectedReferenceMember = 'record'` mode) requires **two** dotted
identifiers to follow the Row variable (`&row.RECORD.FIELD`) — see its own
comment: "a Row variable enters reference-member mode only when the
source structurally has at least two dotted identifiers... This preserves
ordinary single-member Row properties." Definition 536's case has only
**one** dotted identifier (`.ADDRESSES`, chain ends at the `;`), so it
never enters record mode at all and falls through to the generic
inline-identifier fallback.

**Do NOT naively relax this to "any single dot, except a short exclusion
list of known Row state members (RowNumber/IsNew/IsDeleted/IsChanged/
Visible/Selected), is a RECORD reference."** This was the first fix
attempted and DISPROVEN by direct corpus evidence before it was ever
applied to the encoder (caught in evidence-gathering, not via a
regression-gate failure): a corpus-wide scan of every `Local Row`/
`Component Row` declared variable's single-dot terminal (non-chained,
non-method-call) member accesses across the full local snapshot turned up
164 real occurrences spanning 30+ definitions, the large majority of
which are genuine bare built-in Row/Rowset properties that must stay
plain inline text, not references — confirmed examples found directly in
corpus source: `ChildCount`, `RecordCount` (definition 1106,
`&msgrow.ChildCount` / `&msgrow.RecordCount`), `DeleteEnabled`
(definition 3691, `&susprow.DeleteEnabled`), `Style` (definition 2087).
None of these were previously in the encoder's short exclusion list, and
there is no reason to believe that list (or any list assembled by
guessing from memory) is complete — the real Row/Rowset built-in property
surface is larger than the six names the original two-dot heuristic was
calibrated to protect against.

**Missing evidence / the actual next step**: the real distinguishing
signal in definition 536's case is almost certainly *not* about the
member name at all, but about the enclosing statement's shape: `&Rec_
Addresses = &Row_Addresses.ADDRESSES;` assigns the single-dot result into
a variable already declared `Local Record &Rec_Addresses;`. A real
built-in Row property like `ChildCount` (Number) or `Style` (String)
could never be assigned into a Record-typed variable in valid PeopleCode,
so "RHS is `<RowVar>.<member>` (single dot, chain-terminal, not a method
call) AND the assignment's LHS target is a declared Record-typed
variable" is a plausible, narrow, safely-scoped signal — but implementing
it requires threading a hint from the assignment-statement parser (which
already knows its own LHS target and its declared type, per DEVELOPER.md's
documented "CreateRecord target-variable provenance" concept — find and
reuse that existing target-variable-tracking machinery rather than
inventing a parallel one) down into `primary()`'s postfix-chain parsing
for the RHS, which does not currently receive any such context. This is a
bigger, more invasive plumbing change than a single-definition fix
warrants without first confirming (a) how the existing CreateRecord
target-variable provenance mechanism threads its own context, to see if
it can be reused/extended rather than duplicated, and (b) whether there
are OTHER corpus examples of this same `<RecordVar> = <RowVar>.<single
member>;` shape to confirm the LHS-target-type signal generalizes (only
one example, definition 536, has been examined so far — do not implement
against a single data point without at least attempting to find a second
confirming or disconfirming example first, per the evidence rule).

Not marked locally blocked (evidence-gathering is incomplete, not
exhausted) — parked for a dedicated investigation session. Skipped in
favor of continuing to the next actionable failure, per CLAUDE.md's
completion-behavior rule ("a blocker affecting one definition is not a
project-level blocker").

## Protected baseline
- definitions: 430
- exact: 430
- regressions: 0
- last verified: 2026-09-25 (/goal resume session), after Fixes #95-#96
  (colon-qualified package constants and `%metadata` root opcode),
  REGRESSION GATE: PASS (430/430, no regression). Full corpus run_id 1657
  directly diffed against run_id 1638: 1 newly exact, 6 advanced, 0
  regressed. Full-project `npm run typecheck` and `npm test` (486 tests,
  485 pass, 1 intentional skip) both clean.
- prior verification: 2026-09-25 (/goal resume session), after Fix #94
  (explicit `Record.REC`-rooted method-call statements), REGRESSION GATE:
  PASS (430/430, no regression). Full corpus run_id 1638 directly diffed
  against run_id 1628: 1 newly exact, 3 advanced, 0 regressed.
  Full-project `npm run typecheck` and `npm test` (484 tests, 483 pass,
  1 intentional skip) both clean.
- prior verification: 2026-09-25 (/goal resume session), after Fix #93
  (`REM` disabled-condition tails between an If condition and Then),
  REGRESSION GATE: PASS (430/430, no regression). Full corpus run_id 1628
  directly diffed against run_id 1622: 2 newly exact, 0 regressed.
  Full-project `npm run typecheck` and `npm test` (483 tests, 482 pass,
  1 intentional skip) both clean.
- prior verification: 2026-09-25 (/goal resume session), after Fix #92
  (ordinary Component declarations preserve an evidenced trailing comma),
  REGRESSION GATE: PASS (430/430, no regression). Full corpus run_id 1622
  directly diffed against run_id 1597: 2 newly exact, 2 advanced, 0
  regressed. Full-project `npm run typecheck` and `npm test` (482 tests,
  481 pass, 1 intentional skip) both clean.
- prior verification: 2026-09-25 (/goal resume session), after Fix #91
  (explicit Record.REC.FIELD.Value chain's FIELD half now reusable by
  name across a different root record via the shared `declaredRecordFields`
  pool), REGRESSION GATE: PASS (430/430, no regression). Full corpus
  run_id 1597 also directly diffed against run_id 1587 at the
  per-definition `classification` level: 1 newly exact, 0 regressed,
  30208 unchanged. Full-project `npx tsc -p . --noEmit` and `npm test`
  (481 tests, 480 pass, 1 pre-existing skip) both clean.
- prior verification: 2026-09-25 (/goal resume session), after Fix #90
  (quoted 0x48 reference dedup scoped by control group, not global),
  REGRESSION GATE: PASS (430/430, no regression) -- re-verified again
  after the mid-session git-incident recovery (rebase/stash-pop conflict
  resolution, commit `3b2597c`) and again after restoring this progress
  file itself, both times clean. Full corpus run_id 1587 also directly
  diffed against run_id 1578 (the merge-conflict-resolution commit's own
  full run) at the per-definition `classification` level: 14 newly exact,
  0 regressed. Full-project `npx tsc -p . --noEmit` and `npm test` (480
  tests, 479 pass, 1 pre-existing skip) both clean.
- prior verification: 2026-09-25 (/goal resume session), after Fix #89
  (RowScrollSelect-family single-occurrence fallback extended to also
  cover a REPEATED name when `controlDepth > 0`, resolving the definition
  889/1007/1749 `controlDepth` discriminator), REGRESSION GATE: PASS
  (430/430, no regression). Full corpus run_id 1545 also directly diffed
  against run_id 1526 (the last known-clean full run before Fix #89) at
  the per-definition `classification` level: 66 newly exact, 0 regressed,
  30143 unchanged -- by far the largest single improvement this session.
  Full-project `npx tsc -p . --noEmit` and `npm test` (477 tests, 476
  pass, 1 pre-existing skip) both clean.
- prior verification: 2026-09-25 (/goal resume session), after Fix #88
  (definitions 907/908, `parseFunctionMetadata` now masks block comments
  and string literals before scanning for `Function NAME` headers, so a
  commented-out Function no longer inflates the program's function-
  directory count), REGRESSION GATE: PASS (430/430, no regression). Full
  corpus run_id 1526 also directly diffed against run_id 1521 (the last
  known-clean full run before Fix #88) at the per-definition
  `classification` level: 11 newly exact, 0 regressed, 30198 unchanged.
  Full-project `npx tsc -p . --noEmit` and `npm test` (476 tests, 475
  pass, 1 pre-existing skip) both clean.
- prior verification: 2026-09-25 (/goal resume session), after Fix #87
  (definition 982, `Record.X.IsChanged`-style inline Row state/property
  members no longer misrouted through the explicit `Record.REC.FIELD`
  chain detector), REGRESSION GATE: PASS (430/430, no regression). Full
  corpus run_id 1521 also directly diffed against run_id 1509 (the last
  known-clean full run before Fix #87) at the per-definition
  `classification` level: 21 newly exact, 0 regressed, 30188 unchanged.
  Full-project `npx tsc -p . --noEmit` and `npm test` (475 tests, 474
  pass, 1 pre-existing skip) both clean.
- prior verification: 2026-09-25 (/goal resume session), after Fix #86
  (definition 843, RowScrollSelect-family single-occurrence reuse fallback
  now correctly scoped by `genericRecordReferencesSinceLastFamilyCall`
  instead of the shared `recordReferencesByControlGroup` pool -- see Fix
  #86's own notes for its two-round, twice-caught-and-repaired isolation
  trail), REGRESSION GATE: PASS (430/430, no regression). Full corpus
  run_id 1509 also directly diffed against run_id 1457 (the last
  known-clean full run before Fix #86 began) at the per-definition
  `classification` level: 1 newly exact (843), 0 regressed, 30208
  unchanged. NOTE: two INTERMEDIATE full runs during Fix #86's own
  development (1470, 1494) each showed a real regression outside the
  430-window (definitions 860 and 5687 respectively) -- both caught by
  this same full-corpus-diff discipline, root-caused, and repaired before
  landing; neither regression ever reached a committed state. Full-project
  `npx tsc -p . --noEmit` and `npm test` (474 tests, 473 pass, 1
  pre-existing skip) both clean.
- prior verification: 2026-09-25 (/goal resume session), after Fix #85
  (definition 528, leading-Local declaration-section `0x2D` boundary no
  longer suppressed by an unrelated later initialized top-level Local),
  REGRESSION GATE: PASS (430/430, no regression, first attempt). Full
  corpus run_id 1457 also directly diffed against run_id 1446 at the
  per-definition `classification` level (not just the 430-window): 15
  newly exact, 0 regressed, 30194 unchanged (`corpus-results.sqlite`
  `result` table). Full-project `npx tsc -p . --noEmit` and `npm test`
  (471 tests, 470 pass, 1 pre-existing skip) both clean on HEAD `e9ccca2`.
- prior verification: 2026-09-24 (/goal resume session, continued), after fix
  #47 (definition_ids 30/95, ScrollSelect cross-call participating fix),
  REGRESSION GATE: PASS (430/430, no regression). Fix #47 itself was a
  repair of a regression fix #42 introduced (caught by this same gate on
  its own prior run: FAIL, 30/95 EXACT -> UNKNOWN_MISMATCH) — see fix #47's
  own notes for the full isolation trace. Fix #43 similarly repaired a
  regression (definition_id 840) that fix #40 introduced, but 840 is
  OUTSIDE this --limit 430 window, so the gate itself never caught it —
  caught instead by deliberately re-testing every definition a
  shared-helper change could plausibly touch, not just the new target;
  worth remembering that --limit 430 is a necessary but not sufficient
  check for shared-helper changes with broad blast radius. Fixes #39, #41,
  and the fully-repaired #40/#42/#44/#45/#46/#47 combination all
  independently confirmed 430/430 after landing. `npx tsc -p .` and
  `npm test` (456 pass / 1 pre-existing skip) both clean after fixes
  #39-47.
- prior verification: 2026-09-24 (/goal resume session), after fix #38
  (definition 1152, DoModalPanelGroup added to the shared control-group
  Record.X reuse trigger list), REGRESSION GATE: PASS (430/430, no
  regression, first attempt). Fix #27 (definition 840) caused a transient
  FAIL (429/430, definition_id 27) on its FIRST attempt, root-caused and
  repaired via a more precise rule (not a revert) within the same step —
  see fix #27's own notes for the full isolation trace. Fix #23
  (definition 535) similarly caused one transient FAIL (429/430,
  definition_id 180) on its own first attempt, also repaired within the
  same step. Fixes #24, #25, #26, #28, #29, #30, #31, #32, #33, #34, #35,
  #36, #37, #38 all passed 430/430 on their first attempt. Also
  re-verified once at session start (before any new edits) to confirm
  baseline health — clean (430/430). `npx tsc -p .` and `npm test` (456
  pass / 1 pre-existing skip) both clean after fixes #23-#38.
- prior verification: 2026-09-24 (crash-resumed session), after fix #22
  (definition 534, RecordDeleted/RecordChanged reuse + REM blank-line
  multiplicity), REGRESSION GATE: PASS. Verified after every one of the
  22 fixes across both earlier sessions that day, 430/430 in every case
  except one transient FAIL (429/430) during fix #16's first attempt,
  root-caused and repaired within the same step — see fix #16's own
  notes. Fix #20 also caused one transient unit-test regression (caught
  by `npm test`, not the 430-gate) — see fix #20's own notes.

## Locally blocked
- **definition_id 871** (AE_WRK.AE_GO.FieldChange, 36181 bytes / 84 names,
  the largest and most complex definition touched this session): advanced
  enormously (fixes #18-19 moved the first diff from byte offset 1811 all
  the way to 19779, more than halfway through the file) but NOT fully
  EXACT. Remaining issue at @19779: reference index stored=0x3a(58) vs
  generated=6 -- a huge 52-index gap, far larger than any other diff this
  session, meaning either a large chunk of allocations differs
  structurally from this point on, or (more likely, given the file's
  size) there is at least one more distinct, not-yet-understood bug
  further complicating the picture, possibly compounding with the
  Function-body control-group rules from fixes #18-19 in a way not yet
  isolated. This file has MANY functions (clear_scroll, adjust_row_num,
  man_stmt, and others not yet examined) each with their own record/scroll
  manipulation patterns -- the three explored so far (documented in fixes
  #18-19) already needed real, distinct evidence-gathering each; do not
  assume the remaining ones follow the same rules without checking. Next
  step when resumed: identify the exact construct at byte offset 19779
  (search stored bytes for identifiable text near there, e.g. via the
  `dumpTextWindow` scratch-script technique used this session) and repeat
  the stored-PSPCMNAME-enumeration methodology. Given the file's size and
  the number of distinct micro-patterns already found, budget real time
  for this — it is not a quick fix.
- **definition_id 3235** (CO_STATETAX_TBL.EFFDT.FieldChange): partially
  advanced this session (fix #15 fixed a real, generalizable bug — missing
  blank-line-before-End-While handling — moving the first diff from @2166
  to @8240), but has a SECOND, distinct, deeper issue starting at @8240
  that is NOT locally blocked in the "evidence exhausted" sense — only
  parked because it needs a dedicated investigation session with the
  stored-byte enumeration technique, not because it's unsolvable. Construct:
  a `.getrow(N).RECORD.FIELD.VALUE` chain (lowercase `getrow`) on a
  Rowset-typed Local variable (`&tmprowset`/`&Level2_Rowset`), repeated
  MANY times throughout this unusually large (18569-char source, 21339-byte
  stored program) definition with the exact same
  `PY_PFF_OTTX_DTL.PY_PFF_PROGID`/similar RECORD.FIELD pair. At the first
  new diff, stored encodes one such occurrence as a bare INLINE TEXT member
  name (0x0A opcode, no PSPCMNAME reference at all), while the current
  encoder allocates it as a full RECORD+FIELD reference pair (two 0x4A
  operands) — i.e. stored does NOT treat this particular occurrence as a
  PSPCMNAME-backed reference, contradicting the encoder's current
  `expectedReferenceMember`/`rowStartsRecordFieldChain` heuristics for
  `.getrow(...).RECORD.FIELD` chains. Total stored-vs-generated size gap is
  large (~4069 bytes even after fix #15), meaning either this exact pattern
  recurs many times in this file, or there is at least one more distinct
  issue further into the file not yet reached. Missing evidence: has not
  yet done the full stored-byte 0x4A-enumeration cross-referenced against
  `--trace-refs` (the technique that successfully resolved sub-puzzle A) to
  determine the precise rule distinguishing which `.getrow(...).RECORD.FIELD`
  occurrences get a real PSPCMNAME reference vs. inline text. Next step
  when resumed: dump the full stored PSPCMPROG bytes for definition 3235,
  enumerate every 0x4A occurrence in source order, and cross-reference
  against every `.getrow(...).RECORD.FIELD` occurrence in the 18.5KB source
  (there appear to be a dozen-plus) to find the actual distinguishing rule
  (candidate hypotheses, unconfirmed: distinguishes by which Rowset
  variable is the receiver, e.g. `&tmprowset` vs `&Level2_Rowset`; or by
  whether this exact RECORD.FIELD pair was already referenced earlier via a
  DIFFERENT receiver variable in the same control group; or something else
  entirely — do not guess, enumerate first).
- **New corroborating evidence found this continued session** (definitions
  1360 and 1422, both deferred, NOT fixed): the SAME "sometimes a
  `.RECORD.FIELD`-shaped postfix access is inline text, sometimes it's a
  real PSPCMNAME reference" symptom as 3235 above, in a much smaller/more
  tractable shape -- worth trying FIRST when this puzzle family is picked
  back up, before returning to 3235's 18.5KB file.
  - **definition_id 1360** (AUDIT_TLRPTTIME.AUDIT_ACTN.RowInit, tiny --
    506-byte stored program): `&_crsXST2(&i).PSXLATITEM.FIELDVALUE.Value`
    (a Rowset variable, index-called to get a Row, then `.RECORD.FIELD`).
    Stored allocates a FRESH, SEPARATE RECORD.PSXLATITEM reference for this
    `.PSXLATITEM` access (PSPCMNAME row 4) distinct from the one
    `CreateRowset(Record.PSXLATITEM)` itself established (row 3) two
    statements earlier; the encoder currently reuses row 3 instead
    (wrong). Likely the SAME underlying gap as the already-deferred
    definition 536 puzzle ("single-dot Row-shorthand RECORD access needs
    target-variable-type provenance not currently threaded into the
    postfix parser") -- 536's own broad-fix attempt was already
    corpus-disproven (164 counter-examples), so do not retry that same fix
    shape here without fresh enumeration.
  - **definition_id 1422** (BANKACCT_SBR.INTL_BANK_ACCT_NBR.FieldChange,
    tiny -- 266-byte stored program): `&Der_Parent.GetRecord(Record.
    DERIVED_IBAN).GP_IBAN_VALIDATED.Value = "N";` -- stored encodes
    `GP_IBAN_VALIDATED` as bare INLINE TEXT (0x0A), NOT a PSPCMNAME FIELD
    reference; the encoder currently allocates a FIELD reference for it
    (wrong.) This is the EXACT same symptom 3235's own writeup describes
    for `.getrow(...).RECORD.FIELD` chains, just via `.GetRecord(...)`
    instead of `.getrow(...)`. Plausible (unconfirmed) explanation worth
    checking first: PeopleTools may render a `.FIELD` access as inline
    text specifically when that field name does NOT actually validate
    against the named record's real schema (i.e. a compile-time field
    lookup failure falls back to literal text) -- this would explain the
    "sometimes text, sometimes reference" pattern without any new
    syntactic rule, but would require checking the real DERIVED_IBAN/
    PY_PFF_OTTX_DTL record definitions' actual field lists, which may or
    may not be available in the local snapshot. Do not implement a
    positional/heuristic rule without checking this first.

## Next action
- **Current session (2026-09-25, /goal resume), immediate next step**: Fix
  #91 landed and verified (430/430, full run 1597, 0 regressed against
  1587) -- see "Locally blocked / deferred" and Checkpoint above for the
  mid-session git-incident recovery (fully resolved; code fixed in commit
  `3b2597c`, this file restored from commit `be8a8e4`). A SUBSEQUENT
  triage round (still this session) checked six more candidates (1423,
  1424, 1454 -- already deferred --, 1521, 1721, 1722) and found FOUR
  more genuinely deferred items, landing no new fix this round: 1521 (a
  THIRD FetchValue-own-argument contradiction, this time disproving the
  ALREADY-CALIBRATED "FetchValue Scroll.X reuse" comment directly --
  strongly suggests the WHOLE FetchValue-own-argument-reuse mechanism,
  both Record.X and Scroll.X sides, may be systemically over-broad and
  needs a dedicated multi-example session, not another guess), 1423/1424
  (a postfix `.GetRecord(...)` method call on a Row/Rowset VARIABLE may
  not get the bare-primary-call's field-mode treatment), and 1721/1722 (a
  postfix `.GetRow(...)` on an UNDECLARED/untyped variable may not get
  the row-shorthand RECORD.FIELD.Value treatment). Full trails for all
  four are under "Identified, not yet fixed" below. Resume triage from
  `npm run corpus:next`, which currently surfaces the `UNKNOWN_MISMATCH`/
  `(none)` catch-all (no single construct signature -- representatives
  must be pulled and diagnosed individually, e.g. definitions 528, 843,
  982, 908, 889, 805, and 437's families fixed this session). No
  definition is currently mid-investigation. Skip definition_id 536
  (still recommended by `corpus:next` due to its own documented
  offset-ordering caveat below), definition_id 1749 (STILL deferred --
  Fix #89 resolved its first issue but a second, deeper one remains),
  definition_id 1305 (a bare RECORD.FIELD-resolves-to-owner bug,
  unrelated to the FetchValue hypothesis that was tried and reverted for
  it), definition_id 1454, definition_id 1521 (both FetchValue-reuse
  family, see above), definition_id 1423/1424 (postfix GetRecord
  field-mode), and definition_id 1721/1722 (postfix GetRow row-shorthand)
  when triaging; see "Identified, not yet fixed" for the full trail on
  each. All other locally-blocked/deferred entries listed below
  (older sessions) remain unchanged; none were revisited this session.
  Process note worth repeating for future RowScrollSelect/ScrollSelect/
  ScrollFlush-adjacent changes specifically: this whole area has a history
  (fixes #38-#47 in an earlier session, now Fix #86 in this one) of
  narrow-looking rules that a full-corpus diff catches breaking a sibling
  definition outside the 430-window. Always run the FULL local corpus
  (`npm run corpus:harness`, no `--limit`) after any change here, not just
  `corpus:verify --limit 430`, before considering the fix landed.
- **Continued session, immediate next step**: use the SQL workaround below
  with `r.offset > 1643` (the last definition_id touched this continued
  session) to get the next batch of fresh UNKNOWN_MISMATCH candidates.
  `corpus:next` itself will keep re-suggesting definition 536 (still
  deferred, see "Identified, not yet fixed") until it gains
  deferred-definition awareness. No definition is currently
  mid-investigation. Locally-blocked/deferred list, updated this session:
  871, 3235 (locally blocked, deep individual puzzles), 536, 1406, 1285,
  1360, 1422 (deferred, need dedicated investigation sessions -- 1285's
  own writeup is under "Identified, not yet fixed" above the sub-puzzle
  list; 1360/1422 are filed as corroborating evidence for 3235's own
  puzzle, directly above this note).
- **`npm run corpus:next` caveat discovered this session**: it always
  selects the LOWEST-OFFSET representative of the highest-priority family
  (an `ORDER BY offset ASC LIMIT 1` query in `tools/corpus/inventory.ts`),
  with no memory of a prior session's decision to defer/park a specific
  definition. Once definition 536 was deferred, `corpus:next` kept
  re-recommending it every time. Workaround used this session: query
  `tools/corpus/corpus-results.sqlite` directly for the latest
  classification per definition_id at a higher offset in the same family,
  e.g.:
  ```sql
  SELECT r.definition_id, r.offset, d.display_name
  FROM result r JOIN definition d ON d.definition_id = r.definition_id
  WHERE r.run_id = (SELECT MAX(run_id) FROM result r2 WHERE r2.definition_id = r.definition_id)
    AND r.classification = 'UNKNOWN_MISMATCH' AND r.offset > <last-tried-offset>
  ORDER BY r.offset ASC LIMIT 15;
  ```
  then target one of the returned `definition_id`s directly with
  `--definition-id`. Keep using this pattern until/unless `corpus:next`
  gains a way to skip a deferred definition.
- Immediate next step: continue past definitions 634, 772, 808, 840, 921,
  924, 935, 937, 942, 945, 1046, 1128, 1145, and 1152 (all fixed
  encoder-side), plus fix #34's decoder-side resolution of 17+
  definitions (940, 953, 954, 958, 963, 964, 966, 1061, 1062, 1081,
  1083-1097), and side-effect resolutions 842/923/936/949/946. 536
  remains deferred (encoder, needs a target-variable-type-provenance
  investigation); 1406 remains deferred (decoder, a genuinely separate
  rendering gap from what fix #34 fixed); 1066 deprioritized
  (large/complex, 66KB+, not locally blocked, just lower priority than
  smaller targets). Pick the next `UNKNOWN_MISMATCH`-family definition
  past offset ~1152 via the query above (or a fresh `corpus:next` call if
  536 happens to no longer be the lowest-offset one left in the family —
  worth a quick check first) and continue the
  mandatory workflow — `--verbose --trace-refs`, classify, narrow fix
  (encoder.ts for provenance/opcode issues, decoder.ts if
  `source→bin`/`roundtrip` are already EXACT and only `decode` or a
  decoder-driven roundtrip mismatch remains), target EXACT, `--limit 430`
  gate, `tsc`/`npm test`, repeat. When a definition turns out to share a
  source file with several already-resolved neighbors (a common pattern
  this session — AMM_* files especially, thanks to fix #34's reach),
  batch-check a run of nearby offsets quickly (a short shell loop over
  `corpus:harness --definition-id`) rather than investigating each one
  individually, and jump to a different source file once a cluster is
  confirmed resolved. Also worth watching for: sibling/renamed function
  names sharing an already-fixed reuse rule (RowScrollSelect ->
  RowScrollSelectNew this session) — check for `...New`, `...2`, or
  similarly-named variants of any already-fixed bare-call trigger name
  when a fresh failure's symptom shape matches a prior fix exactly. No
  definition is currently mid-investigation. Definitions 3235 and 871
  (see "Locally blocked") remain available to revisit if a session
  specifically wants to continue their existing investigation threads
  instead of taking a fresh pick.
- Fixes #23-38 are all generic (not single-definition-scoped, fix #38
  simply added DoModalPanelGroup to the same list fix #36 touched): fix
  #23's
  `fieldReferencesByControlGroup` fallback and
  `bareGetRecordCallResult`/`fieldMemberFromGetRecord` mechanism, fix
  #24's `sawLeadingComment` Function-body marker fix, fix #25's ApiObject
  opcode/dependency-row support and HideScroll/UnhideScroll SCROLL.X
  reuse rule, fix #26's CreateRowset addition to the Record.X reuse list,
  fix #27's `participatingRecordReferencesByControlGroup` mechanism for
  RowScrollSelect, fix #28's PACKAGE/ROW allocation for object-typed
  Function parameters, fix #29's `rowVariables`/`declaredRecordFields`
  bridge for the same parameters' own field chains, fix #30's
  leading-Local-run/comment transition reorder, Component XmlDoc PACKAGE
  dependency, and rem-statement `space()` fix, fix #31's `remComment()`
  merge-condition narrowing, fix #32's declaration-to-declaration
  blank-line multiplicity, fix #33's PanelGroup addition to that same
  trigger, fix #34's decoder-side `followsDeclaration` PanelGroup opcode
  fix, fix #35's Grid addition to fix #25's ApiObject-style
  opcode/dependency-row mechanism, fix #36's FetchValue addition to
  the Record.X control-group reuse trigger list, and fix #37's
  RowScrollSelectNew addition to fix #27's same-call reuse trigger.
  Three `corpus:failures --summary`
  re-scans this session (after fix #28, after fix #31, after fix #34)
  each showed EXACT count moving by exactly the number of definitions
  fixed/resolved since the prior scan, with no unexpected ripple any time
  (see fix #28's and fix #34's own notes). A random 40-definition sample
  after fix #34 also
  found zero unexpected additional resolutions, further confirming
  containment. Not yet re-measured after fixes #32/#33 specifically
  (folded into the #34 re-scan's cumulative count).
- The one backgrounded `npm run corpus:work` run from the first session was
  killed by its own 1800s timeout (exit 143) partway through — expected, it
  was stale (reflecting only fix #1) and a full 9574-item Oracle
  failed-queue scan takes much longer than 30 minutes against this
  instance. All 22 fixes across both sessions were instead validated with
  targeted per-definition runs plus `corpus:verify --limit 430`, which is
  faster and sufficient for day-to-day calibration. Don't bother
  re-launching a full `--failed` scan unless specifically wanted (e.g. to
  get a precise updated EXACT/non-EXACT count) — expect it to take
  considerably longer than 30 minutes and plan the session/background time
  accordingly.
- EXACT count moved from 20635 (first session start) to at least 20656
  confirmed so far (many more likely from the broader-than-single-target
  impact of fixes #2, #3, #6, #8, #10 and #11-22's shared-helper changes —
  none of that broader impact has been exhaustively measured, only
  spot-checked). Fixes #18-19 (Function-body control-group scoping) in
  particular touch every Function body in the corpus and were previously
  entirely uncalibrated for this scoping question -- worth a
  `corpus:failures --summary` re-scan sometime soon to see how much this
  alone moved the needle corpus-wide.
- A reusable scratch-script methodology was established this session for
  the stored-byte enumeration technique: `discovery.ts`'s
  `getConnectionConfig`/`openCorpusConnection`/`captureDefinition` can be
  imported directly by an ad hoc `tsx` script (absolute file:// style
  import path works fine) to fetch a definition's real PSPCMNAME rows and
  PSPCMPROG bytes directly, then enumerate every 0x21/0x4A operand
  occurrence in byte order and cross-reference against NAMENUM -- this is
  faster and more reliable than inferring intent purely from `--trace-refs`
  (which only reflects the CURRENT, possibly-still-buggy encoder's own
  choices, not ground truth). This is exactly what resolved sub-puzzle C
  (fix #20) cleanly on the first correct hypothesis. Reuse this pattern for
  definition 871's remaining puzzle and definition 3235's remaining puzzle.
- All three of the original sub-puzzles A/B/C from earlier sessions are now
  RESOLVED (fixes #11-13, #17, #20 respectively). Fix #21 (definition 528)
  came from a fresh `npm run corpus:next` pick, not a named sub-puzzle --
  that pattern (pick via corpus:next, trace, stored-enumerate if needed,
  fix, validate) is now the default mode for the rest of this queue. The
  two remaining KNOWN actionable items are both large, complex, single
  definitions (871, 3235) each with their own NOT-yet-understood remaining
  issue, not a named sub-puzzle family — see "Locally blocked" above for
  both. There is no known family of OTHER failing definitions sharing
  either one's specific remaining root cause (unlike sub-puzzles A/B/C,
  which each affected multiple definitions).
- Immediate next step: run `npm run corpus:next` again for a fresh
  representative (fix #21's own family may have more un-triaged members
  now that its root cause is fixed -- re-run `corpus:next`/
  `corpus:failures` to see what moved). Definition 871's remaining
  post-@19779 issue and definition 3235's remaining
  `.getrow(...).RECORD.FIELD` puzzle are both still available whenever a
  session has the time budget for their deeper stored-byte-enumeration
  investigations, but neither blocks picking up fresh, more tractable
  targets in the meantime.
- Continue via `npm run corpus:next` for further representatives, or work
  through remaining known families directly:
  - `UNSUPPORTED_SYNTAX / import` (263 defs): these are NOT ordinary
    record/component event PeopleCode — they're full Application Class
    program definitions (package OnExecute programs, `class X method
    Y(...); ... end-class;` bodies). `parseApplicationClassProgram()` in
    encoder.ts (~line 6047, may have shifted slightly after this
    session's edits) only supports a single hand-calibrated
    single-class/single-method shape and throws 'unsupported Application
    Class import' / 'unsupported Application Class declaration' for
    anything else. This is a much larger, structurally separate feature
    (multi-method classes, extends, properties, private/public sections)
    that would need its own multi-session investigation, not a narrow
    fix. Flagging for awareness, not started.
  - **RESOLVED this session, see fix #34**: the "extra blank line"
    decoder bug originally noted for definitions 964 and 1406 (under
    fixes #7 and #10), and independently re-confirmed for 940 and 953
    while sampling this session, turned out to be a single narrow root
    cause -- `PanelGroup`'s declaration opcode (0x51) was missing from
    decoder.ts's `followsDeclaration` detection list. Fixed; 940, 953,
    954, and 964 are all now EXACT. Definition 1406 was RE-CHECKED and
    confirmed to have a SEPARATE, still-open decoder issue (its own
    `source→bin`/`roundtrip` were already EXACT before and after this
    fix; its remaining classification is `DECODE_SOURCE_MISMATCH`, a
    cosmetic source-rendering gap per DEVELOPER.md tier 3, not the same
    extra-blank-line bug) -- worth its own future investigation, but
    distinct from what fix #34 addressed.
  - Remaining un-investigated failure families as of this session's last
    `corpus:failures --summary` snapshot (counts will have shifted from
    this session's fixes, re-run to get current numbers):
    UNKNOWN_MISMATCH/(none) ~5613, DECODE_SOURCE_MISMATCH/(none) ~512,
    ENCODE_ERROR/End ~133, ENCODE_ERROR/BLOCK_COMMENT ~80 (partially
    worked this session, `expected When/When-Other/End-Evaluate` shape
    fixed; other BLOCK_COMMENT error shapes like `expected )` inside
    expressions were also fixed via the And/Or-group comment fix, re-scan
    to see what's left), ENCODE_ERROR/(1).GetRowset(Sc ~69 (partially
    worked, see fix #8), DECODE_SOURCE_MISMATCH/";\nEnd-Evaluate" ~37,
    UNSUPPORTED_SYNTAX/UNKNOWN ~37, ENCODE_ERROR/UNKNOWN ~34,
    ENCODE_ERROR/rem ~32 (partially worked, see fix #10).

## Newly established rules (this session)
1. Application Class Local declaration section boundary (0x2D) closes
   before an immediately-following standalone block comment, using the
   same blank-line-boundary mechanism as the ordinary top-level
   declaration section close. (encoder.ts, cites definition 513.)
2. The final statement in a `For` loop body may omit its trailing source
   semicolon when immediately followed by `End-For`, regardless of
   whether that statement is a simple call or a compound block (If/etc).
   (encoder.ts forStatement(), cites definitions 2406 and 1269.)
3. A bare top-level declared-function call statement (`Identifier(...)`,
   not preceded by any reserved keyword) may omit its trailing source
   semicolon at EOF, alongside the existing assignment/If/Evaluate EOF
   cases. (encoder.ts, `isTopLevelCallStatement`, cites definition 4066
   and 9 other confirmed EOF-exact "expected ;" failures.)
4. Blank-line markers (0x4F) after an `Evaluate`/`When` clause header,
   before its first body statement, follow the same
   `max(1, newlines-1)` multiplicity rule as every other calibrated
   blank-line boundary in the file — it was previously hardcoded to at
   most one marker. (encoder.ts evaluateStatement(), cites definition
   518.)
5. Blank-line markers (0x4F) inside a `try` body, including right after
   the `try` header before the first body item, follow the same
   multiplicity rule the catch-before boundary already had — previously
   there was no marker handling at all for the try-body-item boundary.
   Same fix applied symmetrically inside the `catch` body (including
   right after the catch header, before the first catch-body item /
   before `end-try`) — that one additionally required moving where the
   header's trailing whitespace is captured, since an earlier
   unconditional `space()` call (for the optional catch-header semicolon)
   was silently consuming the blank line before the catch-body loop's own
   tracking could see it. (encoder.ts tryStatement(), cites definition
   521.)
6. A standalone block comment may appear between an `Evaluate <selector>`
   header and its first `When` clause, encoded the same direct 0x24 way
   REM comments in that position already were (a case that existed in
   code but had no block-comment equivalent). (encoder.ts
   evaluateStatement(), cites definitions 858 and 854.)
7. An inline block comment may follow the last operand of an And-group or
   Or-group (inside a parenthesized boolean expression), immediately
   before that group's closing 0x42 marker — encoded the same 0x4E
   same-line-comment way as other inline trailing comments. Fixed
   symmetrically in both `andExpression()` and `booleanExpression()`
   (only the Or-group shape was directly evidenced; And-group has the
   identical code shape and is presumably subject to the same rule). Also
   added a same-shape fallback in the shared `parenthesized()` helper for
   a comment directly before a simple (non-And/Or) closing `)`. (cites
   definition 1406, which reached source→bin EXACT / roundtrip EXACT;
   remaining non-EXACT classification is an unrelated pre-existing
   decoder formatting gap.)
8. A bare top-level call statement may itself be the head of a further
   postfix chain — index/method-call on the call's own result, e.g.
   `GetLevel0()(1).GetRowset(Scroll.X).Flush();` — not just a standalone
   `Name(args);`. The top-level statement dispatcher's fallback branch for
   bareword-identifier statements was calling the chain-incapable `call()`
   helper directly instead of the full postfix-chain-capable `primary()`
   (which already calls `call()` internally for the plain case, so no
   behavior change there). Required updating
   `src/test/encoderCalls.test.ts`: two entries (`'F()(1);'`,
   `'F().Value;'`) in its generic "malformed/unsupported call syntax
   fails" list were correct when written but are no longer malformed: they
   were removed from that list and given their own positive
   `doesNotThrow` coverage. (cites definition 984 and the wider
   `(1).GetRowset(Sc...` family, 70 definitions at pickup.)
9. A top-level `try ... catch ... end-try` block may terminate directly at
   EOF with no trailing semicolon after `end-try`, joining the existing
   assignment/If/Evaluate/bare-call EOF-omission cases. (encoder.ts,
   `isTryStatement` in the `selfTerminatingAtEof` classification, cites
   definition 524.)
10. Immediately consecutive `REM` lines (no blank line between them)
    compile as one single 0x24 comment record, embedded line break
    included, not as separate records — proved by exact UTF-16LE
    byte-length arithmetic (116 + 2 + rest == 416, matching the stored
    record's length field exactly). Also: the top-level REM handler was
    the only one of `remComment()`'s ten call sites still requiring a
    trailing `;`; made consistent with the other nine
    (`allowMissingSemicolon = true`). (encoder.ts remComment(), cites
    definition 964.)

## Newly established rules (resumed session, 2026-09-24)

11. `UpdateValue` and `InsertRow`'s own `Record.X` argument share the same
    control-group-scoped reuse rule already calibrated for
    `GetRecord`/`DeleteRow`/`ActiveRowCount` (fix #8's session): added to
    the `reuseRecordReferenceWithinControlGroup`-enabling function-name
    regex in the bare-call argument parser. (encoder.ts, cites definition
    1269.)
12. **Structural fix, broad blast radius**: a top-level control-structure
    block (`For`/`If`/`Evaluate`, anything routed through
    `inControlGroup()` at `controlDepth === 0`) is bounded on *both* sides,
    not just on entry. Previously, closing a top-level block restored
    `controlGroup` to whatever it was *before* the block started, so a
    plain top-level statement following the block (or even a second
    top-level control block) could still reuse same-name RECORD/SCROLL
    rows allocated *before* the intervening block — wrong. Now, exiting a
    top-level block assigns a **fresh** control group
    (`nextControlGroup++`) for whatever comes next at top level, exactly
    mirroring the fresh-group assignment already done on entry. Nested
    (already-depth>0) blocks are unaffected — they still restore to their
    enclosing group as before. (encoder.ts `inControlGroup()`, cites
    definition 1269: a top-level `ActiveRowCount(Record.ARCH_TBL, ...)`
    call after a closed `For...End-For` block does not reuse an
    identically-named `Record.ARCH_TBL` row allocated before that block.)
13. `Scroll.X` arguments to `ActiveRowCount`/`UpdateValue`/`Gray`/`UnGray`
    get the same control-group-scoped reuse rule as `Record.X` arguments
    (fix #11 above), via the previously-unused-outside-`.GetRowset(...)`
    `reuseScrollReferenceWithinControlGroup` flag, now also set inside the
    general bare-call argument parser for those four function names.
    Required adding save/restore of this flag alongside the existing
    Record-reuse flags (calls may nest). (encoder.ts, `scrollReference()`
    / bare-call argument parser, cites definition 3586: a `For` loop
    headed by `ActiveRowCount(Scroll.DEDUCTION_TBL, ..., Scroll.
    DEDUCTION_CLASS)` whose body's `UpdateValue`/`Gray` calls all reuse the
    header's SCROLL rows.)
14. `Component Rowset &var;` declarations allocate a PACKAGE/ROWSET
    local-object dependency row, exactly like `Local Rowset &var;`
    declarations already did -- this branch was entirely missing from
    `componentDeclaration()` (only `Record`-typed Component declarations
    had it). Scoped narrowly to `Rowset`; other built-in object types
    (`Row`/`SQL`/`File`/`XmlDoc`/`XmlNode`) as Component declarations are
    NOT yet evidenced to need the same fix. (encoder.ts
    `componentDeclaration()`, cites definition 4067.)
15. Blank-line markers (0x4F) immediately before `End-While` follow the
    same multiplicity rule every other body-closing keyword already has
    (End-If, End-For, End-Evaluate, end-try) — this was the one remaining
    body-closer with NO blank-line handling at all. (encoder.ts
    `whileStatement()`, cites definition 3235.)
16. In the leading top-level Local declaration run: (a) an initialized
    Local only ends the run if the Local declaration immediately following
    it (if any) is itself UNINITIALIZED — two adjacent initialized Locals
    stay in the same run and do not close early relative to each other.
    (b) Once ANY Local in the run had an initializer, the run's eventual
    close gets no 0x2D declaration-section byte, only the ordinary
    blank-line 0x4F marker(s), even in a reference-bearing program that
    would otherwise always pair 0x2D with 0x4F. (encoder.ts, the
    `if (lastLocalHadInitializer)` branch plus a new
    `leadingRunHasInitializedLocal` flag checked at the final insertion
    step, cites definition 3539 for both parts and protected-baseline
    definition 256 for the boundary of part (a) — two directly-adjacent
    initialized Locals must NOT defer past the first one.)
17. A Component-declared Application Class instance's method calls reuse
    its runtime-create PSPCMNAME dependency (no separate method-dependency
    row at all), the same declaration-phase rule `Local X:Y &var;`
    declarations already had. `componentDeclaration()` had this hardcoded
    off (`reuseRuntimeCreateForMethods: false`) for every Component
    Application Class declaration; since a Component declaration is always
    declaration-phase, the fix applies the exact same conditional the
    Local-declaration path already uses. (encoder.ts
    `componentDeclaration()`, cites definition 525 — resolves sub-puzzle
    B.)
18. `HideScroll`, `UnhideScroll`, `UnhideRow`, and `CopyFields` joined the
    Record.X control-group-scoped reuse-checking function list (alongside
    GetRecord/DeleteRow/ActiveRowCount/UpdateValue/InsertRow/
    SetCursorPos). Before this, these four names' own Record.X allocations
    bypassed the reuse check, each one silently overwriting the shared
    control-group cache entry (since it's populated unconditionally on
    every fresh allocation, not just reuse-checked ones) — breaking reuse
    for every reference that came after them too. (encoder.ts, cites
    definition 871.)
19. **New scoping axis**: each top-level statement inside a
    `Function ... End-Function;` body gets its own fresh control group,
    unlike the main program's top level (where flat sequential statements
    share one group by default, only bumping on specific triggers like
    `SetDefault` or a top-level `CreateRecord` assignment). Nested control
    structures within a function (If/For/etc, once entered via
    `inControlGroup()`) are unaffected — they keep the ordinary
    shared-group reuse behavior for their own body, identical to top-level
    program code. `functionDepth` was not previously reflected in
    control-group scoping at all. (encoder.ts `functionStatement()`'s own
    body loop, cites definition 871 two ways: `clear_scroll`'s seven flat
    statements each get their own row — zero reuse, even between five
    textually-identical consecutive `InsertRow` calls — while
    `man_stmt`'s `InsertRow`/assignment/`CopyFields` sequence shows each
    statement's own Record.X argument reused ONLY by nested calls within
    that same statement, never by a later sibling statement. Definition
    871 itself is not yet fully EXACT — see "Locally blocked".)
20. `Field.X` (via `fieldReference()`) gets a control-group-scoped reuse
    rule mirroring `recordReference()`'s own, but ONLY when reached through
    `.GetField(...)` immediately chained onto that same expression's own
    preceding `.GetRecord(...)` postfix step — not merely whenever
    `expectedReferenceMember === 'field'`, since that flag is ALSO true
    (for an unrelated reason) on the very first postfix step off a
    declared `Local Record &var;` variable, where `Field.X` remains
    occurrence-based (an existing, still-valid calibrated test). Tracked
    via a new `wasFirstPostfixStep` check: `.GetRecord(...)` can only ever
    be a preceding chain step, never a chain's own first postfix access,
    so `!wasFirstPostfixStep` cleanly distinguishes the two cases.
    (encoder.ts `fieldReference()` plus the postfix method-call handler's
    reuse-flag block, cites definition 524 — resolves sub-puzzle C.)
21. A standalone disabled-code marker (`<* ... *>`) in the leading
    top-level Local declaration run follows the exact same rule an
    ordinary block comment (`/* */`) already had there: it does NOT, by
    itself, terminate the run. Only close the run early when one had
    already started (`sawLeadingLocalDeclaration`) and no Local
    declaration immediately follows the marker. Previously this branch
    unconditionally set `leadingLocalRun = false`, which — when the
    marker appeared BEFORE any Local declaration at all — permanently
    prevented a Local declared right after it from ever being tracked by
    the mechanism, so the run's eventual 0x2D/0x4F close before the first
    true executable statement was never emitted. (encoder.ts, the
    top-level statement loop's `<*` branch, cites definition 528.)
22. (a) `RecordDeleted` and `RecordChanged` joined the Record.X
    control-group-scoped reuse-checking function list (same list as
    GetRecord/DeleteRow/ActiveRowCount/UpdateValue/InsertRow/
    SetCursorPos/HideScroll/UnhideScroll/UnhideRow/CopyFields).
    (b) Blank-line marker multiplicity before a `REM` comment inside an
    If body was hardcoded to exactly one 0x4F marker whenever any blank
    line was present, in BOTH the Then-body and Else-body loops of
    `ifStatement()` (the identical bug existed independently in each) —
    unlike every sibling boundary in the same loops (the `<*`/`/*`
    comment branches, and End-If/Else itself), which all correctly scale
    by `Math.max(1, newlineCount - 1)`. Fixed by applying the same
    formula in both branches. (encoder.ts, `ifStatement()`'s Record.X
    reuse-enabling regex and both REM branches, cites definition 534.)
