# Integration Broker structural review

Development scope in 0.9.6, built on [header review](IB_HEADERS.md). The same
`ib-service` and `ib-operation` adapters, fixed noncredential checkpoints
(2 service tables, 16 operation tables), scoped tokens, approval hashes and
precommit after-image guard now also carry a bounded set of structural edits to
**existing** definitions on Oracle. Implementation:
`src/changeReview/ibStructure.ts`; staging: `src/mcp/ibHeaderReview.ts`.

## How a structural proposal is formed

1. `psft_ib_save` with a full `psft_ib_get.input` that changes more than the
   description/comments runs the calibrated writer as a rollback preview with
   checkpoint capture. The writer's own after-image is the proposal; nothing in
   Studio computes it.
2. The before/after difference must be inside the contract below. Otherwise the
   edit keeps the legacy per-write confirmation, and grouping it into a Change
   Set is refused with the specific reason.
3. A writer input is re-derived from the two checkpoints alone (the live input
   with only the changed cells and added rows applied), and a second rollback
   preview must reproduce the after-image hash exactly. Validation and approved
   application use that same derivation; application commits only when the
   precommit after-image equals the approved one.

## Contract

| Table | Allowed |
| --- | --- |
| PSSERVICE | DESCR, DESCRLONG, OBJECTOWNERID, IB_NAMESPACE, PTIBAPPLNAME, PTIB_APPSRVGRP |
| PSOPERATION | Writer-editable columns except IB_SERVICENAME (move), RTNGTYPE, IB_RESTMETHOD, IB_ALIASNAME, MSGNAME/IB_MSGVERSION |
| PSOPRVERDFN | Non-key columns of existing versions; no new versions |
| PSOPRVERDFNPARM | Non-key columns of existing parameters except MSGNAME/IB_MSGVERSION; no new parameters |
| PSOPRHDLR | Existing handlers except HANDLERTYPE/HANDLERID; add ApplicationClass `REQUESTHDLR` on `RQST`; paired removal on 8.62.09 only |
| PSOPERATIONAC | Existing implementation rows; a new row only with that new handler |
| PSOPERATIONURI | Existing IB_URI_TEMPLATE text only; same sequence and ordered URI variables, no new or removed templates |
| All other checkpoint tables | Unchanged (routings, PSIBOPRROOT, PSOPRGENRTGPARM, PSSERVICEOPR, AE/CI/DMS handlers, REST URI mappings/content/queue rows) |

No key changes or other child removals are supported. The handler addition is
the one PIA captured on 8.61.15 and 8.62.09; the referenced class must exist.

**Reversal.** Existing-row edits reverse through the typed writer under fresh
review. ApplicationClass REQUESTHDLR/RQST addition now has a typed deletion
inverse on **8.62.09**: both handler and implementation must be removed together.
Translated handlers, other implementations, and routing handler references are
refused. Native deletion writes PSOPRHDLRDEL at OPRHM and increments OPRM twice,
OPRVM once, OPRHM once and SYS three times for the captured single-version case.
Recreation clears matching markers and increments OPRM/OPRVM/OPRHM once and SYS
three times. Existing unmodified handlers keep their version/stamps. Marker
rows participate in freshness tokens without changing logical checkpoint hashes;
empty-marker tokens remain compatible with earlier applied histories. Marker
readback and the approved complete after-image are checked before commit.

Native evidence: `ib01-native-handler-delete` and
`ib02-native-handler-recreate` in `tools/corpus/save-protocol/results/`.
`ibHandlerLifecycle.test.ts` replays both complete native row/counter captures;
`reviewIbStructure.test.ts` covers typed inverse/redo and refusal boundaries.
The five-check [native provider/private-review trial](../../tools/lab/results/ib-handler-inverse-native-2026-10-21.json) passes
rollback, commit, staged addition, fresh inverse and redo, restoring the native
checkpoint. That trial uses trusted service test approval in private history;
installed UI acceptance and 8.61 handler deletion remain separate gates.

## Verification

- `src/test/reviewIbStructure.test.ts`: real-writer statements in the
  transactional fixture for staged/applied/reversed service and operation
  structure, the handler addition and its calibrated inverse/redo, and refusals for
  alias, message binding, handler type/event, child removal, routing, version
  and other-handler changes. `changeReview.test.ts` covers the service hook.
- Production HTTP/UI fixtures (Node 20 and Node 26, 54 checks): each kind stages
  the writer preview without persistence and applies it exactly through the
  trusted UI; the service reverses by typed inverse; the operation's added
  handler now reverses through the calibrated 8.62.09 deletion protocol; out-of-contract alias edits refuse grouping and keep
  legacy confirmation.
- Native HRDMO rollback previews, `tools/lab/ib-structure-native-preview.mts`
  (October 19): ZZ_IB_STD owner/namespace; ZZ_IB_STDOP owner, version
  description and existing REQUESTHDLR activation/description; REST provider
  ZZ_IB_API_5736828_G OnRequest handler addition (PT_SES:Init); ZZ_IB_STDOP
  alias change refused by the contract. Each re-derived input reproduced the
  native after-image exactly, and the scoped token, content hash and
  SRVM/OPRM/OPRVM/OPRHM/SYS counters were unchanged after rollback. No native
  commit or review approval occurred.

- Installed HRDMO acceptance (October 19, runtime bundle SHA-256 `602c9992…`,
  developer approval in the trusted review workspace):
  - ZZ_IB_STDOP standard operation: Change Set `a86ebb85-f99f-4df0-be0a-400949bd3af6`
    applied owner `PPT`, version v1 description and existing REQUESTHDLR
    activation (`I` -> `A`) and description. The staged diff held only those
    cells; the object VERIFIED at snapshot `08437ebc…`, token `d4877a93…`, live
    timeline MATCHES_RECORDED, and readback showed the native version counters
    advanced (operation 20 -> 21, version row 19 -> 20, handler 2 -> 6) with
    the service untouched. The separately approved typed inverse
    `2d37cf05-71ca-4346-9215-dac670516efc` restored the original snapshot
    `df3178ef…` under fresh token `45cd9293…`; the original is REVERTED with
    a REVERSED_BY_VERIFIED_CHANGE_SET journal entry.
  - ZZ_IB_API_5736828_G REST provider: Change Set
    `0cb5ff8b-512b-4350-9151-531b9a9a2686` added the ApplicationClass
    REQUESTHDLR/RQST handler (PT_SES:Init.OnRequest, blank PSOPERATIONAC
    QUALIFYPATH as PIA stores a root class; the writer maps `:` to blank). The
    new handler took the operation's description, as in PIA. VERIFIED at
    `30262b1f…`, token `c1bcedcd…`, MATCHES_RECORDED. `psft_prepare_revert`
    refused up front ("IB child deletion is not calibrated. Deactivate the
    handler ... No partial reverse proposal created") and no reverse set
    exists. The handler stays on this lab operation by developer decision.

That October 19 acceptance did not cover 8.61 application, REST consumer
structure or credential freshness. The October 21 trials below supersede the
first two boundaries for the specific recorded edits; credential freshness
remains outside the contract.

## Operation-specific review rules

| Operation | Snapshot and freshness | Dependencies and validation | Typed inverse |
| --- | --- | --- | --- |
| Existing REST URI text | Complete 16-table operation checkpoint; native stamps and handler markers bind token | Ordered URI variable names/multiplicity, sequence and mapping/root/routing identity stay fixed; native rollback after-image must reproduce exactly | Restore original template text under a fresh complete baseline; redo uses the same validator |
| Paired OnRequest handler add/remove | Complete operation checkpoint plus PSOPRHDLRDEL token | Only ApplicationClass REQUESTHDLR/RQST and its paired class row; live class/reference validation, translated-handler and routing-handler-reference refusal; exact 8.62.09 deletion protocol | Remove the pair and write native handler marker, or typed recreation clearing that marker; other handler kinds refuse |
| Standard service CREATE/DELETE | Separate ib-service-definition/1 checkpoint over four tables, safe raw stamps and PSSERVICEDEL | Empty unrestricted standard service; no credentials, ancillary rows, operation/runtime/project/source references; typed/default completeness | Guarded typed recreation clearing the bound marker, or native delete plus SRVM/SYS movement; fresh destructive review for DELETE |
| Standard synchronous operation CREATE/DELETE | Separate ib-operation-definition/1 checkpoint over complete operation scope, three marker families and owning service | One existing parent with separately bound policy/dirty state; one version and request/response messages; optional paired OnRequest class; no wider ancillary rows/references; parent overlap refusal | Typed header/version/parameter/mapping recreation and optional handler save, or native full deletion; exact marker, parent and cache checks before commit and complete readback after commit |

## October 21 continuation

Existing REST URI template text is now a separate reviewed edit. Its snapshot
remains the complete operation checkpoint. The contract preserves the template
sequence, transaction/root columns, and the ordered names and multiplicity of
URI variables; URI message/root mappings, content rows and routing definitions
must stay identical. Empty/control-character/malformed templates and added or
removed templates are refused. The shared writer validates the operation and
references; its second rollback preview must reproduce the exact after-image.
Inverse and redo use the same typed writer with fresh tokens.

Transactional tests exercise both consumer/provider roles on 8.61.15 (without
URL_ID) and 8.62.09. These are fixture checks, not native release acceptance.
Native deletion calibration has begun on an isolated inactive HRDMO standard
operation `ZZ_PCODE_LAB_IBO`, owned by `ZZ_PCODE_LAB_IBS`, plus an empty service
`ZZ_PCODE_LAB_IBE`. The developer approved native deletion/recreation of these
three fixtures and REQUESTHDLR for this calibration batch.
`tools/lab/ib-lifecycle-fixture.mts` records their ownership manifest in
`/tmp/psft-ib-lifecycle-fixture.json`; it does not implement guessed deletion.
The native snapshot tool now discovers service/operation-keyed base tables,
including ancillary/language/delete-marker tables, retaining scoped rows only
and excluding credential/payload fields. Use
`bash tools/lab/ib-lifecycle-capture.sh before|after ibNN-case-name`; after
captures always omit unrelated swept row values. First native case:
`tools/corpus/save-protocol/results/ib01-native-handler-delete`.

Handler deletion/recreation, native writer replay and durable private-review
inverse/redo pass on 8.62.09. The installed trials below also verify reversal
of the original October 19 handler addition, complete definition lifecycle
review and existing-version structural application on 8.61 and REST consumers.
Bounded definition lifecycle uses the separate adapters described below.

### Native definition lifecycle review (October 21 development)

Six PIA captures on 8.62.09 are now complete. `ib03` empty standard service
deletion removes PSSERVICE and inserts PSSERVICEDEL at SRVM (+1/SYS +1). `ib04`
recreation clears that marker and allocates fresh SRVM/SYS (+1 each). `ib05`
complete standard synchronous operation deletion (one inactive v1, two message
parameters and one inactive application-class request handler) removes its
header/version/parameters/handler/class rows and service mapping. It writes
PSOPERATIONDEL at ending OPRM minus one, PSOPRVERDFNDEL at OPRVM, and
PSOPRHDLRDEL at OPRHM, and resaves the owning service. Counter steps were
OPRM +3, OPRVM +1, OPRHM +1, SRVM +1, SYS +4. `ib06` recreates the operation,
version/parameters/mapping and clears operation/version markers at OPRM +1,
OPRVM +1, SRVM +1, SYS +3; it retains the handler marker. The calibrated typed
handler writer then restored the complete pre-ib05 checkpoint, with exact hash
verification, clearing the remaining handler marker. Both services are restored.

`ib07-native-operation-delete-repeat` repeats the handler-present deletion.
`ib08-native-operation-nohandler-delete` separately proves the zero-handler case:
OPRM +2, OPRVM +1, SRVM +1, SYS +3, with PSOPERATIONDEL at ending OPRM and
existing handler tombstones retained. All captures have complete scoped reads.

Implemented adapters `ib-service-definition` (key `[name]`) and
`ib-operation-definition` (key `[operation, owningService]`) support CREATE/DELETE,
typed inverse and redo on **Oracle PeopleTools 8.62.09 only**. They use separate
complete lifecycle checkpoints: four service tables or all operation-owned
preservation tables, plus all three operation tombstone families and the owning
service. Broader ancillary tables must be empty; their presence refuses before
writing. Marker and parent stamps bind freshness; logical hashes exclude stamps.
An absent definition with orphan rows or incomplete deletion history is refused.

Creation runs the existing typed writer under rollback to define the complete
after-image; no raw checkpoint rows are replayed. Deletion requires reproducible
input/defaults and live inverse dependencies, dynamically checks base tables
keyed by the definition, projects and stored PeopleCode/SQL mentions, and refuses
credential-bearing services using presence checks without selecting secrets.
Before commit, the writer checks the complete after-image, exact marker identities
and versions, native cache movement and unchanged parent content. Rollback verifies
both complete baseline tokens and cache counters. Postcommit readback verifies the
complete resulting token again.

Operation approval explicitly authorizes the owning service mapping/resave with
its own policy proof and dirty-editor check. Composite physical scopes prevent
another root operation sharing that parent, or a parent service edit, in the same
Change Set. Parent creation is a separate reviewed step: an existing owning
service is required. Dynamic references remain subject to developer assessment.
Supported shapes are empty unrestricted standard services and single-version
standard synchronous operations with request/response messages and at most the
paired ApplicationClass REQUESTHDLR/OnRequest handler. REST lifecycle, credentials,
translations, runtime/deployment rows, other handler implementations, new versions
and wider shapes refuse pending their own native protocols.

MCP: bounded `psft_ib_create` routes to these adapters;
`psft_ib_definition_get` returns the complete checkpoint/token and adapter key;
`psft_ib_delete` stages review-only deletion. Other creations retain legacy
confirmation outside an explicit Change Set. Existing structural updates retain
their original adapters and history scope. Every inverse/redo needs fresh review;
DELETE needs distinct destructive consent in the review UI.

Evidence: nine lifecycle tests include five exact native capture replays, inverse/
redo, stale parent/marker refusal, credential/reference/shape/release rejection
and rollback integrity. All **69** production HTTP/UI fixture checks pass,
including creation/deletion/inverse/redo and parent authorization. Native
`tools/lab/ib-definition-review-native.mts` passes seven checks on the approved
HRDMO fixture batch with production providers/adapters and private durable review
using trusted service test approval. Report:
`tools/lab/results/ib-definition-review-native-2026-10-21.json`.
This is backend native acceptance, not installed developer-UI acceptance. Both
services and the complete original operation checkpoint are restored. The
subsequent installed trial is recorded below. No service invocation occurred.

### Installed acceptance, October 21

Candidate VSIX SHA-256 `062c39f31a5d34f2a295f50ec9c6683095edef2d612aaef27d1eafd7650ac35b`,
bundle `40264d878f53e81fe26e13249748b1823e86fa65d8805fb110d5f9deee50c126`.
The developer reloaded the installed candidate and approved/applied each recorded
proposal in Change Review. This is separate from private service-test approval.

- **8.61 structural apply/inverse:** inactive owned operation
  `ZZ_PCODE_LAB_IB61O`, service `ZZ_PCODE_LAB_IB61S`. Forward
  `1adf7013-af98-48c0-94fd-d917cfccd573` changed only existing version v1 DESCR;
  inverse `b07c9d00-9dc0-4745-af68-a598a7c8a27f` restored complete checkpoint
  `a40443314987d5b2b3979c6195230b151cd2d8eca3fb1bed0e0190efeb609dc3`.
  Both VERIFIED, original REVERTED, live timelines MATCHES_RECORDED. Both
  disposable fixtures were subsequently deleted through native PIA; installed
  MCP independently confirmed absence. Report `ib-861-installed-2026-10-21.json`.
- **Previously refused added-handler undo/redo:** original REST provider addition
  `0cb5ff8b-512b-4350-9151-531b9a9a2686` now reverses through
  `f47931e1-b8ba-4d9d-a8e0-155115101933`, deleting the paired REQUESTHDLR and
  writing its native tombstone. Fresh redo
  `5e1ce757-ccfa-4a21-903a-d0decdaa19e0` restores the original applied checkpoint
  `30262b1f9e123dfc72013d16350ab5ae53af409dba09cbf925d7d276d3bebd2c` and clears
  the marker. Both VERIFIED; live final timeline MATCHES_RECORDED. This also
  proves compatibility with the historical empty-marker snapshot token.
- **Complete standard definition DELETE/CREATE:** two-object set
  `b3cababd-9958-422e-8023-d4337c294f8f` deletes the approved empty service
  `ZZ_PCODE_LAB_IBE` and operation `ZZ_PCODE_LAB_IBO` with its full version,
  parameters and handler. Fresh inverse
  `4d0de13a-015d-48aa-b9c1-56ca63341d89` recreates both complete checkpoints.
  All objects VERIFIED with live MATCHES_RECORDED. During operation restoration,
  an agent read on HCDEV closed HRDMO's provider pool during postcommit readback
  (`NJS-064`). The outcome was correctly UNCERTAIN; the developer's Reconcile
  live state action matched the complete approved after-image and recorded it
  VERIFIED without rerunning the writer. Original content is restored.

Installed lifecycle/handler report:
`tools/lab/results/ib-lifecycle-installed-2026-10-21.json`.
REST consumer backend apply/inverse/redo passed four checks and restored its
original full scope (`ib-rest-consumer-native-2026-10-21.json`). Installed
version-description forward `192d4fa0-2793-4daf-afff-a9722780d15d` and inverse
`51d362a2-6b34-4704-a3f3-8975433d7ace` are both VERIFIED on owned consumer
`ZZ_IB_API_5736828_E`; original source REVERTED, original complete checkpoint
restored, live MATCHES_RECORDED. Only the existing v1 DESCR changed; URI mappings
and routing remained part of both complete checkpoints. Report
`tools/lab/results/ib-rest-consumer-installed-2026-10-21.json`.
These trials do not certify every writable cell, runtime service execution,
8.61 child deletion, REST definition lifecycle or additional definition families.
