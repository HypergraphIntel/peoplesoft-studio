export enum TokenKind {
  Name = 'name',
  StringLiteral = 'string',
  NumberLiteral = 'number',
  Keyword = 'keyword',
  Punctuation = 'punct',
  Newline = 'newline',
  Comment = 'comment',
  /** The fixed preamble every program starts with; see {@link matchHeader}. */
  Header = 'header',
  Unknown = 'unknown'
}

interface OpcodeSpec {
  kind: TokenKind;
  text?: string;
  format: number;
}


/**
 * Formatting bitmask flags, adopted from PeopleCodeParser.java's format
 * model (see file header). `NONE`/`PUNCTUATION` is deliberately zero.
 */
export const FMT = {
  NONE: 0,
  SPACE_BEFORE: 0x1,
  SPACE_AFTER: 0x2,
  NEWLINE_BEFORE: 0x4,
  NEWLINE_AFTER: 0x8,
  INCREASE_INDENT: 0x10,
  DECREASE_INDENT: 0x20,
  NO_SPACE_BEFORE: 0x200,
  NO_SPACE_AFTER: 0x400,
  INCREASE_INDENT_ONCE: 0x800,
  NEWLINE_ONCE: 0x2000,
  SEMICOLON: 0x8000
} as const;

const F = FMT;
const SPACE_BOTH = F.SPACE_BEFORE | F.SPACE_AFTER;
const NEWLINE_BEFORE_SPACE_AFTER = F.NEWLINE_BEFORE | F.SPACE_AFTER;
const AND_OR_STYLE = F.NEWLINE_AFTER | F.SPACE_BEFORE;
const FOR_STYLE = F.NEWLINE_BEFORE | F.SPACE_AFTER | F.INCREASE_INDENT;
const IF_STYLE = F.NEWLINE_BEFORE | F.SPACE_BEFORE | F.SPACE_AFTER;
const THEN_STYLE = F.SPACE_BEFORE | F.NEWLINE_AFTER | F.SPACE_AFTER | F.INCREASE_INDENT;
const ELSE_STYLE = F.NEWLINE_BEFORE | F.DECREASE_INDENT | F.NEWLINE_AFTER | F.INCREASE_INDENT;
// No NEWLINE_AFTER here: every End-If/End-While/End-For in the byte stream
// is followed by a real 0x15 (`;`), which already supplies the line break
// (see 0x37's note below on the analogous End-Function case). Adding one
// here too just splits "End-If" and ";" onto separate lines.
const ENDBLOCK_STYLE = F.NEWLINE_BEFORE | F.SPACE_BEFORE | F.DECREASE_INDENT;
const FUNCTION_STYLE = F.NEWLINE_BEFORE | F.SPACE_AFTER | F.INCREASE_INDENT;
// Same reasoning as ENDBLOCK_STYLE on NEWLINE_AFTER -- the real 0x15 after
// End-Function/End-Method already supplies the line break. DECREASE_INDENT
// was missing here: nothing ever brought the indent level back down after a
// Function/Method body, so a program with several functions rendered each
// one more indented than the last (confirmed on WEBLIB_OU_LP.ISCRIPT2,
// whose ten functions drifted from 2 spaces to 20 before this fix).
const END_FUNCTION_STYLE = F.NEWLINE_BEFORE | F.DECREASE_INDENT;
const EVALUATE_STYLE = F.NEWLINE_BEFORE | F.SPACE_AFTER | F.INCREASE_INDENT;
// Each `When`/`When-Other` sits at Evaluate's own indent level, but its own
// body is one more indented -- decrease back to Evaluate's level before the
// keyword, then increase again for what follows it.
const WHEN_STYLE = F.DECREASE_INDENT | NEWLINE_BEFORE_SPACE_AFTER | F.INCREASE_INDENT;
const WHEN_OTHER_STYLE =
  F.DECREASE_INDENT |
  F.NEWLINE_BEFORE |
  F.NEWLINE_AFTER |
  F.INCREASE_INDENT;
const TRY_STYLE = F.NEWLINE_BEFORE | F.NEWLINE_AFTER | F.INCREASE_INDENT;
// `catch` is followed by `Exception &e` on the same line, unlike `try`/
// `end-try` -- SPACE_AFTER, not NEWLINE_AFTER. DECREASE_INDENT is applied
// before the newline/indent write (render() does DECREASE_INDENT first), so
// `catch` itself lands back at `try`'s own level; INCREASE_INDENT is applied
// after writing its text, so it only affects lines that follow.
const CATCH_STYLE = F.NEWLINE_BEFORE | F.DECREASE_INDENT | F.SPACE_AFTER | F.INCREASE_INDENT;


/**
 * Opcode table. Entries confirmed independently against real programs (see
 * file header and docs/ROADMAP.md) plus entries adopted from
 * PeopleCodeParser.java, all attributed there. Speculative entries do not
 * belong here -- an unmapped opcode is reported, not approximated.
 */
export const OPCODES = new Map<number, OpcodeSpec>([
  // -- Independently confirmed against real programs --
  [0x1c, { kind: TokenKind.Keyword, text: 'If', format: IF_STYLE }],
  [0x0b, { kind: TokenKind.Punctuation, text: '(', format: F.NO_SPACE_AFTER }],
  [0x14, { kind: TokenKind.Punctuation, text: ')', format: F.NO_SPACE_BEFORE }],
  [0x06, { kind: TokenKind.Punctuation, text: '=', format: SPACE_BOTH }],
  [0x1f, { kind: TokenKind.Keyword, text: 'Then', format: THEN_STYLE }],
  [0x1a, { kind: TokenKind.Keyword, text: 'End-If', format: ENDBLOCK_STYLE }],
  [0x2c, { kind: TokenKind.Keyword, text: 'End-For', format: ENDBLOCK_STYLE }],
  [0x3c, { kind: TokenKind.Keyword, text: 'Evaluate', format: EVALUATE_STYLE }],
  [0x3e, { kind: TokenKind.Keyword, text: 'When-Other', format: WHEN_OTHER_STYLE }],
  [0x3f, { kind: TokenKind.Keyword, text: 'End-Evaluate', format: ENDBLOCK_STYLE }],
  [0x15, { kind: TokenKind.Punctuation, text: ';', format: F.SEMICOLON | F.NEWLINE_AFTER | F.NO_SPACE_BEFORE }],
  [0x07, { kind: TokenKind.Keyword, text: '', format: SPACE_BOTH }],
  [0x2f, { kind: TokenKind.Keyword, text: 'True', format: SPACE_BOTH }],
  [0x30, { kind: TokenKind.Keyword, text: 'False', format: SPACE_BOTH }],
  [0x03, { kind: TokenKind.Punctuation, text: ',', format: F.NO_SPACE_BEFORE | F.SPACE_AFTER }],
  [0x05, { kind: TokenKind.Punctuation, text: '.', format: F.NO_SPACE_BEFORE | F.NO_SPACE_AFTER }],
  [0x23, { kind: TokenKind.Punctuation, text: '|', format: SPACE_BOTH }],
  [0x19, { kind: TokenKind.Keyword, text: 'Else', format: ELSE_STYLE }],
  [0x32, { kind: TokenKind.Keyword, text: 'Function', format: FUNCTION_STYLE }],
  [0x35, { kind: TokenKind.Keyword, text: 'As', format: SPACE_BOTH }],
  [0x37, { kind: TokenKind.Keyword, text: 'End-Function', format: END_FUNCTION_STYLE }],
  [0x39, { kind: TokenKind.Keyword, text: 'Returns', format: SPACE_BOTH }],
  [0x25, { kind: TokenKind.Keyword, text: 'While', format: FOR_STYLE }],
  // PeopleCode's Repeat/Until loop -- found scanning the live database
  // (pass forty). 0x27 always sits right after a statement boundary and
  // right before the loop body's first real statement, no condition on
  // its own line (same shape as Try, hence TRY_STYLE); 0x28 always sits
  // right after the body's last `;` and right before the exit condition
  // (a bare comparison or a parenthesised expression), which the real
  // `;` immediately after already terminates. Confirmed across three
  // independent programs (ADS_DMW.SelectBuilder.OnExecute twice,
  // ADSM.CompareDataManager.OnExecute): a real `Find`/`Substring`-parsing
  // loop reads `&start = 1;\n[0x27]&found = Find(...);\n...\n&start =
  // &found + 1;\n[0x28]&found <= 0;`, which is exactly `Repeat ... Until
  // &found <= 0;`. See docs/ROADMAP.md pass forty.
  [0x27, { kind: TokenKind.Keyword, text: 'Repeat', format: TRY_STYLE }],
  [0x28, { kind: TokenKind.Keyword, text: 'Until', format: F.NEWLINE_BEFORE | F.DECREASE_INDENT | F.SPACE_AFTER }],
  [0x26, { kind: TokenKind.Keyword, text: 'End-While', format: ENDBLOCK_STYLE }],
  [0x2e, { kind: TokenKind.Keyword, text: 'Break', format: F.SPACE_BEFORE }],
  // A bare statement keyword, same shape as Break: confirmed identically
  // 3/3 across the whole corpus (WEBLIB_EOAW.EOAW_MON_ADHOC(_NUI) and
  // WEBLIB_PTAF.PTAFAW_MON_ADHOC), each program's only unmapped opcode,
  // always `%Response.RedirectURL(&URL);\n Exit;\n End-If;`. See
  // docs/ROADMAP.md pass thirty-eight.
  [0x43, { kind: TokenKind.Keyword, text: 'Exit', format: F.SPACE_BEFORE }],
  [0x44, { kind: TokenKind.Keyword, text: 'Local', format: NEWLINE_BEFORE_SPACE_AFTER }],
  [0x45, { kind: TokenKind.Keyword, text: 'Global', format: NEWLINE_BEFORE_SPACE_AFTER }],
  // The third scope declarator alongside Local/Global: confirmed against
  // four programs whose real source is a single top-level
  // `Component <type> &var;` declaration (e.g. `Component string
  // &CurrentTP_CREFName;`), each the program's only unmapped opcode.
  // Structurally confirmed on the corpus (10/10 programs with a small
  // unmapped-opcode count): always right after a statement boundary
  // (program start, `;`, or a newline) and right before either a type
  // keyword (0x40) or a bare declared name. See docs/ROADMAP.md pass
  // twenty-three.
  [0x54, { kind: TokenKind.Keyword, text: 'Component', format: NEWLINE_BEFORE_SPACE_AFTER }],
  // A literal, the same shape as True/False: confirmed against
  // WEBLIB_HMCRWSDL.HMCR_WSDL_DISCOVER.FieldFormula's real
  // `If &PortalFolder <> Null Then`, its only unmapped opcode.
  // Structurally confirmed on the corpus (23/23): always right after a
  // comparison operator, `=`, `(` or `,` -- everywhere a value is
  // expected, never a keyword position. See docs/ROADMAP.md pass
  // twenty-three.
  [0x4b, { kind: TokenKind.Keyword, text: 'Null', format: SPACE_BOTH }],
  // The `Error`/`Warning`-style statement keyword: confirmed byte-for-byte
  // against WEBLIB_GS_DUO.ISCRIPT1 (`Error ("No default DUO setup
  // selected...");`) and WEBLIB_OU_TN.HTML_FUNCS (`Then\n Error
  // MsgGet(30002, ...)` -- confirming it takes a following bare statement,
  // not necessarily its own parenthesised call, and that the newline before
  // it is real even directly after `Then`). Structurally confirmed 4/4 on
  // the corpus (always right after a newline or `Then`, right before `(`
  // or a bare name). See docs/ROADMAP.md pass twenty-four.
  [0x1b, { kind: TokenKind.Keyword, text: 'Error', format: NEWLINE_BEFORE_SPACE_AFTER }],
  // A `For`/`To` loop's optional step value (`For &i = &x.Len To 1 Step -
  // 1`): confirmed byte-for-byte against WEBLIB_HRCD.ISCRIPT2, its only
  // unmapped opcode. Structurally confirmed 3/3 on the corpus (always right
  // after a number literal, right before `-`).
  [0x2b, { kind: TokenKind.Keyword, text: 'Step', format: SPACE_BOTH }],
  // A fourth declarator alongside Local/Global/Component: confirmed against
  // WEBLIB_PTTILE.ISCRIPT1's real `Constant &QUERYPARAMETER_ID = "ID";`,
  // twice in the same program. Structurally confirmed 20/20 on the corpus
  // (always right after a statement boundary, right before a `&variable`).
  [0x56, { kind: TokenKind.Keyword, text: 'Constant', format: NEWLINE_BEFORE_SPACE_AFTER }],
  // Raises an exception: confirmed against WEBLIB_PTSF.ISCRIPT1's real
  // `throw CreateException(262, 2018, "Search Exception: %1 ", &sError);`,
  // its only unmapped opcode.
  [0x68, { kind: TokenKind.Keyword, text: 'throw', format: NEWLINE_BEFORE_SPACE_AFTER }],
  // A fifth declarator, PeopleCode's component-interface object lifetime
  // scope: confirmed against WEBLIB_PTPN.PTPN_ISCRIPT.SavePreChange's real
  // `ComponentLife PTPN_PUBLISH:PublishToWindow &wlSrch;`, its only
  // unmapped opcode. See docs/ROADMAP.md pass twenty-seven.
  [0x79, { kind: TokenKind.Keyword, text: 'ComponentLife', format: NEWLINE_BEFORE_SPACE_AFTER }],
  [0x58, { kind: TokenKind.Keyword, text: 'import', format: SPACE_BOTH }],
  // `Declare Function X Library "dllname" (...)`: an external DLL
  // function declaration. Confirmed against APPS_RLR.Utilities.
  // OnExecute's real `Declare Function RegCloseKey Library "advapi32"
  // (...)`, sitting right between the function name and the quoted DLL
  // name -- the well-known, unambiguous PeopleCode external-library
  // syntax. See docs/ROADMAP.md pass forty-one.
  [0x33, { kind: TokenKind.Keyword, text: 'Library', format: SPACE_BOTH }],
  // `Declare Function X Library "dllname" Alias "RealDllExportName"
  // (...)`: when the PeopleCode-visible function name differs from the
  // DLL's own exported symbol. Confirmed against GS_UTILS_WRK.
  // GS_OS_FUNCS.FieldFormula's real `Declare Function CopyStringToPtr
  // Library "kernel32" Alias "RtlMoveMemory" (...)`.
  [0x34, { kind: TokenKind.Keyword, text: 'Alias', format: SPACE_BOTH }],
  // A DLL-declared parameter's passing mode: `(long Value As number)`
  // sits between the C-side type and the PeopleCode-side `As <type>`.
  // Confirmed against the same APPS_RLR.Utilities.OnExecute DLL
  // declaration as 0x33 (`Library`) above. Corroborated independently by
  // a reference PeopleCodeParser.java (a separate, older decompiler
  // project) which lists this exact byte value for this exact keyword.
  // `Ref` (0x3b), its pass-by-reference sibling, is the same shape.
  // See docs/ROADMAP.md pass forty-two.
  [0x36, { kind: TokenKind.Keyword, text: 'Value', format: SPACE_BOTH }],
  [0x3b, { kind: TokenKind.Keyword, text: 'Ref', format: SPACE_BOTH }],
  [0x57, { kind: TokenKind.Punctuation, text: ':', format: F.NO_SPACE_BEFORE | F.NO_SPACE_AFTER }],
  [0x38, { kind: TokenKind.Keyword, text: 'Return', format: SPACE_BOTH }],
  [0x2d, { kind: TokenKind.Newline, text: '', format: F.NEWLINE_ONCE }],
  [0x4f, { kind: TokenKind.Newline, text: '', format: F.NEWLINE_AFTER }],
  // A zero-width "clause just ended" marker: confirmed by hand-walking every
  // context it appears in across the corpus -- immediately before `;` in a
  // `Declare Function ... PeopleCode Rec.Field Event;` statement, before `)`
  // closing a parenthesised boolean sub-expression, and before `Then` ending
  // an If condition -- and in every one of those, the source has no
  // character at all between the token before it and the token after, so
  // rendering nothing is correct regardless of grammatical context rather
  // than needing a lookahead gate the way 0x41 below does. 491 occurrences
  // corpus-wide; see docs/ROADMAP.md pass twenty-one.
  [0x42, { kind: TokenKind.Punctuation, text: '', format: F.NONE }],
  // Two more opcodes found by decoding every program in the live database
  // rather than just the 204-program calibration corpus (see
  // docs/ROADMAP.md pass thirty-nine) -- neither appeared with a small
  // enough unmapped-count anywhere in the corpus itself to stand out, but
  // the full database turned up dozens of programs where it was the
  // *only* unmapped opcode. Both are delivered PeopleSoft base objects
  // with no project-export source to check literally against, so
  // confirmation here is structural rather than text-diffed -- but on 13
  // combined independent occurrences, zero counter-examples, with one
  // smoking-gun case for 0x51 (below).
  //
  // 0x20 is `Warning`, the statement-level sibling of `Error` (0x1b), and
  // shares its format. PeopleCodeParser.java names this byte value
  // outright; the structural evidence gathered here before consulting it
  // says the same thing and had simply stopped one step short. Every
  // occurrence sits directly after a statement boundary (`;` or `Then`)
  // and directly before a real `(` that opens a bare, unassigned function
  // call used as a whole statement -- `(MsgGet(6540, 127, "..."));`,
  // PeopleCode's single most common `Warning`/`Error` idiom -- and never
  // before a call whose result is used. That was read here as a "this
  // statement is just an expression" marker and rendered zero-width,
  // which silently dropped the keyword: the decoded text then reads as an
  // unconditional bare call rather than a warning, which is exactly the
  // "compiles and means something different" failure this decoder exists
  // to avoid. The samples it was derived from are delivered PeopleSoft
  // base objects with no project-export source to diff against, which is
  // why the missing word could not be seen from the bytes alone.
  [0x20, { kind: TokenKind.Keyword, text: 'Warning', format: NEWLINE_BEFORE_SPACE_AFTER }],
  // 0x51: sits wherever 0x44 (`Local`) does -- directly before a type (a
  // real type keyword or a bare object-type identifier like `Record`/
  // `Field`) and a `&var;` -- but specifically where the source declares
  // the variable with no scope keyword at all. PeopleCode allows a bare
  // `<type> &var;` at a program's top level (implicitly Local scope); the
  // clincher is AE_WRK.AE_BIND_VALUE.FieldEdit, which declares all four of
  // `Local Record &MYREC;`, `Field &MYFLD;`, `Local Field &FLD;` and
  // `Local Record &REC;` back to back -- the three with an explicit
  // `Local` decode via 0x44 exactly as already confirmed, and only the
  // one genuinely missing it (`Field &MYFLD;`, PeopleCode's well-known
  // implicit-current-field idiom) carries 0x51 instead.
  [0x51, { kind: TokenKind.Punctuation, text: '', format: F.NONE }],

  // try/catch/end-try (0x65/0x66/0x67): confirmed byte-for-byte against
  // WEBLIB_MSGWSDL.WSDLSUMMARY.FieldFormula, a plain record-field Function
  // program (not an Application Class -- no isApplicationClass gating
  // needed, unlike class/method below), whose real source is a single
  // try/catch/end-try wrapping the whole function body. These same three
  // keywords were part of the large Application Class vocabulary rejected
  // in pass sixteen when wholesale-adopting PeopleCodeParser.java's table --
  // that rejection was of the reference project's own byte values for them,
  // which are different from 0x65/0x66/0x67 and evidently wrong on this
  // database; these were found independently by hand-walking, the same way
  // as every entry above, not adopted from that source. See
  // docs/ROADMAP.md pass twenty-two.
  [0x65, { kind: TokenKind.Keyword, text: 'try', format: TRY_STYLE }],
  [0x66, { kind: TokenKind.Keyword, text: 'catch', format: CATCH_STYLE }],
  [0x67, { kind: TokenKind.Keyword, text: 'end-try', format: ENDBLOCK_STYLE }],

  // -- Adopted from PeopleCodeParser.java (see file header), then filtered
  //    against this database's own 204-program corpus via
  //    scripts/corpus-validate.mjs before shipping, the same discipline
  //    applied to every entry above.
  //
  //    Punctuation (comparison/arithmetic operators, `**`, `@`, `[`, `]`)
  //    carries essentially no risk of colliding with the Application Class
  //    trailer noise described in the file header -- a stray byte matching
  //    `>=` is far less consequential and far less detectable than one
  //    matching a whole keyword -- and corpus coverage rose cleanly with
  //    these added, so they are kept without a per-opcode accuracy figure
  //    (corpus-validate.mjs does not score punctuation).
  //
  //    Every adopted KEYWORD opcode, in contrast, was measured individually:
  //    of ~60 candidates, only the 8 below matched their program's real
  //    source at or above 95% (the same bar this project has used
  //    throughout, e.g. 99.76% for 0x21). The rest -- And/Or's neighbours
  //    like Warning (14.5%), Repeat (0.9%), method/private/try/catch/etc.
  //    (5-80%) -- were disproven on this corpus and are deliberately left
  //    out, exactly like the seven removed below. That the wrong ones
  //    cluster around Application Class syntax (method, property, private,
  //    try/catch, interface, class-adjacent keywords) matches the trailer
  //    theory: those programs' method-dispatch trailers are binary data
  //    that happens to coincide with real opcode bytes.
  [0x04, { kind: TokenKind.Punctuation, text: '/', format: SPACE_BOTH }],
  [0x08, { kind: TokenKind.Punctuation, text: '>=', format: SPACE_BOTH }],
  [0x09, { kind: TokenKind.Punctuation, text: '>', format: SPACE_BOTH }],
  [0x0c, { kind: TokenKind.Punctuation, text: '<=', format: SPACE_BOTH }],
  [0x0d, { kind: TokenKind.Punctuation, text: '<', format: SPACE_BOTH }],
  [0x0e, { kind: TokenKind.Punctuation, text: '-', format: SPACE_BOTH }],
  [0x0f, { kind: TokenKind.Punctuation, text: '*', format: SPACE_BOTH }],
  [0x10, { kind: TokenKind.Punctuation, text: '<>', format: SPACE_BOTH }],
  [0x13, { kind: TokenKind.Punctuation, text: '+', format: SPACE_BOTH }],
  [0x46, { kind: TokenKind.Punctuation, text: '**', format: F.NONE }],
  [0x47, { kind: TokenKind.Punctuation, text: '@', format: F.SPACE_BEFORE | F.NO_SPACE_AFTER }],
  [0x4c, { kind: TokenKind.Punctuation, text: '[', format: F.SPACE_BEFORE | F.NO_SPACE_AFTER }],
  [0x4d, { kind: TokenKind.Punctuation, text: ']', format: F.NO_SPACE_BEFORE | F.SPACE_AFTER }],
  [0x59, { kind: TokenKind.Punctuation, text: '*', format: SPACE_BOTH }],

  // Keyword survivors (>=95% real-source match; see note above):
  //   0x18 And 98.7%, 0x1d Not 98.1%, 0x1e Or 100%, 0x29 For 99.1%,
  //   0x2a To 98.0%, 0x3d When 96.7%, 0x5f get 98.5%, 0x69 create 95.4%.
  //
  // End-For (0x2c), True (0x2f), Evaluate/When-Other/End-Evaluate
  // (0x3c/0x3e/0x3f), While/End-While (0x25/0x26), Break (0x2e) and Global
  // (0x45) were retried after noticing the same corruption-noise pattern
  // already known from pass eighteen's trailer work: a handful of
  // heavily-corrupted programs (unrelated decode failures elsewhere, e.g.
  // WEBLIB_MCF.ISCRIPT1 with thousands of unmapped opcodes) throw off naive
  // corpus-wide scoring by misattributing garbage bytes to whatever opcode
  // happens to follow. Scored only against programs with a small
  // unmapped-opcode count (<=25, well above what any of these need on their
  // own), all 100%: 0x2c (48/48), 0x2f (44/44), 0x3c (14/14), 0x3e (10/10),
  // 0x3f (14/14), 0x25 (11/11), 0x26 (11/11), 0x2e (52/52), 0x45 (22/22) --
  // no Application Class gating needed, unlike class/method below. 0x2c was
  // found by hand-walking `WEBLIB_OU_LP.ISCRIPT1` live: a `For`/`End-If`
  // block rendered with an orphan `;` on its own line where `End-For`
  // belongs, immediately after the inner `End-If`; 0x2f the same way,
  // `&flag = <nothing>;` where `True` belongs. 0x3c/0x3e/0x3f were found the
  // same way in `OU_JET_PACK.Layout.ComponentRegistry`'s `Evaluate &tag`
  // dispatch, which had lost its `Evaluate`/`End-Evaluate` bookends entirely
  // (the individual `When` cases still rendered, since 0x3d was already
  // confirmed). All of it cross-checked against
  // https://github.com/cache117/decode-pcode's independently-written table,
  // which maps every one of these nine identically (see docs/ROADMAP.md
  // pass twenty) -- but each was independently confirmed against this
  // corpus first, not adopted on the reference's word alone, the same
  // discipline pass sixteen's wholesale-adoption failure established.
  // 0x45 specifically is `Global`, not `Local` (0x44) -- an early hypothesis
  // from this same pass, based on nothing more than "the source happens to
  // contain the word LOCAL somewhere," a test loose enough to always pass
  // and therefore not real evidence; the reference source corrected it.
  // 0x6e was also tried, as `Continue` -- rejected: 9 real matches out of
  // 660 occurrences, far too common a byte value to be a statement this
  // rare, evidently overloaded with something else the way class/method
  // were outside Application Class programs. Left unmapped.
  [0x18, { kind: TokenKind.Keyword, text: 'And', format: AND_OR_STYLE }],
  [0x1d, { kind: TokenKind.Keyword, text: 'Not', format: SPACE_BOTH }],
  [0x1e, { kind: TokenKind.Keyword, text: 'Or', format: AND_OR_STYLE }],
  [0x29, { kind: TokenKind.Keyword, text: 'For', format: FOR_STYLE }],
  [0x2a, { kind: TokenKind.Keyword, text: 'To', format: SPACE_BOTH }],
  [0x3d, { kind: TokenKind.Keyword, text: 'When', format: WHEN_STYLE }],
  [0x69, { kind: TokenKind.Keyword, text: 'create', format: SPACE_BOTH }]
]);

/** Inline call/member identifier introducer; also overloaded as a newline. */
export const INLINE_IDENTIFIER_OPCODE = 0x0a;

/**
 * Opcodes that introduce a variable-length UTF-16LE text operand: the actual
 * name or string is spelled out, [char, 0x00] pairs, until a [0x00, 0x00]
 * terminator -- confirmed for both `%Mode` (twice, both samples) and the
 * string literals `"A"` and `"AB"`. Kept separate from {@link OPCODES}
 * because the byte(s) that follow are data, not further opcodes; the
 * generic loop in {@link decodeProgram} special-cases these rather than
 * mapping them to fixed text. This is what replaces the byte-pattern
 * heuristic tried and rejected earlier (see docs/ROADMAP.md): the pattern
 * only fires right after one of these two specific opcodes, never on
 * proximity alone, which is what a real false positive (RowInit's
 * `0x21 0x00 0x00`, not one of these two opcodes) exposed as unsafe.
 */
export const TEXT_INTRODUCERS = new Map<number, TokenKind.Name | TokenKind.StringLiteral | TokenKind.Keyword | TokenKind.Comment>([
  [0x12, TokenKind.Name],
  [0x16, TokenKind.StringLiteral],
  // Confirmed by scanning 204 programs whose plain-text source is known from
  // a project export (scripts/corpus-*.mjs) and checking that the decoded run
  // really occurs in that source:
  //   0x01  31047 runs, 100% found in source, and every single one is
  //         &-prefixed -- a variable reference (&myVar).
  //   0x40   3589 runs, 100% found in source -- a type or declaration
  //         keyword (string, boolean, number, integer, array, FieldFormula).
  //   0x6d     68 runs, 100% found in source -- the text inside a PeopleCode
  //         signature annotation (`/+ &tag as String +/`, `/+ Returns
  //         Boolean +/`), which is why it renders wrapped in /+ +/ below.
  [0x01, TokenKind.Name],
  [0x40, TokenKind.Keyword],
  [0x6d, TokenKind.Comment],
  //   0x07  1391 appearances, 1282 of them (92%) followed by a text run that
  //         is usually empty (1091) and otherwise a declaration name (191,
  //         e.g. IScript_RPC, Build_Chart), all found in the known source.
  //         The remaining 109 fall through to its plain OPCODES entry below.
  [0x07, TokenKind.Name]
]);
/** Primitive IDs shared by calibrated Function and Application Class signatures.
 * Parameter flag bits are compilation-unit-specific and are not included. */
export const PRIMITIVE_SIGNATURE_TYPE_IDS: ReadonlyMap<string, number> = new Map([
  ['string', 0x01],
  ['boolean', 0x05],
  ['integer', 0x11],
  ['number', 0x13],
  ['any', 0x04],
  ['datetime', 0x0b]
]);
