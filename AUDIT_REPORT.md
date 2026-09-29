.## Architecture Consolidation Audit

**1. Current HEAD:** `6731001` — clean, pushed, synced with `origin/main`.

**2-3. Current baseline (reproduced fresh):**
```
TOTAL = 30,209   EXACT = 25,265   NONEXACT = 4,944   EXACT% = 83.63%
```
0 regressions on the protected gate.

**4. Top NONEXACT categories (fresh taxonomy rebuild):**

| Category | Count |
|---|---|
| REFERENCE_ACTIVE_RECORD_FIELD | 1,232 |
| REFERENCE_COMPLETE_DOWNSTREAM | 843 |
| REFERENCE_ACTIVE_FIELD | 785 |
| REFERENCE_ACTIVE_PACKAGE | 608 |
| REFERENCE_ACTIVE_RECORD | 439 |
| UNSUPPORTED_SYNTAX | 335 |
| REFERENCE_ACTIVE_OTHER | 146 |
| REFERENCE_ACTIVE_SCROLL | 144 |
| ENCODE_ERROR | 122 |
| REFERENCE_ACTIVE_DECLARE_FUNCTION | 89 |
| DECODE_SOURCE_MISMATCH | 82 |
| STRUCTURAL_ORDERING | 69 |
| DECODER_BARE_IDENTIFIER | 26 |
| ROUNDTRIP_ONLY | 18 |
| REFERENCE_ACTIVE_QUOTED_COMPONENT | 6 |

---

### 5-6. Architecture map (encoder / decoder)

The whole compiler lives in two files with no intermediate representation:

```
encoder.ts (13,534 lines, one function-scoped closure)
  parsing            — inline recursive-descent, interleaved with emission
  type dispatch      — 6 independent if/else-if chains (see #7)
  reference alloc    — 7-8 independent pool/scope mechanisms (see #10)
  statement compile   — ~40 statement-shaped functions (ifStatement, forStatement,
                        evaluateStatement, tryStatement, functionStatement, ...),
                        each owning its OWN trivia/boundary logic inline
  trivia/layout      — no shared model; ad hoc lookahead + raw byte pushes,
                        duplicated per statement (see #6, #8)
  App Class handling — encodeApplicationClassProgramV2 + parseApplicationClassProgram
                        + applicationClassProgram.ts, a partially separate subsystem
                        with its own cross-fragment state threading
  binary serialize   — Buffer.concat of raw opcode bytes, interleaved with parsing
                        (parsing and serialization are the same pass — no CST between)

decoder.ts (2,510 lines)
  binary decode      — one token loop over PSPCMPROG bytes
  format lookup      — format.ts's static OPCODES map (kind/text/format flags),
                        shared with encoder's fixed() for keyword/punctuation TEXT
  operand decode     — decoder-only OPERAND_FORMAT map (dynamic-operand opcodes)
  boundary inference — 7 parallel followsXHeader booleans from one lookback loop
  rendering          — same pass as decode (token → text is interleaved, not staged)
```

Parsing and serialization are the **same pass** in the encoder (no CST/IR sits between source text and bytes); decode and render are likewise the same pass in the decoder. This is target 4/7's core finding: there is no lossless intermediate representation on either side — each direction goes straight from its input to its output, which is exactly why trivia/boundary knowledge can't be shared between the two directions or reused across call sites within one direction.

### 7. Duplicate type-dispatch locations

6 independently-maintained `type → PACKAGE reference` chains, ~59 call sites total, confirmed by direct line-range extraction:

| Site | Types covered |
|---|---|
| `localDeclaration()` — array-element-type | File, XmlDoc, XmlNode, Record, Field, Rowset, Row, SQL (8) |
| `localDeclaration()` — plain type | all 16 (canonical/most-complete) |
| `globalDeclaration()` | Record, File, Rowset (3 — narrowest) |
| `componentDeclaration()` | Record, Rowset, XmlDoc, File, ApiObject, Row (6) |
| `registerTypedParameter()` (App Class methods) | Record, Row, Rowset, SQL, ApiObject, Grid, Message (7) |
| `functionStatement()` parameter chain | File, SQL, ApiObject, Grid, Message, Field (this session added Field, Rowset) |
| `functionStatement()` Returns chain | all 16 (this session, newly added) |

No two chains agree on coverage, and — per this session's own findings — some gaps are genuine grammar restrictions (Field/Rowset *were* wrongly excluded from parameter contexts until re-investigated) while others are simply unimplemented. A registry cannot currently distinguish "not yet evidenced" from "genuinely excluded by grammar" — that distinction only exists in scattered code comments.

### 8. Duplicated inline-comment-placement rule

8 call sites of the identical `source.startsWith('/*', pos) && !blockCommentStartsOwnLine()` → `inlineBlockComment()` pattern:
```
line 4781  andExpression() — leading operand comment
line 4854  (And-group continuation)
line 4875  orExpression() equivalent
line 4943  (Or-group continuation)
line 6147  When-Other header       ← this session
line 6428  catch header            ← this session
line 7622  End-Function            ← this session
line 7832  ordinary When header
```
4 of the 8 existing sites were added *this session*, each independently, each re-deriving the same "is this comment glued to the preceding token on this source line" answer that the OPCODE ITSELF already unambiguously encodes (0x4E vs 0x24) on the decode side. Source-encode has no opcode yet, so it must infer placement from text — and every site above is a separate, hand-written inference of the identical rule.

### 9. Structural-boundary (0x2D/0x4F) emission sites

17 raw `chunks.push(Buffer.from([0x2d]))` sites, 40 raw `[0x4f]` sites, and **59 separate occurrences** of the `Math.max(1, newlineCount - 1)` blank-line-multiplicity idiom, each hand-copied into its own statement handler (When, When-Other, For, While, try/catch, Evaluate, Function, top-level declaration runs, …). This is the single largest source of duplicated logic in the file by occurrence count.

### 10. Duplicated reference-allocation scope mechanisms

At least 8 independently-named pools/scopes, each with its own key scheme and lifetime rule:
```
runtimeCreateReferences        Map<string, Reference>          — create X:Y() dedup
localObjectPackageReferences   Map, key: controlGroup:functionDepth:type — built-in type dedup
applicationClassVariables /
  functionApplicationClassVariables                            — App Class var tracking
htmlDependencyScope            HtmlDependencyScope class
dependencyScope                DependencyScope object           — Record/Field reuse
fieldDependencyScope           FieldDependencyScope object
readTracedReusePool / writeTracedReusePool                      — a third reuse mechanism
applicationClassReferenceScope ApplicationClassReferenceScope,
  .beginFragment() sessions                                     — class/method-wide identity
```
These represent genuinely different *lifetimes* (control-group-scoped, function-depth-scoped, method-wide, class-wide) that should be facets of one explicit scope model, not 8 separately-invented data structures.

### 11. Cross-fragment cursor/state mechanisms

`commentOpcodeIndex` (line 871) is a **fragment-local** counter, reset to 0 on every `encodeFragmentInternal` call. `nextCommentOpcodeIndex` / `nextReferenceIndex` (lines 12751-12752) are hand-threaded counters living in `encodeApplicationClassProgramV2`'s own closure, manually passed into each fragment as `referenceIndexOffset` / a sliced `commentOpcodes` array — this is exactly the shape of bug Cycle 81 fixed once already (a fragment silently re-reading another fragment's slot) and is structurally still fragile: any new fragment-emission call site that forgets to thread these two counters correctly reproduces Cycle 81's bug. This state belongs to a `ClassCompilationState` object fragments read from, not two loose closure variables threaded by convention.

### 12. Decoder rules re-deriving already-known information

The clearest case: `blockCommentStartsOwnLine()` (encoder, source-text heuristic) re-derives what the `0x4E` vs `0x24` opcode *already states outright* on the decode side. The encoder has no way to consult "ground truth" during source-encode (there are no bytes yet), so every one of the 8 sites in #8 is a hand-written attempt to predict what the compiler would have chosen — this is the root mechanism behind 4 of this session's fixes and likely several more not yet found.

The decoder's own `followsCatchHeader` / `followsWhileHeader` / `followsForHeader` / `followsFunctionHeader` / `followsWhenHeader` / `followsMethodOrGetHeader` (6 parallel booleans, one shared lookback loop, `decoder.ts:1853-1859`) are a second, smaller instance of the same shape: one abstraction ("does this structural 0x2D immediately precede a bare `;`, closing this header inline") implemented as N parallel flags instead of one opcode→semantic lookup.

### 13. Roundtrip provenance side channels

`context.commentOpcodes` (validator-supplied array, decoder-derived) is consulted at 6 call sites via `consumeCommentOpcode()` — used ONLY for the roundtrip test, never for source-encode (TEST A), which is precisely why the comment-placement bugs in this session were invisible to roundtrip testing and only showed up as `source→bin` mismatches. This split-brain (one path has ground truth, the other must guess) is itself worth naming explicitly in the architecture rather than leaving implicit in which context fields happen to be populated.

---

### 14-16. Candidate abstractions

**(a) Trivia/boundary model** (targets 1, 5, 6): one `TrailingTrivia` concept — `{ inlineComment?: Comment, ownLineComments: Comment[], blankLinesBefore: number }` — parsed ONCE per statement terminator position and consulted by every statement handler, replacing all 8 inline-comment sites and collapsing the 59 blank-line-multiplicity duplicates into one `emitBoundary(kind, trivia)` function that owns the `0x2D`/`0x4F` emission order. This directly explains and would prevent: When/When-Other/End-Function/catch (already fixed 4x this session), and predicts the still-open For-header and generic-statement-header cases.

**(b) Built-in type registry** (target 2): one table `BUILTIN_TYPES: Record<Name, { opcode, packageKey, allowedContexts: Set<Context> }>`, with `allowedContexts` populated only from corpus-proven evidence (not assumed symmetric) — replacing the 6 chains in #7. Contexts that are currently narrower for genuine grammatical reasons (e.g., `globalDeclaration()`'s narrower list) must be preserved as explicit per-context restrictions in the table, not silently widened.

**(c) Explicit compilation-unit reference state** (target 3): a `ClassCompilationState` object owning `nextReferenceIndex`, `nextCommentOpcodeIndex`, and the class-wide/method-wide reference pools, passed by reference into each fragment rather than threaded by convention — replacing #11's manual threading and reducing (though not eliminating) #10's proliferation of separate pools.

### 17. Which special cases each replaces

(a) replaces all 8 sites in #8 plus the 59 blank-line-multiplicity duplicates in #9 — the single highest-leverage refactor given this session's own evidence (4 identical fixes in a row). (b) replaces the 6 chains in #7, but requires the audit trail of per-context evidence already recorded in code comments to migrate into the table's `allowedContexts`, not just the type names. (c) replaces #11's threading and reduces #10, but is higher-risk (touches the App Class fragment machinery Cycle 81 already destabilized once).

### 18. Regression risk

(a) LOW-MEDIUM: purely additive at each of the 8+ call sites today; consolidating them into one function is a mechanical refactor if done by literally extracting the existing predicate first and proving byte-identical output on all 8 call sites before changing anything else. (b) MEDIUM: the risk is losing a currently-correct narrower restriction (e.g., `globalDeclaration()`'s deliberately-narrow list) by over-generalizing — mitigated by encoding restrictions as explicit per-context data rather than assuming one universal list. (c) HIGH: this is the machinery Cycle 81 already had to fix once for exactly this reason; any touch here needs the full corpus gate plus targeted Application Class regression samples, not just the protected 430.

### 19. Expected categories most likely to improve

`REFERENCE_COMPLETE_DOWNSTREAM` (843) most directly — it's where every comment/boundary-ordering bug this session was found. `REFERENCE_ACTIVE_PACKAGE` (608) and `REFERENCE_ACTIVE_RECORD_FIELD`'s PACKAGE-prefixed sub-clusters would benefit from (b). `STRUCTURAL_ORDERING` (69) is almost certainly entirely explained by (a)'s gap.

---

### Proposed first refactor

**(a), the trivia/boundary model**, extracted narrowly first: a single `captureTrailingInlineComment()` helper replacing the 4 duplicate blocks I personally added this session (When, When-Other, End-Function, catch) plus the 4 pre-existing And/Or-group ones — proven equivalent by running it through all 8 current call sites and confirming byte-identical output on their own fail-before/pass-after fixtures, then the full corpus gate. This satisfies the refactor rule directly: 8 existing sites express one semantic rule, strong corpus evidence (4 fixes landed this session alone), negative controls exist (the And/Or-group tests already in `encoder.test.ts`), and it removes real duplication.

I'll start there. Want me to proceed with that extraction now, or discuss the shape of the abstraction first?