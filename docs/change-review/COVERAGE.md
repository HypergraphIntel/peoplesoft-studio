# Change Review capability and risk matrix

Development scope only. The 0.9.0 release is unchanged. Registration inventory
is in [INVENTORY.md](INVENTORY.md); contracts are in [CONTRACTS.md](CONTRACTS.md).

| Family/path | Current review integration | Snapshot/reversal scope | Verification and missing evidence |
|---|---|---|---|
| Plain SQL | Staged create/update; manual history | Text + native version; update reversal. No calibrated SQL deletion, so reversing CREATE is disabled | Core and production HTTP/UI fixtures; new live reviewed path pending |
| HTML / freeform style sheets | Staged create/update; manual history | Text + native description/version; native normalization before approval; update reversal | HTTP/UI fixtures; new live readReviewContent/description and reviewed saves pending; CREATE inverse deletion unsupported |
| Event PeopleCode (8/9/42/43/44/46/47/48) | Staged create/update/delete; manual history | Authoritative PSPCMTXT source and native fingerprint; existing compiler/writer; reviewed inverse/redo | Compiler and HTTP/UI fixture exercise; new live reviewed path pending; no decompiled baseline |
| Existing Application Class source (58) | Staged update; manual source history | Existing authoritative source only | Class/package creation/deletion metadata snapshots are missing; new class staging cannot validate and class deletion is refused |
| PS Query | Staged create/edit/copy; manual history | Existing native query rows minus writer stamps; full native token and access checks; update reversal | HTTP/UI fixtures. CREATE inverse needs a calibrated delete adapter; new live reviewed path pending |
| Process Definitions | Staged existing-definition updates; manual history | Complete editor input and native token; sorted association sets | Core/model tests. Output-mode normalization changes currently refused; reference validation still runs in writer; live reviewed UI flow pending |
| Pages | Semantic comparator model only; mutation remains legacy | Persisted control identities matched; provisional/ambiguous matches explicit | Need complete editable snapshot/projection, new-control identity mapping and native before/after visual/save checks |
| Records / fields / translates | Record comparator model only; mutation remains legacy | No reviewed mutation or physical DDL reversal | Need complete supported metadata/index/label snapshots, field-removal PeopleCode checkpoints, related-record side effects and inverse lab controls |
| AE | Semantic comparator model only; mutation remains legacy | Section-variant/step/action identities and order | Need full language/native document preservation, staged-dependency overlay, canonical after-state and create/delete/rename recovery lab evidence |
| Menus / CI / channels | Legacy | Existing writer/session models reusable, not yet review adapters | Need complete snapshots and inverse/dependency evidence for create/edit/copy/rename/delete |
| IB / Portal / administration / OAuth | Legacy | Secret-filtered readers/writers exist; not generalized into exact review snapshots | Need per-kind normalization, side-effect/checkpoint scope, ownership/configuration authorization and inverse evidence |
| Event Mapping / PFC / Drop Zones | Legacy | Existing configuration models and previews reusable | Need derived mapping/service side-effect snapshots, zero/new configuration states and dependency-aware reversal coverage |
| Project/package create and membership | Legacy | Existing native writers; no complete reviewed inverse | Need membership/package preservation and calibrated remove/delete operations |
| Migration import / physical build | Existing UI workflow, not migrated | Existing packages/receipts; independent writer commits | Need review integration for all adapters, database DDL/data boundaries and resumable prerequisite contracts |
| SQL Server / DB2 | Legacy paths retained | Reviewed environment identity not calibrated | Need live identity/read/snapshot/write verification per platform; no claim of reviewed apply support |

## Local blockers and exact missing evidence

These affect object adapters, not the generic service. Do not infer inverse
writes or replay opaque rows to get around them.

1. **Creation reversal for SQL/HTML/style/Query:** no calibrated delete pathway
   exists in the released writer. Need native delete/recreate captures, dependent
   object handling, counter/tombstone controls, writer tests and native reopen.
2. **Application Class creation/deletion:** source alone omits class/package
   metadata and parent version side effects. Need combined metadata snapshots
   and inverse package/class behavior, not an empty-code shortcut.
3. **Page inserted-control identity:** negative staged IDs become assigned native
   IDs, and field/storage order can change. Need verified post-save identity
   mapping and semantic equivalence before allowing review/apply/reversal.
4. **Record/field reversal:** removing fields can remove PeopleCode and alter
   related definitions. Need checkpoints for those effects and explicit DDL/data
   scope; a record row restore is insufficient.
5. **Staged dependent definitions:** existing validators query live prerequisites.
   A validated overlay must distinguish staged objects from verified target
   objects before enabling new-record/page/AE multi-object workflows.
6. **Live review acceptance:** existing writer lab evidence does not prove this
   new user/MCP flow. Need the development build activated and actual developer
   plan/object approval, apply/readback, history and reversal on controlled lab
   definitions. Fixture approval is not native human-review certification.

## Cross-cutting limits

- Explicit dependency graphs only; no complete dynamic SQL/PeopleCode closure.
- Per-writer transactions, no atomic multi-object application or automatic restore.
- Partial/uncertain results stop; remaining-work resume needs explicit reviewed
  prerequisites rather than blindly retrying the old request.
- File storage has checksums, schema checks, private files and fsync/rename on the
  development platform. Windows crash durability, retention and large-history
  indexing need verification. No shared history service exists.
- Secret scanning is heuristic and may refuse sensitive/manual source snapshots;
  it is not a universal secret detector.
- Native visual Page/AE comparison, complete object timeline UX and every manual
  mutation pathway are not complete simply because generic history/UI exists.
