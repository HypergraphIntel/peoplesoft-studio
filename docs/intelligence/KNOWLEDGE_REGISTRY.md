# Knowledge registry and server API — proposed

Design for phases 2 and 4. **Built (phase 2 MVP, local only):** the server
skeleton, `POST /findings`, `GET /findings/{id}`, `GET /discoveries/pending`,
`GET /health`, tokens with roles, the audit table, size and rate limits —
see `server/intelligence/README.md`. Everything else here is design.

## Server (phase 2)

Python 3.12+, FastAPI, PostgreSQL 16, under `server/intelligence/`
(DECISIONS D7). Its own `pyproject.toml`, container image, tests and CI job.
The finding schema is shared as JSON Schema exported from
`src/intelligence/schema.ts`; the server validates every submission against
it (strict) and re-runs the privacy rules server-side — server input is
untrusted whatever the client checked.

### Tables (sketch)

| Table | Holds |
|---|---|
| `finding` | id, fingerprint (unique), type, subsystem, object_type, assertion (jsonb), title, statement, status, created_at, updated_at |
| `observation` | finding_id, digest (unique per finding), method, experiment, run, release, payload (jsonb, schema-validated), contributor_id, received_at |
| `contributor` | pseudonymous id, token hash, standing, created_at, withdrawn_at |
| `review` | finding_id, reviewer, from_status, to_status, criteria, rationale, at |
| `bundle` | version, created_at, finding ids, signature, key id, expires_at, revoked_at |
| `audit` | every submission, review, publication, revocation and admin action (append-only) |

## API v1

All under `/api/v1`, HTTPS only, JSON, request bodies ≤ 256 KB.

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /findings` | contributor token | Submit one finding with one observation. **Idempotent:** the response says `created`, `merged` or `duplicate` exactly as the local store does (same fingerprint and digest rules). `Idempotency-Key` header honored for retries. |
| `GET /findings/{id}` | contributor token | A finding with its public status (a contributor sees their own observations in full) |
| `POST /validation-results` | contributor token | A test or reproduction result referring to a finding id — stored as an observation |
| `GET /discoveries/pending` | **reviewer** token | Findings awaiting review, paginated (`?cursor=&limit≤100`) |
| `POST /reviews` | **reviewer** token | A status change with criteria and rationale |
| `GET /knowledge/latest` · `/knowledge/versions` | public | The current bundle manifest; the list of versions |
| `GET /knowledge/compatibility?release=8.62` | public | Published findings applicable to a release |
| `DELETE /contributors/me` | contributor token | Withdrawal: the contributor's observations are deleted or anonymized per the retention policy |

- **Errors**: RFC 9457 problem JSON; validation errors name the field and
  rule, never echo the value.
- **Rate limits**: per token and per address; 429 with `Retry-After`.
- **Version negotiation**: the client sends `PSFT-Finding-Schema:
  psft-finding/1`; the server answers 415 for a schema it does not accept.
- **Compatibility**: v1 changes only additively; breaking changes are `/api/v2`.
- **Audit**: every write and every admin read of contributor data is logged
  (actor, action, target, time) — never tokens or payload text.

## Knowledge bundles (phase 4)

A bundle is a JSON document: `{ format: "psft-knowledge/1", version,
issuedAt, expiresAt, findings: [published, declarative only], revoked: [ids] }`,
signed with Ed25519 (detached signature, key id). The extension ships the
public keys; a key rotation ships in a release. The client:

1. refuses an unsigned, mis-signed, expired or older-than-installed bundle
   (rollback protection: versions only increase, unless a signed revocation
   of a version says otherwise);
2. validates every record against the schema;
3. stores it beside, never inside, the local discovery store;
4. never executes anything from it and never lets it change a write gate,
   an approval policy or a writer (DECISIONS D8).

Keys: the signing key lives offline (or in an HSM/KMS) and signs a bundle
after review; the server holds only public keys.
