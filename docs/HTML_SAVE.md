# Saving an HTML definition

How App Designer stores an HTML definition, decoded from controlled saves on
HRDMO (PeopleTools 8.62.09), and what `src/providers/htmlWriter.ts` writes.
Snapshots: `tools/corpus/save-protocol/results/h*` (App Designer) and `x08`,
`x09` (the writer).

## Storage

An HTML definition is a `PSCONTDEFN` row with `CONTTYPE` 4 and its text in
`PSCONTENT`. All 3,142 on HRDMO have one row, `ALTCONTNUM` 1, `CONTFMT`
blank, `CONTSTYLE` 0, `COMPALG` 0 (uncompressed), `AUXFLAGMASK` 0, and no
`PSCONTDEFNLANG` / `PSCONTENTLANG` rows. `PSCONTDEFN` has a short `DESCR`
only: App Designer offers no long description for HTML.

`PSCONTENT.CONTDATA` is UTF-16LE without a byte-order mark, in rows from
`SEQNUM` 0. Every row but the last is 32,000 bytes (674 of 674). Multi-line
text is CRLF (2,503 of 2,503; none bare LF). 2,331 texts end in one NUL
terminator, never elsewhere, and App Designer 8.62 wrote one (h01-h03); the
reader drops it.

## Cases

| Case | Change | What App Designer wrote |
|---|---|---|
| h01-h03 | ZZ_PCODE_LAB_HTML created, its second line changed, its description and owner set (net, 08:24-08:49) | `PSCONTDEFN` and `PSCONTENT` (one 114-byte row, CRLF, NUL-terminated); `VERSION` 5 = PSVERSION CRM; CRM and SYS + 3, PSLOCK CRM + 3 |
| h03 | description "Lab HTML Obj", owner HTAC (08:48:51) | `PSCONTDEFN` and `PSCONTENT` deleted and reinserted, `VERSION` = new CRM, restamped; CRM, SYS, PSLOCK CRM + 1. A PDM update to its own value moved nothing |
| h04 | 43,955 characters pasted (09:02:49) | `PSCONTENT` SEQNUM 0-2 of 32,000, 32,000 and 23,912 bytes; the same `PSCONTDEFN` and counter moves. `htmlChunks` of the same text is byte-identical |

The flashback window had passed for the create and the first edit, so
those are known net (h01-h03) and from h03's before-image (`VERSION` 4,
`DESCR` and `OBJECTOWNERID` blank).

## The writer

`saveHtmlDefinition` creates (no opened version) or saves (the version it
was opened at) an HTML definition:

- create: `PSCONTDEFN` inserted with the h01 defaults (blank `DESCR`,
  `URL`, `CONTFMT`, `OBJECTOWNERID`; zeros), `VERSION` = new CRM
- save: `PSCONTDEFN` `VERSION` and stamp updated in place (App Designer
  deletes and reinserts it unchanged otherwise); `PSCONTENT` rows replaced
- PSVERSION CRM, SYS + 1; PSLOCK CRM + 1; verified in the transaction and
  again after COMMIT

Direct cases x08 (create) and x09 (edit) on ZZ_PCODE_LAB_HTM2 wrote the
native rows and counters; the text is byte-identical to App Designer's,
and so are the three chunks h04 stored.

Refused: names outside `peoplesoft.writeNamePrefix` when it is set, an existing name on create, a
definition with other content types, alternates or language rows, text with
a NUL, and text whose terminator would fall exactly at a 16,000-character
chunk boundary (no stored example shows how App Designer cuts it).

In VS Code: HTML Definitions are a type in the Open Definition dialog;
*PeopleSoft: New HTML Definition...* opens an empty editor that the first
save creates; an HTML definition opened from a Writable
connection saves with Ctrl+S. *Change Description...* (right-click it in a
tree, or its editor tab) saves a new description with the stored text, as
h03 did: direct case x18 (ZZ_PCODE_LAB_HTM2) wrote h03's change.
