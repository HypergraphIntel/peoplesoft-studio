# Process Scheduler: run and monitor

Status: native acceptance complete. RT-L1 through RT-L4 passed on October 22,
2026 with the installed extension on HRDMO 8.62.09, and the workflow ships in
[release 0.9.9](releases/0.9.9.md) outside the qualified 1.0 core. Native
lost-response recovery remains fixture-tested only. The sections below keep the
implementation record; the acceptance note under *Current validation* has the
results.

## Acceptance scope

1. From App Engine, Process Definitions or a command, choose an existing
   Application Engine process and the operator's existing run control.
2. Inspect the exact environment, operator, process, run control, server and
   output settings; explicit confirmation submits through the delivered native
   Process Scheduler API and returns a process instance.
3. Monitor the native process and distribution statuses, including failures.
4. List native report files, open logs and download output from the workflow.
5. Reject stale/dirty requests; prevent duplicate submissions; preserve recent
   runs across reopening; a timeout/lost response must remain uncertain and
   must never trigger an automatic retry.
6. Verify the packaged, installed extension against a real scheduler run and
   exact expected output; retain native permission checks and clean lab setup.

## Evidence and implementation decisions

- HRDMO 8.62.09 delivers active PROCESSREQUEST operations and handlers.
  Read-only inspection: `tools/lab/process-runtime/inspect.mts`; its private
  diagnostic output is outside the repository and contains no credential reads.
- The live `PROCESSREQUEST.1` WSDL confirms the HTTPS endpoint and SOAP actions.
  Actions are aliases (for example PRQ_SCHEDULE.v1 and PRQ_GET_REQUEST.v1), not
  inferred from operation names. Discovery must use the published WSDL.
- Native PROCESSREQUEST:PRQ_SCHEDULE invokes PRCS_GENERIC.ValidateUser and
  CreateProcessRequest/Schedule. Queue tables are never written by Studio.
- Native PRQ_GETREPORT calls ValidateReportUser before returning report URLs.
  Monitoring and output access must keep these native permission checks.
- Operator authentication is separate from the database access account;
  credentials belong in VS Code SecretStorage, never settings or history.
- This is runtime submission, not a reversible metadata Change Set. Each run
  requires explicit confirmation and has its own durable submission outcome.

Oracle references: [PROCESSREQUEST service](https://docs.oracle.com/cd/F44947_01/pt858pbr3/eng/pt/trws/task_ProcessSchedulerService-e97ec1.html),
[8.62 Reporting Web Services](https://docs.oracle.com/cd/G41076_01/psft/pdf/pt862trws-b112025.pdf).
Local native definitions and installed/runtime evidence govern acceptance.

## Progress

- [x] Inspect current workflow and authoritative native submission path.
- [x] Inspect live operations, handlers and published WSDL without changing IB.
- [x] Implement service client, metadata choices and secure operator sign-in.
- [x] Implement durable confirmation/submission and uncertain-outcome handling.
- [x] Implement run/monitor/output UI and App Engine/Process Definition entry points.
- [x] Expose the supported workflow through discoverable MCP tools.
- [x] Verify protocol, stale/duplicate/failure behavior and production UI routing.
- [x] Package candidate and verify isolated installed connection/panel preflight.
- [x] Prove a real installed run, logs and exact downloaded output (RT-L1–RT-L4, October 22).


## Current validation and native prerequisite (history to October 21)

- Full `npm run verify` passes (2,237 tests: 2,236 passed, one existing skip).
  Fifteen runtime tests cover WSDL aliases, native fault detail, request escaping,
  single scheduling POST, operator/instance/report identity, native control
  sources, common-row staleness, confirmation/expiry, dirty/read-only gates,
  concurrent clicks, durable uncertain outcomes and repository sign-in.
- `npx tsx tools/lab/process-runtime/mcp-fixture.mts` passes against production
  HTTP tools and the trusted controller with a fixture native client. It checks
  mandatory approval in `allow`, `off`, read-only/dirty/late gates, stale
  preparations, exactly one submission, failure status and report refusals.
- `node scripts/process-runtime-ui-check.mjs` passes in actual Chromium using
  the production HTML and fixture messages. It checks exact rendered consent,
  duplicate clicks, draft preservation, run-control filtering, monitoring-only
  access, uncertain recovery, failures, report escaping and download identity.
  `tools/lab/results/process-runtime-ui-fixture.png` is explicitly fixture evidence.
- Existing production HTTP workflow regression suite passes all 70 checks. Its
  lifecycle fixture now waits for forward-history reversal bookkeeping before
  preparing redo, rather than racing the inverse's earlier APPLIED checkpoint.
- Read-only HRDMO checks confirm 8.62.09, JARED, existing `ZZ_BC_EXPORT` process,
  `ZZ_BC_ACC01` generic run control (Once), server HCMDMO and baseline instance
  607265. Generic controls can exist in PS_AEREQUESTTBL without a
  PS_PRCSRUNCNTL row; the reader accepts the native union. Native helper code
  and translates require uppercase WEB/TXT for scheduling.
- First isolated installed 0.9.8 candidate connects to HRDMO and renders the
  workflow. Native sign-in fails on the public HTTPS connector with
  `(158,554)` (encryption/signature or HTTPS required), before native operator
  authentication. No new scheduler process has been submitted.
- The public URL is
  `https://hcm.deathstar.chickenkiller.com/PSIGW/PeopleSoftServiceListeningConnector`.
  Deployed Nginx forwards it to HTTP port 8110 despite HTTPS proxy headers.
  The existing backend HTTPS listener on 8113 has a certificate valid for
  psapp01.deathstar.chickenkiller.com. Its chain/hostname verify with the
  inspected public lab CA. A direct verified-TLS read-only probe advances to
  `(158,535)` (operator password required), proving the transport prerequisite.
- `tools/lab/process-runtime/nginx-soap-tls.patch` and `.py` prepare a narrowly
  scoped exact-connector route to that listener with TLS verification enabled,
  a configuration hash guard, backup, nginx validation and rollback. The script
  has `inspect` (changes nothing: live config hash, locations, backend chain,
  CA saved and verified), `apply CONFIG_SHA256 CA_SHA256` (refuses unless both
  still match what inspect printed) and `rollback BACKUP`, so the guard never
  goes stale between sessions; the `.patch` shows the shape of the change. The
  public URL stays unchanged. This patch is **not deployed**: server sudo
  requires the developer's password. IB service permissions/security have not
  been changed. No TLS validation has been disabled.

**Accepted 2026-10-22 (1.5 session):** RT-L1–RT-L4 passed natively in the installed candidate (instances 607496,
607500, 607501; CSV 123 bytes, SHA-256 match). Native findings encoded in the client: the WS-Security header needs
`soap:mustUnderstand="1"` or PeopleSoft ignores the UsernameToken `(158,535)`; native calls are sent one at a time
because each handler re-enters the gateway for its schema and parallel calls deadlocked a two-PSAPPSRV domain; a
completed Run Once AE control is refused at Review because PeopleSoft skips it with `(108,517)` yet reports Success.
The nginx 8113 route below was not needed and was rolled back. Only native uncertain-outcome reconciliation remains
fixture-only. Details: [1.5 progress](releases/1.5/PROGRESS.md).

Recorded [verification summary](../tools/lab/results/process-runtime-verification-2026-10-21.json) and [native preflight](../tools/lab/results/process-runtime-preflight-2026-10-21.json) retain the exact evidence boundary.

## Limits and remaining acceptance

The initial scope is Oracle / PeopleTools 8.62 / Application Engine / existing
operator controls / run now / WEB/TXT. Choice suggestions show the first 1,000
saved controls; a typed existing control is validated independently. The
preflight snapshot covers the process/program definition and common/generic
run-control rows, not every custom application parameter table. Saved custom
parameters are read by the native program at execution time. Editing these
parameters, creating controls, recurrence, cancellation/restart, jobs, other
process types, cross-origin repositories and browser/MFA automation are outside
this first scope. Binary files use Download; text preview is limited to 2 MiB,
downloads to 20 MiB and MCP text to 128 KiB. HTML/sign-in/error pages are refused.

### Acceptance tasks — complete

| ID | Task | Result (October 22, 2026) |
| --- | --- | --- |
| RT-L1 | Native connector reaches operator authentication | Passed after the developer set Req Verification to None on the PROCESSREQUEST `PRCS_*` operations; the probe reaches `(158,535)`. The prepared nginx TLS route (gundam, port 8113) was tried and rolled back. |
| RT-L2 | JARED sign-in and one confirmed run | Instance 607496 Success/Posted, the only new instance. Its run control was a completed Run Once, which PeopleSoft skips with `(108,517)`; Studio now refuses that at Review. |
| RT-L3 | Native logs and UI download | Instance 607500 Success/Posted after ZZ_BC_ACC01 was set to Always; stdout opened in the UI; the downloaded CSV is 123 bytes with SHA-256 `62d92d414fc02901271744facb65c61b5d9bbecc6f7edfecc31fc734f11b6367`. |
| RT-L4 | Installed persistence and refusals | History survived reload; a double click produced exactly one instance (607501) and refused the second; stale run control, expiry, read-only and unsaved-editor requests were refused with no new instance. Lost-response recovery is fixture-tested only. |
