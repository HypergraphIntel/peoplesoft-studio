# File Layouts

PeopleSoft Studio opens a File Layout in the **File Layout window**, App
Designer's File Layout definition: the layout tree (the layout, its segments,
their fields), its three property dialogs as a side panel, the Insert menu
(Record, Segment, Child Segment, File Field), Delete, move up / down, Save,
Save As, Rename and Delete. *PeopleSoft: New File Layout* (or New Definition >
File Layout) starts one. The MCP tools `psft_file_layout_*` make the same edits.

Everything below was established by capturing App Designer's own saves on
HRDMO (PeopleTools 8.62.09) -- `tools/corpus/save-protocol/results/fl01` to
`fl15` -- and is replayed by `src/test/fileLayoutWriter.test.ts`.
`tools/lab/file-layout-e2e.mts` rebuilds App Designer's two lab layouts through
the writer and compares every column; App Designer then opened a writer-made
layout and saved it, changing only what was edited (`nfl01`).

## Tables and counters

| Table | Holds |
|---|---|
| `PSFLDDEFN` | the layout: format, CSV options, XML buffer, description, comments; `FLDSEGCOUNT` = top-level segments |
| `PSFLDSEGDEFN` | a segment: parent (`FLDSEGPARENT`, blank at the top), `FLDSEQNO` among its siblings, record ID, qualifier, delimiter, `FLDSEGCOUNT` = child segments, `FLDFIELDCOUNT` = fields |
| `PSFLDFIELDDEFN` | a field: `FLDSEQNO` within its segment, start, length, type, decimals, qualifier, date format / separator, strip characters, default, flags |
| `PSFLDDEL` | (name, version) of a deleted or renamed-away layout |

The counts and sequences are derived; they hold on all 533 layouts on HRDMO.

Every save: `PSVERSION` and `PSLOCK` FLM + 1, `PSVERSION` SYS + 1, and
`PSFLDDEFN.VERSION` = the new FLM, `LASTUPDDTTM` / `LASTUPDOPRID` stamped.
Rename also moves PJM. Project items are `OBJECTTYPE` 31, `OBJECTID1` 71.

## What each action writes

| Action | Capture | Rows |
|---|---|---|
| File > New, Insert > Record, Save | fl01, fl07 | FIXED layout, all options off; one segment named and tagged as the record, ID Seq No 0, Max Rec Length = last position; each record field (PSRECFIELDDB order) at consecutive starts from 1, PSDBFIELD type / length / decimals (Time and Datetime +5), date format `MMDDYYYY` separator `/`, qualifier = the layout's |
| Format CSV | fl02 | `FLDFORMAT` 1; definition qualifier `"` and delimiter `,` |
| CSV options | fl03 | Qualifier Optional `FLDQUALIFIEROPT`, Convert Tabs `FLDCONVERTTABS`, Interpret Backslash `FLDINTRPBACKSLASH`, Strip White Space `FLDSTRIPSPACE`, Backslash Quote `FLDEMBQUOTEFMT` 1 |
| Segment properties | fl04 | record ID `FLDSEGID` (start 1), ID length; Default Qualifier copied to every field; Field Delimiter Other = type 4 with its character; ID Seq No stored 1. "Increment start positions for all fields? (116,14)" Yes adds the ID length to every start. Max Rec Length is not recomputed |
| Field properties | fl05, fl08 | as entered; OK writes strip characters with a `~` terminator (blank becomes `~`) and clears the date separator unless the field is a date, time or datetime. A FIXED length change moves no other field (overlaps are saved) |
| Propagate `>>>` n | fl09 | this field's start and every later field's + n |
| Insert Segment / ChildSegment / FileField | fl06 | empty segment: ID Seq No 1, Max Rec Length 0, the layout's qualifier, Comma; a file field: Character unless chosen, after the segment's last position |
| Delete field (40,6) | fl10 | the row; later sequences close up; starts unchanged |
| Move field | fl11 | the two `FLDSEQNO`s swap; starts unchanged |
| Save As | fl12 | every row copied under the new name |
| Rename (78,6: closes open objects) | fl13 | rows re-keyed, layout restamped; `PSFLDDEL` (old name, new FLM); FLM, PJM, SYS + 1 |
| Delete | fl14 | rows deleted; `PSFLDDEL` (name, new FLM); FLM, SYS + 1 |
| Format XML, buffer | fl15 | `FLDFORMAT` 2, delimiter `,`, `FLDXMLBUFFSIZE` |

Not captured, decided by analogy and marked in the code: Rename repointing
project items (as App Designer does for message channels, chn17); a recreated
name's `PSFLDDEL` removed (as for menus and component interfaces); a FIXED file
field's default start; switching back to FIXED (leaves the qualifier and
delimiter as stored); Semicolon / Tab / Space delimiter codes 1-3 (the list's
order). File Layout PeopleCode is not authored here.

## Saving

Oracle connections set to Writable with an Operator ID, for names in the write
scope. The writer locks the layout, refuses a stale token, writes only the rows
that differ, re-reads them and proves them (rows, VERSION, counters) before
COMMIT, then checks again after. MCP writes ask for confirmation as other
legacy writers do; File Layouts have no Change Review adapter.
