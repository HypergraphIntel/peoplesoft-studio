# Integration Broker header review

Development scope in 0.9.5: `ib-service` and `ib-operation` support only existing
definitions' DESCR and DESCRLONG edits on Oracle. `psft_ib_save` stages a complete
scoped after-image when a full `psft_ib_get.input` changes only those columns.
The exact source token is checked before staging. A structural edit follows the
legacy confirmation path; supplying a Change Set/dependencies for such an edit
is refused, so it cannot silently persist outside the requested review.

The service checkpoint covers PSSERVICE and PSSERVICEOPR. The operation checkpoint
covers PSOPERATION; all eleven modeled operation child tables (versions,
parameters, handlers and their implementations, URI templates/messages, content
types and queue parameters); PSIBOPRROOT; PSOPRGENRTGPARM; PSSERVICEOPR; and
PSIBRTNGDEFN: sixteen tables total. Column discovery fails closed for missing or
unsupported schemas, unsupported cells and unsafe numeric precision. Native
timestamps retain nine fractional digits. Row order is canonical.

Versions/operator/time stamps are excluded from semantic content, included in
the scoped token. Credential columns are excluded before SELECT, never retained
in checkpoints and never restored. Credential freshness is not certified.
Related definitions outside the fixed scope and dynamic dependencies are not
automatically covered. No raw row replay, general structural reversal,
create/delete inverse or multi-object atomicity is implied.

Staging and revalidation execute the existing calibrated writer's actual DML
inside rollback previews and require exact before/after hashes. Application
rechecks target identity, policy, write scope, Operator ID, dirty editors and
the native scoped token, then uses the ordinary writer under exact-key reviewed
authorization. A precommit after-image check rejects unexpected side effects.
Independent ReviewService readback supplies verified history/timeline tokens.
Revert/redo prepare fresh typed header edits and require new developer review;
they do not restore raw snapshot rows. Native writer reference/shape/release
restrictions remain in effect, including restricted/OpenAPI services.

## Verification

- Six real-writer transaction fixture tests: rollback previews, committed header
  edits and typed inverses, preservation of unknown columns/credentials,
  unversioned token drift, after-image failures and incomplete/structural scope
  refusal. Fixture commits are not native database acceptance.
- Production HTTP/UI fixture suite: both new adapters stage without persistence,
  validate, apply via the trusted review page, prepare/apply inverses, verify
  retained timelines and refuse grouped structural edits/unversioned drift.
- Native HRDMO rollback previews passed on six existing custom lab definitions:
  standard service/operation, REST provider service/operation and REST consumer
  service/operation. `tools/lab/ib-review-native-preview.mts` verifies exact
  proposal reproduction and unchanged scoped content/token plus SRVM/OPRM/OPRVM/
  OPRHM/SYS counters after rollback. No native commit or review approval occurs.

- Installed HRDMO standard service/operation acceptance passed: developer-approved
  description/comments application, exact checkpoints/approvals, full scoped
  readback/tokens, retained history and separately approved typed inverse. Both
  original metadata scopes are restored under fresh tokens, with reverse
  dependencies and the original Change Set marked REVERTED. The Change Set IDs
  and hashes are recorded in [PROGRESS.md](PROGRESS.md).

REST and 8.61 reviewed apply/inverse, native redo and general structural edits
remain unverified. The six rollback previews do not certify those workflows.
