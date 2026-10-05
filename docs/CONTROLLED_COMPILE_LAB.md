# Controlled-compile lab

What a writable PeopleTools environment must provide to settle the
encoder's last cases that the source cannot distinguish, how to
provision it, and the exact experiments to run there.

- **Cycle 171** wrote the specification.
- **Cycle 172** inventoried what this workstation can provide and
  stopped before installation (Outcome B; see Decision below). It also
  turned the matrices into an executable experiment pack and added an
  ingest tool.

Nothing here has been compiled: no writable 8.61.15 environment exists
yet.

## Milestone this lab follows

**CORPUS_RECOVERABLE_FRONTIER_CLOSED** (Cycle 171). The HCDEV corpus has
30,209 programs compiled with PeopleTools 8.61.15. The encoder is EXACT
on 30,131 of them. The 78 that are not:

| Class | Count | Programs |
|---|---:|---|
| Lossy source: HCDEV `PSPCMTXT.PCTEXT` holds 0xBF for characters outside WE8ISO8859P15, while the compiled program has the real text | 71 | DECODE_SOURCE_MISMATCH |
| Historical compiler variant: per-method row reopening, with no source discriminator | 4 | 29797 29883 30170 30179 |
| Needs a controlled compile | 3 | 30124 10860 15598 |

This is not a claim of compiler equivalence. It means three sources of
evidence justify no further production rule:

- the corpus;
- the captured App Class metadata;
- static analysis of the PeopleTools binaries.

The remaining three programs need compiled experiments.

## The three programs, precisely (Cycle 172)

- **30124** (`PTAF_MONITOR:MONITOR:awSMThread`)
  - Source: `import PTAF_MONITOR:MONITOR:*;` (the class's own package),
    then, in a later method,
    `Local PTAF_MONITOR:MONITOR:awSMToolbar &toolBar = create PTAF_MONITOR:MONITOR:awSMThreadToolbar();`
  - Stored: the declared class's row is opened first (NAMENUM 14
    AWSMTOOLBAR, 15 AWSMTHREADTOOLBAR).
  - Encoder: opens only the created class there (14 AWSMTHREADTOOLBAR);
    the declared class's row comes at its next use (21).
  - Contrast, 28754: named imports of both classes, and the rows follow
    import order. Stored equals encoder, so it says nothing about
    declaration vs creation.
- **10860** (`GP_AUDIT_WRK.FUNCLIB` FieldFormula)
  - Source: Function `Call_Link` assigns and reads
    `&TblFilterlvl2.GetRow(&j).GP_AUD_FLTR_TBL.PIN_NUM.Value`.
    `&TblFilterlvl2` is declared `Local Rowset` only in earlier
    Functions, and those Functions read the same chain.
  - Stored: both members inline (opcode 0x0A, the name itself).
  - Encoder: 0x4A references, opening new RECORD / FIELD rows
    (NAMENUM 1303 / 1304).
- **15598** (`PSIBLOGICL2_WRK.IB_LINKDOC` FieldChange)
  - Source: top-level code reads `&xrow.GetRecord(1).IB_DOC_LBL_ID.Value`.
    `&xrow` is declared `Local Row` only in the earlier Function
    `UpdateParentPeopleCode`.
  - Stored: inline (0x0A).
  - Encoder: a 0x4A reference to the existing FIELD row.

10860 and 15598 are therefore one question: when a root variable is
declared `Local` only in another unit, does a member read in this unit
become a reference or an inline name? In Cycle 163, scoping the
declared-name test to the declaring Function fixed 10860's shape but
moved 15598 farther. The corpus does not settle it.

## Inventory (Cycle 172, this workstation)

| Item | Finding |
|---|---|
| 8.61.15 DPK (`/mnt/ou_network/peoplesoft_dev/ps86115/dpk/archives/pt-pshome8.61.15.tgz`, `pt-oracleclient-19.3.0.0.tgz`, `PT-INFRA-DPK-WIN-8.61-260617_{1,2}of2.zip`) | **Unreachable.** The autofs mount answers "No such device" because the network share is offline. Hashes were recorded while it was reachable (docs/PEOPLETOOLS_BINARIES.md): build PT861P15B_2509220501, `pside.exe` sha256 `e1d1b610…`, `pspcm.dll` `ad57fe09…`. |
| App Designer installed locally | **8.61.07 only.** It is in the Wine bottle `~/.local/share/wine-bottles/peopletools` (win64, wine-11.17) at `C:\PT8.61.07_Client_ORA` (`pside.exe`, `psdmt.exe`, `psae.exe`). An imported copy exists under Bottles (`~/.var/app/com.usebottles.bottles/.../Imported_peopletools`). Both are left untouched. |
| Oracle client (Wine) | `C:\oracle\product\19.3.0.0` |
| `tnsnames.ora` (Wine) | Institutional aliases only: HCDEV, HCTST, HCUAT, HCPRDSRV, FSTST, HCPAY, HCPPY, HCTRN. **No lab or scratch database.** |
| Separate 8.61.15 Wine prefix (`~/.wine-peoplesoft-86115`) | Absent. Creating it needs the unreachable DPK. |
| Windows host | An existing Windows 11 KVM container (dockur `omarchy-windows`, storage in `~/.windows`, 128 GB data image; also a `WinBoat` container). It belongs to the user and was not started or modified. |
| Container / VM tooling | docker, podman, virsh, qemu; `/dev/kvm` present; 16 cores, 30 GB RAM, 494 GB free |
| Oracle Database images | None present locally (no `container-registry.oracle.com/database/*`). |
| PUM / PeopleSoft VM image | None present locally. A PUM 54 / Tools 8.61.15 go-live planning spreadsheet in Downloads is a document, not an image. |
| HCDEV | Read-only (unchanged). |
| HCTST | Read-only. The HCDEV credentials are refused there, and no write authorization exists. |

## Minimum compile architecture

A PeopleCode program reaches PSPCMPROG / PSPCMNAME only when Application
Designer **saves** it. The compiler runs inside App Designer's process
(`pspcm.dll`), and the save writes the tables. So the minimum is:

- **Windows Application Designer 8.61.15** (`pside.exe`, `pspcm.dll` of
  build PT861P15B). Compiler output is patch-specific, so 8.61.07 is not
  authoritative for patch 15.
- **Two-tier Oracle connectivity:** Oracle client 19c to the lab
  database. Three-tier (App Server) also works but needs a full
  PIA/Tuxedo domain, which is unnecessary.
- **A PeopleTools-only database (PTSYS) is sufficient.** The experiments
  use only:
  - Application Packages and classes;
  - derived/work records with new fields;
  - Record PeopleCode.

  No application tables or data are needed. The objects are listed
  under `labObjects` in the experiment pack.
- **Character set does not matter for these experiments.** PSPCMPROG
  stores strings as UTF-16LE in every database. Only `PSPCMTXT.PCTEXT`
  (the source text) depends on the database character set, and every
  experiment source is ASCII. A non-Unicode WE8ISO8859P15 database
  matches HCDEV; a Unicode one is equally valid here.
- **Operator:** an operator id (PTSYS ships `PS` / `VP1`) with App
  Designer access and the rights to create and save Application
  Packages, fields, records and PeopleCode.
- **Read access** for the capture: `SYSADM.PSPCMPROG`, `PSPCMNAME`,
  `PSPCMTXT`, `PSSTATUS`.

## Decision

| Option | Gives 8.61.15 compiler | Writable DB | Safe | Completable from this agent session | Blocker |
|---|---|---|---|---|---|
| A. Wine 8.61.15 client in a separate prefix + scratch DB | yes, if pside 8.61.15 runs under Wine | needs B4 | yes | **no** | DPK share offline; no DB; App Designer saving under Wine is untested |
| B. Windows VM (existing dockur Windows 11 or new) + App Designer 8.61.15 + PTSYS scratch DB | **yes** | needs B4 | yes | **no** | DPK share offline; user consent to use the VM; Oracle DB image and license |
| C. Existing personal PeopleSoft lab database | yes, if 8.61.15 | yes | yes | **no** | none exists on this workstation |
| D. New PeopleTools-only Oracle 19c database (PTSYS from the 8.61.15 DPK) | supplies the DB for A/B | **yes** | yes | **no** | Oracle 19c image needs an Oracle account and license acceptance; PTSYS build needs PS_HOME scripts and Data Mover from the DPK (share offline) |
| E. Authorized HCTST scratch namespace | yes (8.61.15) | only with written authorization | only with authorization | **no** | no write authorization; HCDEV credentials refused |

**Chosen path: B + D.** That is App Designer 8.61.15 on a Windows VM,
saving into a PeopleTools-only Oracle 19c database built from the same
DPK. It is the only path with native Windows App Designer at the exact
patch and no institutional database involved.

**Cycle 174 recheck: media verified; stopped before installation
(conditions B, C, D).**
- The VPN (`tun0`) is up, `hcwin-dev.net.ou.edu` resolves (10.26.197.223)
  and the archive is readable.
- `dpk/pt-manifest`: tools 8.61.15, Windows, Oracle client 19.3.0.0
  Jul2025 CPU.
- `pt-pshome8.61.15.tgz` (2,234,348,986 bytes) streams with every
  client-binary sha256 matching docs/PEOPLETOOLS_BINARIES.md
  (`pside.exe` `e1d1b610…`, `pspcm.dll` `ad57fe09…`).
- `ps86115/db` is empty. No Oracle Database server media is visible on
  the share.
- No authorization has been given for any of: using the media in a
  personal lab, using `omarchy-windows`, or an Oracle 19c image and
  license. So nothing was extracted, started or installed.

**Cycle 173 recheck: still stopped (condition A).** The share is a
cifs automount of `//hcwin-dev.net.ou.edu/Peoplesoft`. The host does not
resolve (VPN not connected), and no local copy of the media exists.
Restoring that connection is provisioning step 1.

**Cycle 172 outcome: STOP BEFORE INSTALLATION.** Every option needs at
least one step that is a human or admin action: restore the media,
accept the Oracle license, authorize use of the institutional
PeopleTools media for a personal lab, and consent to using the Windows
VM. No encoder semantics changed.

## Provisioning checklist (human / admin steps, in order)

1. **Media.** Bring the network share back: connect the VPN so that
   `hcwin-dev.net.ou.edu` resolves and the automount of
   `//hcwin-dev.net.ou.edu/Peoplesoft` at `/mnt/ou_network/peoplesoft_dev`
   succeeds, or copy these to local disk:
   - `ps86115/dpk/archives/pt-pshome8.61.15.tgz`
   - `pt-oracleclient-19.3.0.0.tgz`
   - the Windows infrastructure DPK

   Verify `pside.exe` sha256 `e1d1b610…` and `pspcm.dll` `ad57fe09…`
   (docs/PEOPLETOOLS_BINARIES.md). Do not commit any of it.
2. **Authorization.** Confirm with the PeopleSoft administrator that the
   institution's PeopleTools media may be installed on a personal,
   non-production lab.
3. **Database host.** Run Oracle Database 19c Enterprise, for example
   the `container-registry.oracle.com/database/enterprise:19.3.0.0`
   container. This needs an Oracle SSO account and license acceptance.
   - Run it under podman/docker with a persistent volume.
   - Service name `PCLAB`, character set WE8ISO8859P15, national
     character set AL16UTF16.
   - Publish port 1521 to the Windows VM only.
4. **PTSYS database.** On the Windows host, from PS_HOME 8.61.15, run
   the PeopleTools database-creation scripts against `PCLAB`. These are
   the installation guide's manual Oracle path:
   - `createdb` / `utlspace` / `ptddl` / `dbowner` / `psroles` /
     `psadmin` / `connect`;
   - then the Data Mover bootstrap import of the PeopleTools system
     data.

   Resulting owner `SYSADM`, connect id `people`, operator `PS`.
   `SELECT TOOLSREL, PTPATCHREL FROM SYSADM.PSSTATUS` must return
   `8.61`, `15`.
5. **Windows App Designer.**
   - Use the existing dockur Windows 11 VM (with the user's consent) or
     a new one.
   - Extract PS_HOME 8.61.15 and install the Oracle 19c client.
   - Add a `PCLAB` entry to that VM's `tnsnames.ora`. It must not
     contain the institutional aliases.
   - In Configuration Manager, set Database type Oracle, name `PCLAB`,
     connect id `people`.
   - Sign in to App Designer two-tier as `PS`.
6. **Wine alternative (optional, after 5 works).**
   - Create a new prefix `~/.wine-peoplesoft-86115`. Never modify the
     8.61.07 bottle.
   - Install the same PS_HOME and Oracle client.
   - Save one support class and compare its PSPCMPROG with the Windows
     result. Wine is acceptable only if the bytes are identical.
7. **Capture account.** Any account that can SELECT the four tables in
   `PCLAB`. Put it in `PS_CONNECT_STRING` / `PS_USER` / `PS_PASSWORD`
   only in the shell that runs the capture. Never use the HCDEV
   variables.

## Scratch policy

- **Namespace:** everything starts with `ZZ_PCODE_LAB`.
  - Project `ZZ_PCODE_LAB`.
  - Application Packages `ZZ_PCODE_LAB`, `ZZ_PCODE_LAB:ORDERING`,
    `ZZ_PCODE_LAB:SCOPE`.
  - Derived/work records `ZZ_PCODE_LAB`, `ZZ_PCODE_LAB_P`,
    `ZZ_PCODE_LAB_T`.
  - Fields `ZZ_CASE_01`..`07`, `ZZ_LAB_KEY`, `ZZ_LAB_VAL`.
- **Capture keys:** PSPCMPROG / PSPCMNAME / PSPCMTXT rows with
  `OBJECTVALUE1 LIKE 'ZZ_PCODE_LAB%'`.
  - App Classes: `104=ZZ_PCODE_LAB, 105=<subpackage>, 107=<class>,
    12=OnExecute`.
  - Record PeopleCode: `1=ZZ_PCODE_LAB, 2=ZZ_CASE_nn, 12=FieldFormula`.
- **Rules:**
  - Never reuse or edit an existing definition.
  - Never connect the lab tools to HCDEV or HCTST. `capture-lab.ts`
    refuses institutional database names, and it refuses any database
    whose `DB_NAME` differs from `--database`.
- **Cleanup:** delete the project's objects after capture, or keep the
  lab database as is. It is disposable.

## Experiment pack

`tools/corpus/controlled-compile/experiments.json` (format
`pcode-lab-experiments/1`) holds:

- every **support definition**: seven classes, saved first;
- every **experiment**, each with:
  - its key and exact source;
  - what to observe;
  - each candidate model's prediction;
  - for the two corpus replicas, the corpus program's own observation.

App Designer may reformat a source on save. The comparison uses the
source as captured (PSPCMTXT), so that is harmless.

### 30124 family

Observe the NAMENUM order of the declared and created classes' PACKAGE
rows.

Support classes:
- in `ZZ_PCODE_LAB:ORDERING`: `PARENT`, `CHILD` (extends PARENT),
  `CHILDARG` (extends PARENT, one constructor argument), `BASECLS`,
  `DERIVED` (extends BASECLS);
- in `ZZ_PCODE_LAB:SCOPE`: `SPARENT`, `SCHILD`.

Each experiment is a class in `ZZ_PCODE_LAB:ORDERING`. The statement sits
in method `Run`, after a constructor and a method `Prepare`.

| Case | Role | Variation | Encoder predicts |
|---|---|---|---|
| H1 | positive (30124 replica; corpus: PARENT, CHILD) | wildcard import of the own package, qualified `Local PARENT &x = create CHILD();` | CHILD only (**differs from the corpus**) |
| H2 | control | bare `Local PARENT &x;`: does a method-local class declaration open its row by itself? | PARENT |
| H3 | control | H1 with the alphabetical order reversed (BASECLS / DERIVED) | DERIVED only |
| H4 | control | 28754 shape: named imports PARENT then CHILD | PARENT, CHILD |
| H5 | control | named imports CHILD then PARENT | CHILD, PARENT |
| H6 | control | other package (`ZZ_PCODE_LAB:SCOPE:*`) | SCHILD only |
| H7 | control | declaration and create split into two statements | PARENT, CHILD |
| H8 | control | constructor with an argument (CHILDARG) | CHILDARG only |
| H9 | control | after executable statements (30124's position) | CHILD only |

Models:
- `DECLARED_FIRST`: the declaration opens the declared class's row
  before the initializer's.
- `CREATED_FIRST`: the opposite.
- `IMPORT_ORDER`: named imports open rows in import order.
- `ALPHABETICAL`: the rows sort by class name.

If H1 reproduces 30124 and H2 opens PARENT, the declaration opens the
row (`DECLARED_FIRST`) under a wildcard import. H4 / H5 then say whether
named imports override it. If H1 does **not** reproduce 30124, the order
comes from compiler state or version, not from the source (stop
condition C below).

### 10860 / 15598 family

Observe, per occurrence in program order, the form of the members
`ZZ_PCODE_LAB_T` / `ZZ_LAB_VAL`:

- `:ref`: a 0x4A reference;
- `:recfield`: a 0x21 REC.FIELD reference;
- `:inline`: 0x0A, the name itself.

The detail output adds the NAMENUM each reference used, which separates
reuse of an existing row from a new one. All G programs are Record
PeopleCode on `ZZ_PCODE_LAB.ZZ_CASE_nn` FieldFormula.

| Case | Role | Variation | Encoder predicts |
|---|---|---|---|
| G1 | positive (10860 replica; corpus: ref ref inline inline) | Rowset declared Local only in Function LoadFilter, which reads `&r2.GetRow(&j).ZZ_PCODE_LAB_T.ZZ_LAB_VAL`; CallLink assigns `&r2` without declaring it and reads the same chain inside For / If / For | ref ref ref ref (**differs from the corpus**) |
| G2 | control | G1 with `Local Rowset &r2;` in CallLink too | ref ×4 |
| G3 | control | G1 with LoadFilter declaring `&r2` but never reading the chain | inline inline |
| G4 | control | `&r2` a Global | ref ×4 |
| G5 | positive (15598 replica; corpus: ref inline) | Row declared Local only in Function Prepare, which reads `&xrow.GetRecord(1).ZZ_LAB_VAL`; top-level code assigns `&xrow` and reads it | ref ref (**differs from the corpus**) |
| G6 | control | G5 with a top-level `Local Row &xrow;` | ref ref |
| G7 | control | G5 with Prepare never reading the member | inline |

Models:
- `TYPED_EVERYWHERE`
- `DECLARING_UNIT_SCOPE`: a reference only where the root is declared
  in the same unit, or is Global.
- `PROGRAM_WIDE_DECLARATION`
- `EARLIER_ROW_REUSE`: the encoder today. A reference when the root
  was declared earlier and the member's row already exists.

The encoder's own predictions (`--predict`) are consistent with
`EARLIER_ROW_REUSE` on all seven experiments. They fail to reproduce
exactly the two replicas, just as the encoder fails 10860 and 15598.

### Confirmations of Cycle 171 rules (optional)

| Case | Source | Expected (rule) |
|---|---|---|
| C1 | Function `Returns PKG:Cls`, blank line, `Local` | `2D 4F 44` |
| C2 | as C1 with `Returns string` | `2D 4F 44` |
| C3 | interface ending `end-interface` at EOF | `71 07`, self-only directory, slots kept |
| C4 | as C3 with `end-interface;` | `71 15 2D 07`, method record present |
| C5 | App Designer refuses to save C3 | the shape is historical-only |

## Runner checklist (once the lab exists)

1. `SELECT TOOLSREL, PTPATCHREL FROM SYSADM.PSSTATUS` must return 8.61
   / 15. Record the App Designer *Help > About* build.
2. Create the fields, the three derived records and project
   `ZZ_PCODE_LAB` (`labObjects` in the pack).
3. Create the packages. Save the seven support classes **first**, in
   pack order.
4. Save each experiment's source exactly. Paste it from the pack. Do not
   retype it, and do not let other edits happen in between.
5. Save each experiment once. If App Designer refuses a source, record
   the message as the result.
6. Capture, SELECT-only:
   `PS_CONNECT_STRING=PCLAB PS_USER=… PS_PASSWORD=… npx tsx tools/corpus/controlled-compile/capture-lab.ts --database PCLAB --out lab-results.json`
7. Compare, with no database:
   `npx tsx tools/corpus/compare-controlled-compile.ts --results lab-results.json --json lab-report.json --verbose`
8. Keep `lab-results.json` and `lab-report.json` with the cycle's
   research artifacts. They contain only scratch definitions.

## Ingest tool

`tools/corpus/compare-controlled-compile.ts` is the CLI over
`src/peoplecode/corpus/controlledCompile.ts`. It needs no HCDEV or
Oracle connection.

**Input:** results in format `pcode-lab-results/1`. Per definition:
- the key (OBJECTID / OBJECTVALUE 1–7);
- the experiment id;
- the PSPCMTXT source;
- the PSPCMPROG bytes (hex);
- the PSPCMNAME rows.

**Output, per definition:**
- the decoded program, and whether it matches the source;
- the reference list and NAMENUM map;
- first-use order;
- the encoder's bytes and references against the capture, with first
  differences;
- per experiment:
  - the observation (stored vs encoder);
  - whether a replica reproduced the corpus;
  - each model's verdict.

**Output, per family:**
- each model's consistent / refuted experiments;
- candidates: no refutation, at least one positive and one control
  observed, and every replica reproduced;
- where the encoder disagrees.

**Encode context:** the corpus harness's.
- Owner and package path come from the key.
- OBJECTID1 104 selects Application Class mode.
- The type metadata is built from the lab's own captured classes.
- `#ToolsRel` is the lab's major.minor release.

`--predict` runs the comparison over the encoder's own output. That is
a prediction table, never evidence.

## Interpretation and stop conditions

- **A model becomes a rule only when it is a candidate:**
  - no refutation;
  - at least one positive and one control observed;
  - replicas reproduced;
  - it holds on the whole corpus with 0 regressions, 430/430 protected
    and the fallback six unchanged.

  Then implement it generically. Never key it on a definition or a
  source fingerprint.
- **C. H1 does not reproduce 30124.** 30124's order is a compiler-state
  or version artifact. Classify it as such and change nothing.
- **D. G1 / G5 do not reproduce, or the G controls cannot separate the
  models.** Classify 10860 / 15598 as source-indistinguishable and
  change nothing.
- **E. A candidate regresses any EXACT program.** Reject it.
- **F. Any step would require writing HCDEV or HCTST.** Stop.
