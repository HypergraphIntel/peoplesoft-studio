# Controlled-compile lab

What a writable PeopleTools environment must provide to settle the
encoder's last cases that the source cannot distinguish, how to
provision it, and the exact experiments to run there.

- **Cycle 171** wrote the specification.
- **Cycle 172** inventoried what this workstation can provide and
  stopped before installation (Outcome B; see Decision below). It also
  turned the matrices into an executable experiment pack and added an
  ingest tool.
- **Cycle 175** obtained authorization, staged and verified the 8.61.15
  media, and proved the exact compiler runs headless under Wine. It
  replaced the human-per-save workflow with an unattended harness (see
  "Unattended harness"), and found the remaining blocker: no PeopleSoft
  database seed.

**Status:** Unattended compiler path implemented; end-to-end
unattended compilation remains unverified pending a PeopleSoft database
and one-time project bootstrap. Nothing here has been compiled.

### Order of work once a database exists

1. Bring up the disposable database.
2. Configure the PCLAB-only TNS entry.
3. Confirm SQL connectivity.
4. Confirm pside signon.
5. Bootstrap `ZZ_PCODE_LAB` once.
6. Export the pristine project (`-PJTF`).
7. Run SMOKE through the harness.
8. Settle the `-CMPPRJPC` syntax (inline vs `-PJM`).
9. Capture.
10. Check all four capture predicates.
11. Compile the same SMOKE source on native Windows and compare the
    bytes.

Only byte-identical Wine output makes Wine an authoritative compiler;
until then Windows is. The H and G matrices come after this.

If `-PJFF` does not make `-CMPPRJPC` recompile from the imported text:
1. Exhaust the supported App Designer / project mechanisms first.
2. Then consider Data Mover.
3. Direct SQL on the PeopleCode source tables is a last-resort
   diagnostic only. It is not assumed equivalent to App Designer
   persistence.

PSPCMPROG is never fabricated.

## Cycle 185: HASH_SIGNATURE research reopened (product write-back)

**Decision (user, 2026-10-06).** PeopleSoft Studio is to write PeopleCode
natively, without App Designer in the save path. The Cycle 180 halt
protected the controlled-compile lab during compiler reverse engineering;
it is lifted for this purpose under a new rule:

> Never write a generated HASH_SIGNATURE until its algorithm and the
> complete native save transaction have been independently proven against
> controlled PeopleTools saves.

- App Designer is used only as the oracle for controlled experiments.
- Research writes are limited to `ZZ_PCODE_LAB%` definitions on HRDMO.
  HCDEV is never written.
- No known signature is special-cased; the algorithm must be derived and
  then predict a broad corpus with zero mismatches.

**Candidate** (`src/peoplecode/sourceSignature.ts`, prediction only):
`base64(SHA-1(UTF-16LE(PCTEXT)) || 0x00)`. Every stored value is 21 bytes
(28 base64 characters) ending in 0x00. The text is hashed exactly as
stored: LF line endings, App Designer's trailing blank line included.

- 7 / 7 offline: the five delivered HCDEV rows in
  `src/test/fixtures/entryBoundaryPeopleCode.ts` and the Cycle 180 SMOKE
  A / B saves on HRDMO (`src/test/sourceSignature.test.ts`).
- All seven are single-row ASCII programs. Open: multi-row PSPCMTXT
  programs (per-row or whole-text digest) and non-ASCII source.

**Validation tool** (`tools/corpus/source-signature/validate.ts`):
read-only scan of PSPCMTXT, every row a native-save sample. It reports
single-row matches, which multi-row reading holds, non-ASCII and empty
programs, and mismatch samples. `--database` is required and must equal the
connected DB_NAME; protected institutional databases are refused.

**Next.** Run the scan on HRDMO. Then the controlled native-save
experiments (create, unchanged re-save, A->B->A, comment-only,
literal-only, reference change, compile failure, empty program, App Class,
ordinary PeopleCode), each bracketed by a whole-database before / after
snapshot, to characterize the complete save transaction:
PSPCMTXT, PSPCMPROG, PSPCMNAME, version counters, audit fields, and any
other table a save touches.

## 8.62 track: H2 -- end-of-body boundary (resolved)

Branch `research/pt862-compat`; this is separate from the closed HCDEV
frontier.

**Finding.**
- 8.62.09 H2 `Run` (a body holding only `Local ZZ_PCODE_LAB:ORDERING:PARENT
  &x;`) stores `15 64`; the encoder wrote `15 2D 64`.
- The encoder wrote that 0x2D only for an App-Class-typed bare Local; a
  built-in type (`string`, `Record`) already ended `15 64`.
- HCDEV has one program of the shape, 28918, and blank lines follow its
  Local (stored `15 4F 4F 64`). So 8.61 never reached the case.

**Controlled family H2-boundary** (sub-package `ZZ_PCODE_LAB:BOUNDARY`;
observation type `boundary`, the opcode before each named end-method):

| Method | 8.62.09 stored | Encoder before | Encoder after |
|---|---|---|---|
| H10 BareClass | 15 | 2D | 15 |
| H10 BareClassOtherPackage | 15 | 2D | 15 |
| H10 TwoBareClass | 15 | 2D | 15 |
| H10 BareClassArray | 15 | 15 | 15 |
| H10 BareClassBlankLine | 4F | 4F | 4F |
| H10 BareClassComment | 24 | 2D | 24 |
| H10 StatementThenBareClass | 15 | 15 | 15 |
| H11 BareBuiltin / BareClassThenStatement / InitializedClass | 15 | 15 | 15 |
| H11 Empty | 2D | 2D | 2D |
| H12 StoreXData (28918 replica) | 4F | 4F | 4F |

- **Models:** NO_BOUNDARY_AFTER_BARE_LOCAL is the only one with no
  refutation. Its comment-case prediction was first derived wrongly (15)
  and then corrected to 24, the comment token.
- **Audit:** NON_SCRATCH_CHANGED = 0 for the shell import and for the
  saves. The earlier 24 H / G / SMOKE definitions stayed byte-identical.
- **Cause:** the end-of-fragment close of an open App-Class-Local section
  lacked the `suppressDeclarationSectionMarkers` condition that every
  other close site applies (Cycle 113: 0 of 6,044 Local runs in HCDEV App
  Class programs store a 0x2D).
- **Fix:** add the condition.
- **Result:** H2, H10, H11 and H12 are EXACT. This is the 8.61 rule
  applied consistently, not a release delta. Evidence:
  `results/8.62.09/H2-boundary.json`.

## 8.62 track: the six lab exceptions (resolved)

> **Status (final, first PT 8.62 compatibility frontier: CLOSED).** The
> corrected `compare-delivered.ts --all` run (lab release + lab class
> metadata, final encoder) reproduces PeopleTools 8.62.09's PSPCMPROG and
> PSPCMNAME for **30,067 / 30,067** HCDEV definitions present in HRDMO
> (`results/8.62.09/delivered-corpus-comparison.json`). Identical source:
> 29,792 / 29,792. The earlier 30,061 predates the H2 and header-parser
> fixes and the corrected comparison context.

Cycle 183's corpus-wide lab comparison listed six HCDEV definitions where
the encoder, given HRDMO's source, did not reproduce PeopleTools 8.62.09.
None is a compiler difference.

| Id | Cause | Resolution |
|---|---|---|
| 4601 4602 18249 18256 | `#If #ToolsRel >= "8.62"` blocks: inactive text in 8.61, compiled code in 8.62 (same source) | encode the lab source under the lab's release (`conditionalCompilation`): EXACT |
| 23497 | newer HRDMO revision calls `BDG_FUNCTIONS:GiveBadge`, a class HCDEV does not have (`BadgeHeader` is a Record property) | type the lab source against the lab's own App Classes: EXACT |
| 28943 | newer HRDMO revision has `method InfoPageViewBySFF()` with no `;` before `protected` -- stored as typed, `0B 14 73`, no 0x15 | parser: an unterminated header method declaration may precede a section keyword or another member: EXACT |

`compare-delivered.ts` now encodes the lab's source with the lab's
`TOOLSREL` and the lab's own Application Class definitions (12,270
classes).

## Cycle 183: the final 75, reopened and resolved

The user reopened the 75 residual programs: make each exact with a
generic rule, or prove why the surviving repository state cannot
reproduce it.

```text
Programs (30,209)
  STORED_SOURCE_EXACT          30,134   stored PSPCMTXT reproduces PSPCMPROG (harness class EXACT)
  EXACT_RECOVERED_SOURCE           71   compiled exact from the recovered historical source
  COMPILE_HISTORY_DEPENDENT         4   29797 29883 30170 30179 (harness class UNKNOWN_MISMATCH)

Artifact reproduction
  PSPCMPROG reproducible       30,205 / 30,209
  PSPCMNAME reproducible       30,204 / 30,209
  Both reproducible            30,204 / 30,209
  Original source recoverable  30,209 / 30,209

Unreproducible artifacts: 5, from 4 + 1 programs
  29797 29883 30170 30179   PSPCMPROG and PSPCMNAME (the 4 compile-history-dependent programs)
  30192                     PSPCMNAME only (its PSPCMPROG is exact; the program is STORED_SOURCE_EXACT)

protected 430/430; regressed 0; ENCODE_ERROR / UNSUPPORTED_SYNTAX / ROUNDTRIP_ONLY 0
HCDEV source-reconstruction track: COMPLETE (Cycle 183, pushed at 73d756a)
```

Never conflate "4 unresolved programs" with "5 unreproducible artifacts":
the four programs are the compile-history variants; 30192 is a fifth,
names-only artifact inside an otherwise exact program. All five hold
Oracle's delivered 2023-11-14 build rows (class D).

### Track 1: 71 lossy-source programs -> EXACT_RECOVERED_SOURCE

- **Inventory** (`cycle183-source-loss-inventory.ts`,
  `.claude/cycle183-source-loss-inventory.json`):
  - all 71 programs, 282 differing segments;
  - every difference is a length-preserving character substitution,
    inside a comment (240) or a string literal (42);
  - stored 0xBF where the program holds one of 16 code points with no
    WE8ISO8859P15 byte (U+2019 126, U+2502 62, U+2500 60, U+2013 46,
    U+2014 39, U+25EF 28, U+201D 20, U+251C 16, U+201C 15, U+2514 14,
    U+200B 6, U+00B4 2, U+00BC 2, U+FF1A 1, U+2026 1);
  - stored 0x60 where the program holds U+2018 (56);
  - families: 58 replacement-only, 13 replacement + best-fit.
- **Mechanism, measured:** Oracle 19.30's own
  `CONVERT(cp, 'WE8ISO8859P15', 'AL32UTF8')` over all 63,488 BMP code
  points (read-only SELECT on the lab):
  - 256 code points keep their Latin-9 byte;
  - 8 best-fit mappings (U+2018 -> 0x60, U+2015 -> 0x2D, U+2038 -> 0x5E,
    U+03B2 -> 0xDF, U+20A4 -> 0x4C, U+223C -> 0x7E, U+F8FD -> 0x66,
    U+F8FE -> 0xB7);
  - every other code point -> 0xBF
    (`.claude/cycle183-we8iso8859p15-conversion.json`).
- **Proof that PSPCMTXT alone is insufficient:** 0xBF and 0x60 are
  many-to-one. Genuine U+00BF (EXACT 29293) and genuine U+0060 (8 EXACT
  programs, 18 occurrences) occur in HCDEV source.
- **Compiled model exact:** the decoded program re-encodes to the
  stored PSPCMPROG and PSPCMNAME in 71 / 71.
- **Recovery** (`historicalSource.ts`, commit c6cdc46): keep the stored
  text and take, at exactly the lossy positions, the program's
  character. This happens only where the stored byte is that character's
  measured conversion image, and the result must normalize to the
  decoded program. PSPCMTXT is never changed. 6275's recovered source
  equals the lab's Unicode PSPCMTXT for the same delivered definition.
- **Classification:** `EXACT_RECOVERED_SOURCE` (TEST A' on the recovered
  source plus the round trip). `EXACT` still means stored-source exact.

### Corpus-wide check against PeopleTools 8.62.09

`compare-delivered.ts --all`, read-only on the lab
(`results/8.62.09/delivered-corpus-comparison.json`):
- 30,067 of the 30,209 HCDEV definitions also exist in HRDMO.
- The encoder, given HRDMO's source, reproduces PeopleTools 8.62.09's
  own PSPCMPROG AND PSPCMNAME for 30,061 / 30,067.
  (Superseded: the corrected rerun gives 30,067 / 30,067 -- see "8.62
  track: the six lab exceptions".)
- Identical source: 29,792 definitions.
  - HCDEV stored equals HRDMO stored in 29,785.
  - The encoder equals HRDMO in 29,788.
- The 8.62-only exceptions are recorded for the 8.62 track, not HCDEV:
  - 4601 / 4602 / 18249 / 18256: identical source, EXACT against HCDEV,
    compiled differently by 8.62.09;
  - 23497: a newer HRDMO revision;
  - 28943: a newer HRDMO revision whose source the encoder cannot yet
    encode.
- Lossy-source programs: in 64 / 64 delivered programs with the same
  revision, the recovered source equals HRDMO's Unicode PSPCMTXT exactly.
  - 3 (25956 28890 28982) have a different revision in HRDMO.
  - 4 are custom, absent from the lab (18178 29648 29654 29672).

### PSPCMNAME audit (`cycle183-pspcmname-audit.ts`)

The harness's EXACT compares program bytes only. A corpus-wide
PSPCMNAME comparison found 24 byte-exact programs whose rows differed:
- 22 header-only / empty-body App Classes, plus 29632 (the
  single-method golden-template path), lacked the blank NAMENUM 1 row
  that every App Class stores (1,510 / 1,510). The encoder now emits it
  (program bytes unchanged).
- 30192's rows are Oracle's delivered per-method form (Track 2).

### Track 2: 29797 29883 30170 30179 (and 30192's PSPCMNAME)

These store App Class reference rows reopened per method body.
- **Lab, PeopleTools 8.62.09:** every delivered program in HRDMO was
  compiled in one run on 2026-05-08. For the same five definitions the
  encoder reproduces PeopleTools' PSPCMPROG and PSPCMNAME exactly. For
  29797 / 29883 / 30192 the source is identical to HCDEV's
  (`compare-delivered.ts`,
  `results/8.62.09/delivered-reference-variants.json`).
- **PeopleTools 8.61.15 media** (delivered upgrade project PPLTLS84CUR):
  the five delivered PCMs carry exactly HCDEV's stored rows (191 / 48 /
  543 / 533 / 9). Oracle compiled them on 2023-11-14 (PPLSOFT, one batch
  window), so HCDEV holds Oracle's delivered artifact.
- **Population** (`cycle183-ppltls-repeat-census.ts`): all 2,644
  delivered App Class PCMs come from that 2023-11 build, and 1,998 carry
  per-method repeated rows. Of the 270 that also exist in HCDEV with
  identical source and repeated delivered rows:
  - HCDEV stores the class-wide (recompiled; encoder) form in 266;
  - HCDEV stores the delivered form in 4 (29797 29883 30170 30192);
  - 30179 likewise, among the different-source rows.
- **Nearest exact controls** (same delivery build, repeated delivered
  rows, recompiled in HCDEV, EXACT):
  - 29883: PSXP_SERVICEMGR 29880 29881 29882 29884, plus 29801;
  - 30170 / 30179: PTAI_ACTION_ITEMS 30159 30160 30161 30163 30164
    30168;
  - 29797: 30068 30145 28759 30160 28761 30000.

**Classification D, proven:** identical source plus an identical
delivered artifact produce two different stored artifacts in HCDEV. The
stored form follows compile history (delivered and never recompiled,
versus recompiled), not source, so no source-only rule can reproduce
both.
- **What is missing:** the history flag. HCDEV PSPCMPROG.LASTUPDDTTM for
  these definitions is not in the snapshot; a read-only live read failed
  because the HCDEV host was unreachable from this network. Also missing
  is a model of Oracle's build-compile per-method mode. The 1,998
  delivered PCMs are a calibration set for it (PSPCMNAME only; the
  delivered blob is not PSPCMPROG).
- **Controlled R experiments: not run.**
  - An App Designer save or compile on 8.62.09 produces the class-wide
    form; HRDMO's fresh compile of identical source shows it.
  - The only state that would reproduce the delivered rows is importing
    Oracle's compiled blob, which carries a delivered identity. That is
    the Cycle 178 incident path, refused by the interlocks.

## Cycle 182: HCDEV semantic frontier sealed

```text
HCDEV_SEMANTIC_FRONTIER       = CLOSED
ACTIONABLE_SEMANTIC_NONEXACT  = 0
HCDEV: EXACT 30,134 / 30,209; NONEXACT 75 (71 historical source
       variants + 4 historical reference variants 29797 29883 30170 30179)
```

- Reproduced in Cycle 182 on the LOCAL SNAPSHOT:
  - protected 430/430;
  - ENCODE_ERROR / UNSUPPORTED_SYNTAX / ROUNDTRIP_ONLY 0;
  - row by row, 0 EXACT -> NONEXACT against the pre-30124 and
    pre-10860 taxonomies, and the 75 residual rows unchanged.
- **Release provenance.**

  | Evidence | Release |
  |---|---|
  | HCDEV corpus (stored PSPCMPROG / PSPCMNAME / source) | PeopleTools 8.61.15 |
  | Controlled experimental compiler (SMOKE, H1-H9, G1-G7) | PeopleTools 8.62.09, native Windows, build PT862P09C_2604092319 |
  | Direct 8.61.15 controlled confirmation of the final rules | pending |

- **Final rules.** 3b5c36e (30124: declared class row before a
  different-class create) and 722fa0a (10860 / 15598: a Function-local
  Local declares its name only in its Function). Both have full 8.61.15
  HCDEV corpus compatibility evidence and direct 8.62.09 controlled
  evidence.
- **8.61.15 confirmation scope.** If a writable 8.61.15 database becomes
  available, re-run only the H (30124) and G (10860 / 15598) fixtures in
  `experiments.json`, with the same guarded scratch bootstrap, and compare
  release behavior.
- **8.62 compatibility track.** Separate from HCDEV. It covers the H2
  finding (8.62_CONTROLLED_FINDING, UNMODELED: no 0x2D before end-method
  in a method body holding only a bare Local) and any other 8.62-only
  bytes. 8.62 differences do not reopen the HCDEV frontier.
- **Wine 8.62.09:** an unverified host, not reopened (see the G matrix
  section).
- **Freeze.** HCDEV encoder semantics change only on contradicting
  controlled evidence, a new HCDEV definition exposing a generic bug, a
  contradicting direct 8.61.15 experiment, or explicit work on another
  release.

## Cycle 181: 10860 / 15598 rule trial (authorized) -- accepted

**Rule (commit 722fa0a).** A Local declared inside a Function has
semantic type only within that Function. Outside it, the same name does
not inherit that Local declaration's type, so a member / field chain on
it compiles as an untyped (inline) chain, unless another declaration in
the current scope supplies a type.
- Implemented narrowly: the encoder's declared-name test (Cycle 121)
  excludes names whose only declarations are Function-body Locals, except
  inside the declaring Function.
- Unchanged: top-level / Global / Component declarations and Function
  parameters stay program-wide; Cycle 163's typed-set restore;
  Application Class programs.
- Separate from the 30124 rule (3b5c36e): independent commits and tests
  (`encoderFunctionLocalDeclaredName.test.ts`,
  `encoderDeclaredClassRowBeforeCreate.test.ts`).

**Acceptance gate (LOCAL SNAPSHOT, all 30,209 programs).**

| Check | Result |
|---|---|
| 10860 / 15598 | EXACT (forward and round trip) |
| EXACT -> NONEXACT, row by row vs. the previous taxonomy | 0 |
| Remaining NONEXACT rows (category, first diff) | 75, all unchanged |
| Protected | 430 / 430 |
| ENCODE_ERROR / UNSUPPORTED_SYNTAX / ROUNDTRIP_ONLY | 0 / 0 / 0 |
| Controlled compile (8.62.09) | G1-G7 EXACT; H matrix and SMOKE unchanged (H2 references only) |

HCDEV: EXACT 30,132 -> 30,134; NONEXACT 75 = 71 DSM (stored source is a
historical variant; round trip exact) + 4 historical reference variants
(29797, 29883, 30170, 30179). ACTIONABLE 0.

**Provenance.** The direct controlled experiments are PeopleTools
8.62.09, not 8.61.15 measurements. 30124, 10860 and 15598 are EXACT
against the 8.61.15 HCDEV corpus through rules derived from 8.62.09
evidence, and stay tagged 8.61.15 confirmation pending.

## Cycle 181: G matrix on native Windows 8.62.09 (release-scoped)

**Setup.**
- `build-scratch-project.ts --family 10860/15598` generated project
  `ZZ_PCODE_LAB_G` from the PATCH862 export templates:
  - derived / work records `ZZ_PCODE_LAB` (C01-C07), `ZZ_PCODE_LAB_P`
    (KEY) and `ZZ_PCODE_LAB_T` (KEY, VAL);
  - nine Character fields;
  - seven payload-free Record PeopleCode shells
    (`ZZ_PCODE_LAB.ZZ_PCODE_LAB_C0n.FieldFormula`).
- One guarded `-PJFF` under Wine 8.62.09 imported it. It needs
  `PSLAB_ORACLE_CLIENT` pointing at the 64-bit client in `pt86115/` (a
  first try without it failed sign-on, "Missing or invalid version of SQL
  library PSORA64", and wrote nothing).
- Audit: NON_SCRATCH_CHANGED = 0. PSRECDEFN / PSRECFIELD / PSDBFIELD /
  PSDBFLDLABL verified by SELECT; 7 stub programs (37 bytes), no PSPCMTXT.
- The user saved G1-G7 in App Designer 8.62.09 on `ps-win-client`.
  Audit: NON_SCRATCH_CHANGED = 0 (21 scratch changes: PSPCMTXT /
  PSPCMNAME added and PSPCMPROG replaced for the 7 programs). The 17 H /
  SMOKE definitions were byte-identical to `H-matrix.json`.
- Evidence: `results/8.62.09/G-matrix.json`.

**Result.**

| Case | Variation | Stored member form | Encoder |
|---|---|---|---|
| G1 | 10860 replica: `Local Rowset &r2` in LoadFilter only; CallLink reads `&r2...VAL` | ref, then **inline** in CallLink | DISAGREES (ref) |
| G2 | G1 plus `Local Rowset &r2` in CallLink | ref, ref | EXACT |
| G3 | control: no typed read in LoadFilter | inline | EXACT |
| G4 | `&r2` Global | ref, ref | EXACT |
| G5 | 15598 replica: `Local Row &xrow` in Function Prepare only; top level reads `&xrow...VAL` | ref, then **inline** at top level | DISAGREES (ref) |
| G6 | G5 plus top-level `Local Row &xrow` | ref, ref | EXACT |
| G7 | control: no typed read in Prepare | inline | EXACT |

- DECLARING_UNIT_SCOPE is the only model with no refutation. A `Local`
  declared in one Function body types the variable in that unit only; in
  another unit the same name is an undeclared (untyped) variable, and a
  member read on it is compiled inline (0x0A), not as a reference.
- TYPED_EVERYWHERE / PROGRAM_WIDE_DECLARATION (refuted by G1 G3 G5 G7)
  and EARLIER_ROW_REUSE (refuted by G1 G5) are rejected.
- Both replicas reproduce HCDEV: G1 is 10860's shape and G5 is 15598's.
- The user then authorized an HCDEV trial (see "10860 / 15598 rule
  trial" below), and it was accepted.

**Wine comparison: `-CMPPRJPC` does not save current programs.**
- Wine 8.62.09 `-CMPPRJPC ZZ_PCODE_LAB` (SmokeTest) logged "Compile
  Project PeopleCode completed successfully" with no error lines.
- The audit found zero scratch changes, including PSPCMPROG
  LASTUPDDTTM. ORA_ROWSCN on the SmokeTest PSPCMPROG / PSPCMNAME /
  PSPCMTXT rows still maps to the user's save (22:32:59), not the
  compile (23:31).
- So in 8.62.09, `-CMPPRJPC` compiles and checks a current program
  without writing it. A headless recompile of programs already saved on
  native Windows produces no Wine bytes to compare.

**Wine status (user decision, Cycle 181): dropped for now.**

```text
8.62.09 Wine client:
    signon / headless compiler invocation works
    CMPPRJPC on current programs performs no observable save
    byte-equivalence with native Windows not established
    not an authoritative controlled-compile host
```

This is an unverified host, not a compiler mismatch: no comparable saves
were ever obtained. Native Windows App Designer 8.62.09 on
`ps-win-client` is the authoritative controlled-compile host. Wine
remains usable for the guarded scratch `-PJFF` bootstrap imports.

## Cycle 181: 30124 rule trial (authorized) -- accepted

**Rule.** In an Application Class program, a Local initialized with
`create` of a DIFFERENT class opens its declared class's row at the
declaration, before the created class's. Implementation:
- `createsDifferentClass` in `localDeclaration`;
- same-class creates keep the `create`-owned row;
- named-import rows already exist, so import order is kept;
- ordinary programs are unchanged;
- H2's 0x2D finding is deliberately not included.

**Evidence.** The H matrix on PeopleTools 8.62.09, native Windows
(`results/8.62.09/H-matrix.json`):
- H1 / H3 / H6 / H8 / H9 are now EXACT;
- H4 / H5 / H7 are still EXACT;
- H2 references are exact, bytes differ by the separate 0x2D.
Unit test: `src/test/encoderDeclaredClassRowBeforeCreate.test.ts`.

**HCDEV trial** (all 30,209 programs):
- EXACT 30,131 -> **30,132** (30124);
- regressions 0; protected 430/430;
- UNKNOWN_MISMATCH 7 -> 6.

Accepted per the user's criterion.

**Formal status:** 30124 is EXACT in the HCDEV corpus. Its rule is
supported by 8.62.09 controlled compiles and a zero-regression 8.61.15
corpus trial, and is tagged **8.61.15 confirmation pending** until a
8.61.15 compile, or an explicit policy amendment.

## Cycle 180: H matrix on native Windows 8.62.09 (release-scoped)

**Setup.**
- 16 shells (7 support classes and H1-H9) were created by the guarded
  scratch import; the user then saved every source in App Designer
  8.62.09 on `ps-win-client`.
- The CHILDARG support source was corrected first: App Designer
  rejected "Duplicate parameter name", because property N collided with
  parameter &n.
- Audit: NON_SCRATCH_CHANGED = 0.
- Evidence: `results/8.62.09/H-matrix.json` (17 definitions).
- Every support class and SMOKE: encoder EXACT.

| Case | Variation | Stored PACKAGE order (8.62.09) | Encoder |
|---|---|---|---|
| H1 | 30124 replica: wildcard own package, `Local PARENT &x = create CHILD()` | PARENT, CHILD | CHILD only (bytes exact; reference list differs) |
| H2 | bare `Local PARENT &x;` | PARENT | references exact; bytes differ (see below) |
| H3 | H1 with BASECLS / DERIVED (alphabet flipped) | BASECLS, DERIVED | DERIVED only |
| H4 | named imports PARENT, CHILD | PARENT, CHILD | **EXACT** |
| H5 | named imports CHILD, PARENT | CHILD, PARENT | **EXACT** |
| H6 | other package (SCOPE:*) | SPARENT, SCHILD | SCHILD only |
| H7 | declaration and create split | PARENT, CHILD | **EXACT** |
| H8 | constructor argument | PARENT, CHILDARG | CHILDARG only |
| H9 | after executable statements | PARENT, CHILD | CHILD only |

Wildcard cases also store the blank `PACKAGE.` wildcard row at NAMENUM 2,
as the encoder does.

**Observation** (8.62.09):
- The 30124 replica (H1) reproduces 30124's stored order.
- Under a wildcard import, `Local <A> &x = create <B>(...)` opens A's
  PACKAGE row and then B's, in every variant: own or other package,
  either alphabetical order, constructor argument, statement position.
  A's row is opened even when A is not used again.
- With named imports, rows follow import order (H4, H5), whatever the
  declaration order.

**Inference.**
- One source-visible rule explains all nine: named imports open rows in
  import order; otherwise a Local declaration opens its declared class's
  row at the declaration, before the initializer's rows.
- The current encoder omits the declared class's row when the
  declaration has an initializer (H1 / H3 / H6 / H8 / H9). That is
  exactly its 30124 failure. A bare declaration (H2) and the split form
  (H7) are already right.
- The model checker reports no uniform candidate only because it tests
  each model alone. IMPORT_ORDER-else-DECLARED_FIRST is consistent with
  all nine.

**Second finding (H2).** A method whose body is only a bare `Local`
declaration:
- 8.62.09 stores `... 15 64` (`;` then `end-method`);
- the encoder stores `... 15 2D 64` (an extra 0x2D boundary).
Methods whose last statement is a Local with an initializer (`Prepare`)
match.

**Status.** These are PeopleTools 8.62.09 results. HCDEV / 8.61.15 is
unchanged: 30124 stays NEEDS_CONTROLLED_COMPILE_86115, and no encoder
change is made from 8.62 evidence. Recording the H1 result as
**RELEASE_SCOPED_REPRODUCTION**: 8.62.09 shows a generic rule matching
30124's stored shape.

## Cycle 180: first controlled compile -- SMOKE on native Windows 8.62.09

**Compiler.**
- App Designer 8.62.09 (PT862P09C_2604092319) on native Windows 11
  `ps-win-client`, installed side by side at `C:\psoft\pt-pshome8.62.09`.
- pside `4f754ce3...`, pspcm `4e32443e...` and pssys `3d695436...` match
  the profile; the existing 8.62.03 client is untouched.
- Two-tier to HRDMO (8.62 patch 9) through a lab-only TNS file
  (`C:\pclab\tns`).

**How the source was saved.** The user opened
`ZZ_PCODE_LAB.SUPPORT.SmokeTest.OnExecute`, pasted the SMOKE source and
saved. PeopleTools itself wrote PSPCMTXT (with its HASH_SIGNATURE),
PSPCMPROG and PSPCMNAME. Building GUI automation was stopped by a safety
classifier and has not been pursued.

**Audit** (last pre-save snapshot -> post-save snapshot):
- NON_SCRATCH_CHANGED = 0;
- APPS_RLR:Utilities unchanged;
- scratch: +PSPCMTXT, +PSPCMNAME, ~PSPCMPROG (the 37-byte stub
  replaced), all under `ZZ_PCODE_LAB.SUPPORT.SmokeTest.OnExecute`;
- PSVERSION PCM 23->24, SYS 1226->1227.

**Capture** (`tools/corpus/controlled-compile/results/8.62.09/SMOKE.json`):
- PSPCMPROG: 252 bytes, sha256 `fd60e9ff...`;
- PSPCMNAME: 1 row (the blank owner row), canonical sha256 `bacf4052...`;
- source: sha256 `df689491...`. It is the canonical SMOKE text plus one
  trailing blank line (canonical sha256 `bb33f018...`);
- compiled at 2026-10-05 21:48:40 (database clock).

**Checks.**
- checkLabCompile: ok. The source matches, the program decodes to it,
  it differs from the stub sentinel, and it was compiled after the
  baseline.
- compare-controlled-compile: **encoder EXACT**, bytes and references.
  Decode OK; the source matches.

**Determinism (run 2: an unchanged re-save by the user, add / remove a
space).**
- Audit: NON_SCRATCH_CHANGED = 0. The only scratch change is the
  SmokeTest PSPCMPROG fingerprint, which includes LASTUPDDTTM.
- PSPCMPROG is byte-identical (sha256 `fd60e9ff...`, 252 bytes).
- PSPCMNAME is row-for-row identical, NAMENUM included.
- The source is identical; the encoder is EXACT.
- HASH_SIGNATURE is unchanged (`05Q8EHhRDJ3561gQ3yAJRCqYGO0A`).
- Only LASTUPDDTTM (21:48:40 -> 22:15:04) and PSVERSION (PCM 24->25,
  SYS 1227->1228) moved.
- Evidence: `results/8.62.09/SMOKE-run2.json`.

**A->B->A (user saves; audit and capture after each).**
- B is a different class body: `Local string &s; &s = "B";`.
  - It compiled to a different program (236 bytes, sha256 `ac58d1ab...`,
    HASH_SIGNATURE `STHoS1JCaG+SsgCiyQkdkOIDu08A`).
  - Encoder EXACT.
  - PSVERSION PCM 25->27.
- A2 restored the SMOKE source.
  - PSPCMPROG is byte-identical to A1 (`fd60e9ff...`, 252 bytes).
  - PSPCMNAME is row-for-row identical; the source and HASH_SIGNATURE
    are identical.
  - Encoder EXACT.
- NON_SCRATCH_CHANGED = 0 at every step.
- App Designer appends one trailing blank line to the stored text on
  every save.
- Evidence: `results/8.62.09/SMOKE-aba-B.json` and `SMOKE-aba-A2.json`.

**Status.** One controlled 8.62.09 compile, end to end, with the
encoder exact. An unchanged re-save is byte-deterministic, and A->B->A
returns byte-identical output. The compiler output is a function of the
source alone, so the gate for H / G (8.62.09) has passed. Still open:
- Wine-vs-Windows equality;
- a way to save the H / G sources without our GUI automation.

## Cycle 180: HASH_SIGNATURE research halted; GUI automation chosen

- In the 8.62.09 client, `PcmSavePeopleCodeText` (pssys.dll, called by
  `PcmUpdateProg`) is the native writer of PSPCMTXT, including
  `HASH_SIGNATURE`.
- A read-only investigation matched five sample rows before being
  intentionally halted. No signature was ever written.
- No executable code that reproduces `HASH_SIGNATURE` is kept in the
  repository, and the topic is closed.
- **Boundary:** PeopleTools writes PeopleTools integrity metadata. The
  harness only drives PeopleTools (App Designer's own Save) and observes
  the result.
- **Next path (user decision):** deterministic GUI automation of native
  Windows App Designer 8.62.09 on `ps-win-client`. Every edit is gated on
  positively identifying the `ZZ_PCODE_LAB` definition, and every Save
  is bracketed by the whole-database non-scratch audit.

## Cycle 179: write safety, cleanup, PJFF retry, Data Mover finding

**Interlocks** (`src/peoplecode/corpus/labSafety.ts`, `lab-audit.ts`,
`run-compiler.ts`, `run-datamover.ts`):
- The scratch namespace is exactly `ZZ_PCODE_LAB`, matched with an
  escaped SQL `LIKE`. Never `ZZ%`, which matches delivered `ZZ_PAY_*`.
- -PJFF needs a project file in which every identity is scratch and that
  carries no compiled payload (no blob, no PcmPnt rows).
- -CMPALLPC is refused; -CMPPRJPC needs a scratch project.
- Data Mover runs only exact-name scratch `DELETE`s.
- Every write is bracketed by a read-only audit. It fingerprints, inside
  Oracle, every PSPCMPROG / PSPCMTXT / PSPCMNAME / PSPACKAGEDEFN /
  PSAPPCLASSDEFN / PSPROJECTDEFN / PSPROJECTITEM definition (368,016
  non-scratch keys, about 60 s); two runs with no write in between
  compare equal.
- A write stops on `NON_SCRATCH_CHANGED > 0` or on any change to the
  protected APPS_RLR:Utilities.
- PSVERSION counters, which any save increments, are reported as
  infrastructure.

**APPS_RLR:Utilities** (not rewritten this cycle):
- source sha256 `613dc986...`;
- PSPCMPROG sha256 `e773584d...`;
- names sha256 `de37e3c8...`;
- LASTUPDDTTM 2026-10-05 15:46:04.830645 (local).

**D1-D4 cleanup:**
- Read-only enumeration over 305 table / column pairs found 40 rows:
  - PSPACKAGEDEFN 4, PSAPPCLASSDEFN 4;
  - PSPROJECTDEFN 4, PSPROJECTITEM 8;
  - PSPROJECTMSG 16.
- They were deleted with guarded Data Mover, five exact-name DELETEs.
- Audit: NON_SCRATCH_CHANGED = 0, protected unchanged, 16 scratch keys
  removed, PSVERSION unchanged.
- The re-enumeration finds 0 D1-D4 rows anywhere.

**The one scratch-only -PJFF retry**:
- The project file was built from PATCH862's nested-package APM and
  sub-package PCM structures (not APPS_RLR). It held:
  - project ZZ_PCODE_LAB;
  - packages ZZ_PCODE_LAB and SUPPORT;
  - class SmokeTest;
  - the SMOKE source only (empty blob, no names).
- Validator PASS; file sha256 `be6694fd...`.
- pside did not crash ("Total 3 items processed").
- Audit: NON_SCRATCH_CHANGED = 0, protected unchanged. Scratch changes:
  - +PSPACKAGEDEFN ZZ_PCODE_LAB and SUPPORT;
  - +PSAPPCLASSDEFN SmokeTest;
  - +PSPCMPROG under the scratch key;
  - the project rows.
- PSVERSION APM 5->7, PCM 22->23, PJM 24->29, SYS 1221->1226.
- But the PSPCMPROG row is a 37-byte header-only stub, synthesized from
  the empty payload, and **no PSPCMTXT source row** was stored.
- -> **PJFF_SOURCE_INJECTION_UNSUITABLE**: -PJFF does not persist source
  without a compiled payload. (The Cycle 178 crash was the APPS_RLR-based
  APM structure, not -PJFF itself.) A scratch-only, payload-free -PJFF
  is, however, a proven-safe way to create the scratch definitions.

**Data Mover source loading: blocked by PSPCMTXT.HASH_SIGNATURE.**
- In 8.62, PSPCMTXT has `HASH_SIGNATURE VARCHAR2(112) NOT NULL`.
- All 122,193 rows hold a 28-character base64 value (a 20-byte digest).
- pssys.dll computes and writes it on save: `INSERT INTO PSPCMTXT
  (HASH_SIGNATURE, ... PCTEXT)`, and it reads it back by key.
- It is not a plain MD5 / SHA-1 / SHA-256 / SHA-512, nor a truncated
  SHA-256, of the source (UTF-8 or UTF-16, LF or CRLF, with or without a
  NUL), nor of the compiled program.
- Loading a source row with Data Mover (or SQL) would therefore mean
  writing an invented integrity value. Not attempted.
- The only source-side table needed is PSPCMTXT (key, PROGSEQ,
  HASH_SIGNATURE, PCTEXT); the definitions already exist.

**State left in HRDMO (scratch only):**
- project ZZ_PCODE_LAB with 3 items;
- PSPACKAGEDEFN ZZ_PCODE_LAB and ZZ_PCODE_LAB:SUPPORT;
- PSAPPCLASSDEFN SmokeTest;
- the 37-byte stub PSPCMPROG (a good sentinel).

**SMOKE:** not run.

## Cycle 178 findings on HRDMO (8.62.09)

**Sign-on.**
- Headless App Designer 8.62.09 signs on to HRDMO as PS, after PS's
  password was reset with Data Mover bootstrap (`ENCRYPT_PASSWORD PS`),
  at the user's request.
- Data Mover bootstrap (`psdmtx.exe`, access ID) works headless under
  Wine.

**Switch syntax.**
- `-CMPPRJPC <project>` takes the project name as its own argument. The
  log reads "Compile Project PeopleCode / Project Name: <project>".
- On failure pside 8.62.09 returned exit 8 or 3, but the exit code is
  still not trusted.

**`-PJTF` (copy to file)** works headless. It writes `<P>.XML` plus
`<P>.ini`. In 8.62:
- one `APM` instance per package node (root `.`, level-1 `:`, deeper
  `<parent path>`), each listing its classes (class level = package
  level + 1) and its direct sub-packages;
- project items: 57 (package; IDs 104/116/117) and 58 (class PeopleCode;
  IDs 104/[105]/107);
- `PCM`: key, name rows (`PcmPnt`), `<peoplecode_text>`, and
  `<peoplecode_blob>` (a serialized program structure, not PSPCMPROG
  bytes; `lSourceLen` tracks the compiled length);
- items and instances sorted by key. An `APM` mismatch aborts pside:
  `PSAFFIRM GlobalHandle` in `pssys\apmget.cpp:1354`.

**`-PJFF` (copy from file) is NOT a safe source-injection path.**
- It creates PSPACKAGEDEFN / PSAPPCLASSDEFN rows under the project key.
- But it saves the PeopleCode under the key **embedded in
  `<peoplecode_blob>`**, not under the PCM / project key.
- Diagnostic imports D1-D4 (renames of the exported APPS_RLR package)
  therefore wrote into the **delivered** `APPS_RLR:Utilities` program.
  D1 carried the SmokeTest text, so its source briefly read SmokeTest;
  D2-D4 rewrote the exported original.
- Verified afterwards (read-only):
  - its PSPCMTXT equals the pre-import export (8,419 chars);
  - its 4 PSPCMNAME rows are identical;
  - its PSPCMPROG decodes exactly to that source.
  - Only PSPCMPROG.LASTUPDDTTM changed (2026-10-05 20:46 UTC). The app
    server and web server were down throughout.
- Rule: never import a PCM whose blob was compiled for another key.
- Untested: whether a blob-less PCM imports at all. The first attempt
  aborted on the APM structure, before PeopleCode.

**Scratch objects left in HRDMO:**
- projects ZZ_PCODE_LAB and ZZ_PCODE_LAB_D1..D4;
- packages and classes ZZ_PCODE_LAB_D1 (SmokeTest) and
  ZZ_PCODE_LAB_D2..D4 (Utilities).
- No PeopleCode rows exist under any ZZ_PCODE_LAB key.

**Namespace note:** HRDMO ships delivered `ZZ_PAY_*` Record PeopleCode.
Lab queries must use `ZZ_PCODE_LAB%`, never `ZZ%`.

## Release profiles (Cycle 177)

The harness compiles with one exact PeopleTools release at a time, chosen
by `PSLAB_RELEASE` (`PEOPLETOOLS_RELEASES` in
`src/peoplecode/corpus/controlledCompileRunner.ts`). Each profile pins
four things:
- the client's `pside.exe` / `pspcm.dll` sha256;
- its lab directory (`~/peoplesoft-lab/<dir>`);
- its own Wine prefix;
- the PSSTATUS TOOLSREL / PTPATCHREL a lab database must report.

Results are authoritative only for that release. HCDEV (8.61.15)
conclusions come only from the 8.61.15 profile.

| Profile | Client | Lab database |
|---|---|---|
| 8.61.15 | `pt-pshome8.61.15.tgz` (institutional DPK) | none yet |
| 8.62.09 | `PTC-DPK-WIN8.62.09-1of1.zip` (the home lab's own PeopleTools Client DPK, from psapp01 `/opt/psoft/hcm/dpk`) | home lab HRDMO (TOOLSREL 8.62, PTPATCHREL 9), via an SSH tunnel to psdb01 |

Home lab (user's libvirt host 192.168.4.40):
- psdb01, 192.168.122.206: Oracle 19.30.
  - CDBHCM holds PDBs HRDMO / HRDEV / HRTST / HRUAT / HRPRD.
  - CDBFSCM holds PDB FSCMDMO (8.62.07).
  - Character set AL32UTF8 / UTF8.
- psapp01, 192.168.122.151: the PS_HOMEs and PTC client DPKs for
  8.60.23, 8.61.17 / 8.61.19 and 8.62.07 / 8.62.09.
- Both guests are reached as `oracle` via ProxyJump.

The experiment target is HRDMO only; the other PDBs are not touched.



## Unattended harness (Cycle 175)

### Authorization and media

The user authorized, in this session:
- use of the institution's 8.61.15 media in a disposable lab;
- starting and installing into `omarchy-windows`;
- an Oracle 19c image, with the Oracle account sign-in and license
  acceptance done by the user.

The media is staged at `~/peoplesoft-lab/pt86115/media`:
- `pt-pshome8.61.15.tgz`, 2,234,348,986 bytes, sha256 `9b0d408f…`;
- `pt-oracleclient-19.3.0.0.tgz`, sha256 `ad4da1a3…`.

It is extracted to `ps_home/` and `oracle_client/`. All seven client
binaries match docs/PEOPLETOOLS_BINARIES.md. Nothing is under
`peoplesoft-dlls/pt861` or the 8.61.07 bottle.

### Command-line inventory (8.61.15 binaries)

| Module | Switches |
|---|---|
| pside.exe | `-HIDE`, `-QUIET` |
| pstls.dll (`pstlsexe.cpp`) | `-HELP -QUIET -SR -LF -CC -CT -CS -CD -CO -CP -CX -CA -CI -CW -SS -SN -SUBSEQUENT -GUID -ST -SF`; mentions a parameter file (`@`) |
| psprj.dll (`prjcmdline.cpp`) | `-PJC -PJTF -PJFF -PJM -PJFC -PJB -PJMG -CMPALLPC -CMPPRJPC -CMPDIRPC -CMPPRJDIRPC -PJRCUST`; `-FP <dir>` (copy to / from file); `-TD -TO -TP` (target); also `-OVD -OVW -RST -CL -AF -DDL -CFD -CFF -EXP -LNG -FLTR` and others |

Messages that matter:
- "Error - project name required for %s process."
- "This project contains PeopleCode that needs to be compiled before a
  Copy to File can take place."
- "Total %d items processed."

The project name for `-CMPPRJPC` is either its own argument or comes from
`-PJM`. The runner supports both (`--project-arg inline|pjm`); the smoke
run decides.

### Measured under Wine (separate prefix `~/.wine-peoplesoft-86115`, no database)

- pside 8.61.15 starts headless (`-HIDE -QUIET -SS NO -SN NO`), signs
  on through Oracle client 19.3, writes the `-LF` log and exits.
- The log is UTF-16LE with no BOM and CRLF line ends.
- **The exit code is 0 even when signon fails.** Success is judged from
  the log and the database rows, never the exit code.
- Oracle errors are specific only with `ORACLE_HOME` set. Against the
  lab TNS file, the PCLAB alias gives `ORA-12541` (no listener) and an
  unknown alias gives `ORA-12154`. Without `ORACLE_HOME`, both read
  `Return: -1`.
- No parameter-file form was honored (`@file` and `@@file`, one token per
  line or the whole line). So the disposable lab credentials go on the
  command line.
- With no batch action, pside wrote an empty log even when signon failed.

Not yet measured, because it needs the database:
- signon success;
- the `-CMPPRJPC` syntax;
- PJTF / PJFF behavior;
- whether Wine's saved bytes equal Windows'. Windows stays the authority
  until one smoke definition compiles identically on both.

### Source injection

Measured from real project exports (PUM change packages): a PeopleCode
program in a project file is `<instance class="PCM">`. It holds:
- the `PcmProg` key (`eObjectID_n`, `szObjectValue_n`);
- the PSPCMNAME rows (`PcmPnt`);
- `<peoplecode_text>`, the source;
- `<peoplecode_blob>`, base64 of the compiled program.

So a project file carries source.

Selected mechanism, using supported switches only:
1. **One-time bootstrap.** Create `ZZ_PCODE_LAB` with every support
   class, experiment shell and scratch record. Then export it with
   `-PJTF` as the *pristine* project file.
2. **Per experiment:**
   1. reset: `-PJFF` the pristine file;
   2. load: `-PJFF` a copy whose only change is this experiment's
      `<peoplecode_text>` (`load-experiment.ts`);
   3. compile: `-CMPPRJPC ZZ_PCODE_LAB` in a fresh pside process;
   4. capture: SELECT only.

Why it is valid:
- The harness supplies only source text.
- The blob left in the file is the lab compiler's own pristine output,
  which works as a sentinel. A capture is accepted only when
  `checkLabCompile` passes:
  - PSPCMTXT equals the experiment source;
  - the program decodes to that source;
  - the program differs from the sentinel;
  - LASTUPDDTTM follows the compile start, measured on the database
    clock.
- Encoder output never enters the database.

Data Mover (Option 3) and direct SQL into PSPCMTXT are fallbacks, to use
only if `-PJFF` does not import text that `-CMPPRJPC` then compiles.
Recompile-from-text is the property the smoke run verifies first. GUI
automation (Option 5) is unnecessary unless both fail.

Reset semantics: every experiment re-imports the whole pristine project
before its own load. So no experiment source from an earlier run
survives, and each compile is a new process.

### Tools

| Tool | Status |
|---|---|
| `run-compiler.ts` | Works. It is checked against the exact 8.61.15 binaries and a lab-only TNS file, and refuses institutional names and the 8.61.07 bottle. Each run is one fresh pside process under Wine, reported as JSON with a parsed log. Exercised up to `ORA-12541`. |
| `load-experiment.ts` | `--materialize` works (smoke, support and experiment sources with sha256). Experiment project files are built from a pristine `-PJTF` export, which does not exist yet. |
| `labDb.ts` / `capture-lab.ts` | SELECT-only, READ ONLY. Now also captures PSPCMPROG.LASTUPDDTTM. |
| `orchestrate.ts` (`npm run controlled-compile`) | Preflight checks: pristine coverage, 8.61 patch 15, SMOKE first. Then per experiment: reset, load, sentinel, compile, capture, check. Then the comparison report. Written; not runnable without the database. |
| `compare-controlled-compile.ts` | Unchanged. Reports now include source / program / names sha256. |

### Remaining blockers (human / admin)

1. **PeopleSoft database seed: none on any reachable media.** The
   8.61.15 PS_HOME has Oracle's database-creation scripts (`createdb`,
   `utlspace`, `ptddl`, `dbowner`, `psroles`, `psadmin`, `connect`).
   It has only language packs (`data/pt*a.db`) and upgrade deltas
   (`ptsys_*.dat`), with no English system-database export. The
   application homes (`PS_APP_HOME/HC0xx`) hold no `*engs.db`, and the
   PUM folders hold change packages, not database images. A writable
   8.61 repository needs one of:
   - an Oracle PeopleSoft PUM DPK (HCM 9.2). It is downloaded from My
     Oracle Support with the institution's account and carries Oracle
     Database 19c *and* a full PeopleSoft database, then is patched to
     8.61.15.
   - a DBA-provided scratch PeopleSoft 8.61.15 database (for example a
     disposable non-production clone), with written authorization.
2. **Oracle 19c image** (only if the seed comes as a database export,
   not a PUM DPK): `docker login container-registry.oracle.com` by the
   user. The pull currently answers 401.
3. **One-time bootstrap** of `ZZ_PCODE_LAB` in App Designer. Materialized
   sources: `load-experiment.ts --materialize`. Then
   `run-compiler.ts --copy-to-file ZZ_PCODE_LAB --dir <pristine>`.

After that, `npm run controlled-compile -- --pristine <dir> --out <dir>
--all` runs unattended.

## Milestone this lab follows

**CORPUS_RECOVERABLE_FRONTIER_CLOSED** (Cycle 171). The HCDEV corpus has
30,209 programs compiled with PeopleTools 8.61.15. The encoder is EXACT
on 30,131 of them. The 78 that are not:

| Class | Count | Programs |
|---|---:|---|
| Lossy source: HCDEV `PSPCMTXT.PCTEXT` holds 0xBF for characters outside WE8ISO8859P15, while the compiled program has the real text | 71 | DECODE_SOURCE_MISMATCH |
| Historical compiler variant: per-method row reopening, with no source discriminator | 4 | 29797 29883 30170 30179 |
| Needs a controlled compile | 3 | 30124 10860 15598 |

This is not a claim of compiler equivalence. It means three sources of
evidence justify no further production rule:

- the corpus;
- the captured App Class metadata;
- static analysis of the PeopleTools binaries.

The remaining three programs need compiled experiments.

## The three programs, precisely (Cycle 172)

- **30124** (`PTAF_MONITOR:MONITOR:awSMThread`)
  - Source: `import PTAF_MONITOR:MONITOR:*;` (the class's own package),
    then, in a later method,
    `Local PTAF_MONITOR:MONITOR:awSMToolbar &toolBar = create PTAF_MONITOR:MONITOR:awSMThreadToolbar();`
  - Stored: the declared class's row is opened first (NAMENUM 14
    AWSMTOOLBAR, 15 AWSMTHREADTOOLBAR).
  - Encoder: opens only the created class there (14 AWSMTHREADTOOLBAR);
    the declared class's row comes at its next use (21).
  - Contrast, 28754: named imports of both classes, and the rows follow
    import order. Stored equals encoder, so it says nothing about
    declaration vs creation.
- **10860** (`GP_AUDIT_WRK.FUNCLIB` FieldFormula)
  - Source: Function `Call_Link` assigns and reads
    `&TblFilterlvl2.GetRow(&j).GP_AUD_FLTR_TBL.PIN_NUM.Value`.
    `&TblFilterlvl2` is declared `Local Rowset` only in earlier
    Functions, and those Functions read the same chain.
  - Stored: both members inline (opcode 0x0A, the name itself).
  - Encoder: 0x4A references, opening new RECORD / FIELD rows
    (NAMENUM 1303 / 1304).
- **15598** (`PSIBLOGICL2_WRK.IB_LINKDOC` FieldChange)
  - Source: top-level code reads `&xrow.GetRecord(1).IB_DOC_LBL_ID.Value`.
    `&xrow` is declared `Local Row` only in the earlier Function
    `UpdateParentPeopleCode`.
  - Stored: inline (0x0A).
  - Encoder: a 0x4A reference to the existing FIELD row.

10860 and 15598 are therefore one question: when a root variable is
declared `Local` only in another unit, does a member read in this unit
become a reference or an inline name? In Cycle 163, scoping the
declared-name test to the declaring Function fixed 10860's shape but
moved 15598 farther. The corpus does not settle it.

## Inventory (Cycle 172, this workstation)

| Item | Finding |
|---|---|
| 8.61.15 DPK (`/mnt/ou_network/peoplesoft_dev/ps86115/dpk/archives/pt-pshome8.61.15.tgz`, `pt-oracleclient-19.3.0.0.tgz`, `PT-INFRA-DPK-WIN-8.61-260617_{1,2}of2.zip`) | **Unreachable.** The autofs mount answers "No such device" because the network share is offline. Hashes were recorded while it was reachable (docs/PEOPLETOOLS_BINARIES.md): build PT861P15B_2509220501, `pside.exe` sha256 `e1d1b610…`, `pspcm.dll` `ad57fe09…`. |
| App Designer installed locally | **8.61.07 only.** It is in the Wine bottle `~/.local/share/wine-bottles/peopletools` (win64, wine-11.17) at `C:\PT8.61.07_Client_ORA` (`pside.exe`, `psdmt.exe`, `psae.exe`). An imported copy exists under Bottles (`~/.var/app/com.usebottles.bottles/.../Imported_peopletools`). Both are left untouched. |
| Oracle client (Wine) | `C:\oracle\product\19.3.0.0` |
| `tnsnames.ora` (Wine) | Institutional aliases only: HCDEV, HCTST, HCUAT, HCPRDSRV, FSTST, HCPAY, HCPPY, HCTRN. **No lab or scratch database.** |
| Separate 8.61.15 Wine prefix (`~/.wine-peoplesoft-86115`) | Absent. Creating it needs the unreachable DPK. |
| Windows host | An existing Windows 11 KVM container (dockur `omarchy-windows`, storage in `~/.windows`, 128 GB data image; also a `WinBoat` container). It belongs to the user and was not started or modified. |
| Container / VM tooling | docker, podman, virsh, qemu; `/dev/kvm` present; 16 cores, 30 GB RAM, 494 GB free |
| Oracle Database images | None present locally (no `container-registry.oracle.com/database/*`). |
| PUM / PeopleSoft VM image | None present locally. A PUM 54 / Tools 8.61.15 go-live planning spreadsheet in Downloads is a document, not an image. |
| HCDEV | Read-only (unchanged). |
| HCTST | Read-only. The HCDEV credentials are refused there, and no write authorization exists. |

## Minimum compile architecture

A PeopleCode program reaches PSPCMPROG / PSPCMNAME only when Application
Designer **saves** it. The compiler runs inside App Designer's process
(`pspcm.dll`), and the save writes the tables. So the minimum is:

- **Windows Application Designer 8.61.15** (`pside.exe`, `pspcm.dll` of
  build PT861P15B). Compiler output is patch-specific, so 8.61.07 is not
  authoritative for patch 15.
- **Two-tier Oracle connectivity:** Oracle client 19c to the lab
  database. Three-tier (App Server) also works but needs a full
  PIA/Tuxedo domain, which is unnecessary.
- **A PeopleTools-only database (PTSYS) is sufficient.** The experiments
  use only:
  - Application Packages and classes;
  - derived/work records with new fields;
  - Record PeopleCode.

  No application tables or data are needed. The objects are listed
  under `labObjects` in the experiment pack.
- **Character set does not matter for these experiments.** PSPCMPROG
  stores strings as UTF-16LE in every database. Only `PSPCMTXT.PCTEXT`
  (the source text) depends on the database character set, and every
  experiment source is ASCII. A non-Unicode WE8ISO8859P15 database
  matches HCDEV; a Unicode one is equally valid here.
- **Operator:** an operator id (PTSYS ships `PS` / `VP1`) with App
  Designer access and the rights to create and save Application
  Packages, fields, records and PeopleCode.
- **Read access** for the capture: `SYSADM.PSPCMPROG`, `PSPCMNAME`,
  `PSPCMTXT`, `PSSTATUS`.

## Decision

| Option | Gives 8.61.15 compiler | Writable DB | Safe | Completable from this agent session | Blocker |
|---|---|---|---|---|---|
| A. Wine 8.61.15 client in a separate prefix + scratch DB | yes, if pside 8.61.15 runs under Wine | needs B4 | yes | **no** | DPK share offline; no DB; App Designer saving under Wine is untested |
| B. Windows VM (existing dockur Windows 11 or new) + App Designer 8.61.15 + PTSYS scratch DB | **yes** | needs B4 | yes | **no** | DPK share offline; user consent to use the VM; Oracle DB image and license |
| C. Existing personal PeopleSoft lab database | yes, if 8.61.15 | yes | yes | **no** | none exists on this workstation |
| D. New PeopleTools-only Oracle 19c database (PTSYS from the 8.61.15 DPK) | supplies the DB for A/B | **yes** | yes | **no** | Oracle 19c image needs an Oracle account and license acceptance; PTSYS build needs PS_HOME scripts and Data Mover from the DPK (share offline) |
| E. Authorized HCTST scratch namespace | yes (8.61.15) | only with written authorization | only with authorization | **no** | no write authorization; HCDEV credentials refused |

**Chosen path: B + D.** That is App Designer 8.61.15 on a Windows VM,
saving into a PeopleTools-only Oracle 19c database built from the same
DPK. It is the only path with native Windows App Designer at the exact
patch and no institutional database involved.

**Cycle 174 recheck: media verified; stopped before installation
(conditions B, C, D).**
- The VPN (`tun0`) is up, `hcwin-dev.net.ou.edu` resolves (10.26.197.223)
  and the archive is readable.
- `dpk/pt-manifest`: tools 8.61.15, Windows, Oracle client 19.3.0.0
  Jul2025 CPU.
- `pt-pshome8.61.15.tgz` (2,234,348,986 bytes) streams with every
  client-binary sha256 matching docs/PEOPLETOOLS_BINARIES.md
  (`pside.exe` `e1d1b610…`, `pspcm.dll` `ad57fe09…`).
- `ps86115/db` is empty. No Oracle Database server media is visible on
  the share.
- No authorization has been given for any of: using the media in a
  personal lab, using `omarchy-windows`, or an Oracle 19c image and
  license. So nothing was extracted, started or installed.

**Cycle 173 recheck: still stopped (condition A).** The share is a
cifs automount of `//hcwin-dev.net.ou.edu/Peoplesoft`. The host does not
resolve (VPN not connected), and no local copy of the media exists.
Restoring that connection is provisioning step 1.

**Cycle 172 outcome: STOP BEFORE INSTALLATION.** Every option needs at
least one step that is a human or admin action: restore the media,
accept the Oracle license, authorize use of the institutional
PeopleTools media for a personal lab, and consent to using the Windows
VM. No encoder semantics changed.

## Provisioning checklist (human / admin steps, in order)

1. **Media.** Bring the network share back: connect the VPN so that
   `hcwin-dev.net.ou.edu` resolves and the automount of
   `//hcwin-dev.net.ou.edu/Peoplesoft` at `/mnt/ou_network/peoplesoft_dev`
   succeeds, or copy these to local disk:
   - `ps86115/dpk/archives/pt-pshome8.61.15.tgz`
   - `pt-oracleclient-19.3.0.0.tgz`
   - the Windows infrastructure DPK

   Verify `pside.exe` sha256 `e1d1b610…` and `pspcm.dll` `ad57fe09…`
   (docs/PEOPLETOOLS_BINARIES.md). Do not commit any of it.
2. **Authorization.** Confirm with the PeopleSoft administrator that the
   institution's PeopleTools media may be installed on a personal,
   non-production lab.
3. **Database host.** Run Oracle Database 19c Enterprise, for example
   the `container-registry.oracle.com/database/enterprise:19.3.0.0`
   container. This needs an Oracle SSO account and license acceptance.
   - Run it under podman/docker with a persistent volume.
   - Service name `PCLAB`, character set WE8ISO8859P15, national
     character set AL16UTF16.
   - Publish port 1521 to the Windows VM only.
4. **PTSYS database.** On the Windows host, from PS_HOME 8.61.15, run
   the PeopleTools database-creation scripts against `PCLAB`. These are
   the installation guide's manual Oracle path:
   - `createdb` / `utlspace` / `ptddl` / `dbowner` / `psroles` /
     `psadmin` / `connect`;
   - then the Data Mover bootstrap import of the PeopleTools system
     data.

   Resulting owner `SYSADM`, connect id `people`, operator `PS`.
   `SELECT TOOLSREL, PTPATCHREL FROM SYSADM.PSSTATUS` must return
   `8.61`, `15`.
5. **Windows App Designer.**
   - Use the existing dockur Windows 11 VM (with the user's consent) or
     a new one.
   - Extract PS_HOME 8.61.15 and install the Oracle 19c client.
   - Add a `PCLAB` entry to that VM's `tnsnames.ora`. It must not
     contain the institutional aliases.
   - In Configuration Manager, set Database type Oracle, name `PCLAB`,
     connect id `people`.
   - Sign in to App Designer two-tier as `PS`.
6. **Wine alternative (optional, after 5 works).**
   - Create a new prefix `~/.wine-peoplesoft-86115`. Never modify the
     8.61.07 bottle.
   - Install the same PS_HOME and Oracle client.
   - Save one support class and compare its PSPCMPROG with the Windows
     result. Wine is acceptable only if the bytes are identical.
7. **Capture account.** Any account that can SELECT the four tables in
   `PCLAB`. Put it in `PS_CONNECT_STRING` / `PS_USER` / `PS_PASSWORD`
   only in the shell that runs the capture. Never use the HCDEV
   variables.

## Scratch policy

- **Namespace:** everything starts with `ZZ_PCODE_LAB`.
  - Project `ZZ_PCODE_LAB`.
  - Application Packages `ZZ_PCODE_LAB`, `ZZ_PCODE_LAB:ORDERING`,
    `ZZ_PCODE_LAB:SCOPE`.
  - Derived/work records `ZZ_PCODE_LAB`, `ZZ_PCODE_LAB_P`,
    `ZZ_PCODE_LAB_T`.
  - Fields `ZZ_CASE_01`..`07`, `ZZ_LAB_KEY`, `ZZ_LAB_VAL`.
- **Capture keys:** PSPCMPROG / PSPCMNAME / PSPCMTXT rows with
  `OBJECTVALUE1 LIKE 'ZZ_PCODE_LAB%'`.
  - App Classes: `104=ZZ_PCODE_LAB, 105=<subpackage>, 107=<class>,
    12=OnExecute`.
  - Record PeopleCode: `1=ZZ_PCODE_LAB, 2=ZZ_CASE_nn, 12=FieldFormula`.
- **Rules:**
  - Never reuse or edit an existing definition.
  - Never connect the lab tools to HCDEV or HCTST. `capture-lab.ts`
    refuses institutional database names, and it refuses any database
    whose `DB_NAME` differs from `--database`.
- **Cleanup:** delete the project's objects after capture, or keep the
  lab database as is. It is disposable.

## Experiment pack

`tools/corpus/controlled-compile/experiments.json` (format
`pcode-lab-experiments/1`) holds:

- every **support definition**: seven classes, saved first;
- every **experiment**, each with:
  - its key and exact source;
  - what to observe;
  - each candidate model's prediction;
  - for the two corpus replicas, the corpus program's own observation.

App Designer may reformat a source on save. The comparison uses the
source as captured (PSPCMTXT), so that is harmless.

### 30124 family

Observe the NAMENUM order of the declared and created classes' PACKAGE
rows.

Support classes:
- in `ZZ_PCODE_LAB:ORDERING`: `PARENT`, `CHILD` (extends PARENT),
  `CHILDARG` (extends PARENT, one constructor argument), `BASECLS`,
  `DERIVED` (extends BASECLS);
- in `ZZ_PCODE_LAB:SCOPE`: `SPARENT`, `SCHILD`.

Each experiment is a class in `ZZ_PCODE_LAB:ORDERING`. The statement sits
in method `Run`, after a constructor and a method `Prepare`.

| Case | Role | Variation | Encoder predicts |
|---|---|---|---|
| H1 | positive (30124 replica; corpus: PARENT, CHILD) | wildcard import of the own package, qualified `Local PARENT &x = create CHILD();` | CHILD only (**differs from the corpus**) |
| H2 | control | bare `Local PARENT &x;`: does a method-local class declaration open its row by itself? | PARENT |
| H3 | control | H1 with the alphabetical order reversed (BASECLS / DERIVED) | DERIVED only |
| H4 | control | 28754 shape: named imports PARENT then CHILD | PARENT, CHILD |
| H5 | control | named imports CHILD then PARENT | CHILD, PARENT |
| H6 | control | other package (`ZZ_PCODE_LAB:SCOPE:*`) | SCHILD only |
| H7 | control | declaration and create split into two statements | PARENT, CHILD |
| H8 | control | constructor with an argument (CHILDARG) | CHILDARG only |
| H9 | control | after executable statements (30124's position) | CHILD only |

Models:
- `DECLARED_FIRST`: the declaration opens the declared class's row
  before the initializer's.
- `CREATED_FIRST`: the opposite.
- `IMPORT_ORDER`: named imports open rows in import order.
- `ALPHABETICAL`: the rows sort by class name.

If H1 reproduces 30124 and H2 opens PARENT, the declaration opens the
row (`DECLARED_FIRST`) under a wildcard import. H4 / H5 then say whether
named imports override it. If H1 does **not** reproduce 30124, the order
comes from compiler state or version, not from the source (stop
condition C below).

### 10860 / 15598 family

Observe, per occurrence in program order, the form of the members
`ZZ_PCODE_LAB_T` / `ZZ_LAB_VAL`:

- `:ref`: a 0x4A reference;
- `:recfield`: a 0x21 REC.FIELD reference;
- `:inline`: 0x0A, the name itself.

The detail output adds the NAMENUM each reference used, which separates
reuse of an existing row from a new one. All G programs are Record
PeopleCode on `ZZ_PCODE_LAB.ZZ_CASE_nn` FieldFormula.

| Case | Role | Variation | Encoder predicts |
|---|---|---|---|
| G1 | positive (10860 replica; corpus: ref ref inline inline) | Rowset declared Local only in Function LoadFilter, which reads `&r2.GetRow(&j).ZZ_PCODE_LAB_T.ZZ_LAB_VAL`; CallLink assigns `&r2` without declaring it and reads the same chain inside For / If / For | ref ref ref ref (**differs from the corpus**) |
| G2 | control | G1 with `Local Rowset &r2;` in CallLink too | ref ×4 |
| G3 | control | G1 with LoadFilter declaring `&r2` but never reading the chain | inline inline |
| G4 | control | `&r2` a Global | ref ×4 |
| G5 | positive (15598 replica; corpus: ref inline) | Row declared Local only in Function Prepare, which reads `&xrow.GetRecord(1).ZZ_LAB_VAL`; top-level code assigns `&xrow` and reads it | ref ref (**differs from the corpus**) |
| G6 | control | G5 with a top-level `Local Row &xrow;` | ref ref |
| G7 | control | G5 with Prepare never reading the member | inline |

Models:
- `TYPED_EVERYWHERE`
- `DECLARING_UNIT_SCOPE`: a reference only where the root is declared
  in the same unit, or is Global.
- `PROGRAM_WIDE_DECLARATION`
- `EARLIER_ROW_REUSE`: the encoder today. A reference when the root
  was declared earlier and the member's row already exists.

The encoder's own predictions (`--predict`) are consistent with
`EARLIER_ROW_REUSE` on all seven experiments. They fail to reproduce
exactly the two replicas, just as the encoder fails 10860 and 15598.

### Confirmations of Cycle 171 rules (optional)

| Case | Source | Expected (rule) |
|---|---|---|
| C1 | Function `Returns PKG:Cls`, blank line, `Local` | `2D 4F 44` |
| C2 | as C1 with `Returns string` | `2D 4F 44` |
| C3 | interface ending `end-interface` at EOF | `71 07`, self-only directory, slots kept |
| C4 | as C3 with `end-interface;` | `71 15 2D 07`, method record present |
| C5 | App Designer refuses to save C3 | the shape is historical-only |

## Runner checklist (manual path; superseded by the unattended harness)

1. `SELECT TOOLSREL, PTPATCHREL FROM SYSADM.PSSTATUS` must return 8.61
   / 15. Record the App Designer *Help > About* build.
2. Create the fields, the three derived records and project
   `ZZ_PCODE_LAB` (`labObjects` in the pack).
3. Create the packages. Save the seven support classes **first**, in
   pack order.
4. Save each experiment's source exactly. Paste it from the pack. Do not
   retype it, and do not let other edits happen in between.
5. Save each experiment once. If App Designer refuses a source, record
   the message as the result.
6. Capture, SELECT-only:
   `PS_CONNECT_STRING=PCLAB PS_USER=… PS_PASSWORD=… npx tsx tools/corpus/controlled-compile/capture-lab.ts --database PCLAB --out lab-results.json`
7. Compare, with no database:
   `npx tsx tools/corpus/compare-controlled-compile.ts --results lab-results.json --json lab-report.json --verbose`
8. Keep `lab-results.json` and `lab-report.json` with the cycle's
   research artifacts. They contain only scratch definitions.

## Ingest tool

`tools/corpus/compare-controlled-compile.ts` is the CLI over
`src/peoplecode/corpus/controlledCompile.ts`. It needs no HCDEV or
Oracle connection.

**Input:** results in format `pcode-lab-results/1`. Per definition:
- the key (OBJECTID / OBJECTVALUE 1–7);
- the experiment id;
- the PSPCMTXT source;
- the PSPCMPROG bytes (hex);
- the PSPCMNAME rows.

**Output, per definition:**
- the decoded program, and whether it matches the source;
- the reference list and NAMENUM map;
- first-use order;
- the encoder's bytes and references against the capture, with first
  differences;
- per experiment:
  - the observation (stored vs encoder);
  - whether a replica reproduced the corpus;
  - each model's verdict.

**Output, per family:**
- each model's consistent / refuted experiments;
- candidates: no refutation, at least one positive and one control
  observed, and every replica reproduced;
- where the encoder disagrees.

**Encode context:** the corpus harness's.
- Owner and package path come from the key.
- OBJECTID1 104 selects Application Class mode.
- The type metadata is built from the lab's own captured classes.
- `#ToolsRel` is the lab's major.minor release.

`--predict` runs the comparison over the encoder's own output. That is
a prediction table, never evidence.

## Interpretation and stop conditions

- **A model becomes a rule only when it is a candidate:**
  - no refutation;
  - at least one positive and one control observed;
  - replicas reproduced;
  - it holds on the whole corpus with 0 regressions, 430/430 protected
    and the fallback six unchanged.

  Then implement it generically. Never key it on a definition or a
  source fingerprint.
- **C. H1 does not reproduce 30124.** 30124's order is a compiler-state
  or version artifact. Classify it as such and change nothing.
- **D. G1 / G5 do not reproduce, or the G controls cannot separate the
  models.** Classify 10860 / 15598 as source-indistinguishable and
  change nothing.
- **E. A candidate regresses any EXACT program.** Reject it.
- **F. Any step would require writing HCDEV or HCTST.** Stop.
