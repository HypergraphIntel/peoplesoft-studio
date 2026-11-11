# Priority tasks

## Release targeting

See the [release plan](RELEASE_PLAN.md) for explicit assignments:
V1-1 through V1-5 are core 1.0 reliability, support-scope and release gates;
broader structural review, separate-environment promotion and business/AI
workflow expansion target 1.5; platform/parity expansion targets 2.0.
Existing stable-path correctness and safety issues cannot be deferred merely
by assigning a related feature to a later release. The core profile is Oracle / PeopleTools 8.62.09 on Linux/Windows x64;
[qualification evidence](releases/1.0/PROGRESS.md) records completed gates. No
publication date is committed.

## Current priorities after 1.0.0

V1-1 through V1-5 are **complete** for the exact qualified 0.9.8 candidate;
[the evidence tracker](releases/1.0/PROGRESS.md) records native/client/CI scope.
The 1.5 targets V15-1 through V15-5 passed native and installed acceptance and
ship in [release 0.9.9](releases/0.9.9.md); the [1.5 tracker](releases/1.5/PROGRESS.md)
records the evidence. [Release 1.0.0](releases/1.0.0.md) publishes the core as
version 1.0.

| Target | Priority | Next work | Why it matters |
| --- | --- | --- | --- |
| Follow-up / V15-2 | Normal | Calibrated process definition deletion, so a promotion that creates a process definition can be undone | Today such a promotion is applied without undo |
| Follow-up / V15-2 | Normal | Subpackage and class metadata in migration | Subpackage owner IDs migrate (2026-10-26; 153 HRDMO packages had them); subpackage descriptions/comments and class descriptions still refused (none on HRDMO) |
| Follow-up / V15-5 | Low | Native lost-response recovery for Run and Monitor (needs a deliberately lost response) | Covered by fixture tests only |
| 2.0 | Low, later | Canonical built-in function case in the PeopleCode encoder (`none(` stored as `None(`), under the protected baseline | A Studio save of a lower-case built-in is not App Designer's bytes |
| 2.0 | Planned | Production SQL Server/DB2, cross-platform promotion, Workbench and wider parity/security | Requires platform-specific native evidence and a wider product contract |

## 1.0.1 cycle goal — resolve the open MCP issues (set November 11, 2026)

Owner goal: resolve every open E-task below (and the US-MCP intake) in one
cycle, then release 1.0.1 (package version already 1.0.1; CHANGELOG notes are
written as each fix lands). Order:

1. **E22** — a second record edit in one set silently dropped the first. *Fixed in source.*
2. **Length checks before Oracle** — labels over 60 (E27, E40, E46, E55, E69, E78) and record defaults over 18 (E48). *Fixed in source.*
3. **Subpackage creation through the MCP** — E11, E35, E52, E74(1). *Fixed in source (per-write route); staged route waits on a subpackage-delete capture.*
4. **E37 licensed WEBLIBs** — work out how App Designer produces PSPCMPROG.LICENSE_CODE
   (and PROGRUNLOC/PROGFLAGS/PTTOOLSREL) on a WEBLIB save, reproduce it, and refuse at staging until then.
   *Update path fixed in source (value preserved, refusals moved to validation); creation needs a VM capture.*
5. The remaining open E-tasks, grouped: projects (E30, E31, E39, E54, E60), page operations
   (E10, E17, E28, E49, E61), same-set dependencies (E7, E8, E47, E77), encoder/parser forms
   (E5, E6, E50, E57, E65, E67/E51/E76, E68, E74(2)), checks (E3, E4, E21, E44, E59, E62, E63, E71),
   writers (E36, E38, E42, E58, E73, E75), routes (E12, E23/E34), reference notes (E15, E18, E24, E25, E26).

## MCP reliability intake — User Settings (November 4, 2026)

Owner-requested [development notes](change-review/MCP-USER-SETTINGS-LESSONS-2026-11-04.md)
record HCDEV PT8.61.15 failures from User Settings Slices 1–3. These are **open
recommendations, not implemented fixes**, and do not supersede the priorities
above. Start with existing **E37: the MCP cannot update the licensed WEBLIB**;
repeated native App Designer saves were necessary. Detect that boundary before
staging/application and calibrate metadata-preserving updates without clearing
LICENSE_CODE. The note also tracks canonical writer after-images (US-MCP-01),
native length/dropdown/label checks (02), runtime-context checks such as IScript
CommitWork (03), exact project key encoding (04), useful uncertainty/recovery
reporting (05), bounded native diagnostics/tests (06), and approval/visible
delivery communication (07). Each has evidence and acceptance criteria; related
existing issues are cross-referenced rather than declared fixed.

## Open Studio issues from an HRDMO lab build (October 26, 2026)

Found while building a custom application on HRDMO through the MCP. "Fixed in
source" items are uncommitted and need the extension reinstalled before they take effect in the MCP.

| # | Area | Issue | State | Next work |
| --- | --- | --- | --- | --- |
| E1 | PeopleCode checks | `create Pkg:Class().Method()` passed Studio's checks and failed in PIA (2,47: the expression's type stays the created class) | Fixed in source: rule PC011, census 0 of 5,612 delivered `create` expressions | Reinstall; confirm a refused save in the MCP |
| E2 | PeopleCode checks | `All(&obj.Prop)` on an Application Class object passed and failed in PIA (2,32, "Field or temporary variable name required") | Fixed in source: PC007 extended, census 0 flagged | Reinstall; confirm |
| E3 | PeopleCode checks | Studio's checks catch only known rule families, so native compile errors surface one at a time at run time in PIA. App Designer's Tools > Compile Project PeopleCode compiled only the project's table records (not Application Classes or work-record PeopleCode) | Open | A native compile sweep: find an App Designer route that compiles classes and work-record programs (or a Validate Syntax pass driven on the VM), and capture each refusal it finds as a rule |
| E4 | PeopleCode checks | Undeclared variables are not reported (App Designer warns of auto-declared ones); a stale `&http` slipped through | Open | Report auto-declared variables as App Designer does |
| E5 | PeopleCode checks | `Return &a = &b;` needs parentheses, and the error is reported at offset 0 | Open | Report the real position |
| E6 | Encoder | `Evaluate True` with compound `When` conditions is "unsupported PeopleCode statement" (App Designer accepts it), reported on the wrong line | Open | Encode it (corpus calibration, protected baseline) |
| E7 | Change Review | PC006 (imported class must exist) ignores classes staged earlier in the same Change Set, even with `dependsOn`, so dependent classes need one apply per tier | Open | Let PC006 see same-set staged classes ordered before the importer |
| E8 | Change Review | Record PeopleCode staged with an edit of its own record in one set stops with "Authorization context changed before the writer" (the record UPDATE changes the ownership evidence; only an owner *created* in the run is excused). The UI then shows the program UNCERTAIN although the journal shows nothing was written | Open | Excuse an owner UPDATE verified earlier in the same run; show "not written" instead of UNCERTAIN when the stop precedes the writer |
| E9 | Page writer | A push button added with a label was saved as an Image button (PBDISPLAYTYPE 2) and showed no text; App Designer's Text label type is PBDISPLAYTYPE 0 and sizes the button to its text | Fixed in source (PBDISPLAYTYPE 0 when labelled) | Reinstall; capture App Designer's text-button sizing |
| E10 | Page writer | No MCP operation for an Edit Box's Password option. Evidence: App Designer's tick took DSPLFORMAT 0x200008 to 0x208008 (+0x8000) on a lab page's secret field | Open | Add a `password` page operation from that capture |
| E11 | MCP | No route to create a subpackage (created in App Designer) | Fixed in source for 1.0.1 (2026-11-11): psft_create_package ROOT:Sub[:Sub2] stages through the app-package adapter (subpackageChange, createSubpackages, deleteSubpackages); undo calibrated from App Designer captures tools/lab/results/ad-captures-2026-11-11; legacy per-write route without Change Review. | A class in a subpackage staged in the same set still needs the subpackage applied first (E47); reinstall and confirm |
| E12 | MCP | No physical build route: Build > Create Tables and Alter Tables (a field added to an existing table) are done in App Designer. Every use is logged under "App Designer uses" below | Open | A reviewed Build route (Create / Alter / indexes, as the extension's Build already generates), or a generated script for the developer to run |
| E13 | Field writer | A number field's LENGTH counts the decimal point (5/4 builds NUMBER(4,4)); translate values are at most 4 characters | Partly done: `psft_create_field` describes both (uncommitted) | Refuse or warn on a decimal number whose precision leaves no integer digits, and on a translate field longer than 4 |
| E14 | MCP writes | Approval prompts can expire before the developer sees them ("This approval request expired") | Known; mitigated by `peoplesoft.mcp.writes: allow` for this build | Revisit with the AI Write Approvals timeout work; switch the setting back after the build |
| E15 | PeopleCode reference | `Record.SelectByKey()` that finds no row clears the record, keys included (HRDMO 2026-10-26: a configuration seeder set keys, checked with SelectByKey, then inserted rows with blank keys; then a credential store did the same and stored an encrypted value under a blank reference). Agent-written existence checks fall into this: twice in one build | Open | Add it to `psft_peoplecode_reference`; consider a check for Insert after a failed SelectByKey on the same record |
| E16 | PeopleCode checks | A method parameter named after a stored property of its class (`Reader(&config)` with `property ... Config;`) passed Studio's checks and failed in PIA (2,31, "Duplicate parameter name") | Fixed in source: rule PC012 (0 of 1,640 delivered classes; get/set properties excluded, as 13 delivered classes use those names) | Reinstall; confirm |
| E17 | Page writer | The key field on a page made by `psft_page_create` renders editable in Update mode; App Designer's own key placement is display-only there | Open | Check whether Studio's page create should default key fields as App Designer does |
| E18 | PeopleCode reference | 8.62 JSON API facts learned at run time: a `JsonBuilder` needs its root opened (`StartObjectReturnsTrue(name)`, as delivered BEN_CHATBOT does) before `AddProperty`, or a later nested `AddProperty` fails "AddProperty can not be invoked on array"; `JsonObject.ToString()` writes `"name" : "value"` (spaces around the colon), so text matching must not assume compact JSON | Open | Add both to `psft_peoplecode_reference`; consider a check for `AddProperty` before any `StartObject` on a fresh `CreateJsonBuilder()` |
| E19 | PeopleCode checks | `%This.Prop = ...` for a readonly property passed Studio's checks and failed in PIA (2,46, "property cannot be changed") | Fixed in source: rule PC013 (delivered: 1,156 `&Prop =`, 0 through %This) | Reinstall; confirm |
| E20 | PeopleCode checks | `SQLExec("...", &instanceVar)` passed and failed at run time (2,284, "parameter 2 is neither a record object nor a name") | Fixed in source: PC008 extended to SQLExec outputs (census 0 flagged; get/set property names used as Locals excluded) | Reinstall; confirm |
| E21 | PeopleCode checks | A class whose declaration (between `class` and `end-class`) contained two whole method bodies passed Studio's checks (2026-10-26, caught by reading the file before staging). App Designer would refuse it | Open | Report statements or method bodies inside a class declaration |
| E22 | Change Review (record edits) | Two `psft_edit_record` calls on the same record in one Change Set (insert one field, then another): the second revised the staged object from the live record, so the first insert was silently dropped. The set applied and verified, and the record read back without the first field | Fixed in source for 1.0.1 (2026-11-11): the second call builds on the staged proposal (recordEditFromProposal in structuredHeaders.ts, reviewRouting.ts); a second psft_edit_page or psft_ae_edit on a staged object is refused instead of replacing it. Test in reviewStructuredHeaders.test.ts | Pages: build on the staged after-image instead of refusing (needs a layout from a page snapshot) |
| E23 | Security | No Studio route to grant a web library's IScripts on a permission list (PIA's Web Libraries tab, Full Access, stores one PSAUTHITEM row per IScript: MENUNAME = the web library record, BARNAME = the field, BARITEMNAME = the event (FieldFormula), PNLITEMNAME = the IScript function, DISPLAYONLY 0, AUTHORIZEDACTIONS 4; seen on HRDMO 2026-10-27). `psft_security_grant` covers component pages and process groups only, so a custom web library had to be granted in PIA | Open | Add web library grants to `psft_security_grant` (Web Libraries tab, as the Permission Lists page saves it) |
| E24 | PeopleCode reference | IScript input on HRDMO 8.62: a fetch() POST with a JSON body (Content-Type application/json or text/plain) reached the IScript with `%Request.GetContentBody()` empty, while form-encoded parameters read with `%Request.GetParameter` are the dependable route. Root cause not isolated (a custom HCDEV library uses GetContentBody, so it may depend on the caller or the web profile) | Open | Note in `psft_peoplecode_reference` (IScripts): read input with GetParameter; treat GetContentBody as unverified until a capture shows when it is filled |
| E25 | Fluid reference | Markup injected into a Fluid page (Global Event Mapping, AddJavaScript) inherits Fluid's base styles: every `form` gets height 100%, which collapsed an injected panel's scrolling area and pushed its input off screen. Injected UI must reset form height (and button/textarea looks) | Open | Add to the Event Mapping / branding reference text, next to the Global Event Mapping notes |
| E26 | PeopleCode reference / checks | 8.62 `JsonObject.ToString()` (on a `JsonBuilder` root) does not escape a double quote inside a string value: `AddProperty("html", "<div class=\"x\">")` came out as `"html" : "<div class="x">"`, invalid JSON, so the browser could not parse the response (HRDMO 2026-10-27). The same applies to anything sent with user or admin text (an outbound API request). A custom HCDEV web library carries its own JsonEscape, which fits | Open | Add to `psft_peoplecode_reference` (JSON): ToString is not a serializer for untrusted text; escape by hand. Consider a PC warning when `JsonObject.ToString()` output is written to `%Response` or sent over HTTP |
| E27 | Page writer | `psft_page_create` sent a 238-character Static Text label to the database and failed with ORA-12899 (PSPNLFIELD.LBLTEXT holds 60); the transaction rolled back, nothing was left. App Designer limits the text in its dialog | Fixed in source for 1.0.1 (2026-11-11): labels over 60 refused in applyPageOperations and planPageSave (pageLabelRefusal, model/pageUse.ts); tests in pageLayout.test.ts | Reinstall; confirm the refusal through the MCP |
| E28 | Page writer / MCP | A labelled push button added by the running (installed) extension is stored as an Image button (PBDISPLAYTYPE 2) and draws nothing in PIA or App Designer: a lab page's run button (2026-10-27). The source rule that makes a labelled button Text (0) was added after that build. `psft_edit_page` has no operation for a button's Label Type, so it was set in App Designer (Label tab, Text). Also, a `set_label` with text on an existing Image button leaves it an Image button | Open | Ship the source rule; add a button Label Type (Text / Image / Both) to `set_label`, and have `set_label` with text on an Image button with no image make it Text |
| E29 | Page writer | `psft_page_create` / `psft_edit_page` stored a grid column added with an explicit width as size type 0 (Standard), which PIA and App Designer ignore: the column is sized from the field's length (DESCR254 drew 2,540 pixels; App Designer's next save wrote that width). A width is a custom size (2), as 40,720 of HRDMO's sized grid Edit Boxes are | Fixed in source (2026-10-27, `pageOperations.ts`, test in pageLayout.test.ts); needs a build | — |
| E30 | Projects | `psft_add_to_project` cannot remove an item: a lab project still holds 7 delivered fields (CLASSID, CREATED_DTTM, DESCR, LASTUPDDTTM, LASTUPDOPRID, OPRID, SEQNUM) that an early include-related added, and a migration would copy them over the target's own | Open | A remove-items operation (PSPROJECTITEM delete, version bump), staged like project creation; until then remove them in App Designer |
| E31 | Projects | `psft_add_to_project` refuses roles ("Roles cannot be inserted into a project yet") so a custom application's roles and permission lists cannot be put in its project | Open | Insert roles (19) and permission lists (53) as project items, subject to Settings > Project Contents |
| E32 | Page writer | `set_occurs_level` (and `set_level`) refused a grid, scroll area or rule added earlier in the same `psft_page_create` / `psft_edit_page` request ("is not a Scroll Bar, Grid or Scroll Area"): an added control has no stored FIELDTYPE, and the check read only that. A page with a level-2 grid inside a level-1 scroll area could not be created in one call | Fixed in source (2026-10-27, `pageOperations.ts` uses the added control's kind; test in pageLayout.test.ts); needs a build | — |
| E33 | PeopleCode checks | Two programs that App Designer refuses passed Studio's checks and saved, then stopped at run time: `All(RTrim(&role))` ("Field or temporary variable name required", 2,32 -- PC007 skipped any argument containing parentheses) and `Local integer &i, &latest = 0;` ("Syntax error: expecting statement", 2,42 -- no rule) | Fixed in source (2026-10-27): PC007 now refuses a call result, new PC014 refuses an initialiser in a multi-variable declaration; a third, `GetRow().ParentRow` (2,52), gained PC015; a class saved without a declared method's body (run time 2,81; App Designer's syntax check misses it) gained PC016; tests in peopleCodeSemantics.test.ts; HCDEV census 0 flagged of 35,831; needs a build | — |
| E34 | Security writer | psft_security_grant grants components (PSAUTHITEM pages) and process groups only; a web library IScript function (Permission Lists > Web Libraries: PSAUTHITEM rows for the WEBLIB record's field and event) cannot be granted, so a new IScript needs PIA by hand | Open (2026-10-27) | — |
| E35 | Change Review / packages | A reviewed new class needs its subpackages to exist already, but no MCP tool creates a subpackage (psft_create_package takes a root name only; "Invalid Application Package name" for A:B:C), and the reviewed package writer refuses changes to an existing package. A new subpackage today needs the VS Code Insert Subpackage command (an unreviewed direct write). Add a reviewed subpackage create (the c05 writer exists) | Fixed in source for 1.0.1 (2026-11-11): psft_create_package ROOT:Sub[:Sub2] stages through the app-package adapter (subpackageChange, createSubpackages, deleteSubpackages); undo calibrated from App Designer captures tools/lab/results/ad-captures-2026-11-11; legacy per-write route without Change Review. | A class in a subpackage staged in the same set still needs the subpackage applied first (E47); reinstall and confirm |
| E36 | Portal writer | psft_portal_create_content_reference refuses node LOCAL_NODE ("Content provider node does not exist"), but PIA stores LOCAL_NODE for "Local Node" (the portable alias; the lab application's existing content references use it). A new reference has to name the real default node (PSFT_HR on HRDMO), which does not migrate cleanly | Open (2026-10-28) | Accept LOCAL_NODE as PIA does |
| E37 | PeopleCode writer | On the 8.61 site database almost every web library (WEBLIB) program row carries a PSPCMPROG.LICENSE_CODE value (a base64 hash written by App Designer; HRDMO rows saved through Studio have a blank one). The reviewed PeopleCode writer refuses to update such a row ("PROGRUNLOC, PROGFLAGS, LICENSE_CODE or PTTOOLSREL holds a value native saves were not observed to write"), so a Change Set stopped PARTIALLY_APPLIED with the object UNCERTAIN although nothing was written (2026-10-29). The update had to be pasted in App Designer. After that App Designer save (new source, about 100 changed lines) LICENSE_CODE was byte-for-byte unchanged, so it is not a hash of the program text (key, owner or site derived?) | Fixed in source for 1.0.1 (2026-11-11): update keeps LICENSE_CODE; a new program on a WEBLIB record copies the record's value (recordLicenseCode); validation runs checkStoredProgram. Captured (tools/lab/results/ad-captures-2026-11-11): one value per WEBLIB record, same after delete/recreate, kept on update; HCDEV vs HRDMO 158/158 identical -> fixed function of the record name, not a plain/salted digest (23 hash algorithms tried) | A brand-new WEBLIB record's first program is still blank (AD would write F(record)); reinstall and confirm an HCDEV WEBLIB update |
| E38 | Change Review (PeopleCode) | A program staged with characters the target database cannot store (non-Unicode Latin-9 site database, PSSTATUS.UNICODE_ENABLED 0: zero-width characters, an emoji) validated READY_FOR_REVIEW and only failed at apply, when the writer's read-back found different text; the set stopped PARTIALLY_APPLIED (2026-10-29) | Open (2026-10-29) | Check the source against the target's character set when staging and validating (NLS_CHARACTERSET, UNICODE_ENABLED) and refuse with the offending line and character |
| E39 | Project writer | psft_create_project always goes through Change Review on Oracle, and its reviewed adapter refuses on PeopleTools 8.61 ("Project reversal requires Oracle PeopleTools 8.62"), so an empty project cannot be created on the 8.61 site database at all (2026-10-29). psft_add_to_project works there, but only into an existing project | Open (2026-10-29) | Calibrate project create/reversal on 8.61, or fall back to the legacy confirmed create on releases the reviewed adapter does not cover |
| E40 | Page writer | psft_edit_page sends a Static Text label longer than PSPNLFIELD.LBLTEXT (60 characters) to Oracle and fails with ORA-12899 instead of refusing it up front with the limit. Also: an added field control is checked against the live record only, so a field staged into the record in the same Change Set (dependsOn) cannot be placed on a page until that set is applied (found 2026-10-30 adding ZZ_KBDOC.ZZ_KB_LNKLBL); and set_order accepts only stored ids (minor: an added control is already placed after the control before it in reading order, as App Designer does). | Fixed in source for 1.0.1 (2026-11-11): labels over 60 refused in applyPageOperations and planPageSave (pageLabelRefusal, model/pageUse.ts); tests in pageLayout.test.ts | Reinstall; confirm the refusal through the MCP |
| E41 | PeopleCode checks | A `Local` named after a `readonly` property of its class (`Local string &stage;` with `property string Stage readonly;`) passed Studio's checks; App Designer refuses it (2,39, "Duplicate temporary variable declaration") and the class would not load at run time (`CreateObject` of a class importing it failed) | Fixed in source: PC004 extended to readonly properties (delivered: 1,193 stored readonly properties, 0 Locals of their name; 19 Locals share a plain property's name, accepted) and to class constants, any case (2,66; 83 delivered classes with constants, 0 Locals of their name) | Reinstall; confirm |
| E42 | PeopleCode writer | An Application Class whose definition (PSAPPCLASSDEFN) exists but whose PeopleCode was deleted (no PSPCMPROG/PSPCMTXT, a PSPCMPROGDEL marker; left by App Designer, 8.61 site database, 2026-10-30) cannot be saved: the class adapter refuses an existing class and the PeopleCode adapter needs a stored program ("already exists; its source saves through the PeopleCode review adapter"). Second occurrence 2026-10-31: App Designer deleted a lab class's PeopleCode after its 2,31 error, which also left the pending fix set CONFLICTED. Fix shape: lifecycleReview routes a class row with no PSPCMPROG to writeClassChange (live branch), and savePeopleCode accepts objectIds[0]=104 when the PSAPPCLASSDEFN row exists (clearing PSPCMPROGDEL); needs a native trial before release | Open | Treat a definition with no program as a PeopleCode create (clear the PSPCMPROGDEL marker, as the class lifecycle already does on re-create) |
| E43 | PeopleCode checks | `CreateArrayRept(0, n)` assigned to an `array of integer` variable passes Studio's checks and App Designer's Validate Syntax, then fails at run time: "Cannot convert type Array of Number to object type Array of Integer" (180,604; a lab class, 8.61 site database, 2026-10-30). A numeric literal makes an array of Number | Done | PC019 flags it (Local, instance or property; test added; PEOPLECODE_RULES.md). Second occurrence 2026-10-31: a form-definition class's readonly property, at capability validation |
| E44 | PeopleCode checks | A `CreateSQL` statement that starts with `WITH` (Oracle subquery factoring) passes Studio's checks and App Designer's syntax check, then fails at the first Fetch: "SQL.Fetch: object isn't open on a select" (2,288; a lab class, 8.61 site database, 2026-10-30). PeopleCode opens a cursor only for a statement that starts with SELECT; `SELECT ... FROM (WITH ... SELECT ...)` works | Open | Warn when a CreateSQL text (literal start or known variable) begins with WITH; add to psft_peoplecode_reference |
| E45 | PeopleCode checks | A method parameter named after a class instance variable (`instance number &record;` with `method Who(&emplid As string, &record As number)`) passed Studio validation, saved and decoded exactly, but PIA reported "Class ... was not found" (180,74) and App Designer 2,31 "Duplicate parameter name" (a lab class, 8.61 site database, 2026-10-31). None of the 1,493 delivered classes does it | Done | PC012 now also flags parameters named after instance variables (test added; PEOPLECODE_RULES.md) |
| E46 | Page writer | psft_page_create / psft_edit_page accepted a 150-character Static Text label and failed inside the save with ORA-12899 (PSPNLFIELD.LBLTEXT holds 60) (8.61 site database, 2026-10-31). Nothing was written, but the refusal came from Oracle, not from the writer's checks | Fixed in source for 1.0.1 (2026-11-11): labels over 60 refused in applyPageOperations and planPageSave (pageLabelRefusal, model/pageUse.ts); tests in pageLayout.test.ts | Reinstall; confirm the refusal through the MCP |
| E47 | Change Review | A class that imports a class created earlier in the same Change Set can no longer be staged: the save check now looks imports up in the live database (PC006), so dependsOn on the staged creation does not help (2026-10-31; it did on 2026-10-31 earlier, before the rebuild). A new package of classes that import each other needs one apply per import level | Open | Let PC006 accept an import satisfied by a declared dependsOn CREATE of that class in the same set. 2026-11-01: an import of a class CREATEd earlier in the same set was accepted without dependsOn (ZZ_MFA:Gate, then a class importing it, one set) -- recheck whether only cross-set imports are refused. Later the same day: a class importing a class CREATEd earlier in the same set was refused when both are in the same subpackage, and accepted when they are in different subpackages; a third case refused across subpackages. Pattern found 2026-11-01: an UPDATE to an existing class may import a class staged in the same set; a new (CREATE) class may not |
| E48 | Record writer | psft_create_record accepted a set_default constant of 24 characters ("https://auth.pingone.com") and failed inside the save with ORA-12899 (PSRECFIELD.DEFFIELDNAME holds 18) (8.61 site database, 2026-11-01). Nothing was written; the refusal came from Oracle. E46 (a 68-character page label) recurred the same day | Fixed in source for 1.0.1 (2026-11-11): record default constants over 18 (setDefault in recordEdit.ts); tests in recordEdit.test.ts | Reinstall; confirm the refusal through the MCP |
| E49 | Page writer | psft_page_create's add operation stored a given label text but kept the field control's label type RFT Long (labelType 3), so PIA showed the field's own label and ignored the text (ZZ_MFA_SETUP pages, 8.61 site database, 2026-11-01); a later set_label with labelType 1 was needed | Open | When add carries a label for a record-field control, store it as Text (labelType 1) as App Designer does when a label is typed, or refuse the label and point to set_label |
| E50 | PeopleCode writer | Source with a negative literal argument written `-1` passes the offline validator, but the save refuses it with only "The compiled program does not decode back to the source being saved"; writing `- 1` (the decoder's form) saves (8.61 site database, 2026-11-01) | Open | Normalize unary minus before the round-trip comparison, or name the first differing line in the refusal |
| E51 | PeopleCode checks | A method parameter named `&instance` fails the validator with the unrelated message "class: bare identifiers are only supported as calls", at the class line; renaming the parameter clears it (8.61 site database, 2026-11-01). Whether App Designer also refuses the name is not checked | Open | Report the real line and name, or accept it if App Designer does |
| E52 | Package writer | A class in a new subpackage is refused with "Create subpackage ... first", and psft_create_package creates root packages only, so a new subpackage needs App Designer (8.61 site database, 2026-11-01) | Fixed in source for 1.0.1 (2026-11-11): psft_create_package ROOT:Sub[:Sub2] stages through the app-package adapter (subpackageChange, createSubpackages, deleteSubpackages); undo calibrated from App Designer captures tools/lab/results/ad-captures-2026-11-11; legacy per-write route without Change Review. | A class in a subpackage staged in the same set still needs the subpackage applied first (E47); reinstall and confirm |
| E53 | Page writer | A grid filled by PeopleCode needs a Dynamic View with No Auto Select, No Auto Update, No Row Insert and No Row Delete. Before this, Studio passed a scroll of only Derived/Work fields, and App Designer refused it with 15,19 | Check and `set_scroll_use` written and unit tested 2026-11-01, uncommitted; not run through an installed build. The pattern itself is proven: the four boxes ticked in App Designer stored 0x3C0 and the grid filled | Capture each box's bit on the lab page; run `set_scroll_use` end to end and open the page; create Dynamic Views directly in `psft_create_record` |
| E54 | Change Review (projects) | `psft_create_project` always stages, and on 8.61 validation refuses it ("Project reversal requires Oracle PeopleTools 8.62"), so it fails the whole Change Set it is in and a project cannot be created through the MCP there | Open | Give 8.61 a calibrated project reversal, or refuse at staging so the rest of the set is not lost |
| E55 | Page writer | A page label over 60 characters (PSPNLFIELD.LBLTEXT) reaches Oracle as a raw ORA-12899 instead of a check naming the control | Fixed in source for 1.0.1 (2026-11-11): labels over 60 refused in applyPageOperations and planPageSave (pageLabelRefusal, model/pageUse.ts); tests in pageLayout.test.ts | Reinstall; confirm the refusal through the MCP |
| E59 | PeopleCode checks | A call to an array method PeopleCode does not have (`&keys.Splice(&j, 0, &v)`) passed Studio's checks and the encode/decode round trip; App Designer's Validate Syntax refused it: "Splice is not a method of class Array. (2,52)" (8.61 site database, 2026-11-02). Insert is `Replace(&j, 0, &v)` | Open | Check built-in object methods (Array, Rowset, Record, Field, SQL ...) against the release's method list |
| E60 | MCP projects | `psft_add_to_project` with an HTML definition keyed by name only (`{type: 51, parts: ["ZZ_DFIXTURES"]}`) failed with "ZZ_DFIXTURES has no content type." The key needs the content type as a second part (`["ZZ_DFIXTURES", "4"]`, as `psft_search_definitions` returns it); the message does not say so (8.61 site database, 2026-11-02) | Fixed by commit 6f15d498 (E70): psft_add_to_project builds keys with keyFromInput/completeKey, which adds HTML's content type 4 | Reinstall; confirm a name-only HTML add |
| E61 | Page checks | `psft_page_create` / `psft_edit_page` saved a Drop Down List on a record field with no table edit (no translate, prompt or yes/no edit on the record field): ZZ_DPLAN (ZZ_DPLAN_WRK.ZZ_DOBJ_TYPE) and earlier ZZ_PAY_RULE (ZZ_PAY_LEVEL, ZZ_PAY_CAT, ZZ_PAY_JOB). App Designer's validation refuses each: "No table edit specified for recfield of Drop Down List in page definition (15,83)" (8.61 site database, 2026-11-02). Fixed by `set_edits translate` on the record fields | Open | Add (15,83) to the page checks: a drop-down needs its record field to have a translate, prompt or yes/no edit; suggest the edit when the field has translate values |
| E62 | PeopleCode checks | A value-returning method of another Application Class called as a statement on a typed variable (`&v.Validate(&json);` with `Local ZZ_PKG:Validator &v`) passes Studio's checks; App Designer refuses it as PC021 does the `%This` form (2,45). The developer fixed eleven such calls in App Designer (8.61 site database, 2026-11-03). Calls on an `object` variable compiled and ran | Open | Extend PC021 with a connection: read the imported class's method signatures and refuse a discarded result on a variable of that type |
| E63 | PeopleCode checks | A class property named `Error` passed Studio's checks; App Designer refused it and member reads of it (`&doc.Error`), and the developer renamed it ErrorMsg (8.61 site database, 2026-11-03). No delivered class declares or reads such a property. Error message not yet captured | Open | Capture App Designer's message, then refuse `Error` (and check `Warning`) as a property name and after a dot, as PC018 does True/False/Null |
| E73 | Change Review (PeopleCode) | A class whose source had a method-signature comment typed as `/+ &text As String +/` (capital "As") was written correctly, but post-write verification stopped the Change Set as PARTIALLY_APPLIED / UNCERTAIN: the stored text reads `/+ &text as String +/`, the canonical form App Designer and the encoder generate, so the exact text comparison failed on that comment alone (8.61 site database, 2026-11-05) | Open | Normalize the generated `/+ ... +/` signature annotations before staging (or compare them case-insensitively in post-write verification), or warn about a non-canonical annotation in the PeopleCode checks |
| E74 | Change Review / Application Packages | (1) The MCP cannot create a subpackage: `psft_save_peoplecode` for a class in a new subpackage refuses ("Create subpackage ZZ_AI_ADMIN:Security first") and `psft_create_package` accepts root packages only, so nine subpackages were created by the owner in the VS Code package tree (HRDMO, ZZ_AI_ADMIN refactor, 2026-11-07). (2) The PeopleCode writer stopped an approved update of ZZ_AI_ADMIN:DiagnosticChat: "its source does not re-encode to the stored PSPCMPROG" (an App Designer-compiled class the encoder does not reproduce), so the edit (31 CreateObject strings) went through App Designer | Subpackage part fixed in source for 1.0.1 (2026-11-11): psft_create_package ROOT:Sub[:Sub2] stages through the app-package adapter (subpackageChange, createSubpackages, deleteSubpackages); undo calibrated from App Designer captures tools/lab/results/ad-captures-2026-11-11; legacy per-write route without Change Review. (2) DiagnosticChat re-encode still open | A class in a subpackage staged in the same set still needs the subpackage applied first (E47); reinstall and confirm |
| E75 | Application Class deletion | `psft_delete_application_class` refuses when anything outside the package names the package at all (PSPCMNAME PACKAGEROOT), not the class being deleted: two ZZ_AI_ADMIN admin buttons that import `ZZ_AI_ADMIN:Knowledge:KnowledgeQuery` (which stays) blocked deleting all 50 relocated root classes (HRDMO, 2026-11-07). Worked around by having those buttons create the class by name | Open | Refuse only for outside references to the class being deleted (QUALIFYPATH and REFNAME), or to a class in the same set of deletions |
| E76 | PeopleCode checks | An application class method parameter named `&instance` passed nothing useful to the developer: the class failed to parse ("instance" is a keyword of the class declaration) and Studio reported the error at the `class` line, not at the method declaration (HRDMO, ZZ_AI_ADMIN:Operations:OpScheduler, 2026-11-07). Renaming it `&prcsInstance` fixed it | Open | Report the parameter and its line, or refuse keyword-named parameters (instance, property, method, ...) in the PeopleCode checks |
| E77 | Change Review (records + PeopleCode/pages) | A Change Set that adds fields to a record (psft_edit_record insert_field) cannot also carry what uses those fields: (1) the record field's new FieldChange was staged, but on apply the set stopped PARTIALLY_APPLIED before writing it, "Authorization context changed before the writer" (nothing written; the item UNCERTAIN), so the definitions after it never ran; (2) psft_edit_page refuses a control on a staged field ("is not a field of record"); dependsOn does not help (HRDMO, ZZ_AI_KDISC_WRK, 2026-11-08). Worked around with a second Change Set after the record was applied | Open | Let same-set dependents be validated against the staged record and re-authorize after an earlier object of the set changes the record |
| E78 | Page writer | psft_edit_page set_label on a Static Text with 124 characters failed while staging with ORA-12899 (PSPNLFIELD.LBLTEXT holds 60) instead of a checked refusal (HRDMO, ZZ_AI_KDISC, 2026-11-08) | Fixed in source for 1.0.1 (2026-11-11): labels over 60 refused in applyPageOperations and planPageSave (pageLabelRefusal, model/pageUse.ts); tests in pageLayout.test.ts | Reinstall; confirm the refusal through the MCP |
| E72 | PeopleCode checks | A class property named `Doc` passed Studio's checks; App Designer's Validate Syntax refused the reference `&x.Doc` with 2,49 "Dot not followed by Id". `Doc` is reserved though it is not an encoder keyword token (8.61 site database, 2026-11-05) | Fixed (uncommitted): `doc` added to PC022's reserved member names in `src/peoplecode/semanticCheck.ts`, test in `peopleCodeSemantics.test.ts` | Commit with the next Studio change |
| E71 | PeopleCode checks | An application class with `Constant` declarations in its public section (after the properties, before any `private`) passed Studio's rules and the 8.61 round trip, but App Designer refused it on apply: "Syntax error: expecting end-class" (2,42), and every caller failed with "Class ... was not found" (8.61 site database, 2026-11-04). Moving the constants under `private` fixed it | Open | Refuse Constant (and instance) declarations outside the private section, naming the line |
| E70 | Definition reader | psft_get_definition failed with NJS-105 ("value is not a number") on an HTML definition named without its second key part (`[name]` instead of `[name, "4"]`, 8.61 site database, 2026-11-03). The reader itself works: the full key returns the text | Fixed in commit 6f15d498 (2026-11-04): an HTML or XSLT key given only its name gets its fixed content type (4, 6) in every MCP tool (completeKey in keyFromInput), and a failed psft_get_definition read with fewer key parts than the type takes names the parts it needs (keyPartsProblem). Tests in mcpDefinitionTypes.test.ts; full suite 2306 pass, 0 fail | Reinstall; confirm a name-only HTML read |
| E69 | Page writer | psft_edit_page sent a 73-character Static Text label to HCDEV and failed with ORA-12899 (PSPNLFIELD.LBLTEXT is at most 60) instead of refusing it before the write (2026-11-03) | Fixed in source for 1.0.1 (2026-11-11): labels over 60 refused in applyPageOperations and planPageSave (pageLabelRefusal, model/pageUse.ts); tests in pageLayout.test.ts | Reinstall; confirm the refusal through the MCP |
| E68 | PeopleCode decoder | A negative numeric literal passed as an argument (`AddToDate(%Date, 0, 0, -7)`) decodes as `- 7`, so the 8.61 round trip of a lab class was not text-exact (2026-11-03). Semantics are the same; positive offsets were used instead | Open | Check how App Designer prints a unary minus before a literal on the 8.61 site client and decode to match |
| E67 | PeopleCode checks | A method parameter named `&instance` (`method Probe(&tag As string, &instance As number, &holdMs As number)`) made Studio read `instance As number, &holdMs` as an instance-variable declaration: PC012 then reported "parameter &holdMs has the name of instance variable &holdMs" for two methods, and the encoder refused with "no type name for PACKAGE.AS" (lab class, 2026-11-03). Renaming the parameter cleared both | Open | Match the `instance` keyword only at the start of a declaration line, never after `&` |
| E66 | PeopleCode checks | A lab class with `method Alias(&rec As string)` (and another with `method Step(...)`) passed Studio's checks and encoder; PIA failed to compile it and App Designer reported 2,42, "Syntax error: expecting Identifier" (8.61 site database, 2026-11-03) | Fixed in source (2026-11-03): PC022 refuses a method or property named after a keyword other than Create, Value and Component, the only ones delivered classes use; 0 hits in 1,510 snapshot classes | Reinstall; confirm a refused save |
| E65 | PeopleCode encoder | The encoder refuses three expression forms with "expected )" or "keyword Not is not a supported call name": a comparison passed as a call argument (`%This.Check(&a <> "Y", "x")`), `Not` starting a call argument (`F( Not &o.M())`), and `Not` on the right of an assignment (`&b = Not &b;`). Parenthesizing the comparison (`F((&a <> "Y"), "x")`) or writing `(&o.M() = False)` encodes, round-trips exactly on 8.61 and was used instead (lab classes, 2026-11-03). The reported offset is relative to the method body, not the program, which made the first failure hard to find | Open | Check App Designer's behaviour for each form on the 8.61 site client; support what it compiles, and report the method name with the offset |
| E64 | PeopleCode checks | A Constant whose name differs only in case from an instance variable or a Local of another method (`Constant &OPS` with `instance array of string &ops`; `Constant &CATS` with `Local ... &cats`) passed Studio's checks; App Designer refused it and the developer renamed the constants (8.61 site database, 2026-11-03). Studio already refuses a Local in the same method (PC004) | Fixed in source (2026-11-03): PC004 covers parameters, instance variables and array-typed Locals; App Designer's message for a parameter captured (2,66); 0 hits in 35,831 snapshot programs | Reinstall; confirm a refused save |
| E58 | Record writer | `set_use` with `key: true` and `altSearch: true` on one field saved only the alternate-search flag and silently dropped the key flag, so the table's unique index was built one column short (8.61 site database, 2026-11-02). Asking for key alone restores it | Fixed in source for 1.0.1 (2026-11-11): setUse refuses two key kinds in one change (recordEdit.ts; test in recordEdit.test.ts) | Reinstall; confirm |
| E57 | PeopleCode compiler | A comparison passed directly as a method argument (`%This.YN(&flag = 1)`) is refused with "expected )", and the reported position is wrong: the offset and line pointed into the class's leading comment, so the cause had to be found by stubbing method bodies (8.61 site database, 2026-11-02). Wrapping the comparison in parentheses compiles | Open | Check whether App Designer accepts the unwrapped form; either accept it or name the rule; report the true position |
| E56 | PeopleCode checks | A `Local` named after a writable property with no get / set block (`Local string &problem;` beside `property string Problem;`) passed Studio's checks; the class failed to load at run time (2,39). Studio had recorded this as allowed, from delivered source that does it | Fixed in source: PC004 extended to every stored property; one delivered class (17 Locals) still does it | Installed with the next package; refuses edits to that delivered class if anyone edits it |

## Run and Monitor — native acceptance complete

RT-L1 through RT-L4 passed on October 22, 2026 with the installed extension on
HRDMO (instances 607496, 607500 and 607501; the downloaded CSV matched its
SHA-256). The gateway prerequisite was met by setting Req Verification to None
on the PROCESSREQUEST `PRCS_*` operations; the prepared nginx TLS route was not
needed. Native lost-response recovery remains fixture-tested only. See
[scope and evidence](PROCESS_SCHEDULER_RUNTIME.md).

## Earlier priority tasks — October 20, 2026

User-requested scope: complete all five tasks below. Source changes, fixture
checks, installed UI checks and live runtime evidence are separate gates.
This historical inventory is retained; the current 1.0 qualification and later release targets above define the active completion boundary.

| Task | Current state | Acceptance required |
| --- | --- | --- |
| 1. HRDMO report delivery | Complete. Targeted idle-agent recycle corrected its stale port 80 connection; the exact HTTPS transfer location now disables gzip, fixing XML acknowledgement parsing. Both original instances are Posted to Web (5); native View Log/Trace opens both stdout files and downloads both exact 123-byte CSVs. | [Native delivery evidence](../tools/lab/results/report-delivery-2026-10-20.json), independently refreshed client/runtime reports. |
| 2. Write confirmation timeout recovery | Implemented and packaged. AI Write Approvals has pending cards/status bar and expired/cancelled/declined/approved outcomes; fresh retries use new IDs. Current source verification: 2,149 pass / one skipped. Installed real deadline/decline/allow/native-refusal checks pass without changing the lab Process. | Visible pending confirmations, explicit terminal outcomes and safe retry; expiry/cancellation and late clicks never write; installed workflow verification. |
| 3. Deferred Build Request progress | MCP schema now accepts PENDING, with explicit deferred-work guidance. Focused and production HTTP checks pass, including FAILED to PENDING and preserved history. Actual installed tools/list and report/get accept PENDING, keep the create object unfinished, restore BUILT and retain history. | Discoverable MCP schema accepts PENDING, unfinished objects remain outstanding, history preserved, approval gates retained. |
| 4. Expanded project migration | Complete. HTML, freeform style sheets, standalone/associated PeopleCode, Query and Menu (Codex), plus fields with every stored property and translate values, Application Packages with classes and root properties, SubRecords and subrecord rows, SQL Table user indexes, pages and components (create and replace) — each through durable Change Review with native HRDMO trials, App Designer captures for every new writer, and App Designer checks of migration-made definitions. | See the continuation sections below and [PROJECT_MIGRATION.md](PROJECT_MIGRATION.md). Remaining refusals are explicit (alternate search keys, custom index DDL, translations, subpackage descriptions/comments and class descriptions, nested/SQL-Table subrecords, updates to indexed records/SubRecords). |
| 5. Change Review recovery | Complete. Crash/lost-reply reconciliation, continuation undo/redo and Record/AE/SQL/HTML/style sheet creation reversal (Codex); Query and project creation reversal; undo/redo of every migrated definition type through App Designer-calibrated deletion writers (dl01-dl13); same-run ownership re-stamping for dependent creations. 63/63 production HTTP/UI workflow checks. | [Query/project trial](../tools/lab/results/query-project-reversal-reviewed-native-2026-10-20.json), [migration undo/redo trial](../tools/lab/results/migration-reversal-native-2026-10-20.json). |

## PS Query parity — open tasks (October 21, 2026)

Released in [0.9.8](releases/0.9.8.md) on October 22, 2026. Existing
acceptance artifacts retain their original tested versions and checksums.

Joins, subqueries, unions, aggregates/HAVING/DISTINCT, expressions, translates,
effective dating, the designer, migration and review-only delete/rename are
integrated into `main` from `query-criteria` and natively verified on HRDMO
8.62.09: 31 Windows Query captures replay exactly, and eight Studio-written
queries reopen in Windows Query with identical SQL and rows
([evidence](../tools/lab/results/query-families-native-2026-10-21.json),
[PS_QUERY_WINDOWS.md](PS_QUERY_WINDOWS.md)). Installed acceptance is complete,
and 8.61.15 calibration followed in 0.9.9:

| Task | Needs | Acceptance required |
| --- | --- | --- |
| 1. Installed check — complete October 21 | Unmodified candidate VSIX installed in a separate real VS Code 1.143.0 window, private history, HRDMO 8.62.09 | [10 installed checks](../tools/lab/results/query-installed-2026-10-21.json): saved-query editing of criteria/HAVING, joins, aggregates, translates, expressions, subqueries and unions; SQL and every rendered result cell match independent native execution; undo/redo/discard; MCP rename/delete stage without writing, refuse missing destructive consent without writes, apply through rendered approval and undo to exact native snapshots. Cleanup and installed artifact integrity verified. |
| 2. 8.61.15 calibration — complete October 23 | Developer's RDP session to HCDEV (XX_ objects only) | Twelve Windows Query 8.61.15 queries, one or more per family, match Studio's rows; the 8.61 writer gate is removed (released in 0.9.9; see [Query families on 8.61.15](PS_QUERY_WINDOWS.md#query-families-on-86115-october-23)). |
| 3. Commit and push — complete in this checkpoint | Developer requested all changes committed and pushed | Query implementation and evidence were first committed on `query-criteria`; the complete branch is now integrated into `main` for release 0.9.8. |

Reproduce installed acceptance with HRDMO lab credentials in `PSLAB_ACCESSID`
and `PSLAB_ACCESSPSWD`: `npm run test:query:installed` (after `npm test` compiles
the independent reader). The tested candidate is
`/tmp/peoplesoft-studio-query-tested.vsix`; runtime bundle SHA-256
`00290cf52b6019a3478e0fd4634491d6edf9d0b7c4a486c66b002d59054c47cf`.
The user's running window and normal installation were unchanged. The installed
trial found and corrected expression Length
submission, result-column mapping and the overly broad subrecord metadata
restriction; see [installed acceptance](PS_QUERY_WINDOWS.md#installed-acceptance-october-21-2026).

The earlier priority work was checkpointed on branch `checkpoint/priority-tasks`
on October 21, 2026, with Codex's work credited in the commit messages. The
subsequent commit/push request applies to the current `query-criteria` branch;
release publication remains separate.
No encoder/decoder changes have been made for these tasks.

Installed tasks 2/3 evidence: [report](../tools/lab/results/write-approval-installed-2026-10-20.json), [pending](../tools/lab/results/write-approval-pending-2026-10-20.png), [outcomes](../tools/lab/results/write-approval-outcomes-2026-10-20.png). Candidate bundle: `1ba73ca20ba162ada5e7879994002255efd52ae934fcf5dbea010845b7cf88e9`.

Earlier migration/recovery installed candidate: `716dc5b65f3bf560e8935800845915b6709b6a2605523ef0103152c410de6450`. [Five installed/native checks](../tools/lab/results/priority-installed-native-2026-10-20.json) pass in a separate real VS Code window with private test history; the original window was not reloaded. Test fixtures were removed and complete native absence verified. VSIX: `/tmp/peoplesoft-studio-priority-current.vsix`. This is a development test installation, not publication or replacement of the original running extension.

Earlier interrupted-inverse recovery candidate: `e468c0a3fef05120bd2ad839996dea19651a345f0703877d60fb34500b32859d`.
[Six installed/native checks](../tools/lab/results/inverse-continuation-installed-2026-10-20.json)
pass, including rendered undo pause, remaining-work action, deletion consent
across identical refresh, fresh destructive approval and redo from the original
source history. [Six native lost-reply checks](../tools/lab/results/recovery-inverse-continuation-2026-10-20.json)
also pass without deletion replay. Both trials verified cleanup. Local full
verification: 2,136 pass / one skipped; 61 production HTTP/UI workflow checks.
VSIX: `/tmp/peoplesoft-studio-inverse-continuation.vsix`, verified against the
tested unmodified bundle. The private test window was closed; the original
window was never reloaded. Tasks 4 and 5 remain open for the listed missing
adapters and creation-deletion families.

SQL/HTML/freeform stylesheet deletion and native recreation are calibrated in
six Windows App Designer cases. The production typed writers and complete
metadata adapters now implement reviewed creation inverse and fresh redo,
including lost-reply reconciliation and interrupted inverse continuation.
Legacy partial histories retain their original contract and creation-undo
limits. Native marker/counter checks, known references, rollback preview and
full readback remain required. A long Unicode SQL metadata trial exposed an
inline CLOB-fetch boundary issue; complete locator reads now preserve it.
Concurrent saves lock shared counters before recording their baseline.
[Protocol and exact scope](change-review/TEXT_DELETION.md).

Current `npm run verify`: 2,149 passed / one skipped, activation smoke, 18 editor
checks and 9 package checks. Production HTTP/UI fixture checks: 63 passed.
These results do not complete the remaining migration adapters or Query/project
creation deletion. No encoder/decoder change or original-window reload occurred.

Latest text recovery candidate:
`8dae01cb0940cddde2116dd71b16c3eae0e62444907bc5ecbbc89f1c834ad19a`.
[Six installed HRDMO UI checks](../tools/lab/results/text-reversal-installed-2026-10-20.json)
pass through the unmodified packaged extension, including metadata-preserving
text revision, pause/remaining approval, interrupted destructive undo and full
redo. The [20-check native trial](../tools/lab/results/text-reversal-reviewed-native-2026-10-20.json)
also covers lost replies without deletion replay, unversioned metadata drift,
reference refusal and concurrent saves. Both verify full owned-scope cleanup.
VSIX: `/tmp/peoplesoft-studio-text-reversal.vsix`; archive and installed bundle
integrity are recorded in the report. The private test window is closed; the
original conversation/window was never reloaded. This is development acceptance,
not a release or replacement of the original running extension.

Next recovery work: native Query/project deletion and recreation calibration,
then complete guarded creation reversal for those scopes. Migration still needs
the pages/components, package/class, subrecord/index/translate and advanced-field
adapters listed in task 4.

Six Windows native Query/project delete/recreate cases are now captured with
owned-scope cleanup and regression gates. Project deletion preserves its member
definitions; public/private Query tombstones retain the correct owner. Production
delete/review integration remains open. See [protocol and next implementation](change-review/QUERY_PROJECT_DELETION.md).

Latest calibration gate: `npm run verify` passes 2,155 tests / one skipped,
activation smoke, 18 editor checks and 9 package checks; all six new native
protocol tests and strict capture/helper TypeScript checks pass. This turn
changes capture tooling, evidence, tests and documentation; the previously
tested runtime bundle remains unchanged.

## Continuation (Claude, October 20 evening)

Task 5 — Query/project creation reversal is now verified end to end on HRDMO.
The typed writers (`src/providers/queryProjectReversal.ts`) and adapters were
already wired; the reviewed flow failed because a same-set Query creation was
not treated as a proposed project member (its review key is `[name, owner]`).
`proposedProjectMembers` now includes it (unit test in
`reviewStructuredCreation.test.ts`). [16 native checks](../tools/lab/results/query-project-reversal-reviewed-native-2026-10-20.json)
(`tools/lab/query-project-reversal-native.mts --review`): rollback previews,
stale-token refusal, project-membership and nondefault-metadata refusal,
blank-owner and owner-specific PSQRYDEL / PSPROJECTDEL at QDM / PJM, tombstone
refusal for ordinary reads/creation, marker-bound redo, then durable review:
pause → fresh continuation → destructive inverse (project before Query) with an
injected lost reply → reconciliation without replaying the deletion → fresh
destructive approval → redo from original history. Cleanup verified.

Task 4 — field adapters:
- Translate values travel with their character field (canonical order,
  effective-dated); translations (PSXLATITEMLANG) and target-only values refuse;
  translate-only updates do not re-save the field definition.
- Every stored PSDBFIELD property now travels: owner ID, IME mode, number/time
  FORMAT, default century, custom format family/display name, formatted length.
  Export previously refused every real field (New Field stores DEFCNTRYYR 50)
  and silently dropped owner ID / non-character formats. Not Used, AUXFLAGMASK,
  image format and keyboard layout still refuse. `saveField` takes the full
  property set (`fieldPropertiesRefusal`); a missing target format family blocks.
- [10 native checks](../tools/lab/results/field-migration-native-2026-10-20.json)
  (`tools/lab/field-migration-native.mts`).

Further task 4 adapters (all same-database provider + ReviewService trials,
cleanup verified; details in [PROJECT_MIGRATION.md](PROJECT_MIGRATION.md)):
- Application Packages + classes: [6 checks](../tools/lab/results/package-migration-native-2026-10-20.json).
  Found: class creation moves every package row's VERSION, so the package
  review token is its structure.
- Subrecord rows in Derived/Work records: [4 checks](../tools/lab/results/subrecord-migration-native-2026-10-20.json).
- Pages (complete rows, create-only): [7 checks](../tools/lab/results/page-migration-native-2026-10-20.json).
- Components (complete rows, create-only): [7 checks](../tools/lab/results/component-migration-native-2026-10-20.json).
- Prerequisites now use the project writer's `definitionExists` (images, URLs,
  message catalog, processes, style sheets of any kind).

Windows App Designer work (HRDMO VM):
- [App Designer check](../tools/lab/results/migration-app-designer-check-2026-10-20.json): migration-made
  package, page, component, fields and subrecord record open correctly; native
  re-saves of the component and field change only VERSION/LASTUPDDTTM, and of
  the page leave every migrated control row unchanged.
- New captures (`tools/corpus/save-protocol/results/`): ix01 user index,
  sb01 SubRecord creation, pk01 package properties, pk02 subpackage under an
  owned root; frozen by `src/test/migrationCaptureProtocol.test.ts`.
- Adapters built on them, each compared row for row with App Designer's own
  rows: [user indexes, 6 checks](../tools/lab/results/index-migration-native-2026-10-20.json);
  SubRecord definitions (Studio-created rows identical to App Designer's;
  [subrecord trial](../tools/lab/results/subrecord-migration-native-2026-10-20.json));
  [package properties, 6 checks](../tools/lab/results/package-properties-native-2026-10-20.json).
- Pages and components now also replace an existing target definition, under
  its complete token, with the calibrated save counters (page PDM/SYS,
  component PGM/MDM/SYS): page and component trials, 7 checks each.

Task 4 remaining refusals (documented in PROJECT_MIGRATION.md): alternate
search key indexes, custom index DDL, subrecords in SQL Tables, nested
subrecords, subpackage descriptions/comments and class descriptions, updates to indexed records and
SubRecords, translations/language rows of every type.

Task 5 additions (Claude):
- Production HTTP/UI workflow checks were failing after Codex's last change
  (8.62 Query/project review paths had no fixture coverage); fixed the fixture
  (`readQueryForReview`/`writeQueryForReview` stubs, project reversal SQL in
  `src/test/fixtures/projectTransaction.ts`, consistent PJM lock seed) and the
  one outdated expectation (creation reversal for Record/SQL/AE/project is now
  prepared, not refused). 63/63 pass.
- Query/project writers guard deletion and replacement only; creating an absent
  definition keeps the creation-only path, like Record/AE creation.
- Review apply: a CREATE whose ownership stamp changed only because a dependency
  created earlier in the same run now exists (Record PeopleCode judged by its
  new record) is re-stamped and journaled (`AUTHORIZATION_REFRESHED`) after the
  live authorize gate; any other stamp change still stops the writer.
- Migration creation reversal for records, Record PeopleCode, AE programs and
  menus (calibrated deletion writers, rollback previews with same-inverse
  project/PeopleCode assumptions, grant refusal for menus) plus text, Query and
  project: [4 native checks](../tools/lab/results/migration-reversal-native-2026-10-20.json)
  covering import, destructive inverse, tombstones and fresh redo.
- Next: App Designer deletion captures for page, component, field and package so
  migrations that create those can be undone too.

Deletion calibration (Windows App Designer, HRDMO): dl01-dl13 capture File > Delete of
pages, components, fields and packages (with and without PeopleCode / translate values /
classes), deleting one class in the package editor, and saving deleted page, component
and package names again. New writers: `deletePageForMigration`, `deleteComponentForMigration`,
`deleteField`, `deletePackage`, `deleteClass`; page/component/package creation now clears
tombstones (dl11-dl13). [Migration undo/redo trial](../tools/lab/results/migration-reversal-native-2026-10-20.json):
ten definition kinds imported, undone in one destructive inverse and redone exactly.

Installed acceptance (October 21): a candidate VSIX built from this source
(bundle `f1e64169…`, identical to the tested `dist/extension.js`) ran in a separate
VS Code window with private history (`tools/lab/build-handoff/installed-host.mjs`;
your running window and installed extension were not touched).
[Three checks](../tools/lab/results/migration-installed-2026-10-21.json)
(`tools/lab/migration-installed-native.mts`): the Import command stages a field
with translate values, a page, a component listing it, a package with a class and
the project; the rendered Approve and apply creates them; the rendered review
applies the destructive inverse only with explicit consent; redo recreates them.
The first installed run exposed a real defect the native trials could not (they
stub the write guard): a reviewed write that creates a definition and then saves
more of it (a field's properties after New Field, subpackages after a package
root) was stopped by the delivered-object guard as "ownership changed after
review". The reviewed-write context now records definitions it created itself
(`noteReviewedCreation`), and the guard treats later steps on those as covered by
the approval; refusal by policy still applies.

## App Designer uses (each one is an MCP gap to close)

Every time work has to go through App Designer instead of the MCP, it is logged here against the task that would
remove the need. (Owner instruction, 2026-10-27.)

| Date | What App Designer was used for | Why the MCP could not | Task |
|---|---|---|---|
| 2026-10-26 | Build > Create Tables for new lab records (e.g. PS_ZZ_TXN) | no physical build route | E12 |
| 2026-10-27 | Create Indexes after a record's key changed | no physical build route | E12 |
| 2026-10-27 | Tools > Validate Syntax on each new Application Class after its Change Set was applied (Transaction, TxnInput, EmergencyContact, TransactionService) | no native compile check; Studio's rules miss some refusals (PC016 was found this way) | E3 |
| 2026-10-27 | Build > Create Tables for ZZ_MFA_PROV, ZZ_MFA_POL, ZZ_MFA_CHAL; Alter Tables for ZZ_CAP_VER (new column ZZ_MFA_POL_ID) | no physical build route | E12 |
| 2026-10-27 | Build > Create Tables for three new form-definition tables (with their search indexes); Alter Tables for an existing table after a reviewed field insert. The open record window had to be closed and reopened first (App Designer keeps the pre-change definition) | no physical build route | E12 |
| 2026-10-29 | Paste the updated web library IScript program (FieldFormula) on the 8.61 site database and save | the reviewed PeopleCode writer refuses rows that carry LICENSE_CODE | E37 |
| 2026-10-29 | Build > Create Tables for three new lab tables; Alter Tables for two lab tables after reviewed field inserts (8.61 site database) | no physical build route | E12 |
| 2026-10-30 | Validate Syntax on a new class that failed to load at run time (8.61 site database), to read the compiler's message | Studio's checks passed the class (missing rule), and a handler that fails to load leaves no message in the lab application's log | E41 |
| 2026-10-31 | Paste the rewritten MFA web library IScript program (FieldFormula) on the 8.61 site database and save; the Change Set stopped PARTIALLY_APPLIED at it with five record/page objects behind it, which needed reconciling and re-preparing | the reviewed PeopleCode writer refuses rows that carry LICENSE_CODE, and refuses at apply rather than at staging | E37 |
| 2026-10-31 | Alter Tables for the MFA setup record after a reviewed key change and field removal (8.61 site database) | no physical build route | E12 |
| 2026-10-31 | Paste the MFA web library program again (an added test IScript) and delete a component PreBuild program that wrote decrypted secrets into a page field (8.61 site database) | the reviewed PeopleCode writer refuses rows that carry LICENSE_CODE (both programs were last saved by App Designer) | E37 |
| 2026-11-01 | Paste a small change to a web library IScript program (FieldFormula) on the 8.61 site database and save | the reviewed PeopleCode writer refuses rows that carry LICENSE_CODE | E37 |
| 2026-11-01 | Tick No Auto Select, No Auto Update, No Row Insert and No Row Delete on a grid's Use tab | the installed MCP had no operation for a scroll's Use options | E53 |
| 2026-11-02 | Create an empty project on the 8.61 site database (File > New > Project) | Change Review refuses project creation on 8.61 | E54 |
| 2026-11-04 | Paste a small change to a web library IScript program (FieldFormula) on the 8.61 site database and save; the Change Set stopped PARTIALLY_APPLIED at it, with one HTML object behind it | the reviewed PeopleCode writer refuses rows that carry LICENSE_CODE | E37 |
| 2026-11-07 | Paste the refactored ZZ_AI_ADMIN:DiagnosticChat (31 CreateObject paths moved to subpackages) and save; Change Set 5207dee6 stopped PARTIALLY_APPLIED on it | the reviewed writer refuses a program whose stored PSPCMPROG its encoder does not reproduce | E74 |
