# PSPCMPROG header and complete simple-program generation

## Resolved layout

Read-only measurements on 2026-09-22 established this layout for the observed
`0xa0` format. All offsets are zero-based. Counts and lengths are little-endian
32-bit values. Unassigned words are kept separate: their meaning is unknown,
and the layout reader rejects nonzero values rather than interpreting them.

| Offset | Bytes | Meaning |
| --- | --- | --- |
| 0 | 1 | `0xa0` marker |
| 1 | 4 | Unassigned; zero in the checked samples |
| 5 | 4 | Statement-section byte length, **including its final `0x07`** |
| 9 | 4 | Unassigned; zero in the checked samples |
| 13 | 4 | Name-directory byte length, including UTF-16LE terminators |
| 17 | 4 | Unassigned; zero in the checked samples |
| 21 | 4 | Dispatch-slot count; each slot occupies 4 bytes |
| 25 | 4 | Unassigned; zero in the checked samples |
| 29 | 4 | Directory-record count; each record occupies 16 bytes |
| 33 | 4 | Observed format word `0x85` (also `0x84` in prior decoder evidence) |
| 37 | variable | Statement section, name run, directory records, then dispatch slots |

Thus:

```text
PROGLEN = 37 + statementBytes + nameBytes + 16 * recordCount + 4 * slotCount
nameStart   = 37 + statementBytes
recordStart = nameStart + nameBytes
slotStart   = recordStart + 16 * recordCount
```

The field at 5 is not total PROGLEN and is not a guessed source-character
count. The field at 13 counts **bytes**, not UTF-16 characters. The field at
29 counts all directory records, including class self/member records, not
just the declarations exposed by the decoder. The field at 21 includes slots
for declarations the decoder may not expose.

The final statement-section byte is `0x07`. It separates statements from the
name directory; it is not a general end-of-program opcode. It also appears
elsewhere in the statement grammar. The preceding `0x2d` is optional. This
explains why the existing decoder needed relaxed trailer detection and why
its reported `trailerOffset` can precede the actual separator by one byte.
Header-derived section boundaries do not depend on those heuristics.

## Evidence

- Rebuilt the 204-program source/export-paired corpus with
  `scripts/corpus-build.mjs`, using the configured database read-only.
  **204/204** fit the total-length equation and final separator position.
  Independent walking of every name run ended at exactly the header-derived
  record boundary; every record's name-character offset pointed to a real
  name start. This includes Application Classes and their member records.
- Read **1,000 smallest programs** with PROGLEN 38–180 (ordered by PROGLEN,
  capped at 1,000). Every complete buffer passed the section audit.
- Read only first headers and PROGLEN for **5,000 largest programs**:
  **5,000/5,000** fit the equation; all four unassigned words were zero.
  Their sizes ranged from **15,254 to 659,785 bytes**. All had format `0x85`.
  This sample checks header arithmetic, not full section contents.
- Small samples supplied independent complete bytes for empty source,
  `;`, and `Return;`. Source labels use already established opcode meanings;
  these labels are not a new App Designer source export.

| Real object | PROGLEN | Statement length | Statement bytes |
| --- | ---: | ---: | --- |
| PA_RT_EMP_FORM.FORM_LONG_NAME.FieldChange | 38 | 1 | `07` |
| PSUSRPRFL_WRK.PREVIOUS_CHUNK.RowInit | 39 | 2 | `15 07` |
| EOP_PUBLISHF.DUMMY.GBL.default.1900-01-01.Step05.OnExecute | 40 | 3 | `38 15 07` |

Their remaining size/count fields are all zero, with format `0x85`.
Tests regenerate these complete programs from source, rather than copying a
saved header. Their captured bytes and object provenance are in
`src/test/fixtures/compiledPeopleCode.ts`.

A metadata-bearing fixture, WEBLIB_CAF.FUNCLIB.FieldFormula, independently
anchors every section: 193 bytes = 37 + 112 statement bytes + 24 name bytes +
16 directory bytes + 4 slot bytes. The directory name is `iScript_RPC`.

Reproduce the full-buffer audit after `npm test` (which emits dist-test):

```sh
node scripts/corpus-build.mjs /tmp/peoplesoft-header-corpus.json
node scripts/corpus-header.mjs /tmp/peoplesoft-header-corpus.json
```

The broader read-only header query used was:

```sql
SELECT PROGLEN, DBMS_LOB.SUBSTR(PROGTXT, 37, 1) AS HEADER
FROM SYSADM.PSPCMPROG
WHERE PROGSEQ = 0
ORDER BY PROGLEN DESC
FETCH FIRST 5000 ROWS ONLY
```

No live programs were compiled, edited, saved or executed during this work.
These are samples from the configured environment, not a claim that every
PeopleTools version uses the same layout.

## Implementation and remaining boundaries

`programLayout.ts:readProgramLayout` returns statement/name/record/slot
sections and counts, validating exact total length and separator position.
It rejects truncation, excess bytes, odd name-byte lengths, unknown format
words and nonzero unassigned fields. It does not validate every section's
semantics; the offline audit additionally checks name framing and references.
`ProgramImage` can still preserve layouts this reader rejects.

`encoder.ts:encodeProgram(source)` now returns complete bytes for the existing
small source grammar. It creates the established simple header, appends the
encoded statements and `0x07`, and uses empty name/directory/slot sections.
No PSPCMNAME references are generated. Generation is capped at a 24-bit
statement length to remain compatible with the legacy decoder header matcher;
the layout reader accepts full uint32 lengths. The decoder module re-exports this
API for callers of its former encoder placeholder.

```ts
const bytes = encodeProgram('Return;'); // 40 bytes, matches captured PeopleSoft bytes
const result = decodeProgram(bytes, new NameTable(), { mode: 'strict' });
```

Generation chooses the observed `0x85` simple-program profile; it does not
claim that `0x84` and `0x85` are interchangeable. Unassigned zero words remain
unassigned; zero is evidence-backed for this profile. Programs with
functions, declarations or classes still need metadata writers; merely
setting their header counts would not make their contents valid.

The header is no longer a blocker for complete simple-program generation.
Runtime acceptance and execution equivalence in PeopleTools have not been
tested. The database provider therefore continues to refuse PeopleCode saves.
Future work can now target directory/dispatch generation and controlled
PeopleTools validation without first reverse-engineering section boundaries.

## Verification results

`npm run verify` passed (typecheck, bundle, all test files, activation smoke).
The new layout/encoder tests include byte-exact regeneration of all three
minimal real programs, a real nonempty directory, Unicode byte lengths,
trailer-like bytes inside strings, and malformed/unsupported header rejection.
The new header audit passed 204/204 corpus programs and 1,000/1,000 small
programs. The existing decoder corpus check reports 204/204 clean programs,
100% byte coverage, and 98.60% source-token matches. Comparing complete
`DecodeResult` objects against the original HEAD decoder on the same corpus
found **zero differences**; source-token mismatches were already present.
