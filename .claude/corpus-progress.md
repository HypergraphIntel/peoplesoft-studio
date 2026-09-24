# Corpus Calibration Progress

## Current target
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

## Identified, not yet fixed (deferred, NOT locally blocked — evidence
## gathering is incomplete, not exhausted)

There are at least THREE distinct reference/provenance sub-puzzles
surfacing this session, all with the same *symptom* (byte-identical
program size, single reference-index operand differs) but apparently
different *root causes*. Do not assume a fix for one covers the others —
treat each as its own narrow investigation, per the evidence rule.

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

## Protected baseline
- definitions: 430
- exact: 430
- regressions: 0
- last verified: 2026-09-24 (resumed session), after fix #22 (definition
  534, RecordDeleted/RecordChanged reuse + REM blank-line multiplicity),
  REGRESSION GATE: PASS. Verified after every one of the 22 fixes across
  both sessions today, 430/430 in every case except one transient FAIL
  (429/430) during fix #16's first attempt, which was root-caused and
  repaired within the same step before moving on — see fix #16's own
  notes for the full isolation trace. Fix #20 also caused one transient
  unit-test regression (caught by `npm test`, not the 430-gate, before
  ever being considered final — see fix #20's own notes). Also
  re-verified once immediately at session resume (before any new edits)
  to confirm the crash left no corruption — clean.

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

## Next action
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
  - Decoder-side formatting bugs (definitions 1406 and 964, both noted
    above under fixes #7 and #10) — worth a dedicated decoder-focused
    session; out of scope for encoder work.
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
