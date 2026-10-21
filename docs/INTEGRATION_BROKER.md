# Integration Broker tools

The six tools in Configuration Tools open Messages, Document Builder, Services,
Service Operations, Nodes and Routings. Each supports search, inspection,
validation, New, Preview and Save. The editor provides property fields and an advanced structured
specification for related rows; use the preview before saving related rows.

## MCP workflow

1. Read `psft_ib_reference` for identities and relationships.
2. Search with `psft_ib_list`; inspect with `psft_ib_get`.
3. For a new definition, call `psft_ib_new`, fill its returned `input`, and call
   `psft_ib_create`. For an edit, change `psft_ib_get.input` and call
   `psft_ib_save` with the returned `token` as `expectedToken`.
4. Pass `dryRun: true` to create/save to preview changes and cache increments.
5. `psft_ib_validate` checks stored structure and references.
6. `psft_ib_document_build` builds the logical, XML, JSON and HTML representations
   plus generated XSD/JSON schemas for a flat string document.

Service classification comes from `PSSERVICE.IB_REST_SERVICE`: **0 standard,
1 REST consumer, 2 REST provider**. It is never inferred from HTTP method.
Operations inherit their owning service's classification. Creation requires
explicit service kind, and REST services also require consumer/provider role.
The existing kind and role cannot be converted by Save. Search filters accept
`serviceKind` and `restRole` for services and operations.

Keys are `[name]` for messages, services, operations and nodes;
`[package,document,version]` for Document Builder;
`[name,YYYY-MM-DD effective date]` for routings. Document Builder is object type
92, not Document Layout. Routings are object type 83 and include history.

## Change Review

On Oracle with Change Review enabled, `psft_ib_save` stages existing
service/operation description/comments and bounded structural edits, including
service owner/namespace, supported operation/version/parameter/handler edits, existing REST URI template text
with preserved variable dependencies, and the calibrated OnRequest handler
addition/removal (removal/recreation on 8.62.09 only). The approved after-image must
match the shared writer's rollback preview exactly. On 8.62.09, bounded standard
service/operation creation stages complete lifecycle checkpoints;
`psft_ib_definition_get` supplies their token and `psft_ib_delete` stages
review-only deletion. Empty unrestricted services and single-version standard
synchronous operations with request/response messages and optional paired
OnRequest handler support typed inverse/redo. Owning-service resaves are explicitly
authorized and overlapping parent scopes require separate sets. REST lifecycle,
credentials and wider ancillary shapes refuse. Other creation/out-of-contract
changes retain legacy confirmation outside explicit Change Sets. Editor saves
use their existing save flow.

Native installed acceptance includes standard header/structural cycles, an
8.61 existing-version description apply/inverse and the equivalent REST-consumer
cycle on 8.62.09. Added-handler undo/redo now passes against the historical REST
provider addition: calibrated paired deletion writes the native tombstone and
fresh redo clears it. Complete standard service/operation deletion and typed
recreation also pass in the installed review UI, including reconciliation of an
interrupted postcommit readback without retrying a writer. All original content
is restored; the temporary HCDEV fixtures are removed. These are bounded native
trials, not runtime invocation or certification of every writable property.
See [header scope](change-review/IB_HEADERS.md),
[operation-specific rules and native evidence](change-review/IB_STRUCTURE.md) and
[adapter coverage](change-review/COVERAGE.md).

## Write behavior and current boundaries

Writes use the connection's Writable setting, Operator ID, customization guard
and custom write scope. MCP also uses its off/confirm/allow setting and refuses
writes when an IB editor has unsaved changes. All writes check concurrency,
lock existing definitions, validate references, update family-specific native
cache sequences, verify the stored rows before COMMIT and verify the token
again afterward. Credentials and secret property values are excluded from reads
and preserved by partial updates.

The native write protocol is calibrated on **PeopleTools 8.62.09** and
**8.61.15**, and refuses other releases. Another patch of 8.61
or 8.62 is accepted when the tables written have the calibrated patch's columns
and types (fingerprints in `src/providers/calibratedSchemas.ts`); otherwise the
refusal names the tables that differ. The tested creation paths are standard/REST services,
standard synchronous and REST GET operations, nonrowset messages, external PIA
nodes without authentication, manual routings and flat string documents.
Application class OnRequest handlers can be added after creating the operation;
the native handler name is REQUESTHDLR. Creating other handler kinds or changing
a handler event/implementation type requires further native calibration.
Related rows are exposed as named sections; advanced rows require explicit
native columns where a creation default has not been captured.

What PIA fills in that a caller does not give, and Studio now writes the same way:

- **A new node** also gets its description in PSNODEDEFNLANG under a blank
  language code (8.61.15 and 8.62.09). Later saves leave that row alone.
- **A new routing** that names no parameters gets PIA's: the request, plus the
  response with sender and receiver swapped for a synchronous operation. They
  are named by direction (inbound INREQUEST/OUTRESPONSE, outbound
  OUTREQUEST/INRESPONSE) and aliased `<operation alias, else name>.<version>`.
  Its sub-definition takes the request's alias inbound, and the operation's own
  `name.version` outbound (every delivered row). PIA dates a new routing
  1900-01-01.
- **A new REST operation** is named `<alias>_<METHOD>`, and the alias is the name
  without the suffix. A provider operation's base URL is Service Configuration's
  REST Target Location, then `/<service alias>/`.
- **Every new REST operation generates a routing**, which the page forces for
  REST (`PSSERVICESWRK.SAVE_PB`). For a provider it runs from `~~ANY~~` to the
  default local node; for a consumer, from the local node to `WADL_NODE` through
  the local gateway's `HTTPTARGET` connector. The routing is dated 1900-01-01,
  described as message 158,2382 ("GENERATED") and named
  `~GENERATED~<10000000..109999999>`. It comes with its parameters,
  sub-definition and the operation version's PSOPRGENRTGPARM row
  (`PUBSRVCSYNC`), at RTDM +1 and SYS +1. A consumer service with a token type
  is refused, because the page copies the service's credentials to the routing.
- **A new OnRequest handler** with no description takes the operation's. A class
  at the package root is stored with a blank path, as every delivered row is.
  PIA stores the handler as `REQUESTHDLR` whatever name is typed, and refuses
  that name if you type it.

Credential changes, local node identity changes, restricted services,
OpenAPI/application services, operation moves, other child deletion, other message
structures, and compound/relational/custom document structures require PIA.
Document Layout dependencies also require PIA resynchronization. Generated
routing selection is a separate PIA action; creating an operation does not
implicitly select Generate Any-to-Local or Generate Local-to-Local. Create
manual routings explicitly or use PIA's generation controls.

Validation checks definition structure and references; it does not execute
services or test gateway, endpoint, network, authentication or authorization.

## Evidence and verification

Native PIA saves supplied service flags, parent/child defaults, handler defaults,
routing alias indexes and cache sequence protocols. New service: SRVM+1/SYS+1;
message: MSDM+1/SYS+1; node: MNDM+1/MSDM+1/SYS+1;
routing: RTDM+1/SYS+1. Operation saves increment OPRM and each OPRVM; adding
its service mapping increments SRVM, and changed handlers increment OPRHM.
Document creation increments LSDM+1/PSCHM+3/DSCMA+1/SYS+5; replacing its
three physical schemas increments LSDM+2/PSCHM+4/DSCMA+2/SYS+7.
Document and physical SQL versions are one above their allocated cache sequence.

`PS_MSGDEFN_AUX` is a view over PSMSGDEFN, not a child table to insert into.
Document generated schema CHUNKSIZE is twice the base64 character length.
Compressed bytes match PIA's (reference zlib through pako); decompressed native schema
XML is compared exactly. Native JSON's required placement is preserved.

- `src/test/fixtures/ib-native-8.62.09/documents.json`: three PIA golden schemas.
- `tools/lab/ib-native-capture.mts`: sanitized native save snapshots.
- `tools/lab/ib-read-e2e.mts`: full six-family populations, kind/role filters,
  secret exclusion and all document bodies.
- `tools/lab/ib-write-e2e.mts`: production MCP creates/edits all six families,
  standard/REST consumer/provider services and operations, preview, unchanged
  saves, stale tokens and off/dirty gates.
- `tools/lab/ib-edit-e2e.mts`: two-element document schema edits and confirmation.
- `tools/lab/results/ib-write-e2e.json`: tested custom definition keys.

### PeopleTools 8.61.15

On an 8.61.15 database, PIA made a nonrowset message, a standard service, a
synchronous operation on them, and a one-element flat string document. In a
second round it added an OnRequest application-class handler, an external node
without authentication, a manual routing from that node to the local node, and
REST provider and consumer services, each with a GET operation. Studio made the
same, and every row, generated routing and counter increment matched PIA's. Studio
made the same through `psft_ib_new` / `psft_ib_create`, and edited a service
description as PIA did. Every row was equal apart from names and stamps, with
the same counter increments as 8.62.09. For documents the inflated bodies are
equal. PIA opens Studio's document and reports it valid. What 8.61 changes:

- The 8.62 columns PSOPERATION.URL_ID and PSMSGNODEDEFN.PTIB_NOPING do not
  exist; `psft_ib_new` leaves them out of a new input.
- The JSON physical schema has no `m_bFilterBlankElements` (every 8.62 save
  since 2025 writes it; no 8.61 save does).
- On both releases, the generated JSON schema's `$id` is Service
  Configuration's REST Target Location at save time, followed by
  `/<package>.<document>.<version>.json` (`http://ORACLE_ENDPOINT` when blank).
  The 8.62.09 capture had a blank location.
- PIA compresses with reference zlib at level 6. Node's zlib (Chromium's fork)
  gives different bytes for the same text, so Studio compresses with pako, a
  port of reference zlib. It reproduces every captured PIA body byte for byte:
  six on 8.61.15 and three on 8.62.09.

PIA opened and natively saved the MCP-created standard service and operation.
It validated and saved the MCP-created two-element document, saved the manual
routing, and saved REST consumer and provider GET operations with their payload URI, and saved the
nonrowset message and external node.
