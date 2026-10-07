# PeopleCode write-back: design proposal

**Status:** implemented for a first scope (Cycle 185). The protocol it
reproduces, and the evidence that it matches App Designer, are in
docs/CONTROLLED_COMPILE_LAB.md, Cycle 185.

- **Native, no App Designer in the save path.**
  `src/providers/peopleCodeWriter.ts` performs the save transaction, from
  rows derived by `src/peoplecode/writeback/savePlan.ts`.
- **Gates** (each refuses, never approximates):
  - a Writable connection with a PeopleSoft Operator ID that exists in
    PSOPRDEFN, checked when set, when Writable is turned on, and in every
    save;
  - ZZ_PCODE_LAB definitions only, checked before any lock;
  - Record Field PeopleCode and Application Class programs that already
    exist;
  - PSPCMNAME is the compiler's references, serialized; PACKAGE and
    Declare Function rows' descriptive columns are mapped from them
    (confirmed by App Designer re-saves, Cycle 185 n03 / f02);
  - the stored program re-encodes exactly and holds only observed column
    values;
  - the edit compiles and decodes back to itself;
  - the concurrency token taken at open is unchanged;
  - the written rows verify column for column before COMMIT and again
    after.
- **Timestamp and operator:** LASTUPDDTTM is one database timestamp per
  save; LASTUPDOPRID is the connection's configured operator.
- **Save mode:** Compile and save is what App Designer does. Save only is
  refused, since App Designer never stores uncompiled source (case 10).
- **Save reports:** each save keeps a report of the rows it replaced in the
  extension's global storage (`peoplecode-saves/`).

The sections below are the original proposal, kept for its reasoning.

This proposes how PeopleSoft Studio could save PeopleCode back to a
database. Saving would be controlled per connection by two options the
Settings panel would expose:

- **PeopleCode access:** Read-only (the default) or Writable.
- **Save mode:**
  - **Save only** writes the source text (`PSPCMTXT`).
  - **Compile and save** writes the source text and the compiled program
    (`PSPCMPROG` and `PSPCMNAME`).

## 1. Where things stand

**Implemented**

- **Reads are complete.** The editor decodes `PSPCMPROG` and `PSPCMNAME`
  (src/providers/oracle.ts).
- **The encoder is strong on existing programs.**
  - It reproduces stored `PSPCMPROG` byte for byte for 30,134 of 30,209
    HCDEV programs; the other 75 are explained, none actionable.
  - It matches a fresh PeopleTools 8.62.09 compile for 30,067 / 30,067
    (.claude/corpus-progress.md, Cycle 183-184).
  - That evidence covers source that already compiled in PeopleTools. It
    does not prove the encoder is correct for arbitrary new edits.
- **Writes are deliberately narrow** (docs/ARCHITECTURE.md, "Writes are
  narrow on purpose"):
  - SQL definitions are the only text that saves.
  - They use `bumpVersion`, which increments `PSVERSION` and `PSLOCK` for
    the object type and `SYS` in the same transaction.
  - `OracleProvider.writeText` refuses PeopleCode, so the file system
    marks those documents read-only.

**Rules already recorded in this repository**

These constrain the design:

1. **"PSPCMPROG is never fabricated."** (docs/CONTROLLED_COMPILE_LAB.md)
2. **Direct SQL on the PeopleCode source tables is "a last-resort
   diagnostic only. It is not assumed equivalent to App Designer
   persistence."** (same doc)
3. **The Cycle 178 incident** (src/peoplecode/corpus/labSafety.ts):
   - An App Designer project import wrote PeopleCode under an identity
     embedded in the imported data, not under the project's keys.
   - It overwrote the delivered `APPS_RLR:Utilities` program.
   - Any write path must prove the identity it writes before it writes.

Compile and save by direct SQL would write encoder output into
`PSPCMPROG`, which breaks rule 1. **Adopting it needs an explicit decision
to revise that rule for product saves**, gated as described in section 5.
Section 3 describes the alternative that keeps the rule.

## 2. What each save mode means

| | Save only | Compile and save |
|---|---|---|
| `PSPCMTXT` (source) | rewritten | rewritten |
| `PSPCMPROG` (compiled bytes) | untouched | rewritten |
| `PSPCMNAME` (reference table) | untouched | rewritten |
| Version counters | bumped (type to confirm, Phase 0) | bumped |
| What the application server runs afterwards | **the old program** | the new program |
| What App Designer shows | the new source | the new source |

**Save only** leaves the source ahead of the compiled program until
something compiles it, either App Designer or a later Compile and save.

- It cannot change runtime behaviour, so it is the lower-risk mode.
- It does create a divergence that must be visible:
  - the editor and status bar show "Source saved, not compiled";
  - the Settings card shows the mode.
- Whether App Designer displays `PSPCMTXT` or decodes `PSPCMPROG`, and
  what it does when they disagree, is a Phase 0 question.

**Compile and save** changes what runs. It is only allowed when every
gate in section 5 passes.

## 3. Two ways to perform a save

### Option A: direct SQL with the encoder

The extension writes the rows itself, in one transaction, the way the SQL
definition save already works.

- **For:**
  - Fast; a save is one round trip.
  - Needs no PeopleTools client.
  - Works from Linux and macOS.
  - Uses machinery that already exists (encoder, compiler profiles,
    `bumpVersion`).
- **Against:**
  - It fabricates `PSPCMPROG` (rule 1).
  - It must reproduce everything App Designer writes, including
    `PSPCMTXT.HASH_SIGNATURE` and any other tables touched. That is
    unknown until Phase 0.

### Option B: App Designer-mediated

The extension produces a project file holding the new source and has the
real PeopleTools client import it and compile it (`pside -PJFF`, then
`-CMPPRJPC`). This is the path the controlled-compile lab harness already
drives.

- **For:**
  - PeopleTools itself writes every row, so rules 1 and 2 hold.
  - The compiler is authoritative.
- **Against:**
  - It needs a PeopleTools Windows client (native or the Wine harness)
    and a signon, so it is slow (process start, import, compile).
  - The harness's end-to-end compile is still unverified
    (CONTROLLED_COMPILE_LAB.md, Status).
  - Imports are exactly how Cycle 178 overwrote a delivered program, so
    the identity interlocks in labSafety.ts would have to generalize
    beyond the scratch namespace.

**Recommendation:**

- Build **Save only by direct SQL** first, once Phase 0 settles
  `PSPCMTXT`. It does not touch `PSPCMPROG`, so rule 1 stands.
- Implement **Compile and save by Option A** behind the gates in section
  5, as an explicit revision of rule 1 for product saves.
- Keep Option B as the reference that Phase 1 compares against.

If you would rather never fabricate `PSPCMPROG`, Compile and save becomes
Option B only, and is unavailable without a PeopleTools client.

## 4. Settings model

**Implemented** (decision 4 below, answered: writes are enabled per
connection; only the HRDMO connection will be made writable). The settings
and their Settings-panel controls exist; nothing reads them yet, because no
save path exists.

The options are stored on the connection, beside its decoder, in
`peoplesoft.connections[]`:

```jsonc
{
  "name": "HCDEV",
  "kind": "oracle",
  "connectString": "...",
  "user": "...",
  "decoder": "auto",
  "peoplecodeAccess": "read-only",   // "read-only" (default) | "writable"
  "peoplecodeSaveMode": "save-only"  // "save-only" (default) | "compile-and-save"
}
```

**Defaults:**

- Read-only, so existing connections are unchanged.
- Save only, the mode that cannot change runtime behaviour.

**Switching a connection to Writable:**

- happens in its Settings card;
- asks for confirmation in a modal dialog naming the database and access
  id;
- then shows the connection as **Writable** in red, in the card and in
  the status bar;
- applies immediately: open editors are re-evaluated, with no reconnect.

**Project exports** are not database connections, so they show neither
option.

**Enforcement** stays where it is today:

- `PeopleSoftFileSystem.isWritable` answers from the connection's access
  setting, not only from the definition type.
- `writeFile` refuses again on its own, so a stale editor cannot save to a
  connection made read-only after it opened.

## 5. Compile and save: the pipeline

A save is refused with a specific message if any step fails. There is no
"save anyway".

1. **Preconditions**
   - The connection is Writable and in Compile and save mode.
   - Its PeopleTools release maps to a compiler profile.
   - The definition already exists (v1 does not create programs).
   - The editor's URI resolves to that exact connection and key.
2. **Concurrency check**
   - At open, record a fingerprint of the stored rows: the `PSPCMPROG`
     bytes hash, `PSPCMNAME` rows and the latest `LASTUPDDTTM`.
   - At save, read them again. If anything changed (someone saved in App
     Designer), refuse and offer a diff.
3. **Pre-edit exactness gate.** Re-encode the source as it was when
   opened, under the connection's profile and its own Application Class
   metadata. It must reproduce the stored `PSPCMPROG` and `PSPCMNAME`
   exactly. If it does not, this program is outside proven territory:
   refuse Compile and save, and offer Save only.
4. **Round-trip gate.** Encode the new source, then decode the result
   with the generated name table. The decoded text must equal the new
   source, normalized as in `checkLabCompile`
   (src/peoplecode/corpus/controlledCompile.ts).
5. **Metadata universe.** Application Class types come from the
   connection's own database, read live, never from the HCDEV snapshot.
   If a referenced class cannot be resolved, refuse.
6. **Identity proof** (the Cycle 178 lesson).
   - Before writing, assert that every row to be written carries the
     opened definition's seven-part key and no other.
   - Delete exactly that key's rows. Assert the deleted row counts equal
     what was read in step 2.
7. **One transaction**
   - Rewrite `PSPCMTXT`, `PSPCMPROG` and `PSPCMNAME` for the key.
   - Set `LASTUPDDTTM` and `LASTUPDOPRID`.
   - Run `bumpVersion` with the PeopleCode object type, then commit.
   - Roll back on any error.
8. **Post-save verification.** Re-read the rows, decode them, and compare
   with the saved source. On a mismatch, restore the before-image (step
   9) and report it.
9. **Before-image and audit**
   - Before the transaction, store the rows being replaced in workspace
     storage, with the connection, key, time and operator.
   - A "Restore previous version" command writes a before-image back
     through the same pipeline (steps 6-8).

Save only runs steps 1, 2, 6, 7 (`PSPCMTXT` and counters only), 8 and 9.

## 6. Phase 0: questions to settle on the lab before any code

All of these are observed by saving through App Designer, against
scratch programs in `ZZ_PCODE_LAB` on the lab database, never on HCDEV.

1. **DDL.** Full column lists, nullability and defaults of `PSPCMTXT`,
   `PSPCMPROG` and `PSPCMNAME`. The code uses only key columns,
   `PROGSEQ`, `PROGTXT`, `PCTEXT`, `NAMENUM`, `RECNAME`, `REFNAME`,
   `PACKAGEROOT`, `QUALIFYPATH`, `APPCLASSMETHOD` and `LASTUPDDTTM`; the
   others are unknown.
2. **`PSPCMTXT.HASH_SIGNATURE`:** how it is computed, and whether
   PeopleTools rejects or recomputes a wrong value. **This blocks both
   modes** until answered.
3. **Chunking:** `PSPCMTXT` and `PSPCMPROG` slice sizes per `PROGSEQ`,
   and any per-row length or count columns.
4. **Everything a save touches.** Snapshot row counts and `LASTUPDDTTM`
   for all PeopleTools tables before and after one App Designer save, then
   diff. This finds side tables (change tracking, caches, project items)
   that a direct write would miss.
5. **Version counters:** which `PSVERSION` / `PSLOCK` object types a
   PeopleCode save increments (diff them around the same save).
6. **Save only behaviour:** with `PSPCMTXT` newer than `PSPCMPROG`, find
   what App Designer displays, what it compiles on its next save, and what
   the application server runs.
7. **Cache invalidation:** whether an application server picks up a new
   program after the counter bump alone, without a cache clear.

## 7. Phased plan

| Phase | Scope | Exit condition |
|---|---|---|
| 0 | Lab observation (section 6). No product code. | All seven questions answered and written down here |
| 1 | Write pipeline in a test harness, scratch programs only (`ZZ_PCODE_LAB`) | Rows the harness writes are identical to rows App Designer writes for the same source, for both modes, across the existing H and G experiment families; App Designer reopens and recompiles them cleanly |
| 2 | Product: Settings options, enforcement, editor save, confirmation, audit and restore. Writable labelled "Experimental" | Smoke and unit coverage; Restore proven; no write possible on a Read-only connection |
| 3 | Use on a real development database | Your call, after Phase 2 has run on the lab |

## 8. Decisions needed from you

1. **Rule 1.** May product saves write encoder-generated `PSPCMPROG`
   under the gates in section 5 (Option A)? Or must Compile and save go
   through App Designer (Option B)?
2. **Save only divergence.** Is it acceptable that Save only leaves the
   running program unchanged until something compiles it, with the state
   shown in the editor? *Evidence (Cycle 185, case 10):* App Designer
   compiles before writing and writes nothing when compilation fails, so it
   never stores source ahead of the compiled program. Save only would
   create a state App Designer never does.
3. **Default save mode.** Proposed: Save only.
4. ~~**Which databases may ever be Writable.**~~ Answered: per
   connection, confirmed when enabled. Only HRDMO will be writable.
5. **Before-images.** Workspace storage, which is local to this machine,
   as proposed? Or files in the repository you name?

## Creating Record Field PeopleCode

A Record Field event with no program opens empty in the editor (Writable
connection, scratch record); saving it creates the program. The rows are
the save's (`planProgram`), with nothing to replace: App Designer's create
(case 01-create) and re-create after a delete (11b-recreate) wrote exactly
the program's PSPCMTXT / PSPCMPROG / PSPCMNAME rows, removed any
PSPCMPROGDEL marker, and moved PCM and SYS by one; the save-plan test
already rebuilds 01-create's rows. Key: RECORD (1), FIELD (2), event (12),
the other slots 0 / ' '. Refused for a field not on the record, an event
that is not a Record Field event, an empty program, or a key with source or
name rows but no program rows. Native case d05 (ZZ_PCODE_LAB_C02.FieldChange)
wrote the 01-create shape.
