# Message Channels

How a message channel is stored and how App Designer's Message Channel
window saves it, PeopleTools 8.62.09 on HRDMO. Every rule below was proven by
a controlled App Designer save driven on the lab VM and bracketed by before /
after reads (`tools/lab/def-capture.mts ... chnl`, or the full sweep
`tools/corpus/save-protocol/snapshot.ts` for creates, renames, deletes and
project inserts); the case is in brackets, its rows in
`tools/corpus/save-protocol/results/<case>`. The Message Channel window
(`src/editors/channelDesignerPanel.ts`), the MCP's `psft_channel_*` tools and
the writer (`src/providers/channelWriter.ts`) implement them.

Message channels are Integration Broker's pre-8.48 grouping of messages
(queues replaced them online); App Designer 8.62 still opens, creates and
saves them. HRDMO delivers none: only the lab's channels exist there, though
458 delivered messages still name one in PSMSGDEFN.CHNLNAME.

## Tables

| Table | Key | Holds |
|---|---|---|
| PSCHNLDEFN | CHNLNAME | The channel: VERSION (= PSVERSION CHDM at its last save), CHNLSTATUS, PUBTIMEOUTMIN, SUBTIMEOUTMIN, PUBRETRYSEC, SUBRETRYSEC, ERRORTHRESHOLD, APMSGARCHIVE, THRUPUTTYPE, QUALITYOFSERVICE, CHNLDISPLAYNAME (always the name), DESCR, OBJECTOWNERID, LASTUPDDTTM / OPRID, DESCRLONG (Comments, CLOB; NULL when empty) |
| PSSUBCHNL | CHNLNAME, FIELDNAME | One row per field the channel is partitioned by (no order) |
| PSCHNLDEL | CHNLNAME, VERSION | Delete marker at the new CHDM [chn08]; a rename writes none [chn07, chn17] |
| PSCHNLDEFNLANG, PSCHNLNODE | + LANGUAGE_CD / MSGNODENAME | Translations and nodes (none on HRDMO): kept, re-keyed by a rename, deleted with the channel |
| PSMSGDEFN | MSGNAME | A message names its channel in CHNLNAME; App Designer 8.62's message window does not set it |

Counters: every save moves CHDM and SYS by one, PSLOCK CHDM set to the new
value; the row's VERSION is the new CHDM [chn00-chn15].

## App Designer's new channel

File > New > Message Channel, saved without opening its properties [chn00]:

| Column | Value |
|---|---|
| CHNLSTATUS | 0 (shown as Run) |
| PUBTIMEOUTMIN, SUBTIMEOUTMIN | 14400 |
| PUBRETRYSEC, SUBRETRYSEC | 300 |
| ERRORTHRESHOLD | 100 |
| APMSGARCHIVE | 1 |
| THRUPUTTYPE | 0 (shown as ordered) |
| QUALITYOFSERVICE | 1 |
| DESCR, OBJECTOWNERID | blank; DESCRLONG NULL |

The timeouts, retries, error threshold and quality of service are not in the
window; they are kept as stored.

## Message Channel Properties

- **General**: Description = DESCR, Comments = DESCRLONG, Owner ID =
  OBJECTOWNERID [chn02].
- **Use**: Message Channel Status Run = CHNLSTATUS 1, Pause = 2 [chn03,
  chn04]; Archive Messages? = APMSGARCHIVE 1 / 0 [chn03, chn11]; Unordered?
  = THRUPUTTYPE 1, off = 2 [chn03, chn04].
- **OK normalizes**: any OK of the dialog, changed or not, writes a status of
  0 as 1 and a throughput of 0 as 2 [chn09]; so does giving a new channel's
  properties before its first save [chn10].

## The Messages tab

- **Messages**: the PSMSGDEFN rows whose CHNLNAME is the channel, by name;
  read-only. Opening the channel validates each one's records in the Validate
  output ("Begin validation of record definitions for default version of
  message ...").
- **Use These Fields to Partition** lists, in this order:
  1. the fields of the level-0 records (PRNTRECNAME `--`) of each message's
     default version -- the only version when DEFAULTVER is blank -- in record
     field order, Long fields left out (ZZ_PCODE_LAB_R6 listed without its L1
     and L2), and only the fields **every** message shares (two messages with
     no field in common list none);
  2. then MSGNAME, MSGNAMEDETAIL, PUBLISHER and PUBPROC;
  3. nothing at all when no message names the channel.

  A field is checked when the channel has its PSSUBCHNL row.
- **Add Partition Field** (the list's context menu): a field name, uppercased;
  a name not in PSDBFIELD is refused with "Invalid object name for this
  object type. (78,1)", the box cleared and the dialog left open. A new name
  is appended checked; one already listed is checked again, not added twice
  [chn12, chn14]. Unchecking removes the row at the save [chn13].
- **Dropped on open**: PSSUBCHNL rows the list does not offer are not shown,
  so the next save deletes them -- a channel without messages loses the
  fields added to it once it is reopened and saved [chn15]. The window and
  `psft_channel_get` report such fields as dropped before that save.

Two things are inferred, not captured (no lab message has them): Image and
ImageReference fields are left out of the list as Long fields are, and a
message with several level-0 records contributes all their fields in turn.

## Save As, Rename, Delete

- **Save As** [chn06]: the channel under the new name -- properties, the
  checked partition fields -- at the new CHDM, CHNLDISPLAYNAME the new name.
- **Rename** [chn07, chn17]: App Designer first closes every open definition
  (78,6). PSCHNLDEFN re-keyed in place with CHNLDISPLAYNAME, VERSION the new
  CHDM and the stamp; PSSUBCHNL (and language / node rows) re-keyed; every
  message naming it repointed, its VERSION the new MSDM, unstamped; its
  project items (PSPROJECTITEM 36 / OBJECTID1 61) repointed and their
  projects' VERSION the new PJM, unstamped. CHDM, MSDM, PJM and SYS each + 1,
  with references or without. No PSCHNLDEL.
- **Delete** [chn08]: the channel's rows; PSCHNLDEL at the new CHDM; CHDM and
  SYS + 1. Messages naming it and project items keep the name. Creating the
  name again removes the marker (as menus and Component Interfaces do).

## Projects

Insert into Project (F7) offers the channel's Messages as related
definitions and writes PSPROJECTITEM OBJECTTYPE 36, OBJECTID1 61 =
CHNLNAME, NODETYPE 0, SOURCESTATUS / TARGETSTATUS 0, UPGRADEACTION 0,
TAKEACTION 1, COPYDONE 0; PJM + 1 [chn16].

## Proof

- `src/test/channelWriter.test.ts` replays every captured save as the
  window's own operations on the channel as it was (chn00-chn06, chn09-chn15,
  and nchn01 -- App Designer editing a channel this writer made) and the plan
  must write App Designer's rows and move its counters; Delete and Rename are
  planned against the sweeps chn07, chn08 and chn17.
- `tools/lab/channel-e2e.mts` runs the window's and the MCP's path on a live
  database: defaults, a spec, a staged message's field list, edits, a stale
  token refused, a project item, Save As, Rename with a message and a project
  item repointed, Delete and recreate (25 checks).
- App Designer opened the writer's channel ZZ_CHNL_E2E4 and showed what the
  writer reads -- the message, the fifteen fields in order, two checked, Run,
  Archive and Unordered off -- then edited and saved it [nchn01].
