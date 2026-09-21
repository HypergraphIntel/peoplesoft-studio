import { NameTable } from './progtext.js';

/**
 * Decoder for the tokenized form PeopleCode is stored in.
 *
 * ## What is known and what is not
 *
 * Oracle does not document this format. Chunk assembly and the PSPCMNAME
 * indirection (see progtext.ts) are certain. The opcode table below started
 * out purely reverse engineered against real programs (see docs/ROADMAP.md
 * for the corpus methodology), and every entry that produced was confirmed
 * with zero contradictions against an independent implementation the user
 * pointed at:
 *
 *   https://github.com/cache117/decode-pcode
 *   src/main/java/decodepcode/PeopleCodeParser.java
 *   Copyright (c) 2011 Erik H (erikh3@users.sourceforge.net), ISC licence.
 *
 * That project's table is now adopted wholesale below (superseding the
 * smaller independently-derived table) because it is strictly more
 * complete and never disagreed with anything this project had already
 * confirmed against the live database: the 37-byte header
 * (`container.pos = 37`), byte 0x07 as a declaration marker, `;` (0x15)
 * carrying its own trailing newline, `.` as 0x05, `|` as 0x23, `End-Function`
 * (0x37) without a semicolon, 0x2d/0x4f as line structure, a comment's
 * uint16 BYTE-length prefix (0x24), and a name reference (0x21) as a 2-byte
 * little-endian index plus one, were all independently derived here first
 * and then found identical in that source. Everything else in the table
 * below -- the remaining keywords, the format/indentation bitmask, and the
 * second number-literal shape (0x11) -- is adopted from that project and is
 * *not* independently re-derived; it is measured against the corpus (see
 * docs/ROADMAP.md) rather than assumed correct on the strength of the
 * source alone. Still-unmapped opcodes decode to an explicit `Unknown`
 * token rather than being guessed at.
 *
 * There is no in-band end marker: PSPCMPROG.PROGLEN gives the program's exact
 * byte length, and the assembled chunks run to exactly that length, so
 * decoding simply continues until the buffer is exhausted. An earlier
 * revision treated byte 0x00 as an end-of-program opcode and stopped there
 * unconditionally; that was wrong; 0x00 is an ordinary byte that also happens
 * to be the upper byte of every UTF-16LE-encoded character, so it stopped
 * decoding after essentially the first line of most real programs.
 *
 * That choice is deliberate. A decoder that quietly invents plausible source
 * for an opcode it does not recognise produces code that compiles and means
 * something different, which is far worse than a visible gap. Unknown opcodes
 * surface in the rendered output as a marker comment carrying the byte value
 * and offset, so the table can be extended from real data.
 *
 * ## Formatting
 *
 * Indentation is not encoded in the byte stream at all -- App Designer's
 * Scintilla editor reconstructs it on the fly, which is why early decoded
 * output was flat with no indentation. Each opcode below carries a `format`
 * bitmask (see {@link FMT}) saying how it spaces and breaks lines around
 * itself; {@link render} walks the token stream applying those flags to
 * rebuild the indentation App Designer would show.
 */

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

export interface Token {
  kind: TokenKind;
  /** Rendered text for the token, already resolved through the name table. */
  text: string;
  /** Byte offset the token started at, for diagnostics. */
  offset: number;
  /** Raw opcode byte, present for every token read from the stream. */
  opcode: number;
  /** Spacing/indentation bitmask for this token; see {@link FMT}. */
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
const NEWLINE_BOTH = F.NEWLINE_BEFORE | F.NEWLINE_AFTER;
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
const TRY_STYLE = F.NEWLINE_BEFORE | F.NEWLINE_AFTER | F.INCREASE_INDENT;
// `catch` is followed by `Exception &e` on the same line, unlike `try`/
// `end-try` -- SPACE_AFTER, not NEWLINE_AFTER. DECREASE_INDENT is applied
// before the newline/indent write (render() does DECREASE_INDENT first), so
// `catch` itself lands back at `try`'s own level; INCREASE_INDENT is applied
// after writing its text, so it only affects lines that follow.
const CATCH_STYLE = F.NEWLINE_BEFORE | F.DECREASE_INDENT | F.SPACE_AFTER | F.INCREASE_INDENT;

interface OpcodeSpec {
  kind: TokenKind;
  text?: string;
  format: number;
}

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
  [0x3e, { kind: TokenKind.Keyword, text: 'When-Other', format: WHEN_STYLE }],
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
  // Two more zero-width markers, found by decoding every program in the
  // live database rather than just the 204-program calibration corpus (see
  // docs/ROADMAP.md pass thirty-nine) -- neither appeared with a small
  // enough unmapped-count anywhere in the corpus itself to stand out, but
  // the full database turned up dozens of programs where it was the
  // *only* unmapped opcode. Both are delivered PeopleSoft base objects
  // with no project-export source to check literally against, so
  // confirmation here is structural rather than text-diffed -- but on 13
  // combined independent occurrences, zero counter-examples, with one
  // smoking-gun case for 0x51 (below).
  //
  // 0x20: always sits directly after a statement boundary (`;` or `Then`)
  // and directly before a real `(` that opens a bare, unassigned function
  // call used as a whole statement -- `(MsgGet(6540, 127, "..."));` --
  // never before a call whose result is used. Reads as a "this statement
  // is just an expression" marker: PeopleCode statements are normally
  // assignments or keyword-led, so a bare parenthesised expression
  // apparently needs its own introducer the way `Error (...)` doesn't
  // (`Error` itself already marks the statement).
  [0x20, { kind: TokenKind.Punctuation, text: '', format: F.NONE }],
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

// Every other keyword PeopleCodeParser.java maps -- Error, Warning,
// Repeat, Until, Step, Declare, Library,
// Value, PeopleCode, Ref, Exit, Continue (0x6e -- tried, rejected, see
// above),
// set, Null, PanelGroup, readonly, Doc, Component, Constant, and the whole
// Application Class vocabulary (class/end-class/extends/out/property/
// private/instance/method/end-method/try/catch/end-try/throw/end-get/
// end-set/Continue/abstract/interface/end-interface/implements/protected)
// -- was tried and measured against this corpus and scored well under the
// bar above (many at 0-50%, some as low as 0.1-0.9%; see the comment
// above). They are left unmapped so they surface as Unknown and get
// reported, not guessed at, rather than shipped on the strength of the
// reference source alone.
//
// The Application Class vocabulary specifically was retried after the
// trailer-cutoff pass (see TRAILER_MARKER), on the theory that its earlier
// corpus-wide failure was trailer noise, not a wrong mapping. Hand-walking
// OU_JET_PACK.Layout.ComponentRegistry (12 methods) and
// OU_JET_PACK.Security.AccessCheck (3 methods) confirmed 0x5a `class`,
// 0x5b `end-class`, 0x64 `end-method`, and 0x63 `method` (overloaded
// between a declaration and an 0x41-marked implementation header) against
// real source with zero mismatches in those two samples. Corpus-wide it
// did not hold: `end-method` matched real source only 8.9% of the time
// (54/610), with 556 false positives spread across 33 ordinary
// Function-based WEBLIB_* programs that declare no class at all (e.g.
// `class` itself fired twice in WEBLIB_HRS_MA.WEBLIB_HRS_MA.FieldFormula,
// a plain Function program with no class anywhere in its source). These
// byte values are evidently reused for something else entirely outside an
// Application Class program -- the same trap the corpus-validation
// discipline exists to catch -- so they were reverted rather than shipped
// on the strength of two samples. Not disproven the way the rest of this
// list is (0.1-80%, tried directly): this needs a way to tell an
// Application-Class program apart from an ordinary one *before* deciding
// how to read these bytes, which is not yet established.

/** Format for the operand-bearing opcodes handled outside {@link OPCODES} below. */
// Identifiers/references only ever pull a space in front of themselves --
// never after -- so that `Name(`, `Name.Field` and `Name:Path` (function
// calls, dot access, package paths) stay tight the way real source does.
// What follows an identifier (`(`, `.`, `:`, `,`, another operator) decides
// its own spacing instead.
const OPERAND_FORMAT = new Map<number, number>([
  [0x12, F.SPACE_BEFORE],  // Name
  [0x16, F.SPACE_BEFORE],  // StringLiteral
  [0x01, F.SPACE_BEFORE],  // &var Name
  [0x40, F.SPACE_BEFORE],  // Keyword (type)
  [0x6d, NEWLINE_BOTH],    // signature annotation comment
  [0x07, F.SPACE_BEFORE],  // declaration name (falls through OPCODES entry above when empty)
  [0x0a, F.SPACE_BEFORE],  // identifier-introducer overload of 0x0a
  [0x24, NEWLINE_BOTH],    // length-prefixed comment
  [0x4e, NEWLINE_BOTH],    // length-prefixed comment (second introducer, same shape)
  [0x55, NEWLINE_BOTH],    // length-prefixed comment (third introducer, same shape -- <* *> style)
  // #If/#Then/#End-If preprocessor directives -- see the 0x75/0x76/0x78
  // dispatch block below for why these carry indent flags a comment never
  // would: #Then's body is a real indented block, whether or not it was
  // actually compiled.
  [0x75, F.NEWLINE_BEFORE],
  [0x76, F.SPACE_BEFORE | F.INCREASE_INDENT],
  // #Else: unlike #Then, it starts its own fresh line (after the #Then
  // branch's body, not glued to #If's own line), so it needs its own
  // NEWLINE_BEFORE; DECREASE_INDENT undoes #Then's indent before writing,
  // INCREASE_INDENT re-establishes it after for #Else's own body. No
  // NEWLINE_AFTER, same reasoning as #Then: real content (or an embedded
  // dead-branch newline) supplies its own leading break.
  [0x77, F.NEWLINE_BEFORE | F.DECREASE_INDENT | F.INCREASE_INDENT],
  [0x78, F.NEWLINE_BEFORE | F.SPACE_BEFORE | F.DECREASE_INDENT],
  [0x21, F.SPACE_BEFORE],  // name/record-field reference
  [0x50, F.SPACE_BEFORE | F.NO_SPACE_AFTER], // byte integer literal
  [0x11, F.SPACE_BEFORE | F.NO_SPACE_AFTER]  // second number-literal shape (14-byte operand)
]);

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
const TEXT_INTRODUCERS = new Map<number, TokenKind.Name | TokenKind.StringLiteral | TokenKind.Keyword | TokenKind.Comment>([
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

/**
 * Reads a UTF-16LE text run starting at `start`, terminated by a 0x00 0x00
 * pair. Returns null if the bytes at `start` do not fit that shape (not
 * enough bytes, or no terminator before the buffer ends) so the caller can
 * fall back to treating the introducer as an ordinary unknown byte instead
 * of misreading unrelated bytes as text.
 *
 * Any non-zero UTF-16 code unit is accepted, not just printable ASCII: a
 * string literal or bare identifier can carry a real non-ASCII character
 * (confirmed against HCB_CORE_LIBRARIES.HCB_JsonBuilder.OnExecute's real
 * `&Emplid_CurrSymbol = "£"`, a single-character string whose only
 * character is U+00A3) the exact same way `readLengthPrefixedText`'s own
 * comments could (see that function's own history) -- rejecting it just
 * misread the character's own bytes as a fresh opcode and cascaded
 * everything downstream. See docs/ROADMAP.md pass forty.
 */
function readTextRun(bytes: Buffer, start: number): { text: string; end: number } | undefined {
  const chars: string[] = [];
  let i = start;
  while (i + 1 < bytes.length) {
    const lo = bytes[i];
    const hi = bytes[i + 1];
    const code = lo | (hi << 8);
    if (code === 0x0000) return { text: chars.join(''), end: i + 2 };
    chars.push(String.fromCharCode(code));
    i += 2;
  }
  return undefined;
}

/**
 * A number literal: opcode 0x50, a zero byte, a *scale* byte, then a
 * 16-byte little-endian unsigned integer -- 19 bytes total. First
 * confirmed against four small instances across two programs, at the same
 * relative position each time: 1, 2 (`If (1 = 2) Then`), then 12 (0x0c) and
 * 34 (0x22) (`If (12 = 34) Then`) -- the value byte is the number's raw
 * binary value, not a digit or ASCII, so this was never actually limited to
 * single digits; an earlier revision restricted it to 0-9 on too little
 * evidence.
 *
 * `operandLength` also accepts 0x11's shorter, 14-byte shape (adopted from
 * PeopleCodeParser.java; see file header) which this project has not yet
 * independently confirmed a sample of -- `allowScale` keeps that one
 * restricted to exactly the original zero-scale (plain integer) shape,
 * unchanged, since there is no evidence yet either way for it.
 *
 * For 0x50, `valueBytes` is the full 16 remaining bytes: hand-walking four
 * more real values past the single-byte range (`SetTracePC(3596)`,
 * `Char(65533)`, `Rand() * 1000000000`, a `MsgGetText` message number 311)
 * found each one is the same little-endian integer, just occupying more of
 * the same field -- 3596 (0x0e0c) at bytes 2-3, 65533 (0xfffd) at bytes
 * 2-3, 1000000000 (0x3b9aca00) at bytes 2-5, 311 (0x0137) at bytes 2-3 --
 * confirming the single-byte shape was never a separate case, just this
 * same field with its upper bytes at zero.
 *
 * **The second byte -- required to be zero in every sample above -- is a
 * decimal scale, not a fixed sentinel: `value / 10^scale`.** Found by
 * hand-walking three real decimal literals this shape had been silently
 * refusing (pass thirty-four): `&pcts.Push(33.34)` (scale `2`, magnitude
 * `3334` = `0x0d06`), the adjacent `&pcts.Push(33.33)` (scale `2`,
 * magnitude `3333` = `0x0d05`, confirmed twice, byte for byte identical
 * both times it's pushed), and `If &ptVersionNum < 8.52 Then` in a
 * completely unrelated program (scale `2`, magnitude `852` = `0x0354`).
 * Every plain-integer sample ever confirmed is scale `0`, which this
 * generalises without changing: `value / 10^0` is `value` unchanged. Read
 * with BigInt since nothing bounds how many of the 16 bytes a real literal
 * might use. Negative numbers are still not confirmed and still correctly
 * fail this unsigned-integer read rather than being misread. See
 * docs/ROADMAP.md passes twenty-six and thirty-four.
 */
function readByteIntegerLiteral(
  bytes: Buffer,
  start: number,
  operandLength: number,
  valueBytes: number,
  allowScale: boolean,
  valueOffset: number = 2
): { text: string; end: number } | undefined {
  if (start + operandLength > bytes.length) return undefined;
  if (bytes[start] !== 0x00) return undefined;
  const scale = bytes[start + 1];
  if (scale !== 0x00 && !allowScale) return undefined;
  for (let j = start + 2; j < start + valueOffset; j++) {
    if (bytes[j] !== 0x00) return undefined;
  }
  let value = 0n;
  for (let j = valueBytes - 1; j >= 0; j--) value = (value << 8n) | BigInt(bytes[start + valueOffset + j]);
  for (let j = start + valueOffset + valueBytes; j < start + operandLength; j++) {
    if (bytes[j] !== 0x00) return undefined;
  }
  return { text: formatScaled(value, scale), end: start + operandLength };
}

/** `value / 10^scale` as a decimal string; `scale` 0 is the plain integer, unchanged. */
function formatScaled(value: bigint, scale: number): string {
  if (scale === 0) return value.toString();
  const digits = value.toString().padStart(scale + 1, '0');
  const point = digits.length - scale;
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

/**
 * A name reference: opcode 0x21 followed by a little-endian 16-bit index,
 * 0-based into this program's own PSPCMNAME table (NAMENUM = index + 1).
 * Three bytes total. Used for record.field references, and equally for
 * references to other definitions -- e.g. `HTML.OU_OJET_REQUIRE_CONFIG` in
 * `GetHTMLText(HTML.OU_OJET_REQUIRE_CONFIG, &siteBase)` is this same
 * construct, resolving through the same table.
 *
 * The operand is two bytes, not three. An earlier revision also required a
 * trailing 0x05, because all three samples it was originally derived from
 * happened to be `RECORD.FIELD.Visible` -- where that 0x05 is not part of
 * the reference at all, but the separate `.` operator (confirmed
 * independently) introducing the `.Visible` that follows. Requiring it meant
 * a reference used any other way -- as a function argument, say -- never
 * matched, which is why `GetHTMLText(HTML.OU_OJET_REQUIRE_CONFIG, ...)`
 * decoded as `GetHTMLText(, ...)` with the reference silently dropped.
 * Across the 204-program corpus, 0x21 appears 1775 times, 1640 resolve to a
 * real NAMENUM this way, and 1636 of those 1640 (99.76%) resolve to a name
 * that really occurs in that program's source. The byte after the operand is
 * a comma 771 times and `)` 585 times, against only 16 times for 0x05 --
 * which is what the old rule was demanding.
 *
 * The name table stores `RECNAME.REFNAME` (e.g. `HTML.OU_OJET_REQUIRE_CONFIG`)
 * when PSPCMNAME.RECNAME is non-blank, so the definition-type qualifier is
 * carried through automatically; see progtext.ts and OracleProvider.
 */
function readRecordFieldReference(bytes: Buffer, start: number): { nameNum: number; end: number } | undefined {
  if (start + 2 > bytes.length) return undefined;
  const index = bytes[start] | (bytes[start + 1] << 8);
  return { nameNum: index + 1, end: start + 2 };
}

/**
 * Punctuation a text run carries in source but not in the byte stream: a
 * string literal's quotes, and the `/+ +/` around a signature annotation
 * (confirmed against real source, e.g. `/+ &propsJson as String +/`).
 */
function renderTextRun(kind: TokenKind, text: string): string {
  switch (kind) {
    case TokenKind.StringLiteral: return `"${text}"`;
    case TokenKind.Comment: return `/+ ${text} +/`;
    default: return text;
  }
}

/**
 * A comment: opcode 0x24 or 0x4e, a little-endian uint16 giving the text's
 * length in BYTES (not characters), then that many bytes of UTF-16LE.
 *
 * This is a different framing from every other text in the format, which is
 * null-terminated -- a comment is not, and reading one as null-terminated
 * stops at the first byte pair that happens to be invalid. Confirmed across
 * the 204-program corpus: 2420 comments decoded this way (via 0x24) are
 * found verbatim in the programs' known source, against a single false
 * positive (a run of zero bytes, which only matched because the probe
 * scanned every position rather than only opcode positions). The text
 * carries its own `/* *\/` or `rem` markers, so it is rendered as-is.
 *
 * 0x4e is a second introducer for the exact same shape, found hand-walking
 * `WEBLIB_OU_LP.ISCRIPT1` live (its export is known-stale -- pass thirteen
 * -- so this comment, real in the live bytes, is invisible to the export
 * text the corpus otherwise checks against): 202/202 (100%) match once that
 * one stale-export program is excluded from the corpus check. What
 * distinguishes 0x24 from 0x4e -- position, comment style, some other
 * context -- is not established; both decode identically since the
 * rendered text carries its own delimiters either way.
 *
 * 0x55 is a third introducer, same shape again, confirmed against
 * `WEBLIB_IB.ISCRIPT1`'s real `<* This laucnhes the Integration HUB MAP
 * Rapid Application *>` -- a whole *different* comment delimiter style
 * (angle-bracket-star pairs rather than slash-star), used elsewhere in the
 * corpus to wrap blocks of disabled code that themselves already contain
 * ordinary slash-star comments (`WEBLIB_EP_FL.ISCRIPT2`'s real source: an
 * angle-bracket-star-wrapped `&EndPos = Find(...); If &EndPos = 0 Then ...
 * End-If;`, several statements deep). Exact byte match: declared length
 * 122, real text 61 characters, delimiters and all -- the stored text
 * carries its own delimiters the same way 0x24/0x4e's own comments do.
 * See docs/ROADMAP.md pass thirty-six.
 *
 * Unlike the null-terminated readers, every character here does NOT need
 * its own validity check: the byte length prefix already bounds the read
 * exactly, with no scanning-for-a-terminator ambiguity to resolve. An
 * earlier revision rejected the whole comment if even one UTF-16 code unit
 * fell outside printable ASCII -- real comments legitimately contain an
 * em-dash, a curly quote, or other non-ASCII punctuation a user actually
 * typed, and rejecting the comment for that fell through to walking its own
 * bytes as if they were opcodes, cascading into the exact kind of
 * ASCII-letter-collides-with-a-real-opcode garbage this project has hit
 * more than once (see docs/ROADMAP.md pass thirty-two's `0x70`/`0x6f`/
 * `0x73`/`0x74`/`0x72`/`0x6c` cluster, and pass thirty-three's own
 * `WEBLIB_OU_LP_BK.ISCRIPT2` sample, a "templates -- see below" comment
 * whose only non-ASCII character was an em-dash). The one thing still
 * worth guarding against is the original concern this check was
 * added for: a length prefix that happens to land on a run of zero bytes,
 * which would otherwise silently decode as a comment consisting entirely
 * of NULs -- kept as the one remaining rejection.
 */
function readLengthPrefixedText(bytes: Buffer, start: number): { text: string; end: number } | undefined {
  if (start + 2 > bytes.length) return undefined;
  const byteLength = bytes[start] | (bytes[start + 1] << 8);
  const from = start + 2;
  const end = from + byteLength;
  if (byteLength === 0 || byteLength % 2 !== 0 || end > bytes.length) return undefined;
  const chars: string[] = [];
  let allNul = true;
  for (let j = from; j < end; j += 2) {
    const code = bytes[j] | (bytes[j + 1] << 8);
    if (code !== 0) allNul = false;
    chars.push(String.fromCharCode(code));
  }
  if (allNul) return undefined;
  return { text: chars.join(''), end };
}

/** NameTable.get throws on a missing entry; a decoder must not let that escape as a crash. */
function tryResolveName(names: NameTable, nameNum: number): string | undefined {
  try {
    return names.get(nameNum);
  } catch {
    return undefined;
  }
}

/**
 * The fixed 37-byte preamble every program starts with.
 *
 * Confirmed by tabulating byte-position variance across 204 real programs
 * (every PeopleCode program in two project exports, paired with its
 * PSPCMPROG bytes; see scripts/corpus-header.mjs). Positions 0 and 33 are
 * always 0xa0 and 0x85, and the positions in ZERO_POSITIONS below are always
 * zero. The remaining positions -- 5, 6, 7, 13, 14, 21 and 29 -- vary per
 * program and are left alone: 5-7 and 13-14 look like little-endian counts
 * or lengths, 21 and 29 like small counts, but nothing here depends on
 * knowing which. PeopleCodeParser.java's `container.pos = 37` independently
 * confirms 37 as the header length.
 *
 * An earlier revision required positions 6-32 to be zero, which was overfit
 * to three unusually small programs; it rejected the header on 200 of these
 * 204 and reported all 37 bytes as unmapped noise on each.
 */
const HEADER_LENGTH = 37;

// Positions 7, 22 and 30 were dropped from this list (pass forty-two): a
// database-wide sample (60k programs) found each one zero in the
// overwhelming majority (99.4%/99.995%/99.995%), which is how they ended
// up here, but not always -- 358, 3 and 3 real programs respectively have
// something else there. Requiring any of them be zero rejected the
// header outright for that program, which cascades the *entire* program
// (not just one construct) into unrelated-looking unmapped noise --
// confirmed on G3UTILITIES.UtilityMethods.OnExecute (position 22): fixing
// this alone took it from 28+ unmapped opcodes to 0 across all 128KB.
// Whatever these bytes actually encode is still unknown; the fix is
// simply to stop assuming they are always zero.
const HEADER_ZERO_POSITIONS = [
  1, 2, 3, 4, 8, 9, 10, 11, 12, 15, 16, 17, 18, 19, 20,
  23, 24, 25, 26, 27, 28, 31, 32, 34, 35, 36
];

// Position 33 was thought to be a fixed 0x85 marker; six unrelated real
// Record Field programs (pass forty-three), all rejected outright and
// falling into unrelated-looking garbage from offset ~30 on, turned out
// to carry 0x84 there instead. Accepting both until real evidence turns
// up a byte this position genuinely can't be.
const HEADER_BYTE_33_VALUES = new Set([0x85, 0x84]);

function matchHeader(bytes: Buffer): boolean {
  if (bytes.length < HEADER_LENGTH) return false;
  if (bytes[0] !== 0xa0 || !HEADER_BYTE_33_VALUES.has(bytes[33])) return false;
  return HEADER_ZERO_POSITIONS.every((p) => bytes[p] === 0x00);
}

export interface DecodeOptions {
  /** 'raw' emits a byte/opcode listing instead of source, for extending OPCODES. */
  mode: 'auto' | 'strict' | 'raw';
  /**
   * Whether the caller already knows this program is Application Class
   * PeopleCode (PSPROJECTITEM/definitions.ts OBJECTTYPE 58), rather than
   * something the decoder would have to guess from the bytes themselves.
   *
   * `class`/`method`/`end-class`/`end-method` (0x5a/0x63/0x5b/0x64) only
   * decode when this is set. Confirmed byte-for-byte against
   * OU_JET_PACK.Layout.ComponentRegistry and OU_JET_PACK.Security.AccessCheck,
   * but those same byte values are evidently doing something else entirely
   * in ordinary Function-based programs -- corpus-wide, unconditionally
   * mapping them gave `end-method` an 8.9% real-source match rate, with 556
   * false positives across 33 WEBLIB_* programs that declare no class at
   * all (see docs/ROADMAP.md pass seventeen). Restricting them to programs
   * the caller already knows are classes avoids that collision entirely
   * rather than trying to detect it from content.
   */
  isApplicationClass?: boolean;
}

export interface DecodeResult {
  text: string;
  tokens: Token[];
  /** Offsets of opcodes with no entry in {@link OPCODES}. */
  unknownOpcodes: { offset: number; opcode: number }[];
  /** Byte offset {@link TRAILER_MARKER} was found at, if the program has one. */
  trailerOffset?: number;
  /**
   * Declarations read from the directory after {@link TRAILER_MARKER}, if its
   * shape could be verified for this program. See {@link decodeDeclarations}.
   */
  declarations?: Declaration[];
}

/** One Function/Method entry from the declaration-name directory. */
export interface Declaration {
  name: string;
  /** Parameter count. Confirmed 100% (621/621) against real signatures corpus-wide. */
  paramCount: number;
  /**
   * Whether the declaration has a `Returns` clause. Confirmed 100% (621/621)
   * corpus-wide: the directory's fourth field is exactly `7` when there is no
   * `Returns` clause and never `7` when there is one.
   */
  hasReturnValue: boolean;
  /**
   * The `Returns` clause's type, when it is one of the scalar types
   * {@link RETURN_TYPE_CODES} maps (optionally `array of <type>`, decoded via
   * {@link ARRAY_RETURN_TYPE_FLAG}). Confirmed with zero collisions against
   * 178 real declarations corpus-wide -- every one of these codes matched
   * exactly one type name, every time. `undefined` when `hasReturnValue` is
   * true but the code is not one of these (an object/record/rowset/App Class
   * return type, or an array of one -- see {@link decodeDeclarations}).
   */
  returnType?: string;
  /**
   * Each parameter's own declared type, in order, decoded from the
   * dispatch-slot table pass nineteen's `second` field points into --
   * pass thirty's own follow-on, closing the last item pass nineteen left
   * unlocated. `undefined` per parameter using the same rule as
   * {@link returnType} (a real but still-unconfirmed code); `undefined` for
   * the whole array when the table isn't the expected shape (out of bounds,
   * or its terminator slot isn't exactly `7`) rather than guessing. See
   * {@link decodeParameterTypes}.
   */
  parameterTypes?: (string | undefined)[];
}

/**
 * Scalar codes confirmed corpus-wide for the declaration directory's `kind`
 * field (see {@link decodeDeclarations}), each observed matching exactly one
 * `Returns`/parameter type name and never colliding with another:
 *
 *   1 -> string (151 samples), 5 -> boolean (11), 13 -> object (1),
 *   17 -> integer (1), 19 -> number (2), 11 -> datetime (pass thirty, found
 *   as a real parameter type on `OU_JET_PACK.Utils.JsonUtil.FormatDateTime`)
 *
 * `7` is reserved separately for "no Returns clause" (see
 * {@link Declaration.hasReturnValue}) and is deliberately not a key here.
 * App-Class return types use other, still-unconfirmed bit patterns and are
 * not decoded; built-in object types use {@link OBJECT_RETURN_TYPE_FLAG}.
 */
const RETURN_TYPE_CODES = new Map<number, string>([
  [1, 'string'],
  [5, 'boolean'],
  [11, 'datetime'],
  [13, 'object'],
  [17, 'integer'],
  [19, 'number']
]);

/**
 * Set on a scalar {@link RETURN_TYPE_CODES} value to mean "array of" that
 * scalar -- confirmed against `array of string` (`0x100001` = this flag OR
 * `1`) and `array of number` (`0x100013` = this flag OR `19`), corpus-wide,
 * with no other value ever combining with it.
 */
const ARRAY_RETURN_TYPE_FLAG = 0x100000;

/**
 * Set for PeopleCode's built-in database/collection object return types,
 * combined with a sub-type code in {@link OBJECT_TYPE_CODES} -- or, when the
 * sub-type code is {@link APP_CLASS_TYPE_OFFSET} or higher, an
 * Application-Class type instead (see there). Found by searching live
 * `PSPCMPROG.PROGTXT` system-wide (read-only, `DBMS_LOB.INSTR`) for real
 * `Returns <Type>` clauses this project hadn't seen an example of yet --
 * `FUNCLIB_GP_ABS.CALC_END_DT_BTN.CalcDur` and three sibling functions
 * confirmed `Record` as `0x80003`, alongside the `Rowset`/`XmlDoc`/`XmlNode`
 * codes pass eighteen already had. `ApiObject` (`0x8000f`) and `JsonObject`
 * (`0x80063`) confirmed pass thirty, as real *parameter* types (`&x As
 * ApiObject`, `&x As JsonObject`) once parameter types were decodable at
 * all -- the same sub-code space a return type uses, just never observed as
 * one yet.
 */
const OBJECT_RETURN_TYPE_FLAG = 0x80000;

const OBJECT_TYPE_CODES = new Map<number, string>([
  [3, 'Record'],
  [7, 'Rowset'],
  [15, 'ApiObject'],
  [29, 'XmlDoc'],
  [34, 'XmlNode'],
  [99, 'JsonObject']
]);

/**
 * The keyword display casing for a `0x48`-referenced qualifier, keyed by
 * PSPCMNAME's stored (uppercase) RECNAME. See the `0x48` dispatch below
 * for how this is used and confirmed.
 */
const QUOTED_REFERENCE_QUALIFIERS = new Map<string, string>([
  ['OPERATION', 'Operation'],
  ['MENUNAME', 'MenuName'],
  ['BARNAME', 'BarName'],
  ['ITEMNAME', 'ItemName'],
  ['PAGE', 'Page'],
  ['BUSPROCESS', 'BusProcess'],
  ['BUSACTIVITY', 'BusActivity'],
  ['BUSEVENT', 'BusEvent'],
  // PANEL/PANELGROUP are PeopleTools' pre-8.4x names for Page/Component,
  // still stored under their old names in PSPCMNAME for programs compiled
  // that far back. Confirmed against DERIVED_FP_CA.FP_CA_BTTN2.
  // FieldChange's real `DoModalPanelGroup(MenuName."HEADCOUNT_(FP)",
  // BarName."MDX", ItemName."CALINKS", Panel."FP_AVLBL_CA", ...)`. See
  // docs/ROADMAP.md pass forty.
  ['PANEL', 'Panel'],
  ['PANELGROUP', 'PanelGroup'],
  // Confirmed against FED_TAX_DATA.EFFDT.FieldChange's real `If
  // %Component = Component."TAX_DATA" And &IsRecordNew(RECORD.
  // FED_TAX_DATA) Then` -- this program's only unmapped opcode.
  ['COMPONENT', 'Component']
]);

/**
 * An Application-Class return/property type (`PKG:Sub:Class`) is not a fixed
 * code at all -- {@link OBJECT_RETURN_TYPE_FLAG}'s sub-type code is instead
 * `APP_CLASS_TYPE_OFFSET` plus a *charOffset* back into this same trailer's
 * own name run, pointing at the specific occurrence of the class's
 * colon-qualified name to use. Confirmed byte-for-byte, pass twenty-nine's
 * own follow-on, against three independent real values: `OU_JET_PACK.
 * Storage.DesignRepository`'s `Load(...) Returns OU_JET_PACK:Model:
 * PageDesign` (kind `0x8017f`, sub-code `0x17f` = 383 = `PageDesign`'s own
 * *second* name-run occurrence at charOffset 127, `383 - 256 = 127`) and
 * `ListHeaders() Returns array of OU_JET_PACK:Model:PageDesign` (kind
 * `0x18019c`, composing with {@link ARRAY_RETURN_TYPE_FLAG} exactly like a
 * scalar array does); `TI_INTEGRATION.DVMEError`'s `EOTF_CORE:DVM:Functions
 * &_DvmFunc` property (kind `0x801c4`, charOffset 196, `452 - 256 = 196`).
 * The name run legitimately lists the same colon-qualified type name more
 * than once -- once per place it's referenced -- which is why this points at
 * a specific occurrence rather than carrying the name directly: two
 * properties or return values of the same Application-Class type resolve to
 * different charOffsets, not a shared one. `0x100` never collides with a
 * real {@link OBJECT_TYPE_CODES} sub-code (all four are under 40).
 */
const APP_CLASS_TYPE_OFFSET = 0x100;

function decodeReturnType(
  kind: number, classNames?: readonly { text: string; charOffset: number }[]
): string | undefined {
  const isArray = (kind & ARRAY_RETURN_TYPE_FLAG) !== 0;
  const core = isArray ? kind & ~ARRAY_RETURN_TYPE_FLAG : kind;
  const wrap = (t: string) => (isArray ? `array of ${t}` : t);

  const scalar = RETURN_TYPE_CODES.get(core);
  if (scalar !== undefined) return wrap(scalar);

  if ((core & OBJECT_RETURN_TYPE_FLAG) !== 0) {
    const sub = core & ~OBJECT_RETURN_TYPE_FLAG;
    const builtin = OBJECT_TYPE_CODES.get(sub);
    if (builtin !== undefined) return wrap(builtin);
    if (sub >= APP_CLASS_TYPE_OFFSET && classNames) {
      const charOffset = sub - APP_CLASS_TYPE_OFFSET;
      const name = classNames.find((n) => n.charOffset === charOffset)?.text;
      if (name !== undefined) return wrap(name);
    }
  }
  return undefined;
}

/**
 * A declaration's own parameter types: pass nineteen's "further,
 * still-unlocated table" the `second` field points a running slot offset
 * into, cracked in pass thirty. It is a flat run of 4-byte little-endian
 * slots immediately after the whole declaration-name record table (see
 * {@link decodeDeclarations}'s `slotsStart`), sized so that a declaration
 * with an explicit parameter list occupies exactly `1 + paramCount` slots --
 * one per parameter, using the *identical* type-code vocabulary
 * {@link decodeReturnType} already decodes (confirmed with a real mixed
 * four-parameter signature, `addNonNPSAction(&rsActions As Rowset, &ruleNode
 * As XmlNode, &ruleId As string, &nCurrent As integer)`, matching all four
 * codes exactly in order), plus a final terminator slot that is always
 * exactly `7` -- the same "nothing here" sentinel {@link Declaration.
 * hasReturnValue} already uses.
 *
 * `Function` declarations' parameter slots carry two extra set bits
 * (`0xc0000000`, confirmed corpus-wide never colliding with a real type
 * code) that `method` declarations' slots never do -- some flag distinct to
 * top-level Function parameters, not yet understood, but harmless to a type
 * decode since masking it off is a no-op for `method` slots, which never
 * set it. The table's overall location and size (never a separate
 * per-colon-name record, as an earlier open item's framing had assumed) is
 * itself confirmed corpus-wide: computing this same slot count for every
 * multi-declaration program's very last declaration and checking it against
 * the trailer's real remaining byte count after the record table matched
 * exactly for 106 of 106 valid samples (the other 2 both
 * `WEBLIB_OU_LP.ISCRIPT1`, whose project-export source is already known
 * stale -- see pass thirteen).
 *
 * Checked corpus-wide against real parameter lists (not just the anchoring
 * sample): 384/402 (95.6%), naming three real type codes this project
 * hadn't seen before (`datetime` = 11, `ApiObject` = `0x8000f`, `JsonObject`
 * = `0x80063`) rather than any wrong decode -- the last handful of misses
 * trace to a single duplicate-named `Function` overload in one program's
 * source (the validation script's own source-text lookup found the wrong
 * same-named declaration, not a decoder error).
 *
 * Returns `undefined` -- for the whole array, not a guessed partial one --
 * when the slots don't fit in the buffer or the terminator slot isn't
 * exactly `7`, the same refuse-rather-than-guess discipline
 * {@link decodeDeclarations} already applies to the record table itself.
 */
function decodeParameterTypes(
  bytes: Buffer, slotsStart: number, slotStart: number, paramCount: number,
  classNames: readonly { text: string; charOffset: number }[]
): (string | undefined)[] | undefined {
  const base = slotsStart + slotStart * 4;
  if (base + (paramCount + 1) * 4 > bytes.length) return undefined;
  if (bytes.readInt32LE(base + paramCount * 4) !== 7) return undefined;

  const types: (string | undefined)[] = [];
  for (let p = 0; p < paramCount; p++) {
    const slot = bytes.readInt32LE(base + p * 4) & ~0xc0000000;
    types.push(decodeReturnType(slot, classNames));
  }
  return types;
}

/**
 * Marks the end of the real statement stream. Every program's compiled form
 * carries a declaration-name directory after its last statement -- the
 * program's own declared Function/Method names, verbatim, with no
 * introducer opcode -- followed by a packed table of small integers (a
 * dispatch/offset table) running to PROGLEN. Confirmed across all 204
 * corpus programs that carry it (185 of 204; the other 19 are short enough
 * to have no declarations to list at all) by hand-walking
 * `WEBLIB_OU_LP.ISCRIPT1/2.FieldFormula` and cross-checking every
 * `OU_JET_PACK` Application Class program against real source: `0x2d 0x07`
 * (an ordinary newline immediately followed by the declaration-name
 * opcode with no name after it, which never happens in the statement
 * stream itself) occurs in the byte stream exactly once per program, always
 * right after the closing `;` of the outermost `End-Function`/`End-Method`/
 * `End-Class`, and zero times elsewhere -- across the whole corpus, not one
 * program has a second occurrence. This is what pass thirteen in
 * docs/ROADMAP.md called the Application Class trailer; walking
 * `WEBLIB_OU_LP.ISCRIPT1/2.FieldFormula` (plain Function-based record
 * PeopleCode, no class at all) showed it is not class-specific -- every
 * program gets this directory, not just classes.
 *
 * Decoding stops here rather than trying to read the directory/dispatch
 * table as more statements, which is what produced the garbled keyword
 * soup past a program's real end (e.g. bare `create`, `Local`, `Function`
 * tokens with no real statement shape around them -- the small integers in
 * the dispatch table incidentally collide with real opcode values). See
 * {@link decodeDeclarations} for the directory's own format, decoded
 * separately from (and never feeding back into) the statement stream above.
 */
const TRAILER_MARKER: readonly [number, number] = [0x2d, 0x07];

/**
 * Decodes the declaration-name directory that follows {@link TRAILER_MARKER}.
 *
 * Format, confirmed by hand-walking the corpus (204 programs, live database
 * bytes paired with real source from two project exports; see
 * docs/ROADMAP.md pass eighteen and nineteen):
 *
 * 1. A run of back-to-back, null-terminated UTF-16LE strings, no length
 *    prefix -- the program's own declared Function/Method names, byte-exact
 *    including case (confirmed against `WEBLIB_CD_APP.ISCRIPT1`'s
 *    lowercase-`i` `iScript_CD`), immediately followed (no separator) by any
 *    colon-qualified imported-class names (`PKG:Sub:Class`) the program
 *    references -- a separate, still-undecoded directory that happens to
 *    share this one's name-run encoding. The whole run -- plain names and
 *    colon-qualified ones together -- ends at the first truly empty string.
 *    `decodeDeclarations` only builds {@link Declaration}s for the plain
 *    names, but it has to walk past the colon-qualified ones too to find
 *    where the record table actually starts (see point 2).
 *
 *    Not every declared Function/Method necessarily appears: e.g.
 *    `WEBLIB_CTI.ISCRIPT1` declares 21 functions but the directory lists
 *    only 18, always omitting the same three, which turn out to be
 *    `Declare Function ... PeopleCode <other program> ...;` imports of
 *    functions defined *elsewhere* -- not really declared in this program at
 *    all, hence no entry of its own to list.
 *
 * 2. One 16-byte record per listed plain name, starting right after the
 *    *whole* name run (plain names and any colon-qualified ones): four
 *    little-endian int32s `(charOffset, second, paramCount, kind)`.
 *      - `charOffset`: the character (not byte) offset from the start of the
 *        name run to that entry's own name. This is what makes the whole
 *        table self-verifying -- it can be checked against the name
 *        positions already parsed in step 1 with no source text needed, and
 *        `decodeDeclarations` refuses the whole table if even one record
 *        disagrees, rather than risk emitting a table that has drifted out
 *        of alignment. It also doubles as a robust name-run terminator: a
 *        program with no colon-qualified names has no separate empty-string
 *        marker between the last name and the table, but the first record's
 *        charOffset is always 0 (the first name always starts at character
 *        offset 0), so its own leading zero bytes look exactly like an
 *        empty string and end the scan at the right place regardless.
 *      - second field: a running dispatch-slot offset, understood but not
 *        exposed on {@link Declaration}. Each declaration that has an
 *        explicit parameter list -- `(...)`, even empty `()` -- consumes
 *        `1 + paramCount` slots in some further, still-unlocated table;
 *        its own second field is the running total of that count over all
 *        preceding such declarations in the *program's real declaration
 *        order* (which can include declarations this directory omits
 *        entirely, e.g. more `Declare Function` imports). A declaration
 *        with no parameter list at all (bare `Function Name`, no parens)
 *        does not consume a slot and always has second field `0`.
 *        Confirmed exactly (0 mismatches) on every fully-decoded
 *        multi-declaration program in the corpus, but not exposed here: a
 *        program can have real, contributing declarations this directory
 *        never lists, which this decoder has no way to account for from the
 *        trailer bytes alone.
 *      - `paramCount`: confirmed 100% (661 of 661 declarations, corpus-wide,
 *        after excluding the handful of programs whose charOffset check
 *        rejects the table -- see below) against the real parameter count in
 *        source.
 *      - `kind`: confirmed 100% to be exactly `7` iff the declaration has no
 *        `Returns` clause. Every other observed value pairs with a real
 *        `Returns` clause, and the value identifies the type itself for the
 *        scalar types in {@link RETURN_TYPE_CODES} (plus
 *        {@link ARRAY_RETURN_TYPE_FLAG} for `array of` one of them) and the
 *        built-in object types in {@link OBJECT_TYPE_CODES} (behind
 *        {@link OBJECT_RETURN_TYPE_FLAG}) -- zero collisions in 198 real
 *        declarations checked. App-Class return types use a different,
 *        still-unconfirmed bit pattern (see {@link decodeReturnType}).
 *
 * The charOffset self-check is not cosmetic: naively assuming the record
 * table starts right after the last *plain* name is wrong whenever a program
 * has colon-qualified names too (they sit between the plain names and the
 * real table start) -- confirmed on `WEBLIB_PORTAL.PORTAL_SEARCH_PB`,
 * `WEBLIB_PTNUI.PT_BUTTON_PIN` and `WEBLIB_PTWC.ISCRIPT1`, which all decode
 * cleanly once the table start accounts for their colon-qualified names.
 * There is no second, alternate table shape -- an earlier revision of this
 * decoder (and of this comment) concluded there was, from exactly this bug.
 * Requiring charOffset to match still matters for programs whose real shape
 * genuinely isn't this one (or that declare nothing but colon-qualified
 * references): 170 of 183 trailer-bearing programs verify, and every
 * declaration in a verified program's table matches real source on both
 * paramCount and the Returns-clause check.
 *
 * ## Application Class extension (pass thirteen's own directory, picked up
 * in pass twenty-eight)
 *
 * A class's directory carries two record kinds this format didn't have to
 * account for before, both confirmed byte-for-byte against
 * `TI_INTEGRATION.DVMEError`'s real, fully-decoded methods and properties,
 * then checked against every Application Class program in the corpus
 * (54/54 declarations correct on both `paramCount` and `hasReturnValue`):
 *
 * - **Record 0 is always the class's own colon-qualified self-reference**
 *   (`PKG:ClassName`, the name run's own first entry, charOffset 0), not a
 *   declaration -- its third field is a constant `0x400000`, checked and
 *   required before anything else in this mode; the whole table is refused
 *   if it doesn't hold, rather than treating a self-reference as a
 *   zero-param method.
 * - **A `property`/`instance` member gets a record too, but its third field
 *   is not a parameter count** -- confirmed non-`paramCount` values
 *   `0xa0000`, `0xa0001`, `0xb0002` against three real properties. Detected
 *   because no real parameter count ever sets bits above `0xffff`, and
 *   skipped rather than exposed as a many-thousand-parameter method. Its
 *   kind field does hold a real type code (reusing the same scalar/object
 *   codes a `Returns` clause uses), but not yet confirmed enough to expose
 *   as more than "this wasn't a method".
 * - The self-reference name is colon-qualified like an imported-class
 *   reference, but unlike one, it needs a record -- so in this mode the
 *   name-run scan keeps it (only it; every colon-qualified name after the
 *   first is still a mere type reference, e.g. an Application-Class-typed
 *   property's own type, and still gets no record of its own).
 *
 * Net effect on `TI_INTEGRATION.DVMEError`: `declarations` went from
 * `undefined` to all 11 of its real methods, each with the exact real
 * `paramCount` and return type, none of its 3 properties or its own
 * self-reference mistaken for one.
 */
function decodeDeclarations(
  bytes: Buffer, trailerOffset: number, isApplicationClass: boolean
): Declaration[] | undefined {
  const runStart = trailerOffset + 2;
  const names: { text: string; start: number; end: number }[] = [];
  // Every name-run entry, including the colon-qualified ones the loop below
  // excludes from `names` (they get no record of their own) -- needed to
  // resolve an Application-Class-typed return value, which references a
  // *specific occurrence* of a colon-qualified type name in this same run
  // rather than carrying its own text. See {@link decodeReturnType}.
  const allNames: { text: string; charOffset: number }[] = [];
  let i = runStart;
  // The record table starts after the WHOLE name run, including any
  // colon-qualified names -- not right after the last plain name. Programs
  // with no imported-class names never notice the difference (the run ends
  // at the same place either way), but programs that do have them (e.g.
  // `WEBLIB_PTNUI.PT_BUTTON_PIN`) put the plain-name records after the
  // colon-qualified names too, not before. Computing tableStart from just
  // the plain names -- reading records starting where the colon names
  // begin -- is exactly what produced the garbage-looking fields pass
  // eighteen originally attributed to "some other, unknown table shape";
  // there is no second shape, just a wrong table start.
  while (i < bytes.length) {
    const nameStart = i;
    let j = i;
    while (j + 1 < bytes.length && !(bytes[j] === 0 && bytes[j + 1] === 0)) j += 2;
    if (j + 1 >= bytes.length) return undefined; // ran off the end without a terminator
    const text = bytes.toString('utf16le', nameStart, j);
    // True end of the whole name run (plain + colon-qualified): stop WITHOUT
    // consuming these two bytes, since for a program with no colon-qualified
    // names this "empty string" is not a separate terminator at all -- it's
    // the coincidental leading zero bytes of the record table's own first
    // charOffset (always 0, since the first listed name always starts at
    // character offset 0). Advancing past it here would eat two real record
    // bytes and misalign every field that follows.
    if (text === '') { i = nameStart; break; }
    i = j + 2;
    allNames.push({ text, charOffset: (nameStart - runStart) / 2 });
    // An Application Class program's very first name is always its own
    // colon-qualified self-reference (e.g. `TI_INTEGRATION:DVMEError`) and,
    // unlike every other colon-qualified name, DOES get a record -- see the
    // n===0 handling below. Every other colon-qualified name is a
    // referenced type (an Application-Class-typed property's own type,
    // confirmed against `EOTF_CORE:DVM:Functions` in the same program) and
    // never gets one, same as the plain-Function case.
    if (!text.includes(':') || (isApplicationClass && names.length === 0)) {
      names.push({ text, start: nameStart, end: j + 2 });
    }
  }
  if (names.length === 0) return undefined;

  const tableStart = i;
  if (tableStart + names.length * 16 > bytes.length) return undefined;
  // Where the dispatch-slot table (see {@link decodeParameterTypes}) begins,
  // right after the last record.
  const slotsStart = tableStart + names.length * 16;

  const declarations: Declaration[] = [];
  for (let n = 0; n < names.length; n++) {
    const base = tableStart + n * 16;
    const charOffset = bytes.readInt32LE(base);
    if (charOffset !== (names[n].start - runStart) / 2) return undefined;
    const slotStart = bytes.readInt32LE(base + 4);
    const third = bytes.readInt32LE(base + 8);

    // Application Class only, record 0: the self-reference's own record,
    // not a callable declaration -- distinguished by a third field of
    // exactly 0x400000, confirmed against TI_INTEGRATION.DVMEError. A
    // program whose first record doesn't match this isn't the shape this
    // function understands, so it refuses the whole table rather than
    // treating a self-reference as a zero-param method.
    if (isApplicationClass && n === 0) {
      if (third !== 0x400000) return undefined;
      continue;
    }
    // Application Class only: a `property`/`instance` record reuses this
    // same third field for something else entirely -- confirmed
    // non-parameter-count values (0xa0000, 0xa0001, 0xb0002) against
    // DVMEError's three real properties. Recognised because no real
    // parameter count ever sets these bits: skipped here rather than
    // exposed as a nonsensical multi-thousand-parameter method. (Its own
    // kind field does hold a real type code, matching a Returns clause's
    // own scalar/object codes, but not yet confirmed enough to expose as
    // anything more specific than "this wasn't a method.")
    if (isApplicationClass && (third & 0xffff0000) !== 0) continue;

    const kind = bytes.readInt32LE(base + 12);
    declarations.push({
      name: names[n].text,
      paramCount: third,
      hasReturnValue: kind !== 7,
      returnType: decodeReturnType(kind, allNames),
      parameterTypes: third > 0
        ? decodeParameterTypes(bytes, slotsStart, slotStart, third, allNames)
        : undefined
    });
  }
  return declarations;
}

export function decodeProgram(
  bytes: Buffer,
  names: NameTable,
  options: DecodeOptions = { mode: 'auto' }
): DecodeResult {
  if (options.mode === 'raw') {
    return { text: rawDump(bytes, names), tokens: [], unknownOpcodes: [] };
  }

  const tokens: Token[] = [];
  const unknownOpcodes: { offset: number; opcode: number }[] = [];
  let i = 0;
  let trailerOffset: number | undefined;

  if (matchHeader(bytes)) {
    tokens.push({ kind: TokenKind.Header, text: '', offset: 0, opcode: bytes[0], format: 0 });
    i = HEADER_LENGTH;
  }

  // Whether the literal, strict marker exists anywhere in this buffer at
  // all -- computed once, up front, purely so the relaxed check just below
  // can never fire on a program the strict check already handles
  // correctly. 185 of 204 corpus programs have it; the relaxed check
  // below is scoped to (a small few of) the other 19.
  const hasStrictTrailerMarker = bytes.indexOf(Buffer.from(TRAILER_MARKER), i) !== -1;

  while (i < bytes.length) {
    if (bytes[i] === TRAILER_MARKER[0] && bytes[i + 1] === TRAILER_MARKER[1]) {
      trailerOffset = i;
      break;
    }
    // The trailer's marker is normally 0x2d immediately followed by 0x07,
    // with the name run starting fresh right after both bytes -- but when
    // the program's last real statement is followed by a trailing comment
    // before the trailer begins, the comment's own bytes sit between the
    // last real newline and the trailer's 0x07, so the literal
    // [0x2d, 0x07] pair never occurs adjacently anywhere in the buffer.
    // Confirmed against `WEBLIB_QUERY.ISCRIPT1` (real source:
    // `End-Function;\n\n/* 1746200000 */\nFunction IScript_ToXML();`) --
    // comments already carry their own newline (`NEWLINE_BOTH` in
    // `OPERAND_FORMAT`), so one immediately preceding an otherwise-bare
    // 0x07 plays the same role a literal 0x2d does elsewhere; the name
    // run afterwards (here, `IScript_ToExcel` then `IScript_ToXML`, both
    // declared functions) needs no separate empty-name marker of its own
    // to start, exactly like the ordinary case. `trailerOffset` is set to
    // `i - 1`, one byte *before* this 0x07, purely so
    // {@link decodeDeclarations}'s `runStart = trailerOffset + 2` still
    // lands right after it -- there is no real byte at `i - 1` to read.
    // Gated on the strict marker being entirely absent from the buffer,
    // so this can never preempt a real strict match earlier in a program
    // that also happens to contain this exact byte shape somewhere later
    // (an ordinary mid-stream bare 0x07, confirmed to occur ~900 times
    // corpus-wide for reasons unrelated to the trailer). Recovers the
    // declaration-name trailer -- both declared functions, each
    // byte-for-byte correct -- for `WEBLIB_QUERY.ISCRIPT1`, previously
    // undecodable past this point. See docs/ROADMAP.md pass thirty-two.
    if (!hasStrictTrailerMarker && bytes[i] === 0x07 && tokens[tokens.length - 1]?.kind === TokenKind.Comment) {
      trailerOffset = i - 1;
      break;
    }
    // A second relaxed shape, same reasoning: when the program's last
    // real statement ends in a bare `;` with no trailing comment, the
    // `;` itself (already `NEWLINE_AFTER`) sits directly before the
    // trailer's 0x07 -- no separate 0x2d newline byte gets emitted
    // between them, so the literal [0x2d, 0x07] pair never occurs.
    // Confirmed against AE_WRK.AE_ADD_SECTION.FieldChange's real
    // trailer (`Dup_SECTION`/`FOnBase...`, declared function names)
    // directly after `End-If;`, with no `0x2d` in between -- previously
    // undecodable past this point (43 unmapped opcodes downstream of
    // this one missed boundary). Gated the same way: only when the
    // strict marker is absent everywhere in the buffer.
    if (!hasStrictTrailerMarker && bytes[i] === 0x07 && bytes[i - 1] === 0x15) {
      trailerOffset = i - 1;
      break;
    }
    // A fourth shape: 0xc0 immediately before the trailer's 0x07, the
    // same structural role 0x2d plays elsewhere -- not yet understood
    // what distinguishes it from the ordinary [0x2d, 0x07] case, but
    // confirmed against EOAWCOMMENT2.MAIN.GBL.default.1900-01-01.
    // Step02.OnExecute's real trailer (12 unmapped opcodes downstream of
    // this one missed boundary, all cleared once found). Checked with a
    // lookahead here, not a lookback like the `;` case above, since 0xc0
    // is not a real opcode with a meaning of its own -- checking after
    // the fact would already have recorded it as unmapped on its own
    // turn through the loop. Gated the same way as the other relaxed
    // shapes.
    if (!hasStrictTrailerMarker && bytes[i] === 0xc0 && bytes[i + 1] === 0x07) {
      trailerOffset = i;
      break;
    }
    // A fifth shape: the trailer starts directly after `end-method`
    // (0x64) with no separator at all, when a class's only method ends
    // the whole program -- confirmed against GPDE_CT_MODULE.
    // CT_MsgGetExplainText.OnExecute's real trailer, whose self-
    // reference name (`GPDE_CT_MODULE:CT_MsgGetExplainText`) sits
    // directly after the constructor's own `end-method`, no `;` in
    // between (every other `end-method` in the corpus has one). Gated
    // the same way as the other relaxed shapes.
    if (!hasStrictTrailerMarker && bytes[i] === 0x07 && bytes[i - 1] === 0x64) {
      trailerOffset = i - 1;
      break;
    }

    const offset = i;
    const opcode = bytes[i++];

    const textKind = TEXT_INTRODUCERS.get(opcode);
    if (textKind !== undefined) {
      const run = readTextRun(bytes, i);
      if (run !== undefined) {
        tokens.push({
          kind: textKind, text: renderTextRun(textKind, run.text), offset, opcode,
          format: OPERAND_FORMAT.get(opcode) ?? 0
        });
        i = run.end;
        continue;
      }
      // Didn't fit the text-run shape: fall through and report the
      // introducer byte itself as unknown, exactly as an unrecognised
      // opcode would be, rather than guessing at what follows it.
    }

    if (opcode === 0x24 || opcode === 0x4e || opcode === 0x55) {
      const comment = readLengthPrefixedText(bytes, i);
      if (comment !== undefined) {
        tokens.push({
          kind: TokenKind.Comment, text: comment.text, offset, opcode,
          format: OPERAND_FORMAT.get(opcode) ?? 0
        });
        i = comment.end;
        continue;
      }
    }

    // #If/#Then/#Else/#End-If: PeopleTools evaluates these at compile
    // time, so only the taken branch is ever compiled into real tokens.
    // 0x75 always carries just the condition text (`#If #TOOLSREL >=
    // "8.60"`); 0x78 always carries just `#End-If`. 0x76 (`#Then`) and
    // 0x77 (`#Else`, pass forty) carry their own bare keyword text alone
    // when their branch WAS compiled (real tokens follow normally), but
    // when a branch was NOT taken, its length-prefixed text is that
    // keyword plus the entire untouched source of the dead branch,
    // verbatim down to the byte -- including its own embedded newlines
    // and indentation -- since nothing in it was ever tokenized.
    // Confirmed byte-for-byte against WEBLIB_HRS_CB.HRS_ISCRIPT.
    // FieldFormula: `#If #TOOLSREL < "8.60" #Then` (compiled under a >=
    // 8.60 tools release, so this branch lost) carries `#Then\n
    // &ShowNotif = Decrypt("", &ShowNotif1);` as one 100-byte run,
    // verbatim against real source, immediately followed by 0x78's
    // `#End-If`. `#Else` confirmed the same way against
    // AGC_PROCESS_AG.ActivityGuideCreation.OnExecute's real `#If
    // #ToolsRel < "8.58" #Then\n   %This.SetLanguages(&list);\n#Else\n
    // /* 8.58 and greater ... */` -- here the `< "8.58"` branch lost, so
    // `#Then` carries the dead body and `#Else`'s own text is bare
    // (10 bytes, exactly `#Else`), with real compiled tokens (a comment,
    // then `If`) following normally. See docs/ROADMAP.md passes
    // thirty-seven and forty.
    if (opcode === 0x75 || opcode === 0x76 || opcode === 0x77 || opcode === 0x78) {
      const directive = readLengthPrefixedText(bytes, i);
      if (directive !== undefined) {
        tokens.push({
          kind: TokenKind.Keyword, text: directive.text, offset, opcode,
          format: OPERAND_FORMAT.get(opcode) ?? 0
        });
        i = directive.end;
        continue;
      }
    }

    if (opcode === 0x50 || opcode === 0x11) {
      const operandLength = opcode === 0x50 ? 18 : 14;
      // 0x11's own value doesn't start at the usual offset+2 -- confirmed
      // against OU_RC_PAYINIT.CHKADV_NO_THRU.SaveEdit's real
      // `MsgGet(2000, 420, ...)`: two consecutive 0x11 literals, real
      // PSMSGCATDEFN values (MESSAGE_SET_NBR 2000, MESSAGE_NBR 420) found
      // only by reading from offset+4, not +2 -- two extra always-zero
      // bytes this shape carries that 0x50's doesn't. This project's own
      // prior note called 0x11 "not yet independently confirmed"; this is
      // that confirmation. See docs/ROADMAP.md pass forty-three.
      const valueOffset = opcode === 0x50 ? 2 : 4;
      const valueBytes = opcode === 0x50 ? 16 : (14 - valueOffset);
      const literal = readByteIntegerLiteral(bytes, i, operandLength, valueBytes, opcode === 0x50, valueOffset);
      if (literal !== undefined) {
        tokens.push({
          kind: TokenKind.NumberLiteral, text: literal.text, offset, opcode,
          format: OPERAND_FORMAT.get(opcode) ?? 0
        });
        i = literal.end;
        continue;
      }
    }

    if (opcode === 0x21) {
      const ref = readRecordFieldReference(bytes, i);
      // A NameResolutionError here means the index doesn't land on a real
      // PSPCMNAME entry -- our index-to-NAMENUM formula is confirmed, not
      // proven universal, so an out-of-range index falls through to unknown
      // rather than rendering a guess.
      const resolved = ref !== undefined ? tryResolveName(names, ref.nameNum) : undefined;
      if (ref !== undefined && resolved !== undefined) {
        tokens.push({
          kind: TokenKind.Name, text: resolved, offset, opcode,
          format: OPERAND_FORMAT.get(opcode) ?? 0
        });
        i = ref.end;
        continue;
      }
    }

    // A sibling of 0x21's name reference, same 2-byte index+1=NAMENUM shape
    // and the same PSPCMNAME table, but for `&recVar.FIELDNAME.Value` --
    // FIELDNAME written bare, with no `FIELD.` (or other) qualifier prefix,
    // since it's already unambiguous right after a dot on a Record
    // variable. Confirmed against WEBLIB_GPDE.GPDE_AL_ISCRIPT.FieldFormula
    // by cross-checking every computed NAMENUM against that program's own
    // name table directly (not just against rendered text): 6/6 exact
    // matches (FIELD.GPDE_ELSTER_TKT, FIELD.SEQ_NUM, FIELD.EMPLID,
    // FIELD.EMPL_RCD, FIELD.EFFDT, FIELD.GPDE_XML_TAX_INFO, in that
    // occurrence order). Corpus-wide: 633/659 (96.0%), all 26 misses a
    // NameResolutionError (index out of range) in already heavily-corrupted
    // programs (WEBLIB_CTI, WEBLIB_MCF, OU_JET_PACK.ROADMAP), which already
    // falls through to unknown the same safe way 0x21's own resolution
    // failure does. See docs/ROADMAP.md pass twenty-five.
    if (opcode === 0x4a) {
      const ref = readRecordFieldReference(bytes, i);
      const resolved = ref !== undefined ? tryResolveName(names, ref.nameNum) : undefined;
      const bare = resolved !== undefined
        ? resolved.slice(resolved.indexOf('.') + 1)
        : undefined;
      if (ref !== undefined && bare !== undefined && bare.length > 0) {
        tokens.push({
          kind: TokenKind.Name, text: bare, offset, opcode,
          format: OPERAND_FORMAT.get(0x21) ?? 0
        });
        i = ref.end;
        continue;
      }
    }

    // A third sibling of 0x21's name reference: same 2-byte index+1=NAMENUM
    // shape and the same PSPCMNAME table, for one of PeopleCode's several
    // built-in "quoted qualified reference" types -- unlike 0x21 and 0x4a,
    // rendered with the qualifier as a fixed keyword and the reference name
    // in quotes, not dot-joined. Originally confirmed only for Integration
    // Broker Operations (WEBLIB_GS_JU_IB.ISCRIPT1's real
    // `CreateMessage(Operation."GL_JRNL_IMP", %IntBroker_Request);`, its
    // only unmapped opcode), on the reasoning that an Operation name can
    // contain characters a bare identifier can't.
    //
    // Scanning the live database (pass forty) found the same opcode
    // resolving to `BUSEVENT.Notify Employee` in ACA_NOTE_WRK.EMPLID.
    // Workflow's real `TriggerBusinessEvent(BusProcess.
    // SEND_ACA_NOTIFICATION, BusActivity.SEND_ACA_NOTIFICATION,
    // BusEvent."Notify Employee")` -- a Business Event name containing a
    // literal space, so the quoted form isn't optional there either. Since
    // both confirmed qualifiers needed quoting for the exact same
    // structural reason (a name that can't be a bare identifier), and nothing
    // in the format suggests 0x48 changes shape per qualifier, the other
    // qualifiers seen alongside these two in the same database sweep
    // (MenuName/BarName/ItemName/Page in ACA_XML_WRK.ACA_UPDATE_PB.
    // FieldChange's real navigation-function arguments, BusProcess/
    // BusActivity above) are included on the same basis, all quoted
    // uniformly. Any qualifier outside this confirmed set still falls
    // through to unknown rather than guessing. See docs/ROADMAP.md pass
    // forty.
    if (opcode === 0x48) {
      const ref = readRecordFieldReference(bytes, i);
      const resolved = ref !== undefined ? tryResolveName(names, ref.nameNum) : undefined;
      const dot = resolved?.indexOf('.') ?? -1;
      const qualifier = dot > 0 ? resolved!.slice(0, dot).toUpperCase() : undefined;
      // RECORD is the one exception to the quoted-reference shape every
      // other confirmed qualifier here uses: CreateRecord(Record.X) is
      // conventionally unquoted, dot-joined, the exact same rendering
      // 0x21 already gives a plain RECORD.FIELD reference -- confirmed
      // against EOL_PUBLISH.PUBLISH2.GBL.default.1900-01-01.Step30.
      // OnExecute's real `&DELAYREC = CreateRecord(Record.EO_EFFDELAY)`.
      if (ref !== undefined && resolved !== undefined && qualifier === 'RECORD') {
        tokens.push({ kind: TokenKind.Name, text: resolved, offset, opcode, format: OPERAND_FORMAT.get(0x21) ?? 0 });
        i = ref.end;
        continue;
      }
      const display = qualifier !== undefined ? QUOTED_REFERENCE_QUALIFIERS.get(qualifier) : undefined;
      if (ref !== undefined && resolved !== undefined && dot > 0 && display !== undefined) {
        tokens.push({
          kind: TokenKind.Name, text: `${display}."${resolved.slice(dot + 1)}"`, offset, opcode,
          format: OPERAND_FORMAT.get(0x21) ?? 0
        });
        i = ref.end;
        continue;
      }
    }

    // 0x0a is overloaded: it is a literal newline between statements, but it
    // is ALSO -- far more often (17835 of ~20400 occurrences corpus-wide) --
    // a silent "bare identifier follows" introducer, the same role as
    // 0x12/0x16/0x01/0x40, that happens to reuse the newline byte value.
    // Confirmed by OU_OJ_LAYOUT.Activate: its real source is the single line
    // `AddOnLoadScript(GetHTMLText(HTML.OU_OJ_LOAD_CSS));` with no newline
    // anywhere before GetHTMLText, yet the byte stream has 0x0a right there.
    // A prior revision rendered the newline's '\n' AND the identifier text,
    // producing exactly the fragmented, wrongly-linebroken output this was
    // reported against. The identifier-introducer role is checked first, and
    // only when it does not apply does 0x0a fall through to a real newline.
    if (opcode === 0x0a) {
      const run = readTextRun(bytes, i);
      if (run !== undefined) {
        tokens.push({
          kind: TokenKind.Name, text: run.text, offset, opcode,
          format: OPERAND_FORMAT.get(opcode) ?? 0
        });
        i = run.end;
        continue;
      }
      tokens.push({ kind: TokenKind.Newline, text: '', offset, opcode, format: F.NEWLINE_ONCE });
      continue;
    }

    // 0x41 is also overloaded -- see the 0x63 (`method`) handling below,
    // where a *different* occurrence of this same byte value is consumed as
    // part of an Application Class method's implementation header. This is
    // the other role: immediately before And (0x18) or Or (0x1e), a
    // zero-width marker the same way 0x42 above always is, confirmed by
    // hand-walking `WEBLIB_GS_SSO.ISCRIPT1` and four other programs byte for
    // byte (every one of them a compound boolean condition wrapped across a
    // line, e.g. `If %DbType = "SYBASE" Or\n %DbType = "INFORMIX" Then`) and
    // checked structurally (next token is exactly And/Or, not a text match)
    // against every program with a small unmapped-opcode count: 22/22
    // (100%). Unfiltered corpus-wide it's only 256/402, because most of the
    // rest are the unrelated method-header role above or fall inside
    // already-corrupted programs -- gated on the next byte rather than
    // mapped in OPCODES so it never fires outside this one confirmed shape.
    // See docs/ROADMAP.md pass twenty-one.
    if (opcode === 0x41 && (bytes[i] === 0x18 || bytes[i] === 0x1e)) {
      tokens.push({ kind: TokenKind.Punctuation, text: '', offset, opcode, format: F.NONE });
      continue;
    }
    // The same And/Or role, but with a comment sitting between this
    // marker and the And/Or it precedes -- the same "a trailing comment
    // carries its own newline, so it can stand in for what usually comes
    // right after a zero-width marker" reasoning 0x42's own trailing-
    // comment case and the trailer-marker's comment case both use.
    // Confirmed against DERIVED_HS.EMPLID_LABEL.RowInit's real `If
    // %PanelGroup = PANELGROUP.HS_INJ_ILL_REHAB\n/****Start of
    // Resolution Id: 305302****/\nOr %Component = COMPONENT.
    // HS_NE_INJILL_REHAB` -- this program's only unmapped opcode.
    if (opcode === 0x41 && (bytes[i] === 0x24 || bytes[i] === 0x4e || bytes[i] === 0x55)) {
      tokens.push({ kind: TokenKind.Punctuation, text: '', offset, opcode, format: F.NONE });
      continue;
    }

    // A third role for the same overloaded byte: zero-width right after
    // a DLL declaration's `Library "dllname"` string and right before
    // the parameter list's own newline. Confirmed against APPS_RLR.
    // Utilities.OnExecute's real `Declare Function RegCloseKey Library
    // "advapi32"\n      (long Value As number) Returns long;` -- 3/3
    // occurrences in that program, all in exactly this position (next
    // token always the newline opcode, 0x2d), the program's only
    // remaining unmapped opcode once Library/Value/Ref were added. See
    // docs/ROADMAP.md pass forty-two.
    if (opcode === 0x41 && bytes[i] === 0x2d) {
      tokens.push({ kind: TokenKind.Punctuation, text: '', offset, opcode, format: F.NONE });
      continue;
    }

    // `Continue` -- reopened after pass twenty rejected it on a raw,
    // unfiltered corpus-wide count (9/660): that count included every
    // corruption-noise occurrence of this byte value, structurally
    // unrelated to the real statement. Gating on the very next byte being
    // 0x15 (`;`, i.e. a real, already-recognised token immediately
    // follows) filters almost all of that out by construction, the same
    // way 0x41's gate does above: checked this way at *full* corpus
    // scale (not just the usual <=25-unmapped filter), 9/17 -- and all 8
    // non-matches are the same single program, `WEBLIB_OU_LP.ISCRIPT1`,
    // already known stale (pass thirteen): its project-export source is
    // an older version than the live bytes actually decoded. Every other
    // real sample matches, including three newly found this pass
    // (`WEBLIB_PTIFRAME.ISCRIPT1`, `WEBLIB_UNREMREG.ISCRIPT1`,
    // `WEBLIB_PTDIAG.ISCRIPT1` twice) -- one with a comment right above
    // it that says so in English: `/* ... do not output anything,
    // continue to next app package */`. See docs/ROADMAP.md pass
    // thirty-one.
    if (opcode === 0x6e && bytes[i] === 0x15) {
      tokens.push({ kind: TokenKind.Keyword, text: 'Continue', offset, opcode, format: F.SPACE_BEFORE });
      continue;
    }

    // `Declare Function Name PeopleCode Rec.Field Event;` (an external
    // function import): confirmed by hand-walking WEBLIB_GS_CMD.ISCRIPT1,
    // whose only statement is exactly this construct, then checked
    // structurally against every program with a small unmapped-opcode
    // count -- 0x31 sits immediately before Function (0x32) 35/35 (100%),
    // and of the 944 Function tokens corpus-wide, exactly the 212 that are a
    // real Declare statement (not an ordinary `Function ... End-Function`
    // body) are preceded by it. Consumed together with the Function opcode
    // as one token, not two -- Function's own FUNCTION_STYLE carries
    // NEWLINE_BEFORE, which would otherwise split "Declare" onto its own
    // line the same way ordinary NEWLINE_BEFORE tokens do when text has
    // already been written before them (see render()'s atLineStart).
    // See docs/ROADMAP.md pass twenty-one.
    if (opcode === 0x31 && bytes[i] === 0x32) {
      tokens.push({ kind: TokenKind.Keyword, text: 'Declare Function', offset, opcode, format: FUNCTION_STYLE });
      i++;
      continue;
    }

    // The same Declare statement's `PeopleCode` keyword, between the
    // declared function's own name and the record.field it lives on.
    // Confirmed the same way as 0x31 just above, in the same sample:
    // immediately before a record.field reference (0x21) 35/35 (100%) on
    // programs with a small unmapped-opcode count. Left as its own token
    // (unlike 0x31/Function) since what follows it -- the reference itself
    // -- still needs the normal 0x21 resolution logic, not fixed text.
    if (opcode === 0x3a && bytes[i] === 0x21) {
      tokens.push({ kind: TokenKind.Keyword, text: 'PeopleCode', offset, opcode, format: SPACE_BOTH });
      continue;
    }

    // class/end-class/method/end-method -- see isApplicationClass on
    // DecodeOptions for why these only decode when the caller already
    // knows the program is an Application Class, rather than always.
    if (options.isApplicationClass) {
      if (opcode === 0x5a) {
        tokens.push({ kind: TokenKind.Keyword, text: 'class', offset, opcode, format: FUNCTION_STYLE });
        continue;
      }
      // A class declaration's sibling for an interface (`interface X ...
      // end-interface;` rather than `class X ... end-class;`). Confirmed
      // against BN_CERTIFICATE.WeightCalculator.OnExecute, whose own doc
      // comment says so directly (`* WEIGHTCALCULATOR - This interface is
      // a implementation of the Strategy pattern...`); 0x70 sits right
      // before the bare name with no other class-declaration opcode
      // (0x5a/0x5c) anywhere in the program. See docs/ROADMAP.md pass
      // forty-one.
      if (opcode === 0x70) {
        tokens.push({ kind: TokenKind.Keyword, text: 'interface', offset, opcode, format: FUNCTION_STYLE });
        continue;
      }
      // interface's own closer and its method modifier. Confirmed
      // against the same BN_CERTIFICATE.WeightCalculator.OnExecute:
      // `method calculate(...) Returns number` is followed by `0x6f;`
      // then `0x71;` -- `abstract` modifying the (bodyless) interface
      // method declaration, then `end-interface` closing the block.
      // Corroborated independently by a reference PeopleCodeParser.java
      // (a separate, older decompiler project) which lists the same two
      // byte values for the same two keywords. See docs/ROADMAP.md pass
      // forty-two.
      if (opcode === 0x6f) {
        tokens.push({ kind: TokenKind.Keyword, text: 'abstract', offset, opcode, format: F.SPACE_BEFORE });
        continue;
      }
      if (opcode === 0x71) {
        tokens.push({ kind: TokenKind.Keyword, text: 'end-interface', offset, opcode, format: ENDBLOCK_STYLE });
        continue;
      }
      if (opcode === 0x5b) {
        tokens.push({ kind: TokenKind.Keyword, text: 'end-class', offset, opcode, format: ENDBLOCK_STYLE });
        continue;
      }
      if (opcode === 0x64) {
        tokens.push({ kind: TokenKind.Keyword, text: 'end-method', offset, opcode, format: END_FUNCTION_STYLE });
        continue;
      }
      // 0x63 (`method`) is overloaded: inside a class's declaration block
      // it introduces a one-line method signature (no indent change, same
      // shape as Local), but the implementation header further down --
      // `method Name` with no parameter list, opening the body that runs
      // to `end-method;` -- carries an extra 0x41 byte between the opcode
      // and the name, confirmed present in exactly the implementation-header
      // occurrences (12/12 in ComponentRegistry, 3/3 in AccessCheck), never
      // in a declaration. Consumed here as part of this token rather than
      // surfaced as its own Unknown, since its only confirmed role is this
      // pairing.
      if (opcode === 0x63) {
        const isImplementationHeader = bytes[i] === 0x41;
        if (isImplementationHeader) i++;
        tokens.push({
          kind: TokenKind.Keyword, text: 'method', offset, opcode,
          format: isImplementationHeader ? FUNCTION_STYLE : NEWLINE_BEFORE_SPACE_AFTER
        });
        continue;
      }
      // A property getter's implementation header carries the same extra
      // 0x41 byte `method`'s does, between the opcode and the accessor's
      // name -- confirmed against ADS.Common.OnExecute's real `get
      // useFlowControl\n   /+ Returns Boolean +/\n\n   Return
      // (GetUserOption(...) <> "Y");` (2/2 occurrences in that program).
      // See docs/ROADMAP.md pass forty.
      if (opcode === 0x5f) {
        const isImplementationHeader = bytes[i] === 0x41;
        if (isImplementationHeader) i++;
        tokens.push({
          kind: TokenKind.Keyword, text: 'get', offset, opcode,
          format: isImplementationHeader ? (F.INCREASE_INDENT_ONCE | F.SPACE_BEFORE) : F.SPACE_BEFORE
        });
        continue;
      }
      // get's setter sibling. Confirmed against ADS.GVar4AdsDefnRet.
      // OnExecute's real `property string PTADSADVSRCHIN get set;` --
      // an auto-implemented property (both accessors, no custom body):
      // `property`/type/name run directly into `get` then `set` with no
      // `;` between them, the whole thing one statement. Gated the same
      // lookahead `get` has in case a `set` implementation header turns
      // out to carry the same extra 0x41 byte `method`'s and `get`'s do.
      // Neither carries INCREASE_INDENT_ONCE unless it really is an
      // implementation header -- the bare shorthand form has no body of
      // its own to indent, confirmed the hard way: applying it
      // unconditionally left every subsequent `property ... get set;`
      // line in that same real program one level deeper than the last,
      // all the way down the class (16 properties, 16 levels of drift).
      if (opcode === 0x49) {
        const isImplementationHeader = bytes[i] === 0x41;
        if (isImplementationHeader) i++;
        tokens.push({
          kind: TokenKind.Keyword, text: 'set', offset, opcode,
          format: isImplementationHeader ? (F.INCREASE_INDENT_ONCE | F.SPACE_BEFORE) : F.SPACE_BEFORE
        });
        continue;
      }
      // get's own closing keyword. Confirmed against ADS.Common.
      // OnExecute's real getter bodies: each one's real `Return (...);`
      // is immediately followed by a bare `end-get;` and then the next
      // getter's own doc comment (`/* useApprovals */`, `/* useFlowControl
      // */`, ...) -- 3/3 occurrences in that program. See
      // docs/ROADMAP.md pass forty-two.
      if (opcode === 0x6a) {
        tokens.push({ kind: TokenKind.Keyword, text: 'end-get', offset, opcode, format: END_FUNCTION_STYLE });
        continue;
      }
      // end-get's setter sibling, closing a set implementation body the
      // same way. Not yet seen in a real program with a small enough
      // unmapped count to hand-walk directly; added on the strength of
      // its structural symmetry with end-get (0x6a) and set (0x49), and
      // corroborated by a reference PeopleCodeParser.java (a separate,
      // older decompiler project) which lists this exact byte value for
      // this exact keyword.
      if (opcode === 0x6b) {
        tokens.push({ kind: TokenKind.Keyword, text: 'end-set', offset, opcode, format: END_FUNCTION_STYLE });
        continue;
      }
      // Application Class trailer work (pass thirteen's open item), picked
      // back up in pass twenty-eight: property/instance/extends. Confirmed
      // byte-for-byte against real known source (not just this decoder's
      // own rendering) in OU_JET_PACK.Model.PageCol (`property number
      // ColSeq;`, 5 properties, all this same opcode), OU_JET_PACK.Storage.
      // DesignRepository and OU_LANDINGPAGE.LandingPage.OUBanner
      // (`instance OU_JET_PACK:Widgets:BaseWidget &objBase;`), and
      // OUBanner's own `class OUBanner extends OU_JET_PACK:Widgets:
      // BaseWidget`. Gated the same way as class/method above: 0x5e and
      // 0x5c never occur outside an Application Class program, but 0x61
      // and 0x62 individually do (353 and 53 corpus-wide occurrences in
      // plain Function programs) -- only the *pair*, 0x61 immediately
      // followed by 0x62, is `instance`, and only inside a class. See
      // docs/ROADMAP.md pass twenty-eight.
      if (opcode === 0x5e) {
        tokens.push({ kind: TokenKind.Keyword, text: 'property', offset, opcode, format: NEWLINE_BEFORE_SPACE_AFTER });
        continue;
      }
      if (opcode === 0x5c) {
        tokens.push({ kind: TokenKind.Keyword, text: 'extends', offset, opcode, format: SPACE_BOTH });
        continue;
      }
      // extends' sibling for an interface: `class X implements Y` rather
      // than `class X extends Y`. Confirmed against ACCOM_TYPE_FULLSYNC.
      // AccomTypeFullsync.OnExecute's real `class AccomTypeFullsync
      // implements PS_PT:Integration:INotificationHandler` -- this
      // program's only unmapped opcode, sitting in exactly the position
      // 0x5c occupies for a real base class, right after the class name
      // and right before the colon-qualified package path. See
      // docs/ROADMAP.md pass forty.
      if (opcode === 0x72) {
        tokens.push({ kind: TokenKind.Keyword, text: 'implements', offset, opcode, format: SPACE_BOTH });
        continue;
      }
      // A method parameter's `out` modifier -- sits right after the
      // parameter's `As <type>` and right before the `,` or `)` that
      // ends it. Explains a pattern that looked inconsistent when first
      // investigated (pass forty, tried and rejected "every non-first
      // string parameter" and "same type as the previous parameter" --
      // both falsified by real counter-examples): the real distinguisher
      // was never the type, it was whether that specific parameter is
      // declared `out`. Confirmed against ADS.Common.OnExecute's real
      // `method ADSHasAbsentRecords(&adsName As string,
      // &missingRecordsInProj As string out) Returns boolean;` -- a
      // parameter named for carrying output, out is exactly what it
      // should be. Corroborated independently by a reference
      // PeopleCodeParser.java (a separate, older decompiler project)
      // which lists this exact byte value for this exact keyword. See
      // docs/ROADMAP.md pass forty-two.
      if (opcode === 0x5d) {
        tokens.push({ kind: TokenKind.Keyword, text: 'out', offset, opcode, format: F.SPACE_BEFORE });
        continue;
      }
      // 0x61 (`private`) and 0x62 (`instance`) are two independent
      // keywords, not a fused pair -- corrected in pass forty-two from
      // pass twenty-eight's original attribution. The corpus's own
      // OU_LANDINGPAGE.LandingPage.OUBanner (the pass-twenty-eight
      // confirmation sample) makes the bug visible once checked against
      // its literal real source rather than just a substring match: the
      // real text is `private\n   instance OU_JET_PACK:Widgets:
      // BaseWidget &objBase;` -- two separate lines, two separate
      // keywords -- but treating "0x61 immediately followed by 0x62" as
      // one `instance` token silently dropped the `private` that should
      // have rendered right before it, and the corpus checker never
      // caught it because it only verifies decoded text appears in
      // source, never the reverse. `0x61`'s own standalone confirmation
      // (pass forty, ADS.Relation.SqlGenerator.OnExecute) still holds --
      // it just was never a special case to begin with. `0x62` alone is
      // `instance`, confirmed the same way against EOAW_CORE.Utils.
      // OnExecute's real `Local string &errorSetting;\ninstance array of
      // string &delegationProcesses;` -- gated on isApplicationClass
      // like every other keyword byte 0x62 collides with outside a class
      // (353/53 occurrences corpus-wide in plain Function programs,
      // pass twenty-eight's own count, are why this needs the gate at
      // all).
      if (opcode === 0x61) {
        tokens.push({ kind: TokenKind.Keyword, text: 'private', offset, opcode, format: F.NEWLINE_BEFORE });
        continue;
      }
      // private's own sibling section header. Confirmed against ADSM.
      // CompareDataManager.OnExecute's real trailer: right after
      // `property integer AdsContentID_;` sits 0x73, then a doc comment
      // whose own real text says so directly (`/* This is not public as
      // the GetNextDiff() method will load the data as required...
      // */`), then `method LoadBackingData() Returns ...`. This
      // program's only unmapped opcode.
      if (opcode === 0x73) {
        tokens.push({ kind: TokenKind.Keyword, text: 'protected', offset, opcode, format: F.NEWLINE_BEFORE });
        continue;
      }
      if (opcode === 0x62) {
        tokens.push({ kind: TokenKind.Keyword, text: 'instance', offset, opcode, format: NEWLINE_BEFORE_SPACE_AFTER });
        continue;
      }
      // A property's own accessor modifier -- optional, sitting between
      // the property's declared name and its terminating `;`. Found
      // scanning the live database (pass thirty-nine): every property in
      // ADSM.ADSCompareDiffObject.OnExecute carries it (19/19), and that
      // same program hands over the literal text directly -- one property
      // is commented out with `rem`, and the comment's own real text
      // reads `rem property array of array of string RecKeyValueList
      // readonly;`. Absent on OU_JET_PACK.Model.PageCol's plain, mutable
      // `property number ColSeq;` (pass twenty-eight), present on every
      // property of a class whose whole purpose is exposing read-only
      // diff data -- consistent with an optional modifier, not a
      // mandatory part of the grammar.
      if (opcode === 0x60) {
        tokens.push({ kind: TokenKind.Keyword, text: 'readonly', offset, opcode, format: F.SPACE_BEFORE });
        continue;
      }
    }

    const mapped = OPCODES.get(opcode);
    if (mapped === undefined) {
      unknownOpcodes.push({ offset, opcode });
      if (options.mode === 'strict') {
        throw new UndecodableProgramError(offset, opcode, unknownOpcodes.length);
      }
      tokens.push({ kind: TokenKind.Unknown, text: '', offset, opcode, format: 0 });
      continue;
    }

    tokens.push({ kind: mapped.kind, text: mapped.text ?? '', offset, opcode, format: mapped.format });
  }

  const declarations = trailerOffset !== undefined
    ? decodeDeclarations(bytes, trailerOffset, options.isApplicationClass ?? false)
    : undefined;
  return { text: render(tokens, unknownOpcodes), tokens, unknownOpcodes, trailerOffset, declarations };
}

/**
 * Rebuilds indentation and spacing from each token's {@link FMT} bitmask.
 * There is no in-band indentation in the byte stream (App Designer's
 * Scintilla editor reconstructs it the same way); this walks the token
 * stream tracking an indent level and a "start of line" cursor, applying
 * each token's newline/indent/space flags around its text. Trailing
 * whitespace before a newline is trimmed so indentation changes never leave
 * stray spaces.
 */
function render(tokens: readonly Token[], unknown: readonly { offset: number; opcode: number }[]): string {
  // Built as an array of chunks rather than repeated string concatenation:
  // the trim/lookback operations below only ever need to see the last chunk
  // emitted, so this stays linear in the token count even for the largest
  // real programs (some run to several thousand tokens), where repeatedly
  // regex-trimming a single ever-growing string was quadratic and, on a
  // full-corpus validation run, never finished.
  const out: string[] = [];
  let indent = 0;
  let atLineStart = true;
  // Punctuation that binds tightly to what follows it (`Name(`, `Name.Field`,
  // `@Class`, `arr[i]`): a token declaring SPACE_BEFORE for itself (an
  // identifier has no way to know what precedes it) does not get that space
  // when the previous character is one of these, so `GetHTMLText(x)` and
  // `Name.Field` stay tight instead of picking up a stray space right after
  // the `(`, `.`, `@` or `[`.
  const TIGHT_AFTER = new Set(['(', '.', '@', '[', ':']);

  const lastChar = () => {
    const last = out[out.length - 1];
    return last ? last[last.length - 1] : '';
  };
  const trimTrailing = () => {
    while (out.length > 0 && /^[ \t]+$/.test(out[out.length - 1])) out.pop();
    if (out.length > 0) out[out.length - 1] = out[out.length - 1].replace(/[ \t]+$/, '');
  };
  // Writing the indent puts us at the start of a line with nothing on it
  // yet -- atLineStart stays true until real token text is pushed. Setting
  // it false here (an earlier revision did) meant a token's own
  // NEWLINE_BEFORE could never tell it had just landed on a fresh line via
  // someone else's NEWLINE_AFTER, so `;` (NEWLINE_AFTER) immediately
  // followed by the next declaration's `method`/`Local`/etc (NEWLINE_BEFORE)
  // always emitted a second, redundant newline -- a blank line after every
  // single statement, corpus-wide, that the text-only (whitespace-blind)
  // corpus-validate.mjs metric never had a way to catch.
  const writeIndent = () => { out.push('  '.repeat(indent)); atLineStart = true; };

  for (const t of tokens) {
    if (t.kind === TokenKind.Header) continue;
    const f = t.format;

    if (f & F.DECREASE_INDENT) indent = Math.max(0, indent - 1);
    // NO_SPACE_BEFORE overrides whatever trailing space the previous token's
    // own SPACE_AFTER left behind (e.g. `;` right after `False `), not just
    // its own SPACE_BEFORE -- a token has no way to know what precedes it.
    if (f & F.NO_SPACE_BEFORE && lastChar() === ' ') trimTrailing();

    if (f & F.NEWLINE_ONCE) {
      // A literal newline byte in the stream (0x2d, or 0x0a falling through
      // to its newline role): always emits, even at the very start of
      // output -- unlike NEWLINE_BEFORE below, which is a structural
      // "start this construct on its own line" flag that would otherwise
      // open every program with a spurious blank line.
      trimTrailing();
      out.push('\n');
      writeIndent();
    } else if (f & F.NEWLINE_BEFORE) {
      trimTrailing();
      // Skip the newline entirely when we're already sitting at the start
      // of a fresh, empty line -- someone else's NEWLINE_AFTER (or
      // NEWLINE_ONCE) already got us here. Only the very first token of the
      // whole program starts genuinely blank (atLineStart is true from
      // initialisation, not from a prior writeIndent), which this also
      // correctly leaves alone.
      if (!atLineStart) out.push('\n');
      writeIndent();
    } else if (
      f & F.SPACE_BEFORE && !(f & F.NO_SPACE_BEFORE) &&
      !atLineStart && lastChar() !== ' ' && !TIGHT_AFTER.has(lastChar())
    ) {
      out.push(' ');
    }

    if (t.text) {
      out.push(t.text);
      atLineStart = false;
    }

    if (f & (F.INCREASE_INDENT | F.INCREASE_INDENT_ONCE)) indent++;

    if (f & F.NEWLINE_AFTER) {
      trimTrailing();
      out.push('\n');
      writeIndent();
    } else if (f & F.SPACE_AFTER && !(f & F.NO_SPACE_AFTER)) {
      out.push(' ');
    }
  }

  trimTrailing();
  const body = out.join('').replace(/\n{3,}/g, '\n\n');

  if (unknown.length === 0) return body;

  // Lead with the gap report so nobody edits and saves source that is missing
  // constructs the decoder could not read.
  const sample = unknown.slice(0, 8)
    .map((u) => `0x${u.opcode.toString(16).padStart(2, '0')}@${u.offset}`)
    .join(', ');
  return [
    '/* PeopleSoft Studio: this program could not be fully decoded.',
    ` * ${unknown.length} unmapped opcode(s): ${sample}${unknown.length > 8 ? ', ...' : ''}`,
    ' * The text below is incomplete. Editing and saving it would lose code.',
    ' * Use a project export for this program, or run the decoder in raw mode',
    ' * (peoplesoft.peoplecode.decoder = "raw") to extend the opcode table.',
    ' */',
    body
  ].join('\n');
}

function rawDump(bytes: Buffer, names: NameTable): string {
  const lines: string[] = [
    `# PeopleCode raw token dump — ${bytes.length} bytes, ${names.size} names`,
    '#',
    '# Name table:'
  ];
  for (const [num, name] of names.entries()) lines.push(`#   ${num}\t${name}`);
  lines.push('#', '# offset  hex   dec  mapped');

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    const mapped = OPCODES.get(b);
    lines.push(
      `${i.toString().padStart(7)}  0x${b.toString(16).padStart(2, '0')}  ${b.toString().padStart(3)}  ` +
      (mapped ? mapped.kind : '?')
    );
  }
  return lines.join('\n');
}

export class UndecodableProgramError extends Error {
  constructor(readonly offset: number, readonly opcode: number, readonly count: number) {
    super(
      `Unmapped PeopleCode opcode 0x${opcode.toString(16).padStart(2, '0')} at byte ${offset}. ` +
      `Decoding stopped in strict mode after ${count} unmapped opcode(s).`
    );
    this.name = 'UndecodableProgramError';
  }
}

/**
 * Encoding is intentionally absent.
 *
 * Writing PeopleCode back into PSPCMPROG means producing bytes PeopleTools will
 * execute. Until the decoder round-trips every construct in a program, encoding
 * risks writing a program that differs from what was on screen. Saves through
 * the database provider are therefore refused for PeopleCode; see
 * OracleProvider.writeText.
 */
export function encodeProgram(): never {
  throw new Error(
    'Writing PeopleCode to the database is not implemented. ' +
    'The stored format is not yet mapped well enough to guarantee a faithful round-trip.'
  );
}
