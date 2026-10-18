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

## Write behavior and current boundaries

Writes use the connection's Writable setting, Operator ID, customization guard
and custom write scope. MCP also uses its off/confirm/allow setting and refuses
writes when an IB editor has unsaved changes. All writes check concurrency,
lock existing definitions, validate references, update family-specific native
cache sequences, verify the stored rows before COMMIT and verify the token
again afterward. Credentials and secret property values are excluded from reads
and preserved by partial updates.

The native write protocol is calibrated on **PeopleTools 8.62.09** and refuses
other releases, except **8.61.15** for the shapes matched to PIA there: nonrowset
messages, standard services, standard synchronous operations without handlers,
and flat string documents, created and edited. On 8.61.15, REST services and
operations, nodes, routings and handlers are refused. The tested creation paths are standard/REST services,
standard synchronous and REST GET operations, nonrowset messages, external PIA
nodes without authentication, manual routings and flat string documents.
Application class OnRequest handlers can be added after creating the operation;
the native handler name is REQUESTHDLR. Creating other handler kinds or changing
a handler event/implementation type requires further native calibration.
Related rows are exposed as named sections; advanced rows require explicit
native columns where a creation default has not been captured.

Credential changes, local node identity changes, restricted services,
OpenAPI/application services, operation moves, child deletion, other message
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
synchronous operation on them, and a one-element flat string document. Studio
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
