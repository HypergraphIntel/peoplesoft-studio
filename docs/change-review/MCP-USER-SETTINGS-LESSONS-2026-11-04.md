# MCP development notes from User Settings implementation

Recorded November 4, 2026. Environment: **HCDEV PeopleTools 8.61.15**.
Status: **development intake; recommendations below are not implemented fixes**.
Requested by the owner after repeated failures, manual saves and delays during
User Settings Slices 1–3. Slice 3 ultimately passed 23 HTTP
checks, nine native service checks and exact native readback; its 26 existing
regression failures were unchanged. No employee Settings gear/panel existed at
that point; client Slice 4 had not started.

These notes distinguish agent mistakes from missing safeguards. The agent
constructed incorrect proposals, used an unsupported runtime API, investigated
incomplete evidence in successive rounds and communicated visible progress
poorly. Studio did not cause every mistake. Better MCP contracts should catch
the preventable errors before asking the developer to approve or native-save.

## 1. WEBLIB licensed-metadata limitation — explicit recurring blocker

**Existing issue: [E37](../PRIORITY_TASKS.md). High-value reliability follow-up.**

The reviewed MCP PeopleCode writer refuses the existing
`WEBLIB_OU_AI.ISCRIPT1.FieldFormula` because its PSPCMPROG rows carry nonblank
`LICENSE_CODE`. The refusal also covers uncalibrated PROGRUNLOC, PROGFLAGS and
PTTOOLSREL values; this incident specifically encountered the license value.
It is a writer capability boundary, not missing application authorization or
an unavailable source reader. Studio could read the source and validate the
proposed code but could not save this existing program through its supported
writer. The approved fallback was developer-operated App Designer Validate
Syntax and Save, followed by independent native verification.

That fallback was repeated for the initial implementation and S3D/E/F/G
corrections. The final native save was version 2981: all **38,369 compiled bytes
and dependency-name rows exact**, source exact except trailing blank lines,
and the original license preserved. Several native saves preserving the same
license are evidence for investigating bounded updates; they do **not** prove
how license metadata is generated on creation, rename, copy, another program,
another environment or another PeopleTools release.

Development work:

- Expose per-object, connected-release write eligibility **before staging or
  application**. Return the actual unsupported metadata fields and a supported
  fallback. A successful syntax validation must not imply writer eligibility.
- Calibrate whether an update can preserve existing licensed metadata unchanged.
  Capture native before/after source, binary, dependency names, program flags,
  versions and licensing behavior on owned fixtures. Keep create/copy/rename
  unsupported unless separately proven; never guess the license algorithm.
- If a preservation route is proven, use the normal reviewed writer with exact
  metadata/concurrency guards and readback. Do not blank LICENSE_CODE, weaken
  exact comparison, grant permissions or introduce a replacement endpoint.
- Until then, produce one complete native-save bundle: exact baseline/version,
  full source, small diff, source hash, validation scope and post-save readback
  checklist. Represent native-save completion separately from MCP application.

Acceptance: current unsupported rows are refused before writes and approval
prompts; supported calibrated updates preserve all required metadata and match
native bytes/names. A native-save handoff can be reconciled without replaying
an already-applied Change Set. Starting points:
`src/peoplecode/writeback/savePlan.ts` (`PROGRAM_DEFAULTS`, metadata refusal),
`src/providers/peopleCodeWriter.ts`, MCP capability/preflight reporting.

## 2. One canonical proposal must match the writer's complete after-image

**New intake US-MCP-01.** S1A's sparse record proposal omitted ten blank/zero
properties returned by the native reader. S1B's class proposal omitted seven
method-signature comments added by the actual writer. Both validated, committed
and then failed exact after-image verification. These were agent preparation
errors; preflight should have identified the transformations before approval.

Provide a supported prepare/preview result containing the complete canonical
payload, transformations, predicted after-image/hash and exact target profile.
Use the same preparation in staging, validation, review, apply and readback.
Do not require callers to import repository-internal helpers such as
`addSignatureComments`, or assume `prepareSourceForSave` does more than its
actual whitespace normalization. Return normalized/qualified source explicitly.
If canonical preparation changes reviewed content, require review of that
revision; do not silently normalize only after approval.

Acceptance: sparse records either fail before application with named omissions
or become an explicitly reviewed complete snapshot; class normalization is
idempotent and predicts exact native source including ancestor signatures.
No relaxation of post-write equality. Starting points:
`src/changeReview/adapters.ts`, `src/changeReview/service.ts`,
`src/providers/peopleCodeWriter.ts`, `src/model/appClassSignatures.ts`.

## 3. Validate native metadata limits and coherent page control settings

**New intake US-MCP-02; extends existing E40/E46/E48/E49/E53/E61.**
S2A sent a 31-character description to a native 30-character column and failed
with ORA-12899. S2C corrected dropdown record prompt metadata, but the page still
failed native 15,83 because its DSPLFORMAT/PROMPTFIELD mode was inconsistent.
S2D fixed those two cells. S2E then changed four LBLTYPE cells because intended
caption/column text existed but was not selected for display.

Validate connected-release text limits before staging, using the database's
length semantics. Check a dropdown's record edit metadata **and** page display
mode/prompt field together; check supplied labels actually use Text label mode.
Expose unsupported combinations with the control and record-field identity.
Resolve declared same-set prerequisites in the preview, rather than forcing
one developer apply for each metadata prerequisite when a safe overlay exists.

Acceptance: reproduce each original refusal in a native rollback preview or
owned fixture; corrected complete control settings pass native page validation,
reopen, rendering and save. A structural table-backed grid with work values and
No Auto Select/Update must remain supported where proven. Do not invent a
pure Derived/Work scroll or alter persistence semantics to evade native checks.
Starting points: `src/providers/pageControlTemplates.ts`, page/record operation
checks, buffer/page models and the connected preview route.

## 4. Treat PeopleCode execution context as part of validation

**New intake US-MCP-03.** The agent used `CommitWork()` in the new IScript
preference helper. Local compilation, roundtrip, connected checks and native
syntax/save did not establish runtime legality. The first valid HTTP save
returned PREF_SAVE_UNCERTAIN; the catch rolled back, and independent readback
confirmed no persisted row. S3G changed only that helper to
`SQLExec("COMMIT")`, following HCDEV IScript evidence, and all 23 HTTP checks
then passed.

Add release-aware execution-context diagnostics for known restricted APIs.
Use the IScript entry point and reachable local helper context where proven;
for dynamically invoked/shared classes, report context as unknown instead of
claiming blanket safety. Show the call location, known restriction, evidence
and validation coverage. Consult authoritative HCDEV corpus before proposing
an alternative. **Do not recommend SQL COMMIT inside Component Processor
events**: the administrator grid's shared service must join CP's transaction
and preserve its save/rollback ownership.

Acceptance: this IScript fixture is flagged before application; permitted
contexts and shared transaction-joining services are not globally banned.
Native runtime still verifies commit and independent post-commit reads.
Starting points: `src/peoplecode/validate.ts`, built-in API/context metadata,
`src/mcp/peopleCodeTools.ts` and PeopleCode reference documentation.

## 5. Make exact project-key comparison use the native identity contract

**New intake US-MCP-04.** S2B's final project step committed the intended
membership but failed comparison: logical type48 five-part key versus native
four-part key with the field padded to 18 characters and event packed after it.
Independent readback found exactly all 953 intended native keys, no missing or
unexpected entries. The original partial journal was preserved; no replay.

Use a single calibrated logical/native key codec in staging, checkpointing,
comparison, UI and recovery. Return both representations for diagnosis; do not
drop identity-bearing padding or concatenate ambiguous fields heuristically.
Acceptance: type48 membership and all preserved existing memberships compare
exactly; nearby field/event identities remain distinct; undo/redo use the same
codec and native evidence.

## 6. Explain uncertain outcomes by phase and evidence

**New intake US-MCP-05; related to E8/E37.** The user repeatedly saw
PARTIALLY_APPLIED / UNCERTAIN without a useful cause on the main review screen.
This session included committed after-image mismatches, a pre-write description
failure and native key-representation mismatch. They are different incidents.

Expose structured phase evidence: eligibility checked, writer entered, commit
attempted/confirmed/unknown, readback attempted, comparison mismatch paths and
which objects were never attempted. A missing signal must remain unknown.
Show a plain-language summary and safe next action directly in Change Review
and the MCP result, not only in journal details. Reconciliation must use full
live snapshots and tokens, preserve the original approval/journal and prepare
only unresolved work under fresh review. A new canonical expectation cannot
retroactively make the original reviewed payload exact.

Acceptance: distinguish proven no-write, confirmed commit plus readback drift,
and genuinely unknown commit. Loss of response never enables blind replay.
Full live match identifies already-persisted work without executing its writer
again. Starting points: application/reconcile handling in
`src/changeReview/service.ts`, adapter results and Change Review UI reporting.

## 7. Supply a bounded native runtime harness and useful failure evidence

**New intake US-MCP-06.** The first HTTP control used `URL` constructors
shadowed by PeopleSoft and failed before making requests. The next control
omitted response details, costing another test-class apply. The parameter-name
case hypothesis did not fix the actual request rejection. A restricted native
diagnostic finally showed six virtual names enumerated with zero values:
PSHome, Portal, Node, ContentType, ContentID and ICScriptName.

Provide release-calibrated sample controls that work inside PIA. Include bounded
status/error/response-schema evidence from the first run; report transport,
authentication, validation and transaction outcomes separately. Diagnostic
parameter names/counts must require the existing authorized test surface,
exclude values/cookies/headers and be removable in the final revision. Never
silently ignore unknown business parameters or trust routing fields as identity.

Native test execution must remain an explicitly supported, authorized surface;
do not add arbitrary PeopleCode evaluation, role impersonation, browser-cookie
extraction, automatic authentication bypass or unreviewed diagnostic code.
Keep a signed-in no-application-role test distinct from credential-free sign-in
boundary tests. After metadata deployment reopen stale native components;
identical AJAX report markup may retain a disabled client test control.

Acceptance: a fixed owned fixture demonstrates loads, denied inputs, two
assistant commits, independent HTTP/DB readback, exact audit/revision cleanup,
and unchanged configuration/lifecycle digests. Runtime failure is actionable
on the first attempt. Do not substitute compilation or metadata readback for it.

## 8. Reduce approval churn and communicate visible delivery

**New intake US-MCP-07.** The agent accidentally enabled an additional approach
gate for S1D and used cryptic approval language. Repeated tiny corrections and
sign-in requests consumed the owner's time while no Settings gear was visible.

Expose approach-approval requirements before staging, along with their source;
do not add a second plan gate when the current workflow and owner authorization
already cover it. Developer application remains a separate required action.
Show a dependency-aware bundle of eligible changes and native limitations early.
Do not batch by weakening validation, approve/apply on the owner's behalf, or
activate incomplete client code to make the feature appear finished.

Agent reports should state user-visible outcome first: “server persistence
complete; no gear yet; gear/panel next,” with exact remaining work and the
reason for any handoff. Maintain a fresh durable handoff record instead of
stale instructions after each native save. Before repeatedly asking the owner
to apply corrections, stop and investigate the full native contract and the
test harness. This is agent discipline, not solely a product defect.

## Evidence and recommended development order

The detailed reports/artifacts are local under the ignored `docs/ess-chatbot`
tree; this tracked note embeds the essential facts so the intake remains useful
without those artifacts. Source references describe inspected code, not fixes.

- [S1 record mismatch](../ess-chatbot/hcdev/user-settings/RECORD-VERIFICATION-INCIDENT.md)
  and [S1 class mismatch](../ess-chatbot/hcdev/user-settings/CLASS-VERIFICATION-INCIDENT.md).
- [S2 report](../ess-chatbot/hcdev/user-settings/SLICE-2.md): S2A2
  `b218d96a-ca45-4ebf-a47e-aa6f331b10af`; S2B
  `7cb8ce63-1513-49de-a3cc-d52c846393a5`; dropdown/labels S2C/D/E.
- [S3 report](../ess-chatbot/hcdev/user-settings/SLICE-3.md) and
  [acceptance summary](../ess-chatbot/hcdev/user-settings/slice3/evidence/acceptance-summary.json):
  S3A `49937d2c-9757-4686-aedb-2e9eb2c27884`; S3B/C/F test-control changes;
  native WEBLIB final version2981. S3E's temporary diagnostic is absent.

Recommended triage order: **early WEBLIB eligibility and canonical after-images;
native metadata/context checks; outcome/reconciliation reporting and key codec;
bounded runtime harness and workflow communication**. This is intake for
development prioritization, not authority to change unrelated code or expand
the User Settings implementation. Implement through small reviewed fixes with
targeted tests and native HCDEV acceptance. If an encoder change becomes
necessary, follow AGENTS.md: target, known regressions, protected 430 baseline;
never weaken exactness or change the decoder to disguise an encoder mismatch.
