# Security and privacy

## What leaves this machine today

**Nothing.** Phase 1 has no network code (a test asserts the engine imports
no network module), no upload, no settings that enable one. Findings stay in
`<globalStorage>/intelligence` (each installation) and
`tools/intelligence/store` (this repository's research, committed by its
developers).

## Deny by default (implemented)

1. **Allowlisted schema.** Every object is strict; there is no field for a
   PeopleSoft definition, PeopleCode or SQL source, a row, a database name,
   a host, a connection or a credential. Deltas are counts only.
2. **Bounded text.** Every string has a maximum length; facts are short
   identifiers and short values.
3. **Privacy scan** (`src/intelligence/privacy.ts`) refuses text with: URLs,
   e-mail addresses, absolute file paths (Unix, Windows, UNC, `~/`), IP
   addresses (IPv4, IPv6 — release labels like `9.20.00.000` pass), connect
   strings (`host:port/service`, TNS descriptors), host names (lower-case
   top-level domains), credentials (`password=`, `token:`, `Bearer …`), and
   opaque tokens of 64+ characters. Repository paths must be relative and
   inside the repository. A violation names the field and the rule, never
   the value.
4. **Classification.** `internal` when a finding carries lab provenance
   (experiment or run IDs, capture cases, repository paths, the application
   release), `public-technical` otherwise.
5. **No approval in phase 1.** `approvedForSubmission` is always `false`.

What the scan cannot know: whether an identifier in a fact is an
institution's own definition name (a `ZZ_` lab object is fine; an
institution's custom record name may not be). The submission review
(phase 3) shows every field before anything leaves, and classifies the
finding before it can be approved.

## Submission review (phase 3, proposed)

- Off by default: `peoplesoft.intelligence.uploadMode` = `off`; `manual`
  requires a review of every submission; an administrator policy (machine or
  workspace setting the user cannot override) may set `off` permanently.
- The review shows the exact JSON payload, what was removed and why, and
  where it goes; Cancel has no side effect.
- The payload is a projection: only allowlisted fields of a finding, with
  `internal` provenance stripped unless the user keeps it explicitly.
- The contributor token is in VS Code `SecretStorage`, never in settings,
  logs or findings.
- An upload failure is reported and retried later; it never blocks Studio.
- VS Code's telemetry setting (`telemetry.telemetryLevel` = `off`) disables
  submission regardless of other settings.

## Server and distribution (phases 2, 4, proposed)

- Server input is untrusted: schema and privacy checks re-run server-side.
- Admin and reviewer endpoints use separate credentials from contributors.
- Tokens are stored hashed; never logged.
- Uploaded tests or scripts are never executed; automated reproduction, if
  ever built, runs in an isolated sandbox with no credentials and no
  network.
- Bundles are signed (Ed25519), versioned, expiring and revocable; verified
  before use; declarative only (DECISIONS D8).
- Audit log of every submission, review, publication, revocation and admin
  action.

## Retention and withdrawal (to be settled before any community submission)

- Local: the user deletes a finding (`DiscoveryStore.remove`) or the store.
- Server: a contributor can withdraw (`DELETE /contributors/me`): their
  observations are deleted; findings supported only by them are withdrawn;
  published knowledge built on them is reviewed for revocation.
- Default server retention for unreviewed observations: 12 months
  (proposed — needs an owner's decision before phase 2 ships).
