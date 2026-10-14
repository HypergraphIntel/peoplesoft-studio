# Customization Intelligence

Who owns a definition, what may happen to it, and which configuration
frameworks could extend it instead. Phase 1 of the Customization Intelligence
design (CUSTOMIZATION_INTELLIGENCE.md, CUSTOMIZATION_STRATEGY_PANEL.md):
ownership classified from evidence, and delivered-object policies every write
passes. Phase 2: Event Mapping discovered (2a) and written as PeopleTools'
own page writes it (2b, through the MCP). Drop Zones, Page and Field
Configurator, Configurable Search, AE plug-ins, plans and the customization
registry are later; the Customization Strategy view and the Customization
Plan editor show them as previews.

## Ownership

| Ownership | Meaning |
|---|---|
| Delivered | Oracle's, never saved locally |
| Delivered, modified | Oracle's, saved locally since |
| Partner (bolt-on) | A bolt-on vendor's |
| Custom | The organization's own |
| Unknown | The evidence does not decide |

Every classification carries a confidence (high, medium, low) and the
evidence it rests on, shown in the Customization Strategy view (Object
Identity) and returned by `psft_object_classify`.

### Evidence, strongest first

1. **A delivered baseline** of the database's application release: every
   definition a vanilla demo database of that release holds, saved by Oracle's
   operator. A definition in it is Oracle's -- Delivered when its stamp is
   still PPLSOFT, Delivered, modified when it is not. One not in it is the
   organization's (Custom) or, with a bolt-on prefix, a vendor's (Partner).
2. **The definition's stamp** (LASTUPDOPRID; a PeopleCode program's own).
   Oracle delivers everything saved by PPLSOFT -- on HRDMO all 52,775 records,
   17,342 pages and 119,290 PeopleCode programs are -- and a local save
   restamps it.
3. **An Oracle-delivered project** listing it: a project stamped PPLSOFT and
   not named with a configured prefix. Weak: such projects list about a sixth
   of what Oracle delivers (8,282 of 52,792 records on HRDMO), and anyone
   signed in as PPLSOFT stamps a project so -- HRDMO's lab project
   ZZ_PCODE_LAB_G is one.
4. **The naming prefixes** (`peoplesoft.customization.namingPrefixes`).
   Supporting evidence, never proof on its own: Oracle itself delivers `ZZ_`
   records (ZZ_DMNDCRS_SRC, ZZ_DSTNCT_DEPT and more on HRDMO).

The rules (`src/model/ownership.ts`, tested in `src/test/ownership.test.ts`):

| Baseline | Stamp | Also | Ownership |
|---|---|---|---|
| holds it | PPLSOFT | | Delivered, high |
| holds it | local | | Delivered, modified, high |
| lacks it | any | bolt-on prefix | Partner, high |
| lacks it | any | organization prefix | Custom, high |
| lacks it | PPLSOFT | | Delivered, medium (a later Oracle update than the baseline) |
| lacks it | local | | Custom, medium |
| none | PPLSOFT | in an Oracle project | Delivered, high |
| none | PPLSOFT | bolt-on prefix | Partner, low |
| none | PPLSOFT | | Delivered, medium |
| none | local | in an Oracle project | Delivered, modified, low |
| none | local | bolt-on prefix | Partner, medium |
| none | local | organization prefix | Custom, medium |
| none | local | nothing else | Unknown, low |

A PeopleCode program not stored yet is judged by the definition it belongs to
(a record, component, page, menu, App Engine program, Component Interface):
adding PeopleCode to a delivered record changes a delivered definition. A new
definition of any other kind has no owner yet and is not judged.

## Naming prefixes are a list

Organizations buy PeopleSoft bolt-ons that carry their own prefixes, so the
prefixes are a list, each with who owns definitions named with it:

```json
"peoplesoft.customization.namingPrefixes": [
  { "prefix": "ZZ_",  "owner": "organization", "name": "Acme Corp" },
  { "prefix": "XYZ_", "owner": "partner",      "name": "XYZ Bolt-On Suite" }
]
```

The longest matching prefix wins (`XYZ_HR_` over `XYZ_`). While the list is
empty, 0.8.4's single `organizationPrefix` (deprecated) is read, and failing
that the write-scope prefix `peoplesoft.writeNamePrefix` counts as the
organization's.

## The delivered-object policies

Every save, rename and delete of an existing definition passes one guard, at
the `DatabaseProvider` write methods (`src/providers/writeGuard.ts`), so no
editor, designer or MCP tool can take another path around it;
`tools/lab/customization-e2e.mts` proves every write method reaches the guard
before it writes anything. The guard knows who is writing: every MCP tool
call runs tagged as an AI agent's (`src/mcp/agentOrigin.ts`), everything else
is a person's. Each has its own policy:

| Setting | Applies to | Default |
|---|---|---|
| `peoplesoft.customization.deliveredObjectPolicy` | your writes, in the editors and designers | `allowWithAudit` |
| `peoplesoft.customization.agentDeliveredObjectPolicy` | an AI agent's writes, through the MCP | `requireApproval` |

The defaults put the friction where the risk is. PeopleSoft shops edit
delivered definitions routinely, and without a baseline a site whose
developers sign in as PPLSOFT would see its own definitions flagged: prompting
people on every such save teaches them to click through it. So your own
writes go through and are recorded. An agent's are asked, even when MCP writes
are `allow` -- the one thing that stops an agent from quietly changing a
delivered record or program.

What each policy does:

| Ownership | block | requireApproval | allowWithAudit |
|---|---|---|---|
| Delivered, Delivered modified, Partner | refused | asked | written, recorded |
| Unknown | asked (never refused: nothing proves it delivered) | asked | written, recorded |
| Custom | written | written | written |

Asked: VS Code shows the ownership and its evidence (and, for an agent, that
an AI agent wants the write); **Approve** covers that one write, **Approve for
This Session** that definition until VS Code restarts -- an approval for your
writes does not cover an agent's, nor the other way round. An agent cannot
answer it: for an agent's write the MCP's own write approval (level 1) comes
first, the delivered-object approval (level 2) after it, both in VS Code.
Every refusal, approval, decline and recorded write is in the audit log
(*PeopleSoft: Show Customization Audit Log*, a JSON line each with who wrote,
and the *PeopleSoft Customization* output).

Dry runs (Preview Save) and new definitions (a create, a Save As) are not
judged.

## Delivered baselines

*PeopleSoft: Capture Delivered Baseline...* (the Customization Strategy
view's menu) reads, from a connection you name, every definition saved by
PPLSOFT -- records, fields, pages, components, menus, App Engine programs,
SQL, HTML, style sheets, Component Interfaces, messages, message channels and
every PeopleCode program -- and keeps it in the extension's storage as
`<application release>_PT<tools release>.json.gz` (HRDMO, HRMS 9.20 on
PeopleTools 8.62: about 365,000 definitions, 1.75 MB, 36 seconds). A baseline
applies to databases of the same application release (PSRELEASE's latest
RELEASELABEL), the same tools release preferred.

**A baseline is only as vanilla as its database.** Capture it from an
untouched PUM image of the release you develop on: anything saved there while
signed in as PPLSOFT is taken as Oracle's. HRDMO itself has two lab records
(ZZ_PCODE_LAB, ZZ_PCODE_LAB_P) and nine fields saved that way, so a baseline
from it counts them as delivered.

Sites whose developers sign in as PPLSOFT should capture a baseline: without
one their own definitions look delivered. The Customization Strategy view
offers *Capture Delivered Baseline…* whenever the open definition was
classified without one.

## Event Mapping discovery

Whether Event Mapping -- application class PeopleCode run at a component's,
its records', fields' and pages' events, configured instead of changing the
delivered PeopleCode -- can extend a definition on this database, and what is
configured already. Read only; established on HRDMO, its tables read from
Oracle's own view SQL and the results checked against the Configure Event
Mapping page (PeopleTools > Portal > Related Content Service).

| Table | Holds |
|---|---|
| PSPTCSSRVCONF | A configuration: PORTAL_NAME `_PTCS_PTEVMAP`, PORTAL_OBJNAME the content reference, PTCS_SERVICEID, PTCS_ISCOMPSERVICE the level, PNLNAME / RECNAME / FIELDNAME, PTCS_CMPEVENT (component level) or PTCS_CMPRECEVENT (the others), PTCS_PROCSEQ, SEQNUM, PTCS_ENABLE, the stamp (Oracle view PTCS_EVMAP_CFGS) |
| PSPTCS_SRVCFG | The content references configured (Oracle view PTCS_EVMAP_SRCH) |
| PSPTCSSRVDEFN | The service: PTCS_SERVICEURLTYP `UAPC` (Application Class) names the class by PACKAGEROOT, QUALIFYPATH, APPCLASSID (Oracle view PTCS_EV_SRVC_VW) |
| PSPRSMDEFN | The content references a component is registered as: PORTAL_URI_SEG2 component, SEG3 market |

**The level's translate labels mislead.** PSXLATITEM calls PTCS_ISCOMPSERVICE
P "Services at Page level" and R "Event Mapping at Comp Rec"; the Configure
Event Mapping page shows **C Component, P Record, R Page**, F Record Field --
P rows carry a record and RowInit / RowInsert, R rows a page and Activate.
Events and the processing sequence (Pre Process, Post Process,
Override/Replace) keep their translate labels.

The verdict:

- **Component** -- Verified available when it is registered as a content
  reference (Event Mapping configures content references), with the
  configurations on them; Verified unavailable, with that reason, when not.
- **Page** -- through the components it is in; the configurations naming the page.
- **Record** -- through the components whose pages use it (subpages not
  followed); the configurations naming the record.
- PeopleCode is judged by its component, page or record. Other types: not
  applicable.

HRDMO: 325 Application Class services; 50 configurations on 8 content
references, all Oracle's -- Dependent Information (DEPEND_BENEF) has a
component PostBuild, two RowInit and a RowInsert on records and a page
Activate, all masking services of EOCC_COMP_CONFIG.

The page's Event Map Parameter is the configuration's EV_PARAM row in
PSPTCS_MAPFLDS; its Unrestricted Prompt is not stored (below).

## Drop Zone discovery

A drop zone is a place on a delivered page where a custom subpage is
inserted at runtime, configured with *Configure Drop Zones*
(`PORTAL_ADMIN.PTCS_SUBPAGE_COMP.GBL`) instead of modifying the page.
Studio finds them as that page does (`PTCS_SUBPNL_WRK.SEARCH_BTN`
FieldFormula, `GetDZConfigForComponent`):

- the component's pages, followed recursively into the subpages (field type
  11) and secondary pages (18) they place;
- on each, a subpage control placing the stub named by
  `PSOPTIONS.PTSTUBSUBPAGE` (`PT_ERCSUBPAGE_STUB`) whose preceding control
  (`FIELDNUM - 1`) is a group box of type 21 (`PSPNLFIELDEXT.GRPBOXTYPE`).
  On HRDMO 2162 of the 2163 stub placements, on 1109 pages, are valid.

The group box is the drop zone: its label (text, or its message-catalog
text) names it; `level.record.field.pnlfldid` keys it (`PTCS_PNLFLDNAME`);
it shows on the component page, or on the secondary page that holds it.
A configured drop zone is Related Content: a service named after the custom
subpage (`PSPTCSSRVDEFN`, URL type `UESP`) configured on the component's
content reference -- or on `PT_DZ_UNREGCOMP`/<component> when the component
is not registered -- with a `PTCS_MENUFIELD` map (`PSPTCS_MAPFLDS`) to the
drop zone's key. HRDMO has none configured.

Drop zones are Oracle's to place: PeopleTools 8.62's Application Designer
guide ("Configuring Drop Zones") says they "are delivered by PeopleSoft
application teams", that there is "really no reason" to add them to your own
pages, and that adding one to an Oracle page is a customization. There is no
implicit drop zone: a component whose pages have none is listed by Configure
Drop Zones with "no drop zones are available". Classic drop zones are group
boxes with *Drop Zone Group Box* (Use tab), fluid ones the *Related Content*
group box type; both store GRPBOXTYPE 21.

The Strategy view's **Drop Zones** row and MCP `psft_customization_discover`
report `VERIFIED_AVAILABLE` with each drop zone (page, label, key,
configured subpage), or `VERIFIED_UNAVAILABLE` when the pages have none --
adding one to a delivered page is itself a delivered-object customization.
HRDMO: `JOB_CODE_TBL` 5 drop zones on 5 pages, `JOB_DATA_FL` 40 on 20,
`USERMAINT` none.

## Page and Field Configurator discovery

Page and Field Configurator is PeopleSoft Enterprise Components' configurator
(`EOCC_COMPONENT_CONFIG.EOCC_CONFIGURE.GBL`): it hides, relabels, requires,
disables, defaults, blanks or masks a component's fields and hides pages or
makes them display only -- by role, user, form factor and field-value
criteria -- without changing the component. Stored in `PS_EOCC_CONFIG_HDR`
(one per component, market and type: Standard, Masking, Change Tracking),
`_SEQ` (numbered sequences: description, status, apply to, role, form
factors), `_PNL` (page rows), `_FLD` (field rows keyed
`level.record.field.pnlfldid...`; `EOCC_LBL_OVERRIDE` is a Y/N flag, the label
is `LBLTEXT`) and `_CRT` (criteria).

It runs through Event Mapping -- the `EOCC_*` services
(`EOCC_COMP_CONFIG:Services`) mapped on the component's content references --
so a component must be registered, and a configuration only takes effect on
the content references that carry that mapping (PeopleTools 8.62 maps every
one when a configuration is saved; earlier releases needed Map to Portal
Registry / Apply Configuration). Discovery reports the configurations, what
each sequence changes, and where the mapping is. HRDMO: `JOB_DATA_FL` 26
sequences, applied; `PERSONAL_DATA_FL` hides 5 fields but has no EOCC mapping
-- it does nothing at run time; `DEPEND_BENEF` masking is applied on 1 of its 5
content references; `JOB_CODE_TBL` is registered with none. Content reference
links (`PORTAL_CREF_USGT` LINK) are not counted: they point at a target and
get no mapping of their own.

Captured on HRDMO (`pfc01-configure`, `pfc02-remove`, on JOB_CODE_TBL):
saving a configuration writes its `PS_EOCC_CONFIG_*` rows (sequence and field
rows deleted and re-inserted on a later save; an untouched blank grid row is
saved) and **regenerates its Event Mapping on every save**: on each target
content reference every EOCC configuration is deleted with a
`PSPTCSSRVCNFDEL` tombstone and the ones the configuration now needs are
inserted (`PSPTCSSRVCONFLG` language rows with them), each its own SCNFM step;
`PSPTCS_SRVCFG` for `_PTCS_PTEVMAP` is added when missing (RCSCM, frame
location S). Which services it maps follows the configuration: one required
level-1 field gave component PostBuild and SavePreChange plus `EOCC_ROWINIT1`
and `EOCC_ROWINSERT1` on its record; with no field left, PostBuild and
SavePreChange only. Which rows is the configurator's PeopleCode, ported in
src/providers/pfcMapper.ts (see Writing Page and Field Configurator).

## Writing Drop Zones

`DatabaseProvider.saveDropZoneConfiguration` (src/providers/dropZoneWriter.ts)
sets drop zones' subpages as Configure Drop Zones saves them
(`PTCS_SUBPNL_WRK.PTSAVE_CHANGE_SUOW` FieldChange), in one transaction,
refused when the configuration changed since it was read (its token).
Captured on HRDMO: `dz01-configure` (PIA sets the lab drop zone to
`ZZ_PCODE_LAB_SUB`), `dz02-remove` (PIA clears it).

Every save re-saves each owner's `PSPTCS_SRVCFG` at the next RCSCM (deleted
and inserted when it exists). For a drop zone whose subpage changed:

- **configured** [dz01]: the subpage's service when there is none
  (`PSPTCSSRVDEFN`: id, name, description and `PNLNAME` the subpage, URL type
  `UESP`, type `S`, escape Y, secure use-edit 1, attribute `GNRL`; VERSION the
  next RCSDM); a `PSPTCSSRVCONF` row (type `P`, `PNLNAME` the page, URL
  target `RCF`, embeddable and single unit of work `Y`, label the subpage,
  random instance id; VERSION two SCNFM steps on); the `PTCS_MENUFIELD` map
  (`PSPTCS_MAPFLDS`, type `PF`) to the drop zone's key; a field menu
  (`PSPTCS_MENU_TBL`, type `FLDM`, id the drop zone's field id
  `<page>.<pnlfldid>.`, two RCMTM steps on), its Root folder
  (`PSPTCS_MNUFLDRS`, id `Hash(menuId|"-Root")` -- PeopleCode Hash(), SHA-1
  of the UTF-16LE text, base64) and the link (`PSPTCS_MNULINKS`);
- **removed** [dz02]: link, folder, menu (`PSPTCSMNUTBLDEL` at the next RCMTM),
  map and configuration (`PSPTCSSRVCNFDEL` at the next SCNFM) deleted; the
  service definition kept.

A counter's next value is one past the larger of PSVERSION and PSLOCK and
both are set to it (HRDMO RCSDM: 10 and 13 -> 14); SYS moves once per step.
Data Migration Workbench tracking is kept as PIA keeps it, including its
folder row that lists `PTCS_MENUID` twice and hashes the menu's keys; a
removal re-stamps the configuration's, menu's and that folder row's
tracking and keeps them. A changed subpage is a removal then a
configuration. The write scope applies to the subpages configured or
removed; a subpage must be a subpage (`PNLTYPE 1`).

Proof: src/test/dropZoneWriter.test.ts replays dz01 and dz02 from their
before-states -- every row, tracking row and counter. The writer's own saves
(`dzw01-writer-configure`, `dzw02-writer-remove`) have PIA's shape (same
tables and counter steps; tracking updated in place where PIA deleted and
re-inserted), and the Configure Drop Zones page shows the writer's
configuration. These captures used a drop zone added to the lab page
`ZZ_PCODE_LAB_PG` -- not how drop zones are meant to be used (they are
Oracle's), and since removed; the stored configuration does not depend on who
placed the zone. Run time, on a delivered drop zone (tools/lab/dz-delivered.mts):
the writer configured JOB_CODE_TBL's "DZ-Bottom of Job Code And Profile"
(JOBCODE_TBL1_GBL, level 1) with a ZZ_ classic custom subpage -- on all three
content references the component is registered as -- Configure Drop Zones
listed it, Define Job Code (SETUP_HRMS) showed the subpage at the bottom of
the Job Code Profile data area, and after the writer cleared it the page
showed it no more. No Oracle definition was changed.

## Writing Page and Field Configurator

`DatabaseProvider.savePageFieldConfiguration` (src/providers/pfcWriter.ts)
saves a component's Standard or Masking configuration as `EOCC_CONFIGURE`
saves it, in one transaction, refused when the configuration changed since it
was read (its token). Agents use MCP `psft_page_field_config_get` /
`psft_page_field_config_save`; in the Customization Strategy view a
configuration's sequence row activates or deactivates that sequence or the
whole configuration (previewed, then confirmed).

The rows (`PS_EOCC_CONFIG_HDR`, `_SEQ`, `_CRT`, `_PNL`, `_FLD`) are saved as
the component saves them: the header inserted or updated, a child row that
changed deleted and inserted [pfc02]; a column left out takes the record
field's default (`PSRECFIELDDB`), as a new grid row does. Reads leave out
exactly the values a save would fill in, so a read-edit-save round trip
changes nothing else.

Then the component's SavePreChange (`AddEventMapping`, or
`RemoveEventMapping` when the header is inactive) regenerates the type's
Event Mapping on every content reference of the component that is not a link.
What it maps is `EOCC_COMP_CONFIG:EventMapping:Mapper`, ported in
src/providers/pfcMapper.ts and derived inside the transaction from the rows
just written (the configurator derives it from the rows being saved):

- component events: PostBuild and SavePreChange (Standard), PostBuild at
  sequence 999 (Masking);
- record events: each configured field's parent record RowInit and
  RowInsert, a level-2/3 field's ancestor scrolls' records RowInit; numbered
  `EOCC_ROWINITn`/`EOCC_ROWINSERTn` in order (Standard) or `EOCC_MASK_*`; a
  derived record's parent is the scroll's primary record before it;
- page events when the header's `EOCC_PAGE_EVENT` is Y, secondary pages
  (key part 6 `S`), search and prompt fields (`Srch`/`Prmpt`: the record's
  search keys, subrecords expanded), and FieldChange on the criteria fields
  of active sequences (when `EOCC_CONFIGURE` has `EOCC_CONFIG_SEQ.
  EOCC_SEQUENCE_NBR`, PeopleTools 8.56+).

Checked against every configuration on HRDMO (tools/lab/pfc-mapper-check.mts):
7 applied configurations match row for row; `JOB_DATA_FL` and `EE_HR_PROC_FL`
were generated in 2020 and 2017, before services the current rules add were
delivered (`EOCC_FIELDCHANGE` 2020-12, `EOCC_ROWINIT1` 2021-08), and lack
only those.

Per content reference [pfc01, pfc02]: `PSPTCS_SRVCFG` added when missing (its
menu, ExpandFrame N, frame location S, the next RCSCM), or kept with its
`RCF_SERVICES` tracking restamped; the type's services deleted in
`DeleteUtilityServiceMapping`'s order, each row with its `PSPTCSSRVCNFDEL`
tombstone at the next SCNFM and its tracking restamped; the derived rows
inserted, each at the next SCNFM, a random instance id, the columns the
ServiceHandler sets (component events in the main menu; all enabled). When
`PSPTCS_SRVCFG` already existed, each new row also gets a
`PSPTCSSRVCONFLG` row with a **blank** language code: the related-content API
sets the language only on a new service. An inactive configuration deletes
the type's rows, and a content reference left with no Event Mapping loses
`PSPTCS_SRVCFG` (`PSPTCSSRVCFGDEL`, as the Event Mapping list's Remove
[em07] -- not captured for the configurator). Not written: the
`EOCC_ROWINITn`/`ROWINSERTn` service definitions the configurator clones when
a configuration needs more than exist (refused: save once in PIA), and
change-tracking (TRK) configurations (none on HRDMO to check against).

**The field catalog** (src/providers/pfcCatalog.ts; MCP
`psft_page_field_config_fields`) lists the fields a configuration can name as
the configurator's Select Fields page does (`EOCC_PGFLDS_DVW.LBLTEXT`
FieldFormula `PageFieldsList`, `GetPageFieldsList`, `SecondaryPageList`; the
Add button `EOCC_CONFIG_WRK.EOCC_ADD_PB`): each component page's fields of
the offered types, subpages walked (a field's level is the subpage
control's plus its own; a subpage's primary record substituted, the original
in `RECNAME_BASE`), invisible fields (`FIELDUSE` 0x2) left out, a related
display field (0x10) carrying its control in `RECNAME1`/`FIELDNAME1`; the key
`level.record.field.pnlfldid.ownLevel.P` (`S` on a secondary page); `PNLNAME`
the (sub)page the field is on, `STDPNLNAME` the page chosen; the label the page
field's text, its record field label by label type, or a message catalog
text. Checked against every stored field row on HRDMO
(tools/lab/pfc-catalog-check.mts): 460 of 477 page-field rows match on every
column; the other 17 name fields their pages have since made invisible,
removed or relabelled (EE_HR_PROC_FL's 2017 rows, `HR_JOBDATA_SUM_FL` changed
2024-11 after its 2021 configuration). The row the catalog builds for Key Job
Code equals PIA's pfc01 row.

**Editing fields** (src/model/pfcFieldEdits.ts; the Customization Strategy
view's sequence rows): a field is configured hidden (`EOCC_VISIBLE_FLAG` N),
display only (`EOCC_DISABLED` Y), required (`EOCC_IS_REQUIRED` Y) or
relabelled (`EOCC_LBL_OVERRIDE` Y, the label in `LBLTEXT`; taken away, the
page's label is restored), or taken out. A sequence with no field keeps one
blank row [pfc02]; adding fills it. A registered component with no Standard
configuration gets a *Create a configuration…* row: a description, sequence 1
(applying to everyone on every form factor -- the record defaults) and its
first field, saved as the page's first save [pfc01] (Event Mapping configured
on each content reference). Text longer than its column is refused. Masking
settings, default values and "set to blank" are not offered yet. At run time: Job Title (`JOBCODE_TBL.DESCR`) saved display only
through these rules showed display only on Define Job Code.

Proof: src/test/pfcWriter.test.ts replays pfc01 and pfc02 from their
before-states -- every configuration row, mapping row (instance ids drawn as
PIA drew them), tombstone, language row, tracking row and counter.
The writer's own save on HRDMO (`pfcw01-add-field`, tools/lab/pfc-save.mts:
JOB_CODE_TBL's lab configuration given back its required Key Job Code) has
PIA's shape: sequence and field rows deleted and inserted; on each content
reference 2 rows tombstoned and 4 inserted, language rows replaced; SCNFM and
SYS +12, RCSCM unmoved; 8 tracking rows inserted and 6 restamped. Removing
the field again returned both content references to PostBuild and
SavePreChange, as pfc02 did. At run time: with the writer's configuration
hiding Short Job Title (`1.JOBCODE_TBL.DESCRSHORT.14.1.P`, `EOCC_VISIBLE_FLAG`
N), Define Job Code (SETUP_HRMS) no longer shows it on the Job Code Profile --
the configurator applied the writer's rows and mapping; no Oracle definition
was changed. (Required on Key Job Code showed nothing: a check box always has
a value.)

## Writing Event Mapping

`psft_event_mapping_get`, `_save` and `_remove` read and write a content
reference's configuration as PeopleTools' Configure Event Mapping page
(PeopleTools > Portal > Related Content Service > Configure Event Mapping,
`PTCSSERVICES.PT_EVMAPPING_FL`) does, established from the page's own saves on
HRDMO -- swept before and after, the page's PeopleCode read for the rest
(`tools/corpus/save-protocol/results/em01`-`em08`, `src/providers/eventMappingWriter.ts`).

A save is the whole grid, as the page's Save is: rows that keep their
instance ID are kept (and changed), rows without one added, stored rows left
out deleted.

| What the page does | Rows |
|---|---|
| Every row of the grid deleted and re-inserted on every Save, in grid order, changed or not [em04-em06] | PSPTCSSRVCONF: VERSION the next SCNFM, stamped; a stored row keeps its other columns, a new one is blank but IS_DEFAULT `N` |
| A new row's instance ID | Two random runs of digits (4 and 5), at least 1,000,000, unused on the content reference |
| The Event Map Parameter, uppercased [em04] | PSPTCS_MAPFLDS EV_PARAM, the value in PTCS_PNLFLDNAME; a new row gets one only when it has a parameter; a stored one is kept |
| A row deleted [em06] | Its rows deleted; PSPTCSSRVCNFDEL at the next SCNFM, after the kept rows' |
| A content reference configured for the first time [em03, em08] | PSPTCS_SRVCFG: menu and component from the registry, ExpandFrame `N`, frame location `B`, VERSION the next RCSCM |
| The list's Remove [em07] | Every row deleted with its tombstone; PSPTCS_SRVCFG deleted, PSPTCSSRVCFGDEL at the next RCSCM; services keep EV_PARAM |
| A re-added content reference [em08] | Its tombstones stay |
| A service mapped for the first time [em03] | PSPTCS_PARAMS EV_PARAM (`For Event Mapping`), the service's VERSION the next RCSDM |
| Data Migration Workbench tracking | PSADSTRACKING rows inserted or refreshed for every row saved (PIA's own key hash, below) |

Each SCNFM and RCSCM step moves SYS too; PSLOCK moves by the same steps (its
RCSDM runs ahead of PSVERSION on HRDMO). The page's level and service are
locked on a saved row: change them by removing the row and adding another.
Unrestricted Prompt only widens the page's prompts beyond the component's own
pages, records and fields; the writer takes any page, record and field that
exists, and warns when one is outside the component.

**Every Save re-saves every row.** Oracle's rows on a content reference --
HRDMO's eight configured ones are all Oracle's -- are restamped with your
operator by any save, as the page restamps them. The plan says how many.

**The tracking key hash** is PeopleTools' (UPGPTADSTRK's CalcKeyHash): the
key fields sorted by name, `( NAME = value )` each, concatenated, SHA-1 over
the UTF-16LE text, base64 -- proven on rows PIA wrote (`src/providers/adsTracking.ts`).

What the captures leave open:
- Whether the fluid page adds EV_PARAM to a service without one, as the
  classic page does (em09, not captured: HRDMO's PIA certificate expired). The
  writer adds it.
- The order in which Remove numbers the tombstones: the related-content API
  reads the rows in the table's storage order, which no column gives; the
  writer numbers them in saved order (the same VERSIONs, perhaps paired with
  other rows).
- A content reference configured first through the fluid page (its Add needs
  the PTPORTALREGISTRY search index, not built on HRDMO): the PSPTCS_SRVCFG
  row is the classic page's and the related-content API's defaults.

### The Event Mapping editor

The Customization Strategy view lists, under Event Mapping, each content
reference the open component (or a page's or record's components) is
registered as: *Configure Event Mapping...* opens it in the Event Mapping
editor (`src/editors/eventMappingPanel.ts`, `media/eventMapping.js`), as do
the configuration rows. The editor is the page's grid -- level, page or
record and field, event, service and its class, processing, Event Map
Parameter, sequence, enabled -- with the page's rules: a saved row's level and
service are locked, the events offered are the level's, names are
uppercased, the component's pages, records and fields are suggested. Save
shows the plan first (the changes, how many unchanged rows the save re-saves,
rows reaching outside the component) and saves only on Save. *Remove
Configuration...* is the list's Remove. Editable on a Writable connection
with an Operator ID; read only otherwise.

### Creating a service

An Event Mapping row runs an Application Class related content service.
*New Service...* in the editor and `psft_event_mapping_create_service` create
what is missing of one: the Application Package, the class (a stub extending
`PT_RCF:ServiceInterface` with `execute()`, created as App Designer creates a
class), then the service as the Define Related Content Service page saves it
[em01] (`src/providers/rcServiceWriter.ts`): PSPTCSSRVDEFN with the page's
defaults for URL type Application Class (service type S, `FieldFormula` /
`IScript_`, escape parameters Y, post map data N, attribute GNRL; the URL,
help text, validity dates and admin URL left NULL), QUALIFYPATH as
PSAPPCLASSDEFN keeps it (`:` for a class at the package root), VERSION the
next RCSDM, stamped; RCSDM and SYS + 1, PSLOCK RCSDM + 2 as the page moves it;
the tracking row. Service ID at most 30 characters, Service Name 18 (the page
keeps 18). The class reads the Event Map Parameter with
`%This.getParamValue("EV_PARAM")` (PT_RCF:ServiceInterface). Editing and
deleting services are not captured, and not offered.

The write scope (`peoplesoft.writeNamePrefix`) applies to the services a save
adds -- the organization's code -- not the content reference, which is
usually Oracle's. No delivered-object guard: no definition changes.

## MCP

| Tool | What it does |
|---|---|
| `psft_customization_get_policy` | The effective prefixes, strategy and both delivered-object policies |
| `psft_object_classify` | Ownership, confidence and evidence of a definition, and what the agent policy would do with a write to it |
| `psft_customization_discover` | Which frameworks could extend a definition: Event Mapping's verdict, evidence and existing configurations; the rest not discovered yet |
| `psft_event_mapping_reference` | Levels, events, processing and parameters, as the page saves them |
| `psft_event_mapping_get` | A content reference's configuration as the page lists it, with instance IDs and the token |
| `psft_event_mapping_save` | Saves the whole configuration as the page does (dryRun: the plan, rows restamped, warnings) |
| `psft_event_mapping_remove` | The list's Remove |
| `psft_event_mapping_create_service` | The package and class when missing, then the Application Class service, as the Define Related Content Service page saves it |

## Proof

- `src/test/ownership.test.ts`: every rule above, the prefix list, the policy.
- `tools/lab/customization-e2e.mts` on HRDMO (read only): delivered records,
  pages, components and PeopleCode; a new event judged by its record; lab
  definitions with and without prefixes; a bolt-on prefix; a baseline
  captured from HRDMO and applied; every DatabaseProvider write reaching the
  guard first, a person's write told from an agent's, PSVERSION unchanged;
  Event Mapping discovery against the Configure Event Mapping page --
  48 of 48.
- `src/test/eventMapping.test.ts`: the levels as the page shows them, the
  verdict, the view's rows.
- `src/test/eventMappingWriter.test.ts`: the page's saves replayed -- from
  each capture's rows before, the writer's plan writes the rows and moves the
  counters the page did [em03-em07]; the tracking hashes; the refusals.
- `tools/lab/event-mapping-e2e.mts` on HRDMO (writes the lab content
  reference only): configure, edit, an unchanged save, refusals, remove,
  configure again -- 35 of 35; a sweep around one writer save
  (`results/emw01-writer-save`) shows the tables the page's save touches and
  no others. `--create-service` creates a service with a scaffolded class
  (6 of 6), and its sweep (`results/emw02-service-create`) shows App
  Designer's class save and the page's service save [em01], nothing else.
- The editor's page driven in a browser with HRDMO's rows and choices
  (rows shown, a row added, its level, page and service set and checked by
  the validator, a row deleted, Revert); not yet inside VS Code.
- `src/test/ownership.test.ts` also proves the origin survives awaits and
  interleaved calls, and that an MCP tool's callback runs as an agent's.
