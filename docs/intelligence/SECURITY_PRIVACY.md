# Security and privacy

## What leaves this machine today

**Nothing, by default.** The engine (`src/intelligence/`) has no network
code (tested). Since phase 3 the extension can submit a finding — only when
every gate opens (DECISIONS D13: machine policy, VS Code telemetry,
`peoplesoft.intelligence.uploadMode` = `manual`, an HTTPS server) and the
user approves that submission after seeing its exact payloads. Findings stay in
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
5. **No standing approval.** `approvedForSubmission` stays `false`: approval
   is given per submission, in the review, never stored on the finding.

What the scan cannot know on its own: whether an identifier is an
institution's own definition name (a `ZZ_` lab object is fine; an
institution's custom record name may not be). Given the installation's
naming prefixes (`peoplesoft.customization.namingPrefixes`, the
organization's and each bolt-on vendor's), the submission review blocks any
payload holding an upper-case name that starts with one of them
(`ownNameViolations`); the message names the prefix, never the name. The
review also shows every field before anything leaves, and classifies the
finding before it can be approved.

**The time of day never leaves.** Each payload's `observedAt` is rounded to
the day (UTC), whether or not lab provenance is kept, and the review lists
the rounding among the removals.

## Submission review (phase 3, implemented)

- Off by default: `peoplesoft.intelligence.uploadMode` = `off`; `manual`
  requires a review of every submission; an administrator's machine policy
  file (`/etc/peoplesoft-studio/policy.json` and platform equivalents,
  D13) disables submissions or pins the server; unreadable, it fails closed.
- Example policy: `{ "intelligence": { "uploads": "disabled" } }` or
  `{ "intelligence": { "uploads": "allowed", "serverUrl": "https://discovery.example.org" } }`.
- The review shows the exact JSON payload, what was removed and why, and
  where it goes; Cancel has no side effect.
- The payload is a projection: only allowlisted fields of a finding, with
  `internal` provenance stripped unless the user keeps it explicitly.
- The contributor token is in VS Code `SecretStorage`, never in settings,
  logs or findings.
- An upload failure is reported in the panel and recorded in the submission
  history (status and the server's problem title, never a value or token);
  the user may submit again. Nothing retries on its own; nothing blocks Studio.
- VS Code's telemetry setting (`telemetry.telemetryLevel` = `off`) disables
  submission regardless of other settings.

## Server and distribution (phases 2 and 4, implemented locally)

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
