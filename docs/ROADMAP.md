# Roadmap

Ordered by what unblocks the most work, not by visibility. Full Application
Designer parity is the goal; this is the path to it.

## Done

- Provider abstraction with declared capabilities
- Oracle backend: projects, project items, search, record read, PeopleCode read,
  SQL definition read and write
- Project export backend: parses the real App Designer serialization
  (instance/rowset/pointer format), verified against a production export —
  project items, PeopleCode source, record fields and primary keys, plus
  read-only views of fields, HTML definitions, components, menus, pages and
  application packages
- Application packages browse as a hierarchy in the project tree — root
  package, subpackages, classes as leaves — rather than two flat lists
- Records expand to their fields and components to their pages, in both trees;
  each child is a definition that opens on click
- Open Definition dialog: pick an environment and type, search by name, choose
  a result, open it. Connecting to a database lists nothing until asked
- Projects open from the dialog by name and show the same contents tree an
  opened project export does
- Definitions as editable virtual files over `psft://`
- Connections, projects and definition browser trees
- PeopleCode TextMate grammar and language configuration
- Read-only record editor (field grid, attributes, view SQL)
- Secrets in OS secret store, never in settings
- Installable VSIX with a one-command update loop (`npm run dev`), gated on
  typecheck, unit tests and an activation smoke test
- Language ids namespaced so `jatz.peoplesoft-tools` can stay installed

## Next: make reads trustworthy

1. **Calibrate the PeopleCode decoder.** Run `decoder: "raw"` against real
   programs, extend `OPCODES` one confirmed construct at a time, and verify each
   by round-tripping against App Designer. This is the single highest-value
   item: it turns the database backend into a real PeopleCode source.

   Progress: a real bug is fixed — byte 0x00 was mapped as an unconditional
   end-of-program opcode, so decoding stopped after essentially the first line
   of most programs. It isn't one; PSPCMPROG.PROGLEN gives the exact byte
   length and the stream has no in-band terminator, and 0x00 is also the
   upper byte of every UTF-16LE character, which is why it looked plausible
   in short samples. Confirmed against `OU_OJ_LAYOUT.Activate` (104 bytes)
   by comparing its raw PSPCMPROG bytes to its known-correct source from a
   real App Designer export of the same program — see the fixture bytes in
   `src/test/decoder.test.ts`.

   Second pass, against two more real samples (`WEBLIB_EOHP.ISCRIPT1.
   FieldFormula`, `WEBLIB_EOAW.EOAW_AP_BUILDER.RowInit`): the ~37-byte header
   turned out to be exactly 37 bytes, byte-for-byte identical in shape across
   all three programs (`0xa0`, 4 zero bytes, 1 variable byte, 27 zero bytes,
   `0x85`, 3 zero bytes) regardless of program size or content. That exact
   shape is now recognised and consumed as a single `Header` token
   (`matchHeader` in decoder.ts) instead of flooding the unmapped-opcode
   report with 37 bytes nobody can currently explain. What the header's
   fields mean is still not known.

   A text-run heuristic was tried and rejected: identifiers/strings are
   UTF-16LE, [char, 0x00] pairs terminated by a double-null, confirmed against
   `AddOnLoadScript`, `GetHTMLText`, `IScript_Launcher`, `Mode`, `Visible` —
   but walking `RowInit` byte-for-byte turned up `0x21 0x00 0x00` where the
   source has `Then`, not a string. A blanket "printable byte then double-null
   is a string" rule would have rendered a fake `"!"` literal there. Not
   shipped, because that is exactly the silent-wrong-output failure mode this
   decoder is designed to avoid.

   Third pass resolved it, against `OU_VSCODE_LEARN_JN`'s `OU_CODE_WRK.CODE`
   (the same `If (%Mode = "A") Then` / nested `If (%Mode = "AB") Then` /
   `End-If;` / `End-If;` deliberately given to all 17 record-field events, so
   all 17 produced byte-identical 90-byte programs) cross-checked against
   `RowInit`. Text is only ever introduced by two specific opcodes -- `0x12`
   for a name/system-variable reference, `0x16` for a string literal -- never
   by proximity alone, which is what makes `RowInit`'s `0x21 0x00 0x00` safe
   to leave unmapped instead of misreading as `"!"`. `OU_CODE_WRK.CODE` now
   decodes with **zero unmapped opcodes**: `If`, `(`, `)`, `=`, `Then`,
   `End-If`, `;`, `False`, both text-introducer opcodes, and the real
   end-of-program byte (`0x07` -- also confirmed, unlike the earlier `0x00`
   mistake, by matching the exact tail of both samples) are all in `OPCODES`
   now. See the `CODE_WRK_BYTES`/`ROW_INIT_BYTES` fixtures in
   `src/test/decoder.test.ts`.

   Fourth pass, against a 169-byte program purpose-built to isolate exactly
   these gaps (`OU_CODE_WRK.CODE.SavePreChange`: the same wrapper plus
   `If (1 = 2) Then End-If;`, `WinMessage("Test");`, and
   `OU_CODE_WRK.CODE.Visible = False;`), closed both open items above and
   this program **also decodes with zero unmapped opcodes**:
   - Plain function-call identifiers (`WinMessage`, matching `AddOnLoadScript`/
     `GetHTMLText` from pass one) are spelled directly with no introducer
     opcode at all -- confirmed safe to auto-detect only immediately after a
     newline (`0x0a`), never on proximity alone, so it can't reintroduce the
     `RowInit` false positive from pass two.
   - Number literals that fit in one byte: opcode `0x50`, then 18 more bytes
     -- two zero bytes, the value, then 15 more zero bytes. First confirmed
     with `1` and `2` (`If (1 = 2) Then`); a fifth pass with `12` (`0x0c`) and
     `34` (`0x22`) (`If (12 = 34) Then`, on `OU_CODE_WRK.CODE2_WRK.Workflow`)
     showed the value byte is the number's raw binary value, not a digit --
     never actually limited to single digits, widened from the
     too-narrow 0-9 the fourth pass assumed to the full single-byte range
     0-255. Values above 255, decimals and negative numbers are still not
     confirmed and correctly fail this exact-shape match rather than being
     misread.
   - `RowInit`'s "branch/jump offset" guess from pass three was **wrong** —
     corrected, not just extended. `0x21 0x00 0x00 0x05` is the same 4 bytes
     in `SavePreChange`, in the same role: immediately before a reference to
     the record.field the program is itself defined on
     (`OU_CODE_WRK.CODE.Visible`, `WEBLIB_EOAW.EOAW_AP_BUILDER.Visible`).

   Fifth pass reconfirmed the same 4 bytes a third time, on
   `OU_CODE_WRK.CODE2_WRK.Workflow` referencing its own `CODE2_WRK` — still a
   self-reference, since the code had landed on that field's own event
   instead of a different field's. It did newly confirm the number literal
   isn't limited to single digits: `12` (`0x0c`) and `34` (`0x22`) both
   decoded correctly, widening the value byte from the incorrectly-narrow 0-9
   the fourth pass assumed to the full single-byte range 0-255.

   Sixth pass finally isolated the real cross-reference, and **replaced the
   self-reference theory with a simpler, unified one that fully explains
   it**: `OU_CODE_WRK.CODE.Workflow` and `OU_CODE_WRK.CODE2_WRK.Workflow` were
   set to reference *each other* (`OU_CODE_WRK.CODE2_WRK.Visible = False;` and
   `OU_CODE_WRK.CODE.Visible = False;` respectively). Both produced the same
   132 bytes, but with the reference's middle two bytes now `0x01 0x00`
   instead of every prior sample's `0x00 0x00` — and it resolved to a
   *different* field in each direction despite being the identical bytes.
   That only makes sense if those two bytes are a little-endian 16-bit index,
   **0-based into the program's own PSPCMNAME table** (`NAMENUM = index + 1`):
   index 0 → NAMENUM 1, which is always the program's own record.field (hence
   every earlier sample looking like a distinct "self-reference" case); index
   1 → NAMENUM 2, which in `CODE`'s program is `CODE2_WRK` and in
   `CODE2_WRK`'s program is `CODE` — because each program's own `PSPCMNAME`
   table lists itself as NAMENUM 1 and the field it references as NAMENUM 2,
   in reference order. Confirmed across all 5 instances (3 index-0
   self-references, 2 index-1 cross-references) with zero contradictions.
   `decodeProgram` no longer needs the `selfReference` option this replaced —
   `names.get(index + 1)` is enough, using the `NameTable` every call already
   passes in; a resolution failure (index out of range) falls through to
   unmapped rather than rendering a guess.

   Seventh pass replaced hand-picked samples with a **corpus**, which is how
   this should be driven from here on. `scripts/corpus-build.mjs` pairs every
   PeopleCode program in a project export — those carry plain-text source —
   with its real PSPCMPROG bytes and PSPCMNAME table; the two exports on hand
   give 204 paired programs. The other `corpus-*.mjs` scripts then measure
   against it:
   - `corpus-validate.mjs` reports both **coverage** (bytes consumed) and
     **text accuracy** (decoded text tokens that really occur in the known
     source). Accuracy is the important one: coverage alone can be inflated
     by consuming bytes greedily, and accuracy is what catches that.
   - `corpus-gaps.mjs` hunts the next construct by looking only at text runs
     the decoder still misses, histogrammed by the byte in front of them.
   - `corpus-analyze.mjs` ranks remaining unmapped opcodes and picks the best
     next targets; `corpus-compare.mjs` diffs one program's decode against
     its real source.

   That took coverage from **75.9% to 93.0%** across the 204 programs while
   text accuracy *rose* to **99.50%**, and found four things hand-picked
   samples had got wrong or missed:
   - The header is 37 bytes on all 204, but only some positions are constant.
     Positions 5, 6, 7, 13, 14, 21 and 29 vary per program. The previous
     matcher demanded 6-32 be zero — overfit to three tiny programs — and so
     rejected the header on 200 of 204, reporting 37 bytes of noise on each.
   - `0x07` is **not** end-of-program: only 13 of 204 programs end with it,
     against 1391 mid-stream appearances. It takes a usually-empty name
     operand (191 real declaration names, e.g. `IScript_RPC`).
   - Three more text introducers, each validated against real source:
     `0x01` a variable (31047 runs, 100% found, every one `&`-prefixed),
     `0x40` a type name (3589, 100%), `0x6d` a `/+ +/` signature annotation.
   - Comments (`0x24`) are the one construct that is **not** null-terminated:
     a uint16 byte length, then UTF-16LE. Reading them as null-terminated
     truncated at the first non-text byte pair. 2420 decode verbatim into
     their source. This alone was most of the coverage jump.

   Eighth pass tried to close the remaining structural (non-text) opcodes —
   `0x03`, `0x05`, `0x4f`, `0x23`, `0x44`, `0x2d`, etc. — the same way, and
   **found nothing that held up, which is itself worth recording** so the
   same candidates aren't retried the same way. Two techniques were tried:
   - Per-program count correlation (does opcode X's count per program match
     construct Y's count?) and a character-trigram similarity delta (does
     mapping X to Y's text make decoded output look more like real source,
     in aggregate?). Both surfaced plausible-looking candidates —
     `0x20` → `Function` hit 100% (36/36) on a small filtered sample and
     looked shippable.
   - It collapsed completely when checked against full opcode counts per
     program rather than a filtered sample: `0x20` appears 62892 times
     across the corpus against a few hundred occurrences of the word
     "Function" — several programs have hundreds of `0x20` with *zero*
     "Function" in source. It's almost certainly landing on the space
     character (0x20 in ASCII) incidentally inside still-unmapped bytes, not
     a keyword at all. Every other structural candidate tried
     (`0x3a`~import, `0x23`~As, `0x38`~Return, `0x25`~End-Function,
     `0x27`~Returns) failed the same full-scale check, off by 5-15x — not
     close to the near-exact match every opcode actually shipped has hit.
     None of these were written to decoder.ts.

   The lesson: aggregate/correlation signals are good for *ranking* candidates
   worth investigating, never sufficient to *ship* one — always verify a
   candidate's full per-program opcode count against the full per-program
   source construct count (not a filtered subsample) before trusting it, the
   same discipline that caught the RowInit false positive in pass two.

   A third technique -- anchor-based gap extraction (`corpus-gapextract.mjs`),
   locating each already-confirmed token in the source to pin down exactly
   what text falls between two anchors -- initially found nothing usable for
   the same reason: a name can legitimately appear twice in the bytecode
   (once where declared, once via a NAMENUM backref, e.g. for a function's
   own symbol entry) while appearing once in visible source, which broke
   simple sequential 1:1 matching and desynced the cursor for the rest of a
   program.

   Ninth pass fixed that (skip a 0x21-sourced anchor rather than trying to
   match it, and discard only the one gap bordering a skipped anchor, not the
   whole program) and re-ran gap extraction, which surfaced a batch of
   near-100%-consistent candidates on the filtered sample: `0x03`~`,` 98.4%,
   `0x17`~`|` 97.8%, `0x23`~`As` 100%, `0x3a`~`import` 100%, `0x27`~`Returns`
   100%, `0x20`~`Function` 100%, `0x26`~`Return` 94%, `0x2c`~`Local` 100%,
   among others. Given the eighth pass's `0x20` lesson, every one of these was
   then checked against full per-program opcode counts (not the filtered
   sample) before touching decoder.ts. **Only `0x03` survived**: 163/169
   programs within a 0.7-1.5x ratio band, totals 12798 opcode occurrences vs
   12519 "," in source (1.02x). Every other candidate collapsed at full scale
   by 4x to 68x, the identical `0x20` trap -- `0x17`~`|` was the starkest
   (totals 79 vs 1852, i.e. the opcode explains under 5% of the "|" in
   source). **Shipped: `0x03` renders as `, `**, confirmed both ways; see the
   corpus figures in its OPCODES comment and the synthetic regression test in
   decoder.test.ts. Coverage: 93.02% → 93.56%; text accuracy held at 99.50%
   (unaffected, since "," isn't a text-token category that metric tracks, but
   its steadiness confirms no other regression came with this change).

   The strengthened lesson: even a candidate that is 100% consistent on a
   carefully filtered sample must still be checked against unfiltered,
   full-corpus occurrence counts before shipping -- the filtering itself can
   accidentally select only the cases where a common, unrelated byte happens
   to coincide with the construct being tested for.

   Tenth pass fixed a real, already-shipped bug, reported by the user from
   the extension's own output: decoded programs showed identifiers scattered
   across spurious extra lines, e.g. `&access` then a line break then
   `IsAuthorizedViewer()`, for real source `&access.IsAuthorizedViewer()` —
   no line break there at all. Root cause: **0x0a is overloaded.** It is a
   literal newline between statements, but far more often — 17835 of its
   ~20400 corpus-wide occurrences — it is a silent "bare identifier follows"
   introducer with no corresponding source newline, the same role
   0x12/0x16/0x01/0x40 play for other text, just reusing the newline byte
   value. This was hiding in plain sight since pass one: `OU_OJ_LAYOUT.
   Activate`'s real source is the single line `AddOnLoadScript(GetHTMLText(
   HTML.OU_OJ_LOAD_CSS));` with no newline anywhere before `GetHTMLText`, yet
   the byte stream has 0x0a right there — the fixture comment even called
   this "a newline before AddOnLoadScript" without questioning why a
   one-line program would have one. The identifier-introducer role is now
   checked before falling through to a real newline (previously it rendered
   both the `\n` and the identifier). Real-source diffs before/after:
   `AddOnLoadScript(\nGetHTMLText())` → `AddOnLoadScript(GetHTMLText())`, and
   a 30-line Application Class program went from nearly every identifier on
   its own broken line to reading close to the real source, with only
   genuinely-unmapped constructs (`.`, `Not`, `And`, `create`, `True`, array
   `[...]` indexing) missing rather than scattered across wrong lines.
   Coverage/accuracy metrics don't move (the bytes were already being
   consumed; only how the `\n` was rendered changed), so this was caught by
   eyeballing real decoded output against real source, not by the corpus
   metrics — a reminder that those metrics don't substitute for that.

   Eleventh pass, prompted by the user asking whether App Designer's use of
   Scintilla for its editor helps with formatting: it doesn't directly —
   Scintilla is a text-display widget with a lexer for syntax highlighting,
   not a decompiler, and doesn't invent indentation that isn't already in the
   text it's given. App Designer must reconstruct indentation itself, from
   nesting depth, before ever handing text to Scintilla. This project already
   has the equivalent piece for syntax highlighting (`syntaxes/
   peoplecode.tmLanguage.json`, a TextMate grammar, registered for
   `.peoplecode` files) — what's still missing is the pretty-printer that
   would produce well-indented text for it to highlight. Building that well
   now would be premature: most block-opening keywords (`For`, `Evaluate`,
   `class`/`method`) aren't confirmed yet, so it could only indent
   `If`/`Then`/`End-If` and leave everything else flat.

   Closed a higher-value, more immediately visible gap first: `0x05` = `.`
   (member/method access), confirmed with the same two-stage check as `0x03`
   -- isolated single-opcode gaps decode to `.` 99.3% of the time (2250/2267),
   and at full scale it explains most (not all) of the `.` in source: 146/191
   programs within a 0.7-1.5x ratio band, totals 8420 vs 9824 (0.857x).
   Unlike every candidate rejected in pass nine, which was wrong by 4-68x
   (random noise), this consistently *undershoots* by a similar factor
   across programs -- the signature of a real opcode that covers most but not
   all dot-access contexts (package-path separators, e.g. `OU_JET_PACK:
   Model:PageDesign`, use a different still-unconfirmed byte: `0x57`/`0x58`).
   Verified against real decoded output, not just the ratio:
   `&access.IsAuthorizedViewer()`, `%Response.SetContentType(...)` and
   `%Request.GetParameter(...)` all now decode correctly. Coverage: 93.56% →
   93.91%; text accuracy held at 99.50%.

   Also still open: the structural opcodes that collapsed in pass nine
   (still unmapped, still worth another look with better isolation than
   aggregate counts can give — `Not`, `And`, `create`, `True`, and now the
   package-path `:` separator (`0x57`/`0x58`) foremost among them, now that
   passes ten and eleven show how much of a readability difference they'd
   make); what the header's variable fields mean; numbers above
   255/decimals/negatives; and statement-level formatting/indentation, which
   the decoder still does not attempt and — per the Scintilla question above
   — needs its own pretty-printing pass once enough block keywords are
   confirmed, not something decoding alone will produce.

   Twelfth pass found and fixed a real bug **in the calibration tooling
   itself**, not the decoder, while chasing those keywords further.
   `corpus-gapextract.mjs`'s console output did
   `Number(opcodeHexString).toString(16)` to print a label -- which silently
   produces the *wrong* opcode for any two-digit hex string or one
   containing a-f: `Number("58")` parses "58" as decimal 58, whose hex is
   "3a", so a real `0x58` finding was labeled `"0x3a"`; anything containing
   a letter (`"1a"`, `"2c"`, ...) produced `NaN`, shown as the entries
   littering earlier output as `0xNaN`. This means **most of pass nine's
   "collapsed at full scale" rejections tested the wrong byte** -- the
   literal hex value typed into the verification script, based on a
   mislabeled finding, was never the opcode the gap-extraction evidence
   actually pointed at. The label bug did not affect `0x03` or `0x05`
   (single-digit hex without letters round-trips through `Number()`
   correctly by coincidence), so those two remain genuinely confirmed.

   Fixed the label (print the hex string directly, no `Number()` round
   trip) and re-ran both gap extraction and full-scale verification
   end-to-end with correct labels. Result: **most candidates still
   collapse**, now for real reasons rather than a wrong test -- `0x58`~
   `import` (ratio 5.3x), `0x57`~`:` (3.1x), `0x64`~`end-method` (409x), and
   most others are still overwhelmingly explained by something other than
   the keyword they coincided with on a filtered sample; the same big,
   Application-Class-heavy programs (`WEBLIB_MCF`, `WEBLIB_GS_SSOEX`,
   `OU_JET_PACK`, `WEBLIB_CTI`) dominate the "worst" mismatches every time,
   which points at a large, still-unidentified mechanism (method dispatch or
   array/collection operations, most likely) consuming many of these same
   byte values in contexts unrelated to the keyword being tested. Two did
   survive with correct labels and real full-scale evidence: **`0x23` = `|`**
   (string concatenation: 96% of programs within a 0.7-1.5x band, totals
   5773 vs 5355, 1.078x) and **`0x19` = `Else`** (94%, totals 674 vs 624,
   1.080x). Both verified against real decoded output, not just the ratio.
   Coverage: 93.91% → 94.17%; accuracy held at 99.50%.

   The lesson, again sharpened: a bug in the *verification tooling* can look
   exactly like a genuinely collapsed candidate, and the only way either of
   the earlier passes caught anything was because the ratios were so far off
   (4x to 400x) that even a wrong-byte test still failed loudly. A
   near-miss bug in tooling is more dangerous than a near-miss bug in the
   decoder, because nothing downstream re-checks the tool's own labels
   against ground truth the way `corpus-validate.mjs` re-checks decoded
   text against real source. Any future scoring/ranking script should print
   raw, unprocessed keys wherever the key's own identity (not just its
   frequency) is what a later shipping decision depends on.

   Thirteenth pass explains *why* so many structural candidates keep
   collapsing at full scale, and it's a real structural discovery, not
   another tooling bug: **Application Class programs carry a second,
   completely separate binary section after the real code**, hand-verified
   against two small, complete programs with known source
   (`OU_JET_PACK.Widgets.BaseWidget`, 2 methods, 455 bytes;
   `OU_JET_PACK.Security.AccessCheck`, 3 methods, 1177 bytes -- both fully
   walked byte-by-byte against their real source the same way pass six
   cracked the record.field reference). In both, right after the real
   statement stream ends, the class's own declared method names (`BaseWidget`
   `Render`; `AccessCheck` `IsAuthorizedDesigner` `IsAuthorizedViewer`)
   reappear verbatim with **no introducer opcode before them at all** --
   inconsistent with every text rule confirmed so far, which is what marks
   the boundary. What follows that is a packed table of small integers (2 or
   4 bytes each, values like 7, 33, 45, 5, 66, 2, mostly 0) running to
   exactly the end of the buffer, one entry per method -- almost certainly a
   method dispatch/offset table, not source-text-bearing code at all.

   This directly explains the repeated collapse pattern from passes nine and
   twelve: `0x40`, `0x2a`, `0x07` and others are real, correctly-confirmed
   opcodes *in the statement stream*, but the exact same byte values also
   turn up constantly as incidental small-integer data in this trailer --
   and the trailer is proportionally huge in exactly the programs
   (`WEBLIB_MCF`, `WEBLIB_GS_SSOEX`, `OU_JET_PACK`, `WEBLIB_CTI`) that kept
   dominating every "worst mismatch" list. A full-corpus byte-frequency count
   can't tell trailer noise from statement-stream signal; that's why it kept
   producing plausible-looking candidates that fell apart on closer
   inspection, and it's also why the decoder currently renders visible
   garbage past the real end of an Application Class program (it has no way
   to know the statement stream ended and keeps trying to decode the
   trailer as more code).

   Not shipped, because the boundary-detection rule needs more than two
   samples to calibrate safely, and getting it wrong would either truncate
   real code or fail to suppress the trailer garbage it's meant to hide.
   Next step: find the specific opcode/count that marks "N methods declared,
   N End-Method boundaries seen, stop" (the class header's method count is
   very likely encoded in the still-unmapped tokens right after `class
   ClassName`), which would let the decoder cut off cleanly instead of
   rendering the trailer at all -- and, separately, decoding the trailer's
   own format (which method a given dispatch entry belongs to, what its
   integers mean) is a project in its own right once the boundary is solid.

   Fourteenth pass acted directly on that theory, prompted by the user
   pointing at a real Record PeopleCode program (`WEBLIB_OU_LP.ISCRIPT2.
   FieldFormula`, 9 Functions, no class/trailer at all) whose decoded output
   was missing exactly the keywords pass thirteen suspected were being
   drowned out: `Function`, `As`, `Returns`, `Local`, `End-Function`. Rather
   than run another corpus-wide count, this walked that one file's exact
   bytes against its exact known source by hand -- the same method that
   cracked the record.field reference and found the Application Class
   trailer -- and confirmed all five at multiple independent positions each,
   landing exactly on the matching keyword every time (e.g. `0x32` sits
   immediately before the newline-introduced name in both `Function
   JSONEscape(...)` at offset 475 and `Function GetDesignerBodyHtml()` at
   offset 1064). **Shipped: `0x32` = `Function `, `0x35` = ` As `, `0x37` =
   `End-Function;`, `0x39` = ` Returns `, `0x44` = `Local `.** Coverage:
   94.17% → 94.42%; text accuracy held at 99.48%. Real output for that file
   went from `JSONEscape(&sstring)string&s = Substitute(...)` to `Function
   JSONEscape(&s As string) Returns string&s = Substitute(...)` with a
   correctly-placed `End-Function;` after each function body -- confirming
   pass thirteen's theory: these opcodes were correct all along, and the
   corpus-wide full-scale checks in passes nine and twelve only "collapsed"
   because Application Class trailer noise, concentrated in a handful of
   large programs, swamped the real signal in the aggregate count.

   Remaining in that same file, still unmapped: `import` and the `:`
   package-path separator (both tried and collapsed at full corpus scale in
   pass twelve -- worth retrying with this same hand-verification method
   now that the trailer confound is understood); `Return` itself (the
   value after it decodes fine, e.g. `&s;` where source has `Return &s;`);
   and a reference to an `HTML.*` definition used as a bare object
   (`GetHTMLText(HTML.OU_OJET_REQUIRE_CONFIG, ...)` decodes as
   `GetHTMLText(, ...)`) -- likely a sibling of the confirmed record.field
   reference construct, addressing a different definition type by the same
   or a similar mechanism, not yet checked.

   Fifteenth pass closed all of those, continuing the byte-walking method,
   and found a real bug in already-shipped code along the way.
   - `0x58` = `import `, `0x57` = `:`, `0x38` = `Return `, all hand-confirmed
     in the same file: offsets 37-101 decode exactly as
     `import OU_JET_PACK:Model:PageDesign;` and offset 102 begins the next
     import identically, giving six confirmations of `import` and twelve of
     `:`; `0x38` sits at offset 897 between `Substitute(...);` and `&s;`
     (source `Return &s;`) and again at 1006 before `GetHTMLText(...)`.
   - **Bug fixed: the name reference is 3 bytes, not 4.** `0x21` plus a
     2-byte index, full stop. The trailing `0x05` the shipped rule also
     demanded is the separate `.` operator, which only looked mandatory
     because all three samples it was derived from were
     `RECORD.FIELD.Visible`. Requiring it meant a reference used any other
     way never matched -- which is exactly why
     `GetHTMLText(HTML.OU_OJET_REQUIRE_CONFIG, &siteBase)` had been decoding
     as `GetHTMLText(, &siteBase)`. Corpus-wide the corrected rule resolves
     1640 of 1775 references, and 1636 of those 1640 (99.76%) name something
     that really occurs in that program's source; the byte after the operand
     is a comma 771 times and `)` 585 times against only 16 for `0x05`.
     Fixing it also made `RECORD.FIELD.Property` render its dot again
     (`EOAW_AP_BUILDER.Visible`, previously run together) and took
     `OU_OJ_LAYOUT.Activate` to a fully clean decode.
   - `0x2d` and `0x4f` are line structure. These needed a metric that did
     not yet exist: text accuracy normalises whitespace away and is blind to
     newline opcodes by construction, so `corpus-lines.mjs` was added, which
     strips the indentation that was never encoded and counts how many real
     source lines come out as their own decoded line. That moved from 37.71%
     to 42.47% (10318 -> 11620 of 27361 lines). The same metric also
     confirmed `0x15` carries its own newline rather than duplicating
     theirs: dropping it collapses line matching to 15.19%.
   - `0x37` was rendering `End-Function;` while the byte stream always
     follows it with a real `0x15`, emitting a stray `;` on its own line.

   Coverage: 94.42% → 95.07%; text accuracy 99.48% → 99.46%; clean programs
   3 → 4. `WEBLIB_OU_LP.ISCRIPT2.FieldFormula` now decodes its imports
   byte-identically to App Designer and its function bodies line-for-line.

   What is still missing there, and it is now a short list: the
   definition-type qualifier (`HTML.`, `Record.`, `Scroll.`) on a name
   reference -- the name table stores the bare name, and where the qualifier
   lives is not established -- and indentation, which was never in the bytes
   at all and needs the pretty-printer described above, not more decoding.
   Note also that the keyword opcodes shipped in passes fourteen and fifteen
   do over-fire inside the signature/dispatch trailers of large
   multi-function programs: 172 of 204 programs show zero keyword
   mismatches, and the 168 that remain concentrate there
   (`OU_JET_PACK.ROADMAP` alone accounts for 70). Those land in regions that
   are already undecodable noise, and the trailer-boundary work described in
   pass thirteen is what would clean them up.

   Sixteenth pass did exactly that, prompted by the user pointing at
   `WEBLIB_OU_LP.ISCRIPT1/2.FieldFormula` rendering garbled keyword soup
   (bare `create`, `Local`, `Function` with no real statement shape) past
   their real end. Hand-walked both programs' real bytes (live DB, not the
   stale project export -- the export's `ISCRIPT1` source turned out to be
   an older version missing two functions the live-compiled bytes still
   have) and found the boundary pass thirteen asked for: right after the
   closing `;` of the outermost `End-Function`/`End-Method`, the byte pair
   `0x2d 0x07` (an ordinary newline opcode immediately followed by the
   declaration-name opcode with no name after it -- a shape that never
   occurs in the statement stream itself) marks the start of a
   declaration-name directory: the program's own declared Function/Method
   names, verbatim, no introducer, followed by a packed integer
   dispatch/offset table running to the end of the buffer. Confirmed against
   all nine `OU_JET_PACK` Application Class programs (the same two
   hand-walked in pass thirteen, plus seven more) and both `WEBLIB_OU_LP`
   record PeopleCode programs -- 11 of 11 samples, marker present exactly
   once, always immediately after the real code's terminating `;`, never
   elsewhere. This also settles the open question from pass thirteen: the
   directory is not Application-Class-specific, every program that declares
   at least one Function or Method gets one.

   Corpus-wide (`corpus-validate.mjs` against all 204 programs): the marker
   occurs in 185 of 204 (the other 19 are short enough to declare nothing),
   never more than once in any program. `decodeProgram` now stops at the
   first occurrence instead of trying to read the directory and dispatch
   table as more statements, and reports it as `trailerOffset` rather than
   unmapped-opcode noise. Coverage: 95.48% → 96.80%; **clean programs: 5 →
   34**; text accuracy held (and rose slightly) at 99.23% → 99.36%, so
   nothing that used to decode correctly stopped doing so -- the cut is
   pure removal of already-wrong trailing output, not lost signal. This is
   also most of what pass fifteen's note about keyword opcodes over-firing
   in signature/dispatch trailers was pointing at: those false positives
   live in exactly the region this pass now excludes.

   Decoding the directory's own format (which dispatch entry belongs to
   which name, what its packed integers mean) is still unstarted and is its
   own project, same as pass thirteen scoped it -- this pass only closes the
   boundary-detection half.

   Seventeenth pass fixed a second, unrelated formatting bug found on the
   same files: `End-Function` never decreased the indent level (`const
   END_FUNCTION_STYLE = F.NEWLINE_BEFORE;`, missing `DECREASE_INDENT`), so a
   program with several functions rendered each one more indented than the
   last -- confirmed on `WEBLIB_OU_LP.ISCRIPT2`, whose ten functions drifted
   from 2 spaces to 20 before this fix. Shipped, corpus-neutral by
   construction (it only ever brings indent back toward 0, never introduces
   a new token).

   It also retried the Application Class vocabulary (`class`, `method`,
   `end-class`, `end-method`), on the theory that pass fifteen's "these
   score badly at corpus scale" was measuring trailer noise the boundary
   fix above had just removed, not a wrong mapping. Hand-walking
   `OU_JET_PACK.Layout.ComponentRegistry` (12 methods) and
   `OU_JET_PACK.Security.AccessCheck` (3 methods) confirmed all four --
   `0x5a` class, `0x5b` end-class, `0x64` end-method, `0x63` method
   (overloaded between a one-line declaration inside the class body and an
   `0x41`-marked implementation header, mirroring how `0x0a` is overloaded)
   -- with zero mismatches in those two samples. Unconditionally mapping
   them, though, collapsed exactly like pass fifteen's original attempt,
   which the trailer fix turned out not to explain: `end-method` matched
   real source only 8.9% of the time (54/610) corpus-wide, with 556 false
   positives across 33 ordinary Function-based `WEBLIB_*` programs that
   declare no class at all -- even `class` itself, at a deceptively
   close-looking 92% (23/25), fired twice in
   `WEBLIB_HRS_MA.WEBLIB_HRS_MA.FieldFormula`, a plain Function program with
   no class anywhere in its source. These byte values are evidently doing
   something else entirely outside an Application Class program.

   That test did turn up, immediately: `definitions.ts` already has a real
   OBJECTTYPE for this (`DefinitionType.ApplicationClassPeopleCode = 58`),
   known at the call site before any bytes are read -- `OracleProvider`
   queries `PSPCMPROG` by the same definition key it already has, so
   `key.type` is free. **Shipped, gated on that type**: `decodeProgram`
   takes a new `isApplicationClass` option, and the four opcodes above only
   decode when it is set; `OracleProvider.readPeopleCode` passes `key.type
   === DefinitionType.ApplicationClassPeopleCode`. Corpus-wide, restricted
   to the 15 programs actually typed as Application Classes: **188/188
   (100%)** of the four keywords match real source, the one exception being
   `OU_JET_PACK.ROADMAP`, which was already 93%+ undecoded before this
   change (14490 of 15489 bytes unmapped) for unrelated reasons and is
   excluded the same way `WEBLIB_CTI`/`WEBLIB_EOAW_MON_ADHOC` already are
   elsewhere in this corpus. Detecting "is this a class" from the bytes
   themselves remains unsolved and unneeded now that the caller already
   knows.
2. **Project export writer.** Preserve element order, the `lp*`/`h*` marker
   words and the numeric encoding so edited exports still import. Unblocks
   editing PeopleCode today, without the decoder.
3. **Confirm the remaining OBJECTTYPE codes.** SQL definitions still use an
   explicit local sentinel rather than a real code. Business Interlink (seen
   as type 29), Approval Rule Set (38), Image (68), File Reference (69),
   Message (90/92/93/96/110/120), Analytic Type and Page (Fluid) have all been
   seen in a real project (`OU_VSCODE_JN`) but have no definition table
   confirming them yet — searching `ALL_TABLES` by name pattern didn't turn
   one up. Needs either a known definition name of each kind to search for
   directly, or someone who knows where App Designer actually stores them.
4. **Package hierarchy in the Definition Browser too.** The project tree folds
   packages and classes together; the browser still lists them flat, because
   building the same tree from a live database needs PSPACKAGEDEFN and
   PSAPPCLASSDEFN queries rather than a project's item list.
5. **Structured editors** to replace the read-only text summaries now used for
   fields, pages, components, menus and application packages. The page
   summary in particular lists field identifiers only, because the layout
   rectangles and flag words in `PdmField` are not yet decoded.

## Pass sixteen: an independent implementation, and formatting

The user pointed at an existing open-source decoder,
[cache117/decode-pcode](https://github.com/cache117/decode-pcode)
(`PeopleCodeParser.java`, Erik H, 2011, ISC licence). Every opcode this
project had already independently confirmed matched it exactly, with zero
contradictions -- including the 37-byte header (`container.pos = 37`), 0x05
as `.`, 0x21's 2-byte reference operand, and 0x24's byte-length-prefixed
comment. That source also carries the definition-type qualifier this
project's own list of gaps had flagged as unresolved: `PSPCMNAME.RECNAME`,
not just `REFNAME`, holds it (`HTML.` in `HTML.OU_OJET_REQUIRE_CONFIG`), and
is now included in the name table built by `OracleProvider` and
`corpus-build.mjs`.

Its table also supplied a **format bitmask** per opcode (space/newline
before and after, indent increase/decrease) -- the piece that was actually
missing for the indentation complaint, since indentation is never in the
byte stream at all; App Designer's Scintilla editor reconstructs it the
same way. `decodeProgram`'s `render` now walks the token stream applying
that bitmask instead of just concatenating token text.

Wholesale-adopting that project's table was tried and did not hold up:
`corpus-validate.mjs` scored each new keyword opcode individually against
this database's real source, and about 50 of the ~60 candidates it added
came back at 0-90% (some as low as 0.1%), heavily concentrated in
Application-Class-shaped keywords (`method`, `private`, `try`/`catch`,
`interface`, `protected`, ...) -- the same trailer-poisoning signature noted
in pass fifteen. Only 8 keyword opcodes (And, Not, Or, For, To, When, get,
create) cleared the same 95% bar this project has used throughout, plus a
set of punctuation opcodes (comparison/arithmetic operators, `**`, `@`,
`[`, `]`) that carry effectively no collision risk and were kept without an
individual score. The rest are deliberately left unmapped -- see the
comments in `decoder.ts`'s `OPCODES` table for the full kept/rejected list
and each one's measured rate.

Net effect on the 204-program corpus: coverage 95.07% → 95.48%, clean
programs 4 → 5, text accuracy held at 99.32% (was 99.46%; a wholesale
adoption without pruning had driven it down to 84-86%), and **line
matching 42.47% → 83.51%** -- the indentation/formatting model is what
actually answers "the formatting is missing, spaces and tabulation are
missing" from earlier in this project. The render function was also
rewritten from repeated string concatenation to an array-of-chunks builder;
the original was quadratic in program size and hung on the full corpus.

## Pass eighteen: the declaration-name directory's own format

Finishes what pass seventeen only closed the boundary for. Rebuilt the
204-program calibration corpus fresh against the live database (HCDEV) and
hand-parsed the bytes right after `TRAILER_MARKER`, starting from
single-function `WEBLIB_*.ISCRIPT1` programs and working up to the largest
multi-function ones in the corpus.

**Shipped** — `decodeProgram` now also returns `declarations?: Declaration[]`
(`{ name, paramCount, hasReturnValue }`), decoded by the new
`decodeDeclarations` in `decoder.ts`, in addition to the unchanged rendered
`text` (the directory is metadata, not statements, so it was never meant to
render as source and still doesn't):

- The directory opens with a run of null-terminated UTF-16LE strings, back
  to back, no length prefix -- confirmed byte-exact against `WEBLIB_CD_APP`
  (single name `iScript_CD`, lowercase `i` included) and `WEBLIB_CLRSSN`
  (`IScript_clearSession`), both matching real source exactly, case
  included. The run ends at the first empty string or the first name
  containing `:` -- colon-qualified names (`PTNUI:Model:Tile`) are imported
  Application Class references belonging to a separate structure that can
  follow this one, confirmed present in `WEBLIB_PORTAL.PORTAL_SEARCH_PB` and
  `WEBLIB_PTNUI.PT_BUTTON_PIN`, and left undecoded.
- Not every declared Function/Method necessarily appears -- `WEBLIB_CTI.
  ISCRIPT1` declares 21 functions but the directory lists only 18, always
  omitting the same three (`SetDocDomainForPortal`,
  `SetDocDomainToAuthTokenDomain`, `GetRefreshCookieName`), which are also
  the only three never called through anything that looks like a by-name
  dispatch elsewhere in the program. Consistent with every sample checked,
  but not confirmed as the actual rule.
- After the name run, one 16-byte record per listed name: four
  little-endian int32s `(charOffset, ?, paramCount, kind)`.
  - `charOffset`: the *character* (not byte) offset from the start of the
    name run to that entry's own name. This makes the table
    self-verifying -- no source text needed, just the name-run offsets
    already parsed -- and `decodeDeclarations` refuses the *entire* table
    for a program if even one record disagrees, rather than emit a
    misaligned one.
  - second field: tried and abandoned as "0-based directory position" (an
    earlier draft of this pass required it and rejected 68 of 183
    otherwise-good programs on it). Not sequential, not a PSPCMNAME NAMENUM
    either (`WEBLIB_EOAW.EOAW_AP_BUILDER` has none for either of its two
    declared functions, yet both records use it). Left undecoded.
  - `paramCount`: matches the real parameter count.
  - `kind`: `7` exactly when there is no `Returns` clause; every other
    observed value pairs with a real `Returns` clause. What a non-7 value
    itself encodes (presumably the return type) is not decoded.
- The charOffset self-check turned out not to be a formality: naively
  reading one 16-byte record per name breaks on the corpus's largest
  PeopleTools-delivered programs (`WEBLIB_PORTAL.PORTAL_SEARCH_PB`,
  `WEBLIB_PTNUI.PT_BUTTON_PIN`, `WEBLIB_PTWC.ISCRIPT1`), producing records
  with garbage-looking fields -- some other, still-unknown table shape
  applies there. Requiring charOffset to match rejects exactly those
  programs (plus the ones that declare nothing but colon-qualified
  references) instead of emitting wrong data.

Corpus-wide (excluding `WEBLIB_OU_LP.ISCRIPT1`, whose project-export source
is already known stale from pass thirteen): of 183 programs with a trailer,
167 verify. Every declaration in a verified program's table matches real
source on both fields: **621/621 (100%) for `paramCount`, 621/621 (100%) for
`hasReturnValue`** — checked against the actual compiled `decodeProgram`,
not a standalone script. Five apparent mismatches in an early pass of this
check turned out to be the test harness itself matching a `* Function
CreateQueryURL` mention inside a header comment in `WEBLIB_QUERY.
QRYGENFUNCS` before the real declaration further down; fixing the harness
to skip comment blocks resolved them without any decoder change.

A second, stronger check needs no export source at all: for every verified
program, its trailer declarations were compared against the `Function`/
`Method` headers in that *same buffer's own independently-rendered
statement text* -- two different parts of `decodeProgram` decoding the same
bytes through entirely separate code paths. 637/637 declarations agree on
both fields. This also directly closes the stale-export gap pass thirteen
noted for `WEBLIB_OU_LP.ISCRIPT1`: read live (not from the project export),
its trailer lists 8 declarations (including `DisplayPath`, declared with no
parameter list at all -- `Function DisplayPath`, no `()`), and all 8 match
the functions the statement decoder renders independently, including the
zero-param, no-parens case.

**The `kind` field's non-7 values are also decoded, for scalar and array
return types.** The user pointed at their PeopleTools 8.61.07 Windows client
(App Designer, `pspcedit.dll` et al.), installed in a Wine bottle. Its
strings didn't turn out to be needed for the actual encoding -- it was
already fully recoverable by grouping every verified declaration's `kind`
by the type its source's `Returns` clause actually names -- but confirmed
the underlying type system's shape (`pspcedit.dll` carries an internal
`Decimal, Date, Any, Boolean, Time, DateTime, Object, Integer, Float,
Unknown` type-name table, consistent with `kind` being a small type
enumeration rather than something unrelated). The grouping came back with
**zero collisions** -- every `kind` value paired with exactly one type name,
every time, across 178 real declarations:

- `1` = `string` (151 samples), `5` = `boolean` (11), `13` = `object` (1),
  `17` = `integer` (1), `19` = `number` (2).
- `0x100000` (`ARRAY_RETURN_TYPE_FLAG`) OR one of those scalar codes means
  `array of <type>` -- confirmed against `array of string` (`0x100001`) and
  `array of number` (`0x100013`).
- Record/Rowset/XmlDoc/XmlNode/App-Class return types use other bit patterns
  entirely (`Rowset` observed as `0x80007`, `XmlDoc` as `0x8001d`, `XmlNode`
  as `0x80022`) and are deliberately not decoded -- three data points is not
  enough to guess the rest of that table, and `0x80007`'s low bits
  coinciding with the unrelated void sentinel `7` is exactly the kind of
  false pattern this project's corpus-first method exists to catch rather
  than ship on.

**Shipped**: `Declaration.returnType`, populated by `decodeReturnType` for
exactly the scalar/array codes above and left `undefined` (never guessed)
otherwise. Checked against the compiled decoder corpus-wide, of 180
declarations with `hasReturnValue` and a real `Returns` clause in source:
**170 got a decoded `returnType`, and all 170 (100%) match it**; the other
10 are the object-typed cases just above, correctly left undecoded rather
than guessed.

Unshipped and still open at the end of pass eighteen: what the second int32
field means, the object/record/rowset/App-Class return-type encoding, the
colon-qualified imported-class structure that can follow the Function/Method
directory, and the ~16-program table shape that fails the charOffset check.

Tried and came back empty: searched live `PSPCMPROG.PROGTXT` directly
(`DBMS_LOB.INSTR`, read-only) across every `WEBLIB_*` record field
PeopleCode program for the UTF-16LE bytes of `Record`, `File`, `SQL`,
`Message`, `ApiObject`, `JavaObject` and `Array`, to find real `Returns`
clauses using object types this pass hasn't confirmed a `kind` code for.
136 programs matched, decoded and cross-checked the same way as the
637-declaration check above (trailer vs. the same buffer's own rendered
text, no export needed) -- but none of them actually declare a function or
method returning any of those types; the words only appear as parameter/
local-variable types or elsewhere in the program. This did add more samples
of the codes already confirmed (`Rowset`, `array of string`, the scalars),
still with zero collisions, but found nothing new. Filling in the rest of
the object-type table needs either a corpus with real examples of those
return types, or the client binaries mentioned below.

## Pass nineteen: the second field, the "alternate table shape", and Record

Closes three of pass eighteen's four open items in one sitting, using the
same Wine-bottled PeopleTools 8.61.07 client and live read-only database
access as pass eighteen, plus a fresh look at the corpus.

**The second int32 field is a running dispatch-slot offset.** Hand-walking
`WEBLIB_CTI.ISCRIPT1` (18 listed declarations) found it climbs by exactly
`1 + paramCount` from one entry to the next, except for three functions
(`GetJSMCAPI`, `GetCTIJSMCAPI`, `GetTPJSMCAPI`, each taking 1 parameter)
where consecutive entries jump by `1 + 1 = 2` instead of the `1 + 0` a
naive "position in the list" theory predicts -- i.e. the field already
accounts for each entry's own parameter count before the next one's slot
starts. Corpus-wide validation refined this once more: `WEBLIB_FIN_MBL.
CALLBACK` (3 declarations, 0 unmapped opcodes, so its rendered text is
trustworthy) has this field at `0` for *every* entry, and all three are
declared with no parameter list at all (`Function iScript_PageContent`, no
`()`) -- confirmed by checking each declaration's own real syntax in the
decoder's rendered text, not guessed. Full rule, confirmed with zero
mismatches on every *fully*-decoded (0 unmapped opcodes) multi-declaration
program in the corpus: **a declaration with an explicit parameter list --
`(...)`, even empty `()` -- consumes `1 + paramCount` slots in some further,
still-unlocated table; its own second field is the running total of that
count over every preceding declaration with an explicit parameter list, in
the program's real declaration order (which can include declarations this
directory omits entirely, such as `Declare Function ... PeopleCode <other
program>` imports of functions defined elsewhere -- confirmed these
contribute nothing, since `WEBLIB_CTI.ISCRIPT1`'s first three declared
functions are exactly this shape and its counter starts cleanly at 0 right
after them). A declaration with no parameter list at all never advances the
counter and always shows `0` itself.**

Not exposed on `Declaration`: a program can have real, slot-consuming
declarations this directory omits, which this decoder has no way to see
from the trailer bytes alone, so nothing here is safe to expose as a
guaranteed absolute value. Documented in `decoder.ts` instead.

**The "~16-program alternate table shape" was never a second shape --
it was `tableStart` computed from the wrong position.** Pass eighteen's
`decodeDeclarations` stopped collecting names at the first colon-qualified
one and used the last *plain* name's end as the record table's start. Real
programs with colon-qualified names put those names *before* the plain
names' own record table, not after -- confirmed by hand-walking `WEBLIB_
PTNUI.PT_BUTTON_PIN` byte-for-byte: its 23 plain names are followed
immediately by 3 colon-qualified ones (`PTNUI:Model:Tile`,
`PTNUI:Model:LandingPageTab` twice), and *only after all of those* does the
real 23-record table begin, verified via the same charOffset self-check
pass eighteen already trusted. Fixed by continuing to scan (and skip) past
colon-qualified names, stopping only at the name run's true end, and computing
`tableStart` from there. This uses the same charOffset-based termination
trick as before: a program with no colon-qualified names has no separate
empty-string marker to find, but the first record's charOffset is always 0,
so its own leading zero bytes look exactly like an empty string and the
plain-only case still terminates in the right place without a special case.

Corpus-wide effect: 167 → 170 of 183 trailer-bearing programs now verify
(the fix directly recovers `WEBLIB_PORTAL.PORTAL_SEARCH_PB`, `WEBLIB_PTNUI.
PT_BUTTON_PIN` and `WEBLIB_PTWC.ISCRIPT1`, pass eighteen's three named
counter-examples), and every declaration in a verified program's table
still matches real source on both `paramCount` and the Returns-clause check:
**661/661 (100%)**, the strong export-independent self-check (trailer vs.
the same buffer's own rendered text) rose to **677/677 (100%)**, and the
`returnType` check to **204/204 (100%, case aside)**. A regression test
(`decoder.test.ts`) hand-builds exactly this shape -- colon names between
the plain names and their table -- so this doesn't silently regress again.

**A fourth confirmed return-type code: `Record` (`0x80003`).** Pass
eighteen's search for object return types was scoped to `WEBLIB_*` and
came back empty. Broadening it system-wide (still read-only, still
`DBMS_LOB.INSTR` on live `PSPCMPROG.PROGTXT`, searching for the literal
`" Returns <Type>"` phrase to cut the false-positive rate) found real
examples across the whole database in seconds: `FUNCLIB_GP_ABS.
CALC_END_DT_BTN.CalcDur` and three sibling functions all return `Record`,
decoding to `kind = 0x80003` -- fitting the exact same `0x80000`-flag family
as `Rowset` (`0x80007`), `XmlDoc` (`0x8001d`) and `XmlNode` (`0x80022`)
pass eighteen already had, with the low bits now understood as a built-in
object-type sub-code (`3` = Record, `7` = Rowset, `29` = XmlDoc, `34` =
XmlNode). Shipped as `OBJECT_RETURN_TYPE_FLAG` / `OBJECT_TYPE_CODES` in
`decodeReturnType`, generalizing what was `ARRAY_RETURN_TYPE_FLAG`'s
sibling rather than a one-off. File/SQL/Message/ApiObject/JavaObject
sub-codes are still unconfirmed -- the same system-wide search for those
five did turn up real `Returns` clauses this time (unlike the `WEBLIB_*`-
only attempt), but the matching programs are Component/Page PeopleCode
events needing more than three OBJECTVALUE key columns to fetch, which
this pass's query script didn't build; worth a second attempt with the
right key shape.

Still open: the App-Class (`PKG:Sub:Class`) return-type encoding, the
colon-qualified imported-class directory's own record format (its name run
is now correctly skipped over, but its records -- confirmed to exist,
immediately after the plain-name table, in programs like `WEBLIB_PTNUI.
PT_BUTTON_PIN` -- are not decoded), and the File/SQL/Message/ApiObject/
JavaObject return-type sub-codes just mentioned.

**A lead for whoever picks up the Application Class trailer next.** Pulled
the full 7-column key for nine Application Class programs a system-wide
search had already flagged (read-only) and hand-walked `TI_INTEGRATION.
DVMEError` (34078 bytes, only 36 unmapped opcodes -- clean enough to trust
its rendered `class`/`method`/property declarations against the trailer
byte-for-byte). Its directory is a genuinely different, richer shape than
the plain-Function one this pass otherwise confirms, not yet decoded:

- Record 0 is the class's *own* colon-qualified self-reference
  (`TI_INTEGRATION:DVMEError`, charOffset 0 -- the name run's very first
  entry), with a distinct `third` field value (`0x400000`) not seen
  anywhere in a plain-Function program's table.
- The next three records are *properties*, not methods (`DVM_ERROR: string`,
  `ProcessInstance: number`, `&_DvmFunc: EOTF_CORE:DVM:Functions`) -- and
  their `kind` field reuses exactly the same scalar codes a Returns clause
  uses (`1` for the string property, `19` for the number one), which is
  good news for extending `RETURN_TYPE_CODES` to property types later,
  but their `third` field (`0xA0001`, `0xA0000`, `0xB0002`) is not a
  parameter count -- confirmed self-consistent charOffsets prove these are
  real, correctly-aligned records, just a different field meaning for a
  property than for a method.
- The App-Class-typed property's `kind` (`0x80184`) doesn't match any
  confirmed `OBJECT_TYPE_CODES` sub-code and isn't explained by a
  NAMENUM lookup either (this program's whole PSPCMNAME table has only 3
  entries) -- genuinely unresolved, not a guess withheld.
- The plain Function/Method "second field" formula pass nineteen confirmed
  elsewhere (running total of `1 + paramCount` over declarations with an
  explicit parameter list) breaks down here: `LOAD_DVM` (the first real
  method after the self-reference and three properties) jumps straight to
  `29` where the simple formula predicts `9`, and later entries don't
  settle back into the pattern either. Properties evidently don't
  contribute to this counter the same way plain declarations do (consistent
  with pass nineteen's finding that parameterless, parenless declarations
  don't consume a slot), but the exact accounting is unconfirmed.

Net effect: confirmed the object/App-Class return-type search needs real
Application Class corpus data to make progress (the plain-Function corpus
this project has been using doesn't include class properties or self-
descriptors at all), and that class trailers are a large enough departure
from the plain-Function shape to warrant their own pass rather than an
extension of `decodeDeclarations`. Nothing from this investigation is
shipped; it is here so the next pass starts from `TI_INTEGRATION.DVMEError`
instead of re-deriving that a plain-Function model doesn't fit.

## Pass twenty: nine more opcodes, and the indentation drift is gone

The user reported two real programs looking visibly wrong in the editor:
`WEBLIB_OU_LP.ISCRIPT1` drifting further right every line until it broke
into unreadable garbage, with orphan `;` on lines by themselves; and
`OU_JET_PACK.Layout.ComponentRegistry`'s `GetRequireModule` method losing
its `Evaluate`/`End-Evaluate` bookends around a real `Evaluate &tag / When
"..." / When-Other` dispatch (the individual `When` cases still rendered,
since 0x3d was already confirmed, but not the block they belonged to).

**The root cause of the garbage cascade**: `WEBLIB_OU_LP.ISCRIPT1` (live
bytes) has a comment -- `/* fallback if the class-line parse below doesn't
fire */` -- introduced by opcode `0x4e`, not the already-confirmed `0x24`.
Same exact shape (`readLengthPrefixedText`: a little-endian uint16 byte
length, then that many bytes of UTF-16LE), confirmed byte-for-byte by hand
before checking anything else. Reading `0x4e` as unknown didn't just drop
the comment -- it fell through to interpreting the comment's own text as a
fresh stream of one-byte opcodes, producing dozens of unmapped-opcode
entries and cascading garbage past that point in the file. Fixed by routing
`0x4e` through the same handling as `0x24`. Corpus-wide (excluding
`WEBLIB_OU_LP.ISCRIPT1` itself, whose stale project-export source -- pass
thirteen -- doesn't contain this comment even though the live bytes do):
**202/202 (100%)**.

**The root cause of the orphan `;` lines and the drift**: `End-For` (0x2c)
was unmapped, so a `For ... End-For;` block rendered its `End-For` as
nothing and its own real `;` as an orphan line. Found the same way -- hand
walking the exact byte offset where the rendered text showed a bare `;`
between an inner `End-If` and the outer one's `End-If`.

**Confirming these two turned up a pattern worth naming**: naive
corpus-wide scoring of a candidate opcode is corrupted by a handful of
programs with large numbers of *unrelated* unmapped opcodes (e.g.
`WEBLIB_MCF.ISCRIPT1`, thousands of them) -- once one opcode misdecodes,
every byte downstream can misattribute to whatever opcode value it
coincidentally matches, and that noise lands on whichever candidates happen
to be under test. Restricting scoring to programs with a small total
unmapped-opcode count (`<=25`, generously above what any single new opcode
needs) turns this noise off. This is the same shape of problem pass
eighteen solved for the declaration-name directory's own field alignment,
just showing up in opcode scoring instead.

**The user then pointed at the reference project again**
(https://github.com/cache117/decode-pcode, `PeopleCodeParser.java`, already
cited in `decoder.ts`'s file header) to check whether this was already
solved there. It was, exactly: 0x2c `End-For`, 0x4e a second
`CommentParser` instance -- both matching this pass's independent findings
byte-for-byte before the reference was ever opened. Cross-checking it
further (not adopting it wholesale, the exact mistake pass sixteen already
learned from) surfaced more candidates, each independently corpus-checked
before shipping, all **100%** once the corruption-noise filter above is
applied:

- `0x25` `While` (11/11), `0x26` `End-While` (11/11) -- same shape as
  `For`/`End-For`.
- `0x2e` `Break` (52/52) -- a bare statement, `SPACE_BEFORE` only (no
  newline before it), matching real source's `Then Break;` on one line.
- `0x2f` `True` (44/44) -- alongside the already-confirmed `0x30` `False`;
  found the same hand-walking way, `&flag = <nothing>;` where `True`
  belongs.
- `0x3c` `Evaluate` (14/14), `0x3e` `When-Other` (10/10), `0x3f`
  `End-Evaluate` (14/14) -- no Application Class gating needed, unlike
  `class`/`method`/`end-class`/`end-method`, which stay gated.
- `0x45` `Global` (22/22) -- **not** `Local` (0x44). An early hypothesis in
  this same pass guessed 0x45 was `Local` from real structural evidence (it
  sat exactly where `Global object &obj;` belongs in `WEBLIB_OU_LP.
  ISCRIPT1`) but was checked against the corpus with a test loose enough to
  always pass ("does the source contain the word LOCAL anywhere") -- worth
  recording as a caution: a plausible-looking structural match still needs
  a test that can actually fail. The reference source caught it before it
  shipped wrong.

**Tried and rejected**: `0x6e` as `Continue`, suggested the same
hand-walking way (sitting exactly where `Continue` belongs, right after
`Then`) and confirmed in the reference table too (opcode 110). Rejected
anyway: only 9 of 660 corpus-wide occurrences actually correspond to a real
`Continue` in source, even before any corruption filtering -- `Continue` is
too rare a statement to explain 660 occurrences, so this byte is evidently
overloaded with something far more common the same way `class`/`method`
were outside Application Class programs. No gating condition is evident
the way `isApplicationClass` was for those, so it stays unmapped rather
than guessed at.

Corpus-wide effect of all nine shipped opcodes together: coverage 97.51% →
**97.56%**, clean programs 44 → **56** (up from 34 at the end of pass
nineteen), text accuracy holding at 97.6-98%. `OU_JET_PACK.Layout.
ComponentRegistry` itself now decodes with **zero unmapped opcodes** (was
23), and its `Evaluate`/`When`/`When-Other`/`End-Evaluate` block renders
completely. `WEBLIB_OU_LP.ISCRIPT1` dropped from 450 unmapped opcodes to
27, its rendered indentation now maxes out at a reasonable 14 spaces
(was drifting unboundedly), and the garbled section after `ParsePathValues`
is gone entirely.

Still open in `WEBLIB_OU_LP.ISCRIPT1` specifically (27 remaining unmapped
opcodes): `0x41`/`0x42` (the reference maps these to empty text with
uncertain format -- its own author left a `// 'And'-style?` comment on
0x41), and a few isolated occurrences the reference table doesn't explain
either. None of the remaining ones reproduce the garbage-cascade or
indentation-drift failure mode; what's left is ordinary missing-keyword
gaps.

## Pass twenty-one: 0x41/0x42, and the Declare Function import statement

Picked up the one item pass twenty left open. Rebuilt the 204-program corpus
fresh against the live database and hand-walked every `0x41`/`0x42`
occurrence in `WEBLIB_GS_SSO.ISCRIPT1` (the cleanest sample -- only these two
opcodes unmapped in the whole 8743-byte program) and four more programs
across the corpus, byte for byte the same way pass fifteen cracked the
name-reference bug.

**`0x42` is a context-independent, zero-width "clause just ended" marker.**
Every occurrence -- single byte, no operand -- sits at a point where the real
source has no character at all between the token before it and the token
after, regardless of what grammatical construct it's in: before `;` closing a
`Declare Function ... PeopleCode Rec.Field FieldFormula;` statement (the most
common shape, 26 of the corpus's clean-sample occurrences), before `)`
closing a parenthesised boolean sub-expression, and before `Then` ending an
If condition. Confirmed 491 occurrences corpus-wide, checked case by case
rather than scored as a percentage, because there was no case where treating
it as anything other than empty text was consistent with the real source.
Shipped unconditionally in `OPCODES`, no gating needed.

**`0x41` is genuinely overloaded, which is exactly what the reference
project's `// 'And'-style?` hedge was circling.** One role is the one this
project needed: immediately before `And` (0x18) or `Or` (0x1e), it is the
same kind of zero-width marker as `0x42` above, confirmed on
`WEBLIB_GS_SSO.ISCRIPT1` (`If %DbType = "SYBASE" Or\n %DbType = "INFORMIX"
Then`, wrapped across a line the same way the SYBASE/INFORMIX case is written
in real source) and four more programs, all compound boolean conditions.
Checked structurally rather than by text match (is the very next opcode
0x18/0x1e, not does the rendered text happen to contain "And"/"Or"
somewhere) against every program with a small unmapped-opcode count (pass
twenty's corruption-noise filter): **22/22 (100%)**. Unfiltered corpus-wide
it's only 256/402, because this byte value has a second, unrelated role:
pass seventeen had already found it marking an Application Class method's
*implementation* header (`0x63` `method`, immediately followed by `0x41`
then the bare method name with no introducer, as opposed to a one-line
declaration inside the class body) -- and that pairing already consumes its
own `0x41` as part of the `method` token, so it was never the source of
these 402. The remainder are inside already-corrupted programs or a still
different, unidentified role near Application Class self-references and
properties (pass nineteen's open item on `TI_INTEGRATION.DVMEError`'s richer
trailer shape) -- not re-investigated here, since the And/Or role fully
explains every occurrence this pass's samples needed. Shipped gated on the
next raw byte being 0x18 or 0x1e; everywhere else, 0x41 still surfaces as
unknown rather than guessed at.

Corpus-wide: coverage 97.56% → 97.60%, clean programs 56 → 60, text accuracy
held at 97.60%. `WEBLIB_GS_SSO.ISCRIPT1` itself now decodes with zero
unmapped opcodes; `WEBLIB_OU_LP.ISCRIPT1` dropped from 8 remaining unmapped
opcodes to 4, all of them `0x6e` -- the `Continue` candidate pass twenty
already tried and rejected (9 real matches out of 660 corpus-wide
occurrences, evidently overloaded with something far more common) --
correctly left unmapped rather than guessed at a second time.

**Second finding in the same pass: `Declare Function ... PeopleCode
Rec.Field Event;`**, the syntax for importing a function defined on a
different record field's PeopleCode, decoded whole. `corpus-analyze.mjs`
ranked `0x31` and `0x3a` among the most common remaining unmapped opcodes
(69 and 68 programs respectively, almost the same count -- a hint they're
paired), and both had already turned up, unexplained, while hand-walking
`WEBLIB_GS_CMD.ISCRIPT1` for the 0x41/0x42 work above: that program's only
statement is exactly `Declare Function UpdateGHServer PeopleCode
GS_CMD_WRK.GS_CMD_CFGSTR FieldFormula;`, with `0x31` sitting where `Declare`
belongs and `0x3a` where `PeopleCode` belongs.

Checked structurally against every program with a small unmapped-opcode
count, both are **35/35 (100%)**: `0x31` always immediately precedes
`Function` (0x32), `0x3a` always immediately precedes a record.field
reference (0x21). The unfiltered corpus-wide counts (276 and 260) are mostly
the same corruption-noise pattern as always -- confirmed by hand: one
"0x31 followed by another unknown opcode" case turned out to be a run of
literal UTF-16LE text (`Text(18081, ...`) inside an already heavily-corrupted
program being misread byte-by-byte as opcodes, not a real counter-example.

Checked for a collision before shipping, since `Function` is a very common
token: of 944 `Function` tokens corpus-wide, exactly 212 are preceded by
`0x31`, and every ordinary `Function ... End-Function` body (732 of them) is
untouched -- confirming `0x31` only ever appears on a real `Declare`
statement, not on every function definition.

`0x31` is consumed together with the `Function` opcode as a single
`"Declare Function"` token rather than two separate ones: `Function`'s own
format carries `NEWLINE_BEFORE`, which would otherwise put `Declare` and
`Function` on separate lines the same way any two adjacent `NEWLINE_BEFORE`
tokens do once real text has been written between them (see `render()`'s
`atLineStart` tracking, and the blank-line bug pass twenty's last item
fixed). `0x3a` (`PeopleCode`) is left as its own token, since what follows it
is a real reference needing the normal `0x21` resolution logic, not fixed
text.

Coverage 97.60% → 97.61%, **clean programs 60 → 74** (the single biggest
jump of any opcode pair confirmed this pass), text accuracy held at 97.60%,
line matching 88.26% → 89.02%. `WEBLIB_GS_CMD.ISCRIPT1` now decodes
byte-for-byte identical to its real source.

## Pass twenty-two: try/catch/end-try

`corpus-analyze.mjs` ranked the remaining unmapped opcodes by how many
programs each touches; `0x65`/`0x66`/`0x67` (43, 40 and 37 programs
respectively) stood out with a distinctive shape on the corruption-filtered
sample -- `0x66` immediately before a bare `Exception` every single time,
`0x65` right after a newline or `Then`, `0x67` sandwiched between two `;`
tokens. Hand-walked `WEBLIB_MSGWSDL.WSDLSUMMARY.FieldFormula` (3 unmapped
opcodes, real source a single `try`/`catch Exception &e`/`end-try;` wrapping
the whole function body) byte for byte and confirmed all three exactly:
**`0x65` = `try`, `0x66` = `catch`, `0x67` = `end-try`**.

This is a plain record-field `Function` program, not an Application Class
-- unlike `class`/`method`/`end-class`/`end-method`, these three needed no
`isApplicationClass` gating. That matters because `try`/`catch`/`end-try`
were *already tried and rejected* once before, in pass sixteen's wholesale
adoption of PeopleCodeParser.java's table, as part of the large
Application-Class-shaped batch that collapsed at full corpus scale. That
rejection was of the *reference project's own byte values* for these three
keywords -- different from 0x65/0x66/0x67, and evidently wrong on this
database. These were found independently by hand-walking, the same
discipline as every entry in this project's table, not adopted from that
source; the earlier rejection doesn't apply to them.

Checked structurally (is the decoded keyword text really in the real
source) at two scales, because the corpus-wide unfiltered rate looked
alarming at first: **try 91.9% (1344/1463), catch 30.6% (72/235), end-try
25.9% (66/255)**, all dragged down by a handful of already heavily-corrupted
programs (`WEBLIB_EOAW.EOAW_MON_ADHOC_NUI` alone -- 10953 unmapped opcodes
even before this pass -- accounts for most of the catch/end-try misses).
Restricted to programs with a small unmapped-opcode count, the same filter
pass twenty established: **88/88 (100%)** across all three keywords, on
every one of 11 programs that have them, zero exceptions. This is the same
false-alarm shape corpus-wide checks have produced before (0x20/"Function"
in pass eight, the mislabeled candidates in pass nine) -- the filtered
check, not the raw corpus-wide one, is what this project has always
trusted, and this is a reminder of exactly why: a real, correctly-confirmed
opcode can still look terrible in an unfiltered aggregate if the byte value
coincidentally litters a few already-broken programs' garbage decode.

Coverage 97.61% → 97.69%, clean programs 74 → 76, line matching 89.02% →
89.43%. `WEBLIB_MSGWSDL.WSDLSUMMARY.FieldFormula` now decodes with zero
unmapped opcodes.

## Pass twenty-three: Component (the third scope) and Null

`corpus-analyze.mjs`'s "best next targets" ranking (fewest distinct
unmapped opcodes, shortest source) surfaced several tiny programs whose
*only* unmapped opcode was `0x54`, real source a single top-level
`Component <type> &var;` declaration -- confirmed against four of them,
e.g. `WEBLIB_EOPP_LN.ISCRIPT1`: `Component string &CurrentTP_CREFName;`.
**`0x54` = `Component`, the third variable-scope declarator** alongside
`Local` (0x44) and `Global` (0x45) -- PeopleCode's Component-level scope,
distinct from the unrelated built-in `Component` type/metadata reference
(`Component.AMM_DETAILS`), which never showed up encoded this way in any
checked sample. Same ranking surfaced `0x4b`, confirmed against
`WEBLIB_HMCRWSDL.HMCR_WSDL_DISCOVER.FieldFormula`'s real
`If &PortalFolder <> Null Then`, its only unmapped opcode: **`0x4b` =
`Null`**, a literal the same shape as `True`/`False`.

Structurally confirmed on the corruption-filtered corpus: `Component`
10/10 programs (right after a statement boundary, right before a type
keyword or bare name, every time); `Null` 23/23 (right after a comparison
operator, `=`, `(` or `,` -- everywhere a value is expected). Checked more
strictly too, the same per-token-against-real-source method used for
try/catch/end-try: `Null` 100% (23/23) even on that stricter check, and
`Component` had one apparent miss (`WEBLIB_GS_MASK.ISCRIPT1`, 17 total
unmapped) -- traced by hand rather than waved off, and it isn't a real
counter-example: those 17 aren't 17 independent gaps, they're one
contiguous corruption run (a `0x50` number-literal shape failing to match,
desyncing everything after it into being walked byte-by-byte), and this
`Component` just happens to land inside that noise. A useful sharpening of
the corruption filter for next time: total-unmapped-count alone doesn't
distinguish "many independent small gaps" from "one desync producing many
coincidental unmapped reports" -- this pass's filtered set admitted one of
the latter.

Coverage 97.69% → 97.71%, **clean programs 76 → 87**, line matching
89.43% → 90.07%.

## Pass twenty-four: Error and Step

Two more single-opcode gaps off the same "best next targets" ranking.
**`0x1b` = `Error`**, confirmed against two different real shapes:
`WEBLIB_GS_DUO.ISCRIPT1`'s `Error ("No default DUO setup selected...");`
and `WEBLIB_OU_TN.HTML_FUNCS`'s `Then\n   Error MsgGet(30002, ...)` -- the
second confirms it takes a following bare statement, not necessarily its
own parenthesised call, and that the newline before it is real even
directly after `Then` (not a case `render()` needs to suppress the way
consecutive `NEWLINE_AFTER`/`NEWLINE_BEFORE` sometimes must). **`0x2b` =
`Step`**, a `For` loop's optional descending-iteration clause, confirmed
against `WEBLIB_HRCD.ISCRIPT2`'s `For &i = &arrProfileHierarchy.Len To 1
Step - 1`, its only unmapped opcode.

Both structurally confirmed 100% on the corruption-filtered corpus (`Error`
4/4, `Step` 3/3) and, checked more strictly per-token against real source,
100% there too (same counts). The raw unfiltered rate is weaker,
especially for `Step` (7/16, 43.75%) given how few total occurrences exist
to average over -- traced by hand rather than trusted on faith: every one
of the 9 misses sits in a program with 126 to 12733 *total* unmapped
opcodes, nowhere near clean, the same corruption-noise shape as every
previous pass's false alarms.

Coverage barely moved (97.71% → 97.71%, both are rare opcodes), clean
programs 87 → 89, line matching 90.07% → 90.14%.

## Pass twenty-five: 0x4a, a second name-reference opcode

The last easy single-byte gap was gone; `0x4a` (47 programs, 659
occurrences) was the next most common, but every filtered-corpus sample had
it sitting next to *other* unmapped bytes, never isolated -- a different
kind of problem than the last several passes, closer to the original
record.field reference dig than a quick keyword confirmation.

Hand-walking four samples found the same shape every time: `<record var> .
[0x4a][2 bytes, second always 0x00] . Value`, e.g. `&recELSTERfile.
[0x4a 04 00] .Value` in `WEBLIB_GPDE.GPDE_AL_ISCRIPT`. That 2-byte, second-
byte-zero shape is exactly `0x21`'s own record.field reference operand
(`readRecordFieldReference`: little-endian index, `NAMENUM = index + 1`).
Cross-checking real source directly against that program's own name table
(not just "does this text appear somewhere") confirmed it exactly: all 6
occurrences' computed NAMENUM landed on the real field being accessed, in
order -- `FIELD.GPDE_ELSTER_TKT`, `FIELD.SEQ_NUM`, `FIELD.EMPLID`,
`FIELD.EMPL_RCD`, `FIELD.EFFDT`, `FIELD.GPDE_XML_TAX_INFO`, matching
`&recELSTERfile.GPDE_ELSTER_TKT.Value`, `&recELSTERfile.SEQ_NUM.Value`, etc.
one for one.

**`0x4a` is a sibling of `0x21`: the identical 2-byte index+1=NAMENUM
resolution, through the identical PSPCMNAME-derived table -- but rendered
bare, without the `FIELD.` (or whatever) qualifier prefix `0x21` keeps.**
That's the whole difference, and it's exactly what the grammar needs:
`RECORD.FIELD` (0x21) is a reference written from nothing, so it needs its
qualifier to say what kind of thing it is; `&recVar.FIELDNAME.Value`
(0x4a) already has that context from the record variable and dot before
it, so FIELDNAME is written bare in real source and must be rendered bare
here too. Implemented by reusing `readRecordFieldReference` and
`tryResolveName` unchanged, stripping everything up to and including the
first `.` from the resolved qualified name; a resolution failure falls
through to unknown exactly the way `0x21`'s already does, no new failure
mode introduced.

Corpus-wide, checked directly (is the computed NAMENUM's resolved bare name
correct, not a loose text-presence check): **633/659 (96.0%)**, every one
of the 26 misses a `NameResolutionError` (index out of range) in an
already heavily-corrupted program (`WEBLIB_CTI`, `WEBLIB_MCF`,
`OU_JET_PACK.ROADMAP` -- the same names that have shown up as noise
sources all session), which is the safe fallback, not a wrong render.

**Coverage 97.71% → 97.77%, clean programs 89 → 108 (the largest single
jump this session), line matching 90.14% → 91.85%.**

## Pass twenty-six: the number literal was never a single-byte shape

The user picked this over the Application Class trailer as the next dig.
Pass four's `0x50` confirmation (`If (1 = 2) Then`, `If (12 = 34) Then`)
established "two zero bytes, the value byte, then 15 more zero bytes,"
and flagged the obvious open question: what about values above 255? Every
`0x50` still unmapped in the corpus is exactly that question.

Hand-walked four real values past the single-byte range, each the
program's only unmapped opcode: `WEBLIB_G3TOOLS.ISCRIPT1`'s
`SetTracePC(3596)`, `WEBLIB_GS_ERPFW.ISCRIPT1`'s `Char(65533)`,
`WEBLIB_OU_LP.ISCRIPT2`'s `Rand() * 1000000000`, and
`WEBLIB_PORTAL.PORTAL_PGLT_PREV`'s `MsgGetText(95, 311, "...")`. All four
are the *same field*, not a new shape: 3596 (`0x0e0c`) sits at bytes 2-3
of the 16-byte field past the two leading zero bytes; 65533 (`0xfffd`)
the same; 1000000000 (`0x3b9aca00`) at bytes 2-5; 311 (`0x0137`) at bytes
2-3. The single-byte cases pass four confirmed are the identical field
with its upper 15 bytes at zero -- there was never a separate "fits in
one byte" shape, just this one 16-byte little-endian unsigned integer,
confirmed now from 1 up through 1000000000.

**Shipped**: `readByteIntegerLiteral` now takes a `valueBytes` parameter.
`0x50` reads all 16 remaining bytes as the value (nothing left over to
require being zero); `0x11` (the still-unconfirmed 14-byte shape adopted
from `PeopleCodeParser.java`) is untouched, still restricted to exactly
one value byte, since this pass has no fresh evidence about it. Read with
`BigInt` rather than a plain number, since nothing bounds how many of the
16 bytes a real literal might use. Decimals and negative numbers are
still not confirmed and still correctly fail this unsigned-integer read
rather than being misread -- an all-zero field decodes to `0`, which is
indistinguishable from "no value here" only in the sense that both cases
are real integers this shape already covers; a decimal point or a sign
would need a different field entirely, still unidentified.

This was, by a wide margin, the highest-value single fix of the session:
**coverage 97.77% → 98.72%, clean programs 108 → 156 (+48), line matching
91.85% → 95.64%**. Text accuracy held (97.07% → 97.13%). Three of the four
hand-walked samples now decode with zero unmapped opcodes.

## Pass twenty-seven: Constant, throw, ComponentLife

Re-ran `corpus-analyze.mjs`'s "best next targets" ranking after the number
literal fix reshuffled it. Three more single-opcode gaps, each confirmed
byte-for-byte as the *only* unmapped opcode in a real program:

- **`0x56` = `Constant`**, a fourth declarator alongside `Local`/`Global`/
  `Component`, confirmed against `WEBLIB_PTTILE.ISCRIPT1`'s real
  `Constant &QUERYPARAMETER_ID = "ID";`, twice in the same program.
  Structurally confirmed 20/20 on the corpus.
- **`0x68` = `throw`**, confirmed against `WEBLIB_PTSF.ISCRIPT1`'s real
  `throw CreateException(262, 2018, "Search Exception: %1 ", &sError);`.
- **`0x79` = `ComponentLife`**, a fifth declarator (PeopleCode's
  component-interface object lifetime scope), confirmed against
  `WEBLIB_PTPN.PTPN_ISCRIPT.SavePreChange`'s real `ComponentLife
  PTPN_PUBLISH:PublishToWindow &wlSrch;`.

`0x68` and `0x79` each have only one corruption-filtered sample, unlike
most opcodes shipped this session -- not because the evidence is weaker,
but because they're genuinely rare constructs (`throw` and
`ComponentLife` each occur in only a handful of the 204 programs at all).
Both are hand-confirmed byte-for-byte, the same standard as every other
entry in this table, and neither shows any counter-evidence at any
scale checked.

Coverage 98.72% → 98.74%, clean programs 156 → 162, line matching
95.64% → 95.76%.

## Pass twenty-eight: pass thirteen's Application Class trailer, picked back up

The user asked for this by name. Fetched `TI_INTEGRATION.DVMEError` fresh
from the live database -- the exact sample pass nineteen left this open
for -- and decoded it with everything this session had already shipped:
**36 unmapped opcodes down to 4**, and every declared method and property
now renders cleanly (`class DVMEError`, ten methods with real parameter
lists and return types, then `number ProcessInstance;`, `string
DVM_ERROR;`, `EOTF_CORE:DVM:Functions &_DvmFunc;`, `end-class;`). Pass
nineteen only had scraps of this program to work from; this pass had
nearly the whole thing.

Hand-walked the 4 remaining opcodes directly in the (now mostly clean)
class header and found two new declaration keywords and confirmed a
third: `0x5e` sits before `number ProcessInstance;` and `string
DVM_ERROR;` -- **`property`**, PeopleCode's public-member declaration,
whose name is written bare (no `&`), unlike every other declarator this
project has confirmed. `0x61` immediately followed by `0x62` sits before
`EOTF_CORE:DVM:Functions &_DvmFunc;` -- **`instance`**, for an
Application-Class-typed private member, whose name *does* keep its `&`.

Corroborated immediately against real known source, not just this
decoder's own rendering: the corpus's `OU_JET_PACK.Model.PageCol` has
real source `property number ColSeq;` (and four more properties, all the
same opcode); `OU_JET_PACK.Storage.DesignRepository` and
`OU_LANDINGPAGE.LandingPage.OUBanner` both have real `instance
OU_JET_PACK:Widgets:BaseWidget &objBase;` (or `&REF_PageDesign;`).
OUBanner's own header also turned up a fourth, previously-unexplained
opcode sitting between `class OUBanner` and the same colon path:
**`0x5c` = `extends`** (`class OUBanner extends
OU_JET_PACK:Widgets:BaseWidget`).

Checked against every Application Class program in the corpus (not just
the samples that found them): **31/31 (100%)**, zero exceptions, and 12
of the corpus's 15 Application Class programs now decode with zero
unmapped opcodes (up from 6). `TI_INTEGRATION.DVMEError` itself is now
fully clean: **4 unmapped → 0**. Gated on `isApplicationClass`, the same
as `class`/`method`: `0x5e` and `0x5c` never occur outside an
Application Class program, but `0x61` and `0x62` individually do (353
and 53 corpus-wide occurrences in plain `Function` programs) -- only the
adjacent pair, inside a class, is `instance`.

**A real bug found in the calibration tooling itself, not the decoder,
while re-checking these numbers.** `corpus-validate.mjs`,
`corpus-lines.mjs`, `corpus-analyze.mjs`, `corpus-gaps.mjs`,
`corpus-gapextract.mjs` and `corpus-compare.mjs` have never once passed
`isApplicationClass` to `decodeProgram` -- meaning every Application
Class confirmation shipped since pass seventeen (`class`/`method`/
`end-class`/`end-method`, and now `property`/`instance`/`extends`) has
been invisible to every corpus-wide metric this project has quoted the
whole time, silently understating coverage and clean-program counts by
however many Application Class programs those opcodes actually touch.
Fixed by passing `{ mode: 'auto', isApplicationClass: e.key.type === 58 }`
uniformly across all six scripts. Corpus-wide, this alone (with no other
change) moved the *already-shipped* class/method/end-class/end-method
and this pass's property/instance/extends from invisible to counted:
coverage 98.74% → 98.77%, **clean programs 162 → 174**, line matching
95.76% → 96.56%. The lesson is the same shape as pass twelve's
`corpus-gapextract.mjs` label bug: a tool that measures correctness can
itself be wrong in a way nothing downstream re-checks, and the fix can
move the numbers as much as a real decoder fix does.

Still open, unchanged from pass nineteen: the App-Class-typed return
value encoding (`kind` on a method returning an App Class), the
colon-qualified imported-class directory's own record format, and
whether `decodeDeclarations`' plain-Function record shape can be
extended to cover the richer property/self-reference records this
program's own trailer directory has (still returns `undefined` for
`TI_INTEGRATION.DVMEError` -- these are separate from the
now-fully-decoded statement-stream keywords this pass shipped).

## Pass twenty-nine: the trailer directory's own richer record shape

The last item pass twenty-eight left open, closed in the same sitting:
`decodeDeclarations` extended to read the Application Class directory
records themselves, not just the statement-stream keywords that
describe them.

With `TI_INTEGRATION.DVMEError`'s statement stream now fully clean (pass
twenty-eight took it to zero unmapped opcodes), its trailer table became
readable by eye for the first time: 15 sixteen-byte records, self-
verifying via the existing charOffset check exactly like the
plain-Function case, in precisely the class's own real declaration
order (self-reference, then 3 properties, then 11 methods, matching the
rendered `class DVMEError ... end-class;` header one for one). Two
things needed handling that the plain-Function shape never has:

- **Record 0 is the class's own self-reference** (`TI_INTEGRATION:
  DVMEError`, the name run's first entry, charOffset 0) -- not a
  declaration, distinguished by a constant third field, `0x400000`.
- **Property records reuse the third field for something that isn't a
  parameter count** -- `0xa0001` (the `string DVM_ERROR` property),
  `0xa0000` (`number ProcessInstance`), `0xb0002` (the App-Class-typed
  `EOTF_CORE:DVM:Functions &_DvmFunc`) -- while the *method* records'
  third field is exactly `paramCount`, confirmed 11/11 against
  DVMEError's own real signatures, and its fourth field (`kind`) the
  exact same `7`-means-no-return / scalar-code scheme already confirmed
  for plain Function programs -- `1` (string) seven times, `19` (number)
  is absent here but matches ProcessInstance's own property kind too.

Both detected structurally, not guessed: a property's third field always
sets bits above `0xffff`, which no real parameter count ever does; the
self-reference's is checked against the exact constant and the whole
table is refused if it doesn't hold. Both are skipped from the returned
`Declaration[]` rather than exposed as nonsense -- a many-thousand-
parameter "method" for a property, or a zero-param one for the class
itself.

One more wrinkle in the name run: the self-reference is colon-qualified
(`PKG:Class`) exactly like the still-undecoded imported-class references
pass nineteen already knew to skip -- but unlike them, it *does* get a
record. Handled by keeping only the very first colon-qualified name in
Application Class mode; every colon-qualified name after it (here,
`EOTF_CORE:DVM:Functions`, the `&_DvmFunc` property's own type,
appearing last in the run) is still skipped exactly as before.

Checked against every Application Class program in the corpus, not just
DVMEError: of 15, 13 now decode a `declarations` array at all (up from
0 -- this shape was previously unreached entirely), and **every single
declaration in every one of them matches real source exactly on both
`paramCount` and `hasReturnValue`: 54/54 (100%)**. `TI_INTEGRATION.
DVMEError` itself goes from `declarations: undefined` to all 11 of its
real methods, correct in full, none of its 3 properties or its own
self-reference mistaken for one.

Still open at the end of pass twenty-nine: the App-Class-typed return/
property value encoding itself (what `0x801c4` means for the
`&_DvmFunc` property, or what a method returning an App Class type would
encode as its own `kind`), and the colon-qualified imported-class
reference's own record format, if it has one at all -- unlike the
plain-Function case, this pass found no evidence `EOTF_CORE:DVM:
Functions` gets a record of its own anywhere, only a name-run entry
other records' `kind` fields presumably point back into somehow, not yet
worked out.

## Pass thirty: both of pass twenty-nine's open items, plus the "still-unlocated table"

The user asked to keep going. Gathering one more real sample to answer
"does a colon-qualified type reference get its own record" -- pulling
`OU_JET_PACK.Storage.DesignRepository`'s trailer, which has one
(`OU_JET_PACK:Model:PageDesign`, referenced four separate times: a
property's type, a method parameter's type, and two method return
types) -- answered both of pass twenty-nine's open items in one motion
and, chasing the pattern further, cracked pass nineteen's own
"still-unlocated" second table too.

**An Application-Class return/property type is not a fixed code at all
-- it's a back-reference to a specific occurrence of the type's own name
in this same trailer's name run.** `REF_PageDesign`'s property kind
(`0x80162`), `Load`'s return kind (`0x8017f`), and `ListHeaders`'s
`array of` return kind (`0x18019c`) all point at *different* occurrences
of the identical text `OU_JET_PACK:Model:PageDesign` -- stripping
`OBJECT_RETURN_TYPE_FLAG` leaves `0x162`/`0x17f`/`0x19c` (354/383/412),
and subtracting a constant `256` from each lands exactly on that name's
1st/2nd/3rd charOffset in the run (98/127/156) -- confirmed a fourth time
against `OUBanner`'s own self-reference record, whose `kind` (when the
class `extends` something) points at the base class's own name the same
way (`0x8013c` → charOffset 60, `OU_JET_PACK:Widgets:BaseWidget`'s first
occurrence), and a `no base class` program's self-reference (`DVMEError`,
`DesignRepository`) shows the ordinary `7` sentinel there instead. This
also directly answers "does the colon name get its own record": **no** --
it's referenced positionally, by charOffset, not through any record of
its own; there was nothing to decode there because there was nothing
there to decode.

Why a back-reference and not a direct code: the same type name can
legitimately appear more than once in one program (once per place it's
referenced), and different occurrences are NOT interchangeable -- this is
what a fixed enum could never express, but a name-run charOffset always
disambiguates for free, since the run already exists for the plain-name
case. **Shipped**: `decodeReturnType` takes an optional `classNames`
list; when `OBJECT_RETURN_TYPE_FLAG`'s sub-code is `0x100` or higher, it's
read as `0x100 + charOffset` and resolved against the trailer's own name
run (not just the filtered, colon-stripped one `decodeDeclarations`
builds its record table from -- a new `allNames` list keeping every
entry). Checked corpus-wide against real `Returns` clause text, not a
loose presence check: **38/38 (100%)**.

**The dispatch-slot table pass nineteen called "further, still-unlocated"
is a flat run of one 4-byte slot per parameter, immediately after the
declaration-name record table, plus one terminator slot per declaration
that's always exactly `7`.** This is exactly what the already-confirmed
"second field" (a running total of `1 + paramCount` per declaration with
an explicit parameter list) was always a slot *offset* into -- pass
nineteen named its existence and offset formula but never located the
table itself. Verified two ways:

- **Size**: for every multi-declaration program in the corpus, computing
  the total slot count implied by its declarations' own real parameter
  lists (ground truth from source, not the trailer) and multiplying by 4
  matched the trailer's real remaining byte count after the record table
  exactly for **106 of 106 valid samples** (2 apparent exceptions are
  both the same already-known-stale `WEBLIB_OU_LP.ISCRIPT1` duplicate
  export). Every single trailer's remaining byte count divides evenly by
  4 -- zero exceptions -- which alone was already suspicious in exactly
  the right way.
- **Content**: each parameter's own slot decodes through the *identical*
  type-code vocabulary `decodeReturnType` already has -- confirmed against
  a real mixed four-type signature, `addNonNPSAction(&rsActions As
  Rowset, &ruleNode As XmlNode, &ruleId As string, &nCurrent As integer)`,
  whose four slots decoded to `Rowset`, `XmlNode`, `string`, `integer` in
  order, exactly. A `Function` declaration's own parameter slots carry two
  extra set bits (`0xc0000000`) a `method` declaration's slots never do --
  some flag not otherwise understood, masked off before decoding since it
  never collides with a real type code either way.

**Shipped**: `Declaration.parameterTypes?: (string | undefined)[]`,
decoded by the new `decodeParameterTypes`, refusing the whole array
(not a partial guess) when the slots don't fit the buffer or the
terminator isn't exactly `7`. Checked corpus-wide against every
parameter's real declared type: **401/402 (99.75%)**, the one exception
traced by hand to the validation script's own ground-truth lookup
matching the wrong one of two same-named `Function` overloads in a
single program's source, not a decoder error. This pass's own
mixed-type sample turned up three real type codes this project hadn't
seen before, confirmed the same way as every other entry in this table
rather than assumed: `datetime` (`11`, a scalar, alongside `string`/
`boolean`/`object`/`integer`/`number`), `ApiObject` (`0x8000f`) and
`JsonObject` (`0x80063`), both alongside the existing `Record`/`Rowset`/
`XmlDoc`/`XmlNode` object codes.

This closes every item pass twenty-nine's own open list named. What
remains of the Application Class trailer project pass thirteen started:
whatever the `Function`-only `0xc0000000` parameter-slot flag itself
means (harmless to mask off, but not understood), and whether a
`property`'s own `kind` field (confirmed to reuse the same scalar/object/
App-Class vocabulary, per pass twenty-nine) is worth exposing on some
future property-facing API now that `Declaration` covers methods.

## Pass thirty-one: a tracker for what's left, and Continue reopened

The user asked for a standing list of which real programs still carry
each of the session's remaining candidate opcodes (`0x00`, `0x20`,
`0x6e`, `0x70`/`0x6f`/`0x73`/`0x74`/`0x72`/`0x6c`) unmapped, to work from
across sessions instead of re-running `corpus-analyze.mjs` cold each
time. `scripts/track-opcodes.mjs` generates `docs/unmapped-opcodes.md`:
every corpus program with each opcode, sorted by that program's own
total unmapped count (ascending), so the best hand-walking candidates
sort to the top automatically. Regenerate after any decoder change.

Already visible from the generated list before touching any code: the
`0x70`/`0x6f`/`0x73`/`0x74`/`0x72`/`0x6c` cluster shares almost the exact
same program list across all six opcodes, and none of them ever appears
in a program with a low total-unmapped count -- a real signal that these
are bound together in some shared construct particular to a handful of
harder programs, not six independent single-byte gaps the way most of
this session's finds have been.

The tracker also surfaced three fresh, clean `0x6e` samples this
session's corpus rebuild hadn't had before (`WEBLIB_PTIFRAME.ISCRIPT1`,
`WEBLIB_UNREMREG.ISCRIPT1`, `WEBLIB_PTDIAG.ISCRIPT1` twice) -- worth
rechecking `Continue`, which pass twenty tried and rejected on a raw,
unfiltered corpus-wide count of 9/660. All four hand-walked instantly:
every one is `Continue;` inside an `If ... Then` block, one with a
comment that says so outright (`/* ... do not output anything, continue
to next app package */`). **The rejection was the measurement, not the
mapping**: pass twenty's count included every corruption-noise
occurrence of this byte value corpus-wide, with no structural filter at
all. Gating on the very next byte being `0x15` (`;`, an already-decoded
real token) turns out to filter almost all of that out by construction --
checked this way at *full* corpus scale, not just the usual small-
unmapped-count filter: **9/17**, and all 8 non-matches are the same
single program, `WEBLIB_OU_LP.ISCRIPT1`, already known stale (pass
thirteen: its project-export source is an older version than the live
bytes actually decoded). Excluding that one known-bad ground truth, this
is **9/9 (100%)**.

**Shipped: `0x6e` = `Continue`, gated on the next byte being `0x15`.**
Coverage barely moved (a rare opcode) but **clean programs 174 → 180**.

## Pass thirty-two: the 0x70/0x6f/0x73/0x74/0x72/0x6c cluster was one bug

The tracker's own observation -- that this cluster of six opcodes shares
almost the exact same program list and never appears in a cleanly-
decoding program -- turned out to be exactly right, but not because
they're a real shared construct. They're the same kind of misread-text
garbage pass twenty's `0x4e` fix and this session's `WEBLIB_EOAW.
EOAW_MON_ADHOC_NUI` desync both already hit: real UTF-16LE text (in this
case, the trailer's own declared-name run) being walked byte by byte as
if each character pair were an opcode. `0x70`/`0x6f`/`0x73`/`0x74`/
`0x72`/`0x6c` are ASCII `p`/`o`/`s`/`t`/`r`/`l` -- letters that happen to
also collide with real single-byte opcodes, which is why the cluster
looked coherent: it's six different letters of the same handful of
real words (`Script`, `Component`, `import`, ...) each misfiring against
whatever opcode its own ASCII value happens to equal.

**Root cause: `TRAILER_MARKER` detection requires the literal two-byte
sequence `[0x2d, 0x07]` adjacently in the byte stream, but when the
program's last real statement is followed by a trailing comment before
the trailer begins, the comment's own bytes sit between the last real
newline and the trailer's `0x07` -- so that literal pair never occurs.**
Confirmed against `WEBLIB_QUERY.ISCRIPT1` (46 unmapped opcodes, real
source `End-Function;\n\n/* 1746200000 */\nFunction IScript_ToXML();`):
hand-walked the exact bytes and found the trailer's own name run
(`IScript_ToExcel`, `IScript_ToXML` -- both real declared functions)
sitting right where the "unmapped cluster" was, immediately after the
comment, with no `0x2d` anywhere nearby -- the comment already carries
its own newline formatting, so the compiler evidently doesn't need a
separate one before the trailer in this case.

**Shipped**: a second, relaxed trailer check -- `0x07` immediately
preceded by an already-decoded Comment token counts as the trailer too.
Gated on the literal strict marker being entirely absent from the whole
buffer (checked once, up front), so it can never preempt a real strict
match that exists later in a program which also happens to contain this
exact byte shape somewhere earlier for an unrelated reason (an ordinary
mid-stream bare `0x07`, ~900 occurrences corpus-wide, already established
as a real but different construct).

Found and fixed all five corpus programs this affected (of the 19 total
lacking the strict marker; the other 14 are simply too short to declare
anything, the already-established baseline): **all five now decode with
zero unmapped opcodes**, including two that were nowhere near "clean" by
any other measure -- `WEBLIB_CTI.ISCRIPT2` (56 → 0) and `WEBLIB_GS_UTIL.
ISCRIPT1` (188 → 0). Coverage 98.79% → 98.79% (rounds the same at two
decimal places on this small a byte count), **clean programs 180 → 185**.
Regenerating `docs/unmapped-opcodes.md` after this fix shows the cluster
shrink from 16/16/14/14/14/13 programs to 13/13/12/12/12/11 -- the
residual is a second, still-unidentified cause behind the same symptom,
not fully explained by this one bug.

The lesson: a coherent-looking "shared construct" hypothesis, formed
purely from co-occurrence data before touching any bytes, was worth
exactly one hand-walk to falsify -- the six opcodes were never related to
each other at all, only to the same single boundary-detection gap.

## Pass thirty-three: the second cause behind the same cluster -- by far this project's biggest single fix

Pass thirty-two explicitly left the residual cluster open ("a second,
still-unidentified cause behind the same symptom"). Picked the lowest-
total-unmapped residual candidate, `WEBLIB_OU_LP_BK.ISCRIPT2` (88
unmapped), and hand-walked one `0x70` occurrence: right after a
correctly-decoded `try` keyword, a run of ASCII letters colliding with
real opcodes again -- `0x6d`/`0x70`/`0x6c`/`0x61` spelling fragments of
"template". Searching real source for "template" found the actual
culprit a few dozen bytes earlier, inside a comment: `/* the Knockout
viewModel + templates` **—** `see below */` -- an em dash.

**`readLengthPrefixedText` (the comment reader for `0x24`/`0x4e`) rejected
the entire comment if even one UTF-16 code unit fell outside printable
ASCII**, even though the byte length prefix already says exactly where
the comment ends -- unlike the null-terminated readers elsewhere in this
format, there is no terminator-scanning ambiguity here that a
per-character validity check is needed to resolve. Real comments
legitimately contain an em dash, a curly quote, or whatever else a human
actually typed; rejecting the whole comment for that fell through to
walking its own bytes as opcodes, producing exactly the
ASCII-letter-collides-with-a-real-opcode garbage cluster pass thirty-two
had only half-explained.

**Shipped**: read every UTF-16 code unit in the byte range the length
prefix already bounds, with no per-character rejection at all. Kept the
one guard the check was originally added for -- a length prefix that
happens to land on a run of zero bytes, which would otherwise silently
decode as a comment made entirely of NULs -- since that one is a real
structural concern the length prefix alone doesn't rule out.

By a wide margin the single largest fix this project has shipped:
**coverage 98.79% → 99.74%**, closing most of the remaining gap to 100%
in one change. `WEBLIB_OU_LP_BK.ISCRIPT2` itself went from 88 unmapped
opcodes to 0. Clean programs 185 → 187 (a small net number, because most
of the gain landed in programs that still have a handful of other,
unrelated gaps rather than crossing all the way to zero) -- coverage is
the metric that shows the real size of this one. The opcode-tracker
cluster shrank further (13/13/12/12/12/11 → 11/11/11/10/10/10), meaning a
third cause likely remains behind whatever's left, still unidentified.

## Pass thirty-four: decimal number literals

The user's own next suggestion (the tracker's `WEBLIB_OU_LP_BK.ISCRIPT1`
`0x50` anomaly flagged at the end of the last session) turned out to be
a real, clean, third thing entirely -- not a misread-text artifact like
the last two passes' fixes, but the number-literal shape itself, still
narrower than reality. Real source: `&pcts.Push(33.34);
&pcts.Push(33.33); &pcts.Push(33.33);` inside a three-column layout
percentage split. The raw bytes (`00 02 06 0d 00...`, `00 02 05 0d
00...` twice) didn't fit pass twenty-six's confirmed shape, which
requires the second operand byte to be zero.

**It doesn't need to be zero -- it's a decimal scale.** `0x0d06` (little-
endian at bytes 2-3) is 3334; divided by `10^2` (the second byte, `2`)
that's exactly `33.34`. `0x0d05` is 3333, `/100` = `33.33`, confirmed
twice, byte-for-byte identical both times the same literal is pushed.
A third, independent sample in a completely unrelated program nailed it
down further: `OU_JET_PACK.Layout.LayoutEngine`'s own `3COL_333333`
branch has the *identical* two byte patterns for its own `Push(33.34)`/
`Push(33.33)` pair, and `WEBLIB_GS_MASK.ISCRIPT1`'s real `If
&ptVersionNum < 8.52 Then` gave a fourth, differently-scaled data point
(`0x0354` = 852, `/100` = `8.52`) confirming the scale byte generalizes
rather than being a fixed "this is a decimal" flag.

Every already-confirmed plain integer is scale `0`, which the new
formula (`value / 10^scale`) reduces to unchanged -- this is a strict
generalisation of pass twenty-six's shape, not a competing one, and
required no change to any previously-passing case. Negative numbers are
still unconfirmed and still correctly refused rather than guessed.

**Shipped**: `readByteIntegerLiteral` reads the second operand byte as a
scale (still requiring the first to be exactly zero) and renders
`value / 10^scale` as a decimal string; 0x11's still-unconfirmed 14-byte
shape is deliberately left restricted to scale `0` only, since this pass
found no evidence either way for it.

All three programs that anchored this confirmation now decode with
**zero unmapped opcodes**. Coverage **99.74% → 99.77%**, clean programs
187 → 190.

## Pass thirty-five: Operation."Name" references, a third sibling of 0x21

The opcode tracker's next-cleanest `0x00` candidate, `WEBLIB_GS_JU_IB.
ISCRIPT1` (2 total unmapped), hand-walked to a construct this project
hadn't seen before: real source `CreateMessage(Operation."GL_JRNL_IMP",
%IntBroker_Request);` -- an Integration Broker Operation reference. The
bytes right after `CreateMessage(` were 3 total, nowhere near enough to
spell `GL_JRNL_IMP` as inline text, which is what pointed at a
reference-style construct rather than a string literal: `0x48`, then a
2-byte index in the exact shape `0x21`'s own record.field reference
already uses. Resolving it the same way (`index + 1 = NAMENUM`) against
this program's own PSPCMNAME table landed exactly on `OPERATION.
GL_JRNL_IMP`.

**`0x48` is a third sibling of `0x21`** (after `0x4a`, pass twenty-five):
same 2-byte index+1=NAMENUM shape, same table, `tryResolveName`'s
resolution-failure fallback reused unchanged. What's different from both
0x21 and 0x4a is the rendering -- `Operation."GL_JRNL_IMP"`, the
qualifier as a fixed keyword and the reference name in double quotes,
not dot-joined the way `RECORD.FIELD` or a bare `FIELDNAME` are -- an
Operation name can contain characters (spaces, punctuation) a bare
identifier can't carry, so PeopleCode's own grammar quotes it. Gated on
the resolved qualifier actually being `OPERATION`, case-insensitively,
not just on the index resolving at all: every other corpus-wide
occurrence of this opcode sits in an already heavily-corrupted program
with a garbage-large index (17409 and up, far past any real NAMENUM),
which the existing resolution-failure check already refuses safely --
but the qualifier check additionally means a real reference to some
other, unconfirmed qualifier under this same opcode would still fall
through to unknown rather than being rendered with a guessed keyword,
since this pass has exactly one real sample and no evidence either way
for any qualifier but `OPERATION`.

`WEBLIB_GS_JU_IB.ISCRIPT1` now decodes with zero unmapped opcodes.
Coverage held at 99.77% (a single-program opcode), clean programs
190 → 191.

## Pass thirty-six: a third comment style closes out the whole tracker

Moved to the tracker's next-cleanest `0x00` candidate, `WEBLIB_IB.
ISCRIPT1` (88 total unmapped). The unmapped run sat right after a real
`End-Function;`, two newlines, then two unmapped bytes followed by what
looked like the now-familiar ASCII-letters-collide-with-real-opcodes
garbage (`Evaluate`, `To`, `Component` firing on coincidence). But the
"misread text," read straight, spelled real, readable English: "This
laucnhes the Integration HUB MAP Rapid Application" -- and real source
confirmed it, wrapped in a delimiter style this project hadn't seen
before: `<* ... *>` rather than `/* ... */`.

**`0x55` is a third length-prefixed comment introducer -- the identical
shape `0x24`/`0x4e` already have.** The two bytes immediately before the
"misread" text were the giveaway once labelled correctly: `0x55` (the
opcode) then a two-byte length prefix of exactly `122` -- and the real
comment text is 61 characters, `122` bytes of UTF-16LE, delimiters and
all. Exact match, not a coincidence: `<*`/`*>` is stored as literal text
content the same way `0x24`'s own comments carry their own `/* */`.

Checking where else this delimiter style shows up explains *why* it
exists at all: `WEBLIB_EP_FL.ISCRIPT2`'s real source has `<*&EndPos =
Find("?", &sURL, 0); If &EndPos = 0 Then ... End-If;*>` -- several whole
statements, commented out as a block, and that disabled block sits right
next to other, ordinary `/* */` comments earlier in the same function.
`<* *>` is PeopleCode's way to comment out code that itself contains
`/* */` comments.

**Shipped**: `0x55` added alongside `0x24`/`0x4e` everywhere they're
already handled (the main dispatch check, `OPERAND_FORMAT`), reusing
`readLengthPrefixedText` unchanged -- no new function needed, since the
shape genuinely is identical.

This is the same second cause pass thirty-two's own trailer-marker fix
left an "opcode tracker cluster shrank but didn't disappear" note about
-- and it explains nearly all of what was left. Coverage **99.77% →
99.99%**, clean programs **191 → 200 of 204**. Regenerating the tracker
afterward shows the entire original nine-opcode list (`0x00`, `0x20`,
`0x6e`, `0x70`/`0x6f`/`0x73`/`0x74`/`0x72`/`0x6c`) down to a single
remaining program, `WEBLIB_HRS_CB.HRS_ISCRIPT` (183 unmapped opcodes) --
everything else the tracker was built to watch is closed.

## Pass thirty-seven: `#If`/`#Then`/`#End-If`, the tracker's last program

`WEBLIB_HRS_CB.HRS_ISCRIPT.FieldFormula` was the sole survivor across the
entire original nine-opcode tracker, at 183 unmapped opcodes -- by far
the largest remaining count of any corpus program. Hand-walking its
lowest offset landed on real source that had nothing to do with the
opcodes being tracked:

```
&ShowNotif1 = %Request.GetParameter("ShowNotif");

/*AES128 Encryption uptake*/
#If #TOOLSREL >= "8.60" #Then
   If Left(&ShowNotif1, 4) = "{V2}" Then
      &ShowNotif = DecryptStr(&ShowNotif1);
   Else
      &ShowNotif = Decrypt("", &ShowNotif1);
   End-If;
#End-If;
#If #TOOLSREL < "8.60" #Then
   &ShowNotif = Decrypt("", &ShowNotif1);
#End-If;
```

`#If`/`#Then`/`#Else`/`#End-If` are PeopleTools preprocessor directives,
evaluated once at **compile time** against the compiling environment
(here, `#TOOLSREL`, the PeopleTools release). Only the taken branch is
ever compiled into real opcodes -- the untaken branch isn't tokenized at
all. That's what turned one directive pair into 183 unmapped opcodes:
every one of the second `#If` block's real statement opcodes was replaced
by a single opaque byte run the decoder had no entry for, and everything
downstream cascaded into garbage.

Byte-for-byte, three new opcodes, all length-prefixed text runs in
exactly the shape `0x24`/`0x4e`/`0x55`'s comments already use (2-byte LE
byte length + that many bytes of UTF-16LE, reusing `readLengthPrefixedText`
unchanged):

- **`0x75`** is `#If`: its text is always just the condition
  (`#If #TOOLSREL >= "8.60"`, `#If #TOOLSREL < "8.60"` -- 46 and 44 bytes,
  confirmed exact both times), regardless of which way it evaluates.
- **`0x78`** is `#End-If`: its text is always the fixed 14 bytes
  (`#End-If`, 7 characters), confirmed exact both times -- it has no body
  of its own to carry.
- **`0x76`** is `#Then`, and it's the interesting one. When its branch
  *was* compiled (the first block, `>= "8.60"`, true under whatever tools
  release this program was compiled with), its text is just `#Then` (10
  bytes) and real opcodes follow normally -- `If`/`Then`/`Else`/`End-If`
  decode exactly as they do anywhere else. When its branch *was not*
  compiled (the second block, `< "8.60"`, false), its length-prefixed text
  is `#Then` plus the **entire untouched source of the dead branch**,
  verbatim down to the byte -- one single 100-byte run reading
  `#Then\n      &ShowNotif = Decrypt("", &ShowNotif1);`, embedded
  newlines and original indentation and all, immediately followed by
  `0x78`'s `#End-If` with no real opcodes in between. The compiler simply
  never tokenized what it didn't need, and kept the raw text instead
  (presumably for round-tripping through App Designer's own editor).

Formatting-wise, `#Then` and `#End-If` behave exactly like a real
`Then`/`End-If` pair: `0x76` carries `SPACE_BEFORE | INCREASE_INDENT`
(applied after its own text, so only what follows is indented one level
deeper) and `0x78` carries `NEWLINE_BEFORE | SPACE_BEFORE |
DECREASE_INDENT` (same as `ENDBLOCK_STYLE`, no `NEWLINE_AFTER` since a
real `;` always follows and supplies the line break itself). `0x75`
carries only `NEWLINE_BEFORE`. This is enough for both cases: when the
branch was compiled, the following real tokens supply their own
newlines/indents same as anywhere else in the format; when it wasn't,
the dead branch's own embedded `\n` characters do the job directly, since
they're literal characters inside the token's rendered text, not
format-flag-driven breaks.

Only one corpus program carries these opcodes, so there's no
corpus-scale confirmation beyond this single sample -- but the render
output matches the real source byte-for-byte across both directive
blocks, including the verbatim dead-branch text, which is about as
strong a single-sample confirmation as this format offers.

**Shipped**: `0x75`/`0x76`/`0x78` added to `OPERAND_FORMAT` and a new
dispatch block reusing `readLengthPrefixedText`, rendered as
`TokenKind.Keyword` (plain text, no wrapping, unlike `Comment`'s `/+ +/`).
`WEBLIB_HRS_CB.HRS_ISCRIPT.FieldFormula` goes from 183 unmapped opcodes to
**0**. Corpus-wide: coverage **99.99% → 100.00%**, clean programs
**200 → 201 of 204**. Regenerating the tracker shows every one of the
nine originally-tracked opcodes (`0x00`, `0x20`, `0x6e`, `0x70`, `0x6f`,
`0x73`, `0x74`, `0x72`, `0x6c`) at zero remaining programs, corpus-wide --
the tracker this pass thirty-one built is now empty by its own measure.

## Pass thirty-eight: a validator fix, and the corpus's last unmapped opcode

With the tracker empty, `corpus-validate.mjs`'s text-accuracy check was
worth trusting again -- and it flagged two programs (`WEBLIB_CTI.ISCRIPT1`,
`WEBLIB_EOAW.EOAW_MON_ADHOC(_NUI)`) whose decoded string literals
"weren't found" in real source. Both turned out to be the validator, not
the decoder: PeopleCode escapes a literal `"` inside a string by doubling
it (`""`), same as SQL. The decoder already renders that correctly as one
real `"` (`"<applet MAYSCRIPT name="pCti" ...`), but the checker's
substring search compared against the still-escaped source text
verbatim, so it could never match. Fixed by un-escaping source the same
way before the fallback check, string literals only. Text accuracy
**98.30% → 98.60%**.

That fix also unmasked a previously-hidden entry behind the sample cap:
`WEBLIB_OU_LP.ISCRIPT1.FieldFormula`, decoding real function names
(`ParsePathValues`, `ClassSkeleton`) that don't appear anywhere in its
corpus source at all. Not a decoder bug -- that corpus entry's
ground-truth source is 6,270 characters against an 18,669-character
decoded program; several earlier passes already note this exact file's
bytes are "live, not the stale export." A known, pre-existing
ground-truth limitation, left as-is.

With the validator trustworthy again, the corpus's remaining 3 non-clean
programs turned out to share one opcode, `0x43`, one occurrence each:

```
%Response.RedirectURL(&URL);
Exit;
End-If;
End-Function;
```

Identical byte-for-byte across `WEBLIB_EOAW.EOAW_MON_ADHOC`, `WEBLIB_EOAW.
EOAW_MON_ADHOC_NUI` and `WEBLIB_PTAF.PTAFAW_MON_ADHOC` -- `0x43` is
`Exit`, a bare statement keyword with no operand, the same shape as
`Break` (`0x2e`). Confirmed 3/3, each program's *only* unmapped opcode,
with zero conflicting occurrences anywhere else in the corpus.

**Shipped**: `0x43` added to `OPCODES` alongside `Break`. This was the
last unmapped opcode anywhere in the 204-program corpus: coverage
**100.00%** (unchanged -- already there), clean programs **201 → 204 of
204**. Every program in the corpus now decodes with zero unmapped
opcodes.

## Pass thirty-nine: past the corpus -- decoding the whole live database

204 programs is a sample, not the format. With the corpus itself fully
clean, the only way to find what it doesn't cover is to decode everything
else: every PeopleCode program in `SYSADM.PSPCMPROG`, not just the ones
paired with known-correct source. That's ~121,000 programs and 390MB
against 204 -- roughly 590x more.

Two tools-only mistakes had to be found and fixed before the scan's
output meant anything, both instructive on their own:

1. **An empty `NameTable` cascades.** The first attempt skipped joining
   `PSPCMNAME` to avoid 121k round trips, reasoning that only `0x21`/
   `0x4a`/`0x48` need it. True, but incomplete: a *failed* reference
   resolution doesn't consume its 2-byte operand -- it falls through to
   the generic unknown-opcode handler, which advances past only the
   opcode byte, leaving the 2 index bytes to be reread as fresh opcodes
   next iteration. Every unresolved reference in a program with no names
   at all desyncs everything downstream of it. First pass reported
   ~200 opcodes "wrong," nearly the entire table, almost all of it this.
   Fixed by streaming `PSPCMPROG` and `PSPCMNAME` as two cursors ordered
   identically by the same 7-part key and merge-joining them client-side
   -- one pass each, no per-program round trips, real names throughout.

2. **`isApplicationClass` needs the last *non-blank* key part, not
   `OBJECTVALUE7` literally.** Application Class keys are often only 3
   parts long (`Package.Class.OnExecute`); the unused OBJECTVALUE slots
   stay blank rather than shifting `OnExecute` down into slot 7. Checking
   slot 7 outright silently treated most real Application Class programs
   as plain Function programs, flooding the report with false "unmapped"
   hits across the entire class/method family (`0x5a`-`0x64`). Fixed by
   finding the last non-blank part -- but that alone is ambiguous, since
   App Engine step/action PeopleCode keys *also* end in a literal
   `OnExecute` (`Program.Section.Market.EffDate.Step.OnExecute`). Those
   always carry a `YYYY-MM-DD` effective-date part that no Application
   Class package/class name ever does, so excluding any key with a
   date-shaped part tells them apart. Misclassifying a Function program
   as a class would silently misrender real bytecode rather than just
   flag it -- worse than the bug it replaces, so worth the extra check.

With both fixed, the scan (`scripts/scan-db-opcodes.mjs`, kept as a
reusable tool) reported real, structurally-consistent gaps -- filtering
by each opcode's *cleanest* sample (lowest total-unmapped-count program
it appears in, same corruption-noise discipline as every corpus pass)
separated two genuine finds from the rest, which were either noise
cascading off those two or too entangled with other gaps to hand-walk
confidently yet:

- **`0x20`**: a zero-width marker, always directly after a statement
  boundary (`;` or `Then`) and directly before a real `(` opening a bare,
  unassigned function-call statement (`(MsgGet(6540, 127, "..."));`),
  never before a call whose result is used. 5 independent occurrences
  across 3 programs, each the program's *only* unmapped opcode
  (`AA_ONE_JPN_VW.ACTION_REASON_JPN.SaveEdit`, `ABSENCE_HIST.
  ABS_RECURRENCE.SaveEdit` twice, `ABSENCE_HIST.EMPLID.RowDelete`,
  `ABSENCE_HIST.EMPLID.SaveEdit`), zero counter-examples.
- **`0x51`**: `Local`'s own zero-width sibling, sitting wherever `0x44`
  does -- directly before a type and a `&var;` -- but specifically where
  the source declares the variable with *no* scope keyword at all.
  PeopleCode allows a bare `<type> &var;` at a program's top level
  (implicitly `Local` scope). 8 independent single-occurrence samples,
  and one clincher: `AE_WRK.AE_BIND_VALUE.FieldEdit` declares `Local
  Record &MYREC;`, `Field &MYFLD;`, `Local Field &FLD;` and `Local Record
  &REC;` back to back -- the three with an explicit `Local` decode via
  the already-confirmed `0x44` exactly as everywhere else, and only the
  one genuinely missing it (`Field &MYFLD;`, PeopleCode's well-known
  implicit-current-field idiom) carries `0x51` instead.

Neither opcode has a project-export source to check literally against --
both are delivered PeopleSoft base objects, not custom OU_ code -- so
confirmation here is structural rather than text-diffed. That's a
different (and slightly weaker) standard than every other opcode in this
document, worth naming plainly rather than quietly reusing the same
"confirmed" language: it rests on volume (13 combined independent
occurrences, zero counter-examples) and, for `0x51`, a same-program
contrast that leaves little room for coincidence.

**Shipped**: `0x20` and `0x51` added to `OPCODES`, both zero-width
(`TokenKind.Punctuation`, empty text, `F.NONE`) exactly like `0x42`'s
established shape. Corpus-wide: unaffected (100.00%/204 clean, neither
opcode occurs in the corpus itself -- this is precisely why the full-database
scan was necessary). Both re-verified directly against all 12 real DB
programs they were hand-walked against: 0 unmapped opcodes in every one.

Rerunning the scan with the `isApplicationClass` fix in place (still
before it had ever seen `0x20`/`0x51`) dropped total unmapped occurrences
from 762,744 to 343,542 and raised clean programs from 101,324 to 109,346
of 121,028 -- most of the difference was exactly the false class/method
hits the fix targeted. It also surfaced a new cleanest candidate: `0x60`,
7,041 occurrences, one single-unmapped-opcode sample
(`ADS.Relation.CriteriaUI.OnExecute`). Hand-walked, it sits right before
the terminating `;` of a `property` declaration inside an Application
Class -- and `ADSM.ADSCompareDiffObject.OnExecute` (21 unmapped opcodes,
19 of them this one) handed over a literal confirmation for free: one of
its properties is commented out with `rem`, and the comment's own real
text reads `rem property array of array of string RecKeyValueList
readonly;`. `0x60` is that property's optional `readonly` modifier --
present on all 19 properties of a class whose whole purpose is exposing
read-only diff data, absent on `OU_JET_PACK.Model.PageCol`'s plain,
mutable `property number ColSeq;` back in pass twenty-eight.

**Shipped**: `0x60` added to the `isApplicationClass`-gated dispatch
block alongside `property`/`instance`/`extends`, rendered as the keyword
`readonly`. `ADS.Relation.CriteriaUI.OnExecute` goes from 1 unmapped
opcode to 0; `ADSM.ADSCompareDiffObject.OnExecute` goes from 21 to 1 (the
one left, a lone `0x61` not immediately followed by `0x62`, is the
already-documented standalone-occurrence gap from pass twenty-eight,
unrelated to this fix). Corpus-wide: unaffected (100.00%/204 clean,
`0x60` doesn't occur in the corpus either).

The corrected scan (`db-scan.json`, not checked in -- reproducible via
`scripts/scan-db-opcodes.mjs`) is the natural next investigation queue:
its cleanest remaining samples are the next candidates once corroborated
the same way these three were.

## Pass forty: working the database tracker, top to bottom

`docs/unmapped-opcodes.md` was regenerated from a full rescan (0x60 now
shipped) and turned into a proper queue: every opcode still unmapped
anywhere in the database, sorted by each one's cleanest single sample --
`scripts/track-db-opcodes.mjs`, replacing the old corpus-only tracker
that had nothing left to track. Working it from the top:

**`0x48` generalizes past Operation.** Its cleanest sample, `ADDL_PAY_DATA.
EMPLID.RowInit` (3 unmapped), resolved to `MENUNAME.
MAINTAIN_PAYROLL_DATA_CANADA` -- a qualifier pass thirty-five's opcode
never handles, since it was gated specifically on `OPERATION`. The real
clincher was `ACA_NOTE_WRK.EMPLID.Workflow` (8 unmapped, tiny at 109
bytes): its real `TriggerBusinessEvent(BusProcess.
SEND_ACA_NOTIFICATION, BusActivity.SEND_ACA_NOTIFICATION,
BusEvent."Notify Employee")` resolves to `BUSEVENT.Notify Employee` -- a
name containing a literal space, so the quoted form isn't optional there
either, for the exact same structural reason Operation needed it.
`ACA_XML_WRK.ACA_UPDATE_PB.FieldChange`'s real `Transfer(True,
MenuName."ACA_SETUP_RPT", BarName."USE", ItemName."ACA_EMP_XMIT",
Page."ACA_EMP_XMIT_PART1", ...)` -- PeopleCode's well-known navigation
function -- rounds out MenuName/BarName/ItemName/Page, all quoted
uniformly. Shipped as a small qualifier-to-display-keyword table
(`QUOTED_REFERENCE_QUALIFIERS`) covering the 8 qualifiers now confirmed
(Operation, MenuName, BarName, ItemName, Page, BusProcess, BusActivity,
BusEvent); any other qualifier still falls through to unknown. All three
programs go from real unmapped opcodes to zero; a fourth,
`DERIVED_ABS_EA.SUBMIT_BTN.FieldChange` (tracker's `0x17` entry), turned
out to be a cascade off this same bug and resolved for free.

**`0x27`/`0x28` are `Repeat`/`Until`**, PeopleCode's third loop shape
(alongside `While` and `For`), found from the tracker's `0x28` entry
(`ADS_DMW.SelectBuilder.OnExecute`, 10 unmapped). Real source:

```
&start = 1;
Repeat
  &found = Find(",", &expression, &start);
  ...
  &start = &found + 1;
Until &found <= 0;
```

`0x27` always sits right after the statement before the loop and right
before its first body statement -- no condition of its own, so it's
formatted like `Try` (`TRY_STYLE`: newline before and after, increase
indent). `0x28` always sits right after the body's last `;` and right
before the exit condition (a bare comparison here; a parenthesised
expression, `Until (...)`, in a second confirmed case), which the real
trailing `;` already terminates, so it only needs `NEWLINE_BEFORE |
DECREASE_INDENT | SPACE_AFTER`. Confirmed on 2 independent occurrences in
`ADS_DMW.SelectBuilder.OnExecute` (10 → 6 unmapped -- the remaining 6 are
an unrelated, already-documented standalone-`0x61` gap) and a third in
`ADSM.CompareDataManager.OnExecute` (14 → 12, same unrelated gap).

**Shipped**: `QUOTED_REFERENCE_QUALIFIERS` and the rewritten `0x48`
dispatch; `0x27`/`0x28` added to `OPCODES`. Corpus-wide unaffected
(100.00%/204 clean -- none of these opcodes occur in the corpus, which is
why the database scan keeps finding what the corpus can't). Regenerating
the database scan and tracker afterward is the natural way to keep
working down the list.

Continuing down the same tracker:

**`0x77` is `#Else`**, the missing fourth member of the `#If`/`#Then`/
`#End-If` family (pass thirty-seven). Same length-prefixed-text shape,
same `readLengthPrefixedText` reuse, confirmed against
`AGC_PROCESS_AG.ActivityGuideCreation.OnExecute`'s real `#If #ToolsRel <
"8.58" #Then\n   %This.SetLanguages(&list);\n#Else\n   /* 8.58 and
greater... */\n   If Not &list.bCreateMLInstances Then\n
%This.SetLanguages(&list);\n   End-If;\n#End-If` -- the `< "8.58"`
branch lost, so `#Then` carries its dead body verbatim exactly like
before, while `#Else`'s own text is bare (its branch compiled normally,
real tokens follow). Formatted like `Else` (`NEWLINE_BEFORE |
DECREASE_INDENT | INCREASE_INDENT`), minus the real `Else`'s
`NEWLINE_AFTER` since real content (or an embedded dead-branch newline)
already supplies its own leading break, the same reasoning `0x76` used.
11 → 2 unmapped opcodes in the real program.

**`readTextRun` had the same non-ASCII bug `readLengthPrefixedText` was
fixed for in pass thirty-two, just never carried over.** This reader
backs string literals and bare identifiers (not comments), and its
byte-pair check required the high byte to be exactly `0x00` *and* the low
byte to fall in printable ASCII -- so any real character outside that
range failed the whole run, falling through to walking the character's
own bytes as a fresh opcode. Found from the tracker's `0xa3` entry
(`HCB_CORE_LIBRARIES.HCB_JsonBuilder.OnExecute`, a 162KB Application
Class): its real `&Emplid_CurrSymbol = "£"` is a one-character string
literal whose only character is U+00A3 -- the pound sign. `0xa3` was
never a real opcode at all, just that character's own low byte read as
one. Fixed the same way as the comment reader: accept any non-zero
UTF-16 code unit, terminate only on a real `0x0000` pair. 11 → 1 unmapped
opcodes in the real program.

**`0x48` also covers `Panel`/`PanelGroup`**, PeopleTools' pre-8.4x names
for `Page`/`Component` -- PSPCMNAME still stores programs compiled that
far back under the old names. Confirmed against `DERIVED_FP_CA.
FP_CA_BTTN2.FieldChange`'s real `DoModalPanelGroup(MenuName.
"HEADCOUNT_(FP)", BarName."MDX", ItemName."CALINKS", Panel.
"FP_AVLBL_CA", ...)`. The other three qualifiers in that same call had
already resolved via pass forty's earlier `0x48` generalization --
`Panel` was the program's only remaining unmapped opcode. 0 unmapped
opcodes in the real program.

**Shipped**: `0x77` added to the `#If`/`#Then`/`#End-If` dispatch and
`OPERAND_FORMAT`; `readTextRun` rewritten to drop the printable-ASCII
restriction; `Panel`/`PanelGroup` added to `QUOTED_REFERENCE_QUALIFIERS`.
Corpus-wide unaffected (100.00%/204 clean throughout). Four fixes, one
pass, all from working the same tracker top to bottom -- a reminder that
the database scan surfaces both new opcodes and old bugs in already-
shipped ones, not just the former.

Regenerating the scan afterward: clean programs 101,324 → 111,122 of
121,028, unmapped occurrences 762,744 → 238,452, since this pass started.
Still working the tracker top to bottom:

**A standalone `0x61`** (not immediately followed by `0x62`, which stays
`instance`) **is a class's `private` section header** -- a bare keyword
on its own line marking every method/property declaration after it as
private, until `end-class;`. Confirmed against `ADS.Relation.
SqlGenerator.OnExecute`'s real class block (`method GenerateSql()
Returns string;\n\nprivate\n   method GenerateSqlPerMapping() Returns
string;\n   method GenerateSqlPerCriteria() Returns string;\n
end-class;`), this program's only unmapped opcode.

**`0x72` is `implements`**, `extends`' sibling for interface
implementation (`class X implements Y` rather than `class X extends
Y`). Confirmed against `ACCOM_TYPE_FULLSYNC.AccomTypeFullsync.
OnExecute`'s real `class AccomTypeFullsync implements PS_PT:
Integration:INotificationHandler`, this program's only unmapped opcode,
sitting in exactly the position `0x5c` occupies for a real base class.

**A property getter's implementation header carries the same extra
`0x41` byte `method`'s does**, between the opcode and the accessor's
name -- `get` (`0x5f`) was a fixed `OPCODES` entry with no lookahead, so
it couldn't consume this the way `method` (`0x63`) already does. Found
from the `0x41`/`0x6a`/`0x5d` cluster all pointing at `ADS.Common.
OnExecute`: its real `get useFlowControl\n   /+ Returns Boolean +/\n\n
Return (GetUserOption(...) <> "Y");` (2/2 occurrences in that program)
needed the same lookahead-and-consume `method` already has. Moved `get`
into the same `isApplicationClass`-gated dispatch to gain it. 14 → 11
unmapped opcodes in the real program (the remaining `0x5d` cluster's
pattern didn't hold up under closer study -- see below).

**`0x5d` stays open.** It sits after some, not all, `string`-typed
parameters in a method's declaration, and the first pattern tried
("every non-first parameter typed `string`") was falsified by
`ValidateParentChild(&parentRecord As string, &childRecord As string,
&isChildRoot As boolean, ...)`, where the second parameter is a non-first
`string` with no marker. A same-type-as-immediately-preceding-parameter
theory fails the same way. Left unmapped rather than shipping a guess;
still in the tracker for a future pass with more samples.

**Shipped**: `0x61` (standalone) and `0x72` added to the
`isApplicationClass`-gated dispatch; `get` (`0x5f`) moved from a fixed
`OPCODES` entry into the same dispatch to gain the `0x41` lookahead.
Corpus-wide unaffected (100.00%/204 clean -- `0x61`(standalone)/`0x72`/
`get`+`0x41` don't occur in the corpus).

## Pass forty-one: two more, and a look at how much of the tracker is real

Asked to work through the ~180-entry tracker as fast as possible. Two
more confirmed and shipped:

**`0x70` is `interface`**, a class declaration's sibling for
`interface X ... end-interface;` (PeopleCode's other Application-Class-
like construct, used for defining a contract with no implementation).
Confirmed against `BN_CERTIFICATE.WeightCalculator.OnExecute`, whose own
doc comment says so directly (`* WEIGHTCALCULATOR - This interface is a
implementation of the Strategy pattern...`); `0x70` sits right before the
bare name with no `0x5a`/`0x5c` (`class`/`extends`) anywhere in the
program -- the first interface this project has seen. The program's
other two unmapped opcodes, `0x6f`/`0x71` right at the very end (where
`end-interface;` should be), didn't yield to the same confidence: only
one sample exists, and no theory tried explained why there would be
*two* separate opcode-plus-`;` pairs there rather than one. Left open.

**`0x33` is `Library`**, for `Declare Function X Library "dllname"
(...)`, PeopleCode's syntax for calling an external Windows DLL.
Confirmed against `APPS_RLR.Utilities.OnExecute`'s real `Declare Function
RegCloseKey Library "advapi32" (...)`. The rest of that same DLL-declare
grammar -- parameter passing mode, `0x36`, and whatever `0x3b`/a second
`0x41` context are -- stayed unclear from one 18-unmapped-opcode sample
and no ground truth; left open rather than guessed.

**Assessment of the remaining ~180**: this pass's investigation makes the
shape of what's left clearer. A meaningful fraction are not independently
addressable opcodes at all:

- **Cascade noise.** `0x0`/`0xc0` and similar high-count, high-total-
  unmapped entries are overwhelmingly downstream of some other unresolved
  byte earlier in the same program (the same phenomenon that inflated the
  very first, unjoined database scan by 500k+ false hits) -- fixing the
  root cause resolves them for free, the way `0x17`/`0xa3` already did
  this session, and no amount of staring at the cascade site itself
  reveals the root cause.
- **Single-sample, ambiguous constructs**, like `0x50`'s apparent
  negative-number-literal shape (one sample, a `Constant &UNSET_ANGLE =
  ...` whose decoded magnitude doesn't obviously mean anything) or the
  `0x36`/`0x3b` DLL-declare remainder above -- real, but not confirmable
  without either a second independent sample or a project-export source
  to diff against.
- **Rare constructs** like `interface`'s own closing shape, where the
  format genuinely differs from the common case and one sample isn't
  enough to be sure which of several plausible shapes is right.

None of this is deliberately incomplete: every candidate this pass
touched used the same rigor as every other opcode in this document,
including declining to ship the ones that didn't hold up (`0x5d`, pass
forty; `0x6f`/`0x71`/`0x36`/`0x3b`/`0x50` here). Getting through "all
180" at that same bar is not a fixed amount of work the way it might look
from the tracker's row count -- most of the count is cascade, a handful
are genuinely hard, and the tracker (regenerated after every fix) is the
right tool to keep separating the two.

**Shipped**: `0x70` and `0x33` added to `OPCODES`/the
`isApplicationClass`-gated dispatch. Corpus-wide unaffected (100.00%/204
clean -- neither opcode occurs in the corpus).

## Pass forty-two: an independent reference, a real bug it found, and the rest of the tracker

The user handed over two files from a separate, older decompiler project
(`PeopleCodeParser.java`/`PeopleCodeContainer.java`, targeting a PeopleTools
8.4x-era project) -- an independently written opcode table covering
essentially this whole format. Cross-checking it against every opcode
this project has confirmed the hard way agreed almost everywhere
(`Repeat`/`Until`, `Library`, `readonly`, `private`, `Exit`, `interface`,
`get`, the 37-byte header, `class`/`method`/`end-class`/`end-method`, and
more) -- strong, independent corroboration of the whole approach, not
just individual bytes. A couple of entries didn't match this project's
own numbering (their `0x51` = `PanelGroup`; this project's confirmed
`0x51` is unrelated) -- opcode assignment apparently isn't stable
release to release, so each entry still needed checking against real
bytes before shipping, not just copied over.

**First, `0x6a` (`end-get`)**, found independently before reading the
reference (which later confirmed it exactly): `get`'s own closing
keyword, the same shape as `end-method`. Confirmed against `ADS.Common.
OnExecute`'s real getter bodies -- each `Return (...);` immediately
followed by a bare `end-get;` and then the next getter's own doc comment,
3/3 occurrences. 11 → 8 unmapped opcodes in that program (the rest was
`0x5d`, below).

**A real bug in the header check, found chasing `0x2`/`0xe0` and a
cluster of "garbage from byte 0" programs.** `matchHeader` required three
specific header positions be zero, based on how the corpus looked; a
database-wide sample (60k programs) found each one zero in the
overwhelming majority (>99.4%) but not always. Requiring any of them be
zero rejects the header outright, which cascades the *entire* program
(not just one construct) into unrelated-looking unmapped noise --
confirmed on `G3UTILITIES.UtilityMethods.OnExecute` (position 22):
fixing this alone took a 128KB program from 28+ unmapped opcodes to 0
across the whole file. Dropped positions 7, 22 and 30 from
`HEADER_ZERO_POSITIONS`; three more real programs
(`G3UTILITIES.Constants.OnExecute`, `EOAW_CORE.Utils.OnExecute`, and
`G3UTILITIES.UtilityMethods.OnExecute` itself) went from unreadable to
0-1 unmapped opcodes each.

**A real bug in pass twenty-eight's own confirmed work, found because the
reference disagreed.** The reference lists `0x61` (`private`) and `0x62`
(`instance`) as two *independent* keywords; this project's pass
twenty-eight had fused "`0x61` immediately followed by `0x62`" into a
single `instance` token, on the reasoning that only the pair occurs in
that position. Checking the actual confirmed sample's real source
(`OU_LANDINGPAGE.LandingPage.OUBanner`) against the *literal* text --
not just whether the decoded text appears somewhere in it, which is all
the corpus checker verifies -- showed the real source is `private\n
instance OU_JET_PACK:Widgets:BaseWidget &objBase;`: two separate lines,
two separate keywords. The fusion silently dropped the `private`. This
is exactly the failure mode the project's own "confirmed" language is
supposed to rule out, and it shipped anyway, undetected for the length
of this whole session -- a reminder that the corpus checker's one-
directional verification (decoded text found in source) has a real
blind spot: it can't see something real that never got decoded at all.
Fixed by making `0x61`/`0x62` fully independent; `0x61`'s own standalone
confirmation (pass forty) already covered its half correctly, it was
never actually a special case. `0x62` alone confirmed separately against
`EOAW_CORE.Utils.OnExecute`'s real `instance array of string
&delegationProcesses;` (no `private` before it).

**The rest of the tracker's cleanest remaining entries, corroborated by
the same reference and confirmed against real bytes:**

- **`0x6f`/`0x71`** are `abstract` and `end-interface`, closing out
  `BN_CERTIFICATE.WeightCalculator.OnExecute`'s interface entirely (the
  program pass forty-one left at 2 unmapped opcodes) -- 0 unmapped now.
- **`0x49`/`0x6b`** are `set`/`end-set`, `get`/`end-get`'s setter
  siblings. Confirmed against `ADS.GVar4AdsDefnRet.OnExecute`'s real
  `property string PTADSADVSRCHIN get set;` -- an auto-implemented
  property, both accessors, no custom body, the whole thing one
  statement. Neither `get` nor `set` carries `INCREASE_INDENT_ONCE`
  unless it's genuinely an implementation header (the `0x41` lookahead
  already added for `get`, pass forty-one) -- applying it
  unconditionally to the bare shorthand form left every subsequent
  `property ... get set;` line in that same real program one level
  deeper than the last, all the way down a 16-property class. Caught by
  actually reading the render output, not just the unmapped-opcode
  count.
- **`0x5d` is a method parameter's `out` modifier.** This is the pattern
  pass forty investigated and explicitly left open (tried and rejected
  "every non-first string parameter" and "same type as the previous
  parameter," both falsified by real counter-examples) -- the real
  distinguisher was never the type at all. Confirmed against `ADS.Common.
  OnExecute`'s real `method ADSHasAbsentRecords(&adsName As string,
  &missingRecordsInProj As string out) Returns boolean;` -- a parameter
  named for carrying output, `out` is exactly what it should be. 8 → 0
  unmapped opcodes in that program (this and `end-get` together resolved
  it completely).
- **`0x36`/`0x3b` are `Value`/`Ref`**, a DLL-declared parameter's passing
  mode, and **`0x41` gained a third overloaded role**: zero-width right
  after a DLL declaration's `Library "dllname"` string, gated on the next
  byte being the newline opcode (`0x2d`) this time -- distinct from its
  existing And/Or and method-header gates. Confirmed together against
  `APPS_RLR.Utilities.OnExecute`'s real `Declare Function RegCloseKey
  Library "advapi32"\n      (long Value As number) Returns long;` -- the
  program pass forty-one left at 15 unmapped opcodes, now 0.

**Shipped**: `0x6a`/`0x6f`/`0x71`/`0x49`/`0x6b`/`0x5d` added to the
`isApplicationClass`-gated dispatch; `0x36`/`0x3b` added to `OPCODES`;
`0x41` gained its third gated role; `HEADER_ZERO_POSITIONS` dropped three
positions; `0x61`/`0x62` decoupled from their incorrect fused pairing.
Corpus-wide: 100.00%/204 clean throughout, text accuracy essentially
unchanged (86792/88027, a few tokens up from the `private` fix now
rendering real text that was previously silently dropped). This was the
single most productive pass of the whole database-scan effort -- eleven
opcodes fixed or added, one real regression in already-shipped code
caught and fixed, one indentation bug caught by reading render output
rather than trusting an unmapped-count number, from one independently
written reference file cross-checked against real bytes rather than
copied blind.

## Pass forty-four: re-reading the reference for what it says and this decoder doesn't

A mechanical diff of every byte value in the reference
`PeopleCodeParser.java` against everything `decoder.ts` handles today
(fixed `OPCODES` entries, gated dispatch, text introducers) rather than
another pass down the database tracker. Most of the table now agrees
either way. Four rows disagreed or were missing, and only two of them
survived checking.

**`0x20` is `Warning`, not a zero-width marker.** Pass thirty-nine
derived its shape correctly -- always directly after a statement
boundary (`;` or `Then`), always directly before a real `(` opening a
bare function call whose result is discarded, `(MsgGet(6540, 127,
"..."));` -- and then read that as a "this statement is just an
expression" marker, since the samples are delivered base objects with no
project-export source to diff the missing word against. The reference
names byte 32 outright, and once named the shape is unmistakable: that
is `Warning (MsgGet(...));`, the commonest form the keyword takes, and
`Error` (0x1b, already confirmed, identical shape, identical format)
with a different word. Rendering it as nothing silently dropped the
keyword, turning a warning into an unconditional bare call -- the exact
"decodes to something that compiles and means something else" failure
this decoder exists to refuse, and the same blind spot pass forty-two's
`private` fusion fell into: the corpus checker verifies decoded text
appears in the source, so it cannot see a real word that never got
decoded at all.

**`0x00` is a bare identifier with no introducer.** The reference maps
byte 0 to an identifier parser that backs up two bytes and reads the
null-terminated run it has just walked into -- i.e. an identifier can
sit in the stream with no introducer byte at all, not even the `0x0a`
one pass thirty-one confirmed. `0x00` is the single largest bucket in
`docs/unmapped-opcodes.md` (8968 occurrences). Implemented one byte
earlier than the reference does, looking forward instead of back (the
run's own first character never becomes a bogus token of its own, and
strict mode sees the same stream auto mode does), and deliberately
narrower: it only runs where a gap was about to be reported anyway, so
no program that decodes cleanly today can change, and the run has to
match the identifier alphabet rather than merely being null-terminated,
since arbitrary binary is null-terminated too. An identifier whose first
character collides with a mapped opcode (`e` is `0x65`, `try`) is still
missed; recovering those needs real grammar, not a lookahead.

**Rejected: `0x52`/`0x53`/`0x6c`.** The reference has `Doc` for `0x53`
and zero-width for the other two, and this decoder maps none of them.
Every occurrence in the database tracker sits in programs with ~2400
unmapped opcodes -- cascade noise downstream of some earlier missed
boundary, not evidence of the byte's own meaning. Left unmapped.

**Rejected: `0x51` = `PanelGroup`.** Already noted in pass forty-two as
a numbering disagreement; pass thirty-nine's `0x51` is text-diffed
against `AE_WRK.AE_BIND_VALUE.FieldEdit`'s real source, so it stands.

**Shipped**: `0x20` remapped to `Warning`; the `0x00` bare-identifier
recovery. No corpus rerun was possible here (no database access in this
environment); the unit suite covers both, including the two shapes the
recovery must keep refusing.

## Then: writes

4. **Record save** — `PSRECDEFN`/`PSRECFIELD` rewrite with version counters, in
   one transaction. Makes the record editor editable.
5. **DDL generation and build** — `PSRECTBLSPC`, `PSIDXDEFN`, `PSKEYDEFN`;
   create/alter scripts matching App Designer's build output.
6. **PeopleCode encoder** — only once the decoder round-trips completely.

## Then: language intelligence

7. Language server: diagnostics, go-to-definition across record PeopleCode and
   application classes, completion for record fields and class members, and
   references.
8. Compile against the environment so errors match what PeopleTools reports.

## Then: the remaining definition types

9. App Engine programs — section/step/action tree, a text-first editor
10. Components and menus — structured editors
11. Component interfaces, file layouts, application packages
12. **Page designer** — the largest single item. `PSPNLFIELD` holds absolute and
    flow layout; a faithful editor is a project of its own, and a read-only
    layout preview should come first.

## Then: lifecycle

13. Insert into project, project compare and copy between environments
14. Definition compare with the existing diff editor
15. Migration: project copy to file and database

## Not planned

- Anything requiring App Designer's undocumented binary project formats beyond
  XML export
- Replacing Data Mover
