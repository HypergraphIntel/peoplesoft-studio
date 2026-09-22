# PeopleCode encoder foundation

## Current pipeline and evidence

`OracleProvider.readText` assembles PSPCMPROG chunks in PROGSEQ order through
`progtext.ts:assembleProgram`, and supplies a `NameTable` made from PSPCMNAME
NAMENUM and qualified RECNAME/REFNAME. The provider knows whether the object is
an Application Class and passes that context into `decodeProgram`.

The complete implementation is in `src/peoplecode/decoder.ts`:

1. Raw mode lists bytes without parsing. Otherwise `matchHeader` recognizes a
   37-byte preamble; variable fields are accepted, not interpreted.
2. A cursor walks bytes using `OPCODES`, `TEXT_INTRODUCERS`, `OPERAND_FORMAT`,
   and contextual dispatch. Readers handle terminated UTF-16LE text,
   uint16 byte-length-prefixed comments/directives, uint16 name indices plus
   one, and the two numeric operand layouts. `0x50` reads an 18-byte operand
   (zero, decimal scale, 16-byte unsigned magnitude); `0x11` reads 14 bytes
   with magnitude at offset four and only zero scale accepted.
3. Identifiers use several introducers: `0x01` for &variables, `0x12` for
   names including system variables, `0x0a` for inline identifiers (also a
   newline fallback), and `0x07` for declaration names. A narrow recovery
   handles introducer-less identifiers. `0x16` stores unquoted string values.
   References `0x21`, `0x4a`, and `0x48` resolve names with different rendering.
4. Contextual dispatch combines Declare/Function and method/accessor markers,
   gates class vocabulary, and recognizes invisible structural markers.
   Unknown bytes produce diagnostic tokens or throw in strict mode.
5. Strict or relaxed trailer detection stops statement parsing.
   `decodeDeclarations` separately validates name-directory records and reads
   parameter/return types, including class-name offsets and dispatch slots.
6. `render` applies formatting flags to flat tokens, escapes strings, indents
   blocks, normalizes whitespace, and adds a warning for unknown opcodes.

The intermediate `Token` contains kind, rendered text, byte offset, opcode,
and formatting flags. `DecodeResult` adds rendered source, unknown offsets,
trailer offset, and partial declaration metadata. It is a rendering view,
not a bidirectional representation.

Tests in `src/test/decoder.test.ts` include real inline PSPCMPROG samples and
many focused synthetic examples. `progtext.test.ts` covers assembly and name
resolution. The unchanged real OU_OJ_LAYOUT.Activate sample is now shared in
`src/test/fixtures/compiledPeopleCode.ts`. Corpus tooling in `scripts/corpus-*.mjs`
builds database/export pairs and checks coverage and source comparisons;
`scan-db-opcodes.mjs` and the tracker scripts extend that investigation.
The external 204-program corpus is not checked into this workspace. The
header follow-up rebuilt and audited it read-only; see PEOPLECODE_HEADER.md.

## Information unavailable from the rendered view

| Stage | Information lost or normalized |
| --- | --- |
| Provider/NameTable | Original SQL row fields, padding and chunk boundaries; names are qualified and trimmed |
| Header token | All 37 original bytes except the first opcode; counts/fields absent from the token |
| Text operands | Original framing, terminators and unescaped values; rendering chooses double quotes |
| Name references | Original table index, duplicate-entry identity; 0x4a strips the qualifier and 0x48 changes display casing/quoting |
| Numeric operands | Original payload bytes; rendered decimal text alone cannot reproduce alternate layouts |
| Combined tokens | Consumed secondary opcodes, such as 0x32 after Declare or 0x41 after method/get/set |
| Trailer | Raw name occurrences, offsets, slot flags, skipped self/member records, unknown type codes, rejected layouts and unexposed fields |
| Rendering | Invisible tokens, header and trailer, original spacing, repeated blank lines and source quote choice |
| Unknown recovery | Unknown opcode retained, but no reliable grouping of its potential operands |

Token offsets do not solve this alone: relaxed trailer offsets can overlap
the preceding token's last byte. Inferring raw spans from adjacent offsets
would risk mispartitioning the buffer. Future editable lossless tokens should
capture actual cursor start/end positions during decoding, with every byte
owned once, and retain unresolved sections explicitly.

## Smallest implementation

`encoder.ts:encodeFragment(source)` writes only statement-stream bytes.
The first construct is `Return;` (`38 15`), using existing opcode knowledge.
The deliberately small grammar is:

```text
fragment  := statement*
statement := ';' | Return expression? ';' | variable '=' expression ';'
expression := value (('+' | '-' | '*' | '/') value)*
value     := variable | string | True | False | unsignedInteger
variable  := '&' [A-Za-z_] [A-Za-z0-9_]*
```

Keywords are case-insensitive; variables retain case. Strings accept either
quote delimiter, doubled delimiters, Unicode and embedded whitespace. NUL is
rejected because it would terminate the binary operand. Empty source is an
empty fragment. Every unsupported construct or malformed statement throws
`UnsupportedPeopleCodeError` with a UTF-16 source offset; nothing is skipped.
This is syntactic encoding, without scope or type checking. Arithmetic is
emitted in source order as an infix token stream; no AST or expression folding
is needed. Parentheses and unary signs remain unsupported.

Unsigned integers use the existing `0x50` format at scale zero. Leading zeros
normalize away. Magnitudes use BigInt throughout, with explicit overflow
rejection above the 16-byte field limit (2^128 - 1). That bound describes wire
capacity, not proven PeopleTools arithmetic precision. Decimal/exponent forms
and signed literal representations remain unsupported. `numberFormats.ts`
shares both existing numeric layouts with the decoder, without changing its
numeric reading behavior. The encoder chooses `0x50`; opaque replay preserves
original `0x11` operands and binary diagnostics report canonicalization.
For multiplication, the encoder explicitly selects the corpus-confirmed `0x0f`;
`OPCODES` also contains `0x59` with the same rendered text, so blindly reversing
that table would be ambiguous.

Fixed opcodes are resolved from the decoder's existing `OPCODES` table.
The exported `TEXT_INTRODUCERS` table verifies the two selected text operand
forms (`0x01`, `0x16`); no second keyword table is introduced. Those choices
come from the decoder's documented corpus evidence. Keeping these tables in
place avoids moving hundreds of evidence comments or altering decoder logic.
A future `opcodes.ts` extraction is appropriate when broader writers need it;
`progtext.ts` already supplies shared assembly/name infrastructure. Metadata
type tables should remain decoder-local until a writer actually needs them.

`programImage.ts:ProgramImage` is the minimum lossless representation: a
private copy of the entire original byte buffer, logical name table and class
context. `decode()` produces a disposable rendering view; `replay()` emits
fresh copies of the original representation. Even unsupported or malformed
bytes survive unchanged. There is intentionally no patch/edit API: changing
body length while replaying opaque trailer tables is not known to be safe.
This is opaque replay, **not semantic recompilation**.
Original PSPCMNAME SQL rows are outside this representation.

`compareBytes` reports equality, both lengths, total differing byte positions,
and the first difference. Callers decide whether equality is mandatory.
An equivalent alternative encoding can be reported without declaring failure.

## Validation and limits

`encoder.test.ts` checks normalized expected source after encode/decode,
canonical source re-encoding, independent expected bytes, strings with doubled
quotes and Unicode, rejection diagnostics, exact replay of the real fixture,
unknown/malformed preservation, copy isolation, and binary difference reports.
The source expectations are explicit so normalization never deletes spaces
inside strings or hides token differences. Synthetic fragment byte tests are
not represented as PeopleSoft-produced complete programs.

The header follow-up resolved its section lengths/counts against live samples.
`encodeProgram(source)` now wraps the supported fragments in a complete,
evidence-backed simple-program envelope; see PEOPLECODE_HEADER.md. The
database save refusal remains in place pending PeopleTools validation. Exact
snapshot replay proves preservation only; it does not demonstrate regeneration
of the real fixture's calls, references, or metadata from decoded source.

Unsupported source includes decimal/signed/exponent literals, bare/system
identifiers, name-table references, comments, parentheses, comparisons,
boolean operators, other compound expressions, calls,
control flow, declarations, functions, methods, classes and preprocessing.
These all fail explicitly, even if the decoder understands them.

Next targets, in order:

1. Unsigned zero-scale integers and flat arithmetic are implemented. Add
   parenthesized expressions after checking their structural markers.
2. Add system identifiers and explicit name-table references, retaining indices
   rather than reverse-mapping ambiguous displayed names.
3. Add calls and comparisons after checking their surrounding invisible
   markers against real byte slices; then If/Then/Else and loops.
4. Capture lossless cursor spans if editable binary IR becomes necessary.
   Preserve original opcode variants, operands and opaque regions separately
   from presentation tokens. Reject edits whose offset dependencies are unknown.
5. The minimum complete-program envelope is now implemented (see
   PEOPLECODE_HEADER.md). Next: declarations, dispatch tables, methods and
   classes, plus controlled PeopleTools execution validation.

Residual class metadata, complete corpus regression and a semantic AST are
not prerequisites for steps 1–3.


## Integer and arithmetic milestone (2026-09-22)

The 204-program corpus contains 5,657 decoded zero-scale `0x50` operands;
all regenerate byte for byte. Seven additional numeric operands have decimal
scales and remain excluded from generation. Captured operand fixtures cover
0, 1, 2, 12, 34, 311, 3596, 65533, 1,000,000,000 and 10,000,000,000, with the
original object keys and byte offsets in `numericPeopleCode.ts`. Larger
precision and overflow tests are explicitly synthetic wire-format tests.

Real contiguous assignment slices anchor each arithmetic opcode:
`&lifetime = 43200 * 360;`, `&previous_max = &max + 1;`,
`&num = &num / 16;`, and `&tokEnd = &tokEnd - 1;`.
The multiplication sample disambiguates `0x0f` from the other `*` opcode.
Source labels follow the established decoder mappings; fixture bytes come
from the database and were not manufactured by the encoder.

A read-only sample of 300 short programs beginning with Return or a variable
assignment yielded 11 supported complete programs, all byte-exact after
regeneration. Five representative assignment fixtures are checked in,
including `&ss = 0;` and `&TEST = 1 + 1;`; each has empty name-directory,
record and dispatch sections. The sample deliberately omitted PSPCMNAME:
219 entries need names or otherwise cannot be fully decoded by this probe,
and 70 decoded entries use unsupported syntax. Neither group counts as a
successful encoder round trip. One real assignment omits its final semicolon;
that spelling remains explicitly unsupported rather than silently normalized.

Reproduce the offline audit after `npm test`:

```sh
node scripts/corpus-encode.mjs /tmp/peoplesoft-header-corpus.json
```

The audit reports unsupported and undecodable programs separately, tests
integer operand reconstruction, regenerates supported programs from decoded
source, compares significant token text/kinds, and reports binary differences.
It never substitutes opaque replay for actual encoding. Full-program binary
differences remain diagnostic, while semantic and supported integer-payload
differences fail the audit. No database saves or PeopleTools execution tests
were performed.

Validation for this milestone: all 48 numeric/arithmetic tests passed directly,
`npm run verify` passed, and complete DecodeResult comparisons against the
baseline decoder were identical for all 204 corpus programs. The 204-program
audit validates operands only at this stage: every whole program in that
corpus still contains unsupported source constructs. The separate short-program
sample supplies the 11 actual complete-program regeneration checks.

Application Class primitive-signature checkpoint: see
[APPLICATION_CLASS_SIGNATURES.md](APPLICATION_CLASS_SIGNATURES.md) for the
measured method record/slot layout, complete source/binary/name captures,
regression coverage and remaining full-program/dependency boundaries.
