# Installed build-phase handoff acceptance

Status: bounded installed Codex and Claude build/runtime acceptance passed,
October 20, 2026. Report delivery also passed after repairing the stale Distribution Agent connection and compressed transfer acknowledgements: both original instances are Posted to Web, with native View Log/Trace and exact downloaded CSVs verified.

## Actual installed journey

The user authorized a separate window and delegated testing so the original
conversation/window would remain open. A normal interactive VS Code window
loaded the unmodified installed 0.9.7 extension, using the same request and
Change Review stores. The original window was not reloaded. After acceptance, the separate window,
CLI terminals and test-control bridge were closed, and its private temporary
profile was removed; the shared request/review history remains. Both revision-1
specs were reviewed and approved through the installed page, then their actual
**Build with Codex** / **Build with Claude Code** buttons were clicked.
No spec or Change Review approval was written directly to the store.

| Client | Request | Applied Change Set | Native instance |
| --- | --- | --- | --- |
| Codex | `br-b7ed22ea1caa` | `31c06921-abb4-4d70-b106-a1bc6d4ffb19`, revision 5 | **607265**, `ZZ_BC_EXPORT` / `ZZ_BC_ACC01` |
| Claude | `br-b6a1848629e9` | `31cd089a-a005-471d-ab6a-780803ab0931`, revision 5 | **607266**, `ZZ_BL_EXPORT` / `ZZ_BL_ACC01` |

The real interactive clients read the approved requests over this window's
MCP endpoint, staged their proposed definitions, and stopped for approach and
concrete-object approval. Trusted installed Change Review applied all four
objects in each set; all are APPROVED / VERIFIED, with revision-bound hashes,
checkpoints and native live timeline matches. Each client then independently
read back its Record, SQL, AE, project and dependency closure, created its
Process Definition after rollback-only preview and ordinary confirmation,
and reported all five create objects BUILT. Initial Process confirmations
timed out without writing; retries through the same confirmation gate passed.
Writes remained `confirm` throughout.

The four metadata definitions use explicit dependencies: AE on Record/SQL,
project on all three. Each project contains five members and has zero missing
related objects. Process creation uses its existing per-write writer rather
than a Change Review adapter. Exact settings: Application Engine, description
`Synthetic handoff CSV`, restart disabled, calibrated Add defaults, component
AE_REQUEST, group TLSALL, and no command/server/recurrence/output overrides.
No business rows, DDL, security grants, recurrence or trace changes were used.

The synthetic attachments/specs were seeded with the store API before this
trial; they do not prove native request intake or AI analysis. Separate intake
and analysis evidence is in [native acceptance](NATIVE_ACCEPTANCE.md). Real
CLI onboarding and the user-supplied HRDMO sign-in were completed normally.
No authentication bypass was used.

## Native execution and output

Both new run controls were created through authenticated native **Submit AE
Process Requests**, JARED, frequency Once. Only the matching new lab process
was selected on HCMDMO, with no recurrence or tracing. Both completed Success
(RUNSTATUS 9), return code 0. Their actual shared output was read through the
existing authorized `gundam-server-01` connection; expected fixture bytes were
never substituted for actual output.

Both stdout files say `accepted=3 rejected=1 total=30.75` and that the program
ended normally. Each actual CSV is **123 bytes, UTF-8 without BOM, exact expected
content**, SHA-256
`62d92d414fc02901271744facb65c61b5d9bbecc6f7edfecc31fc734f11b6367`.
Native readback confirms both run-control frequencies remain Once (O).

Evidence:

- [Actual installed sessions and launch identity](../../tools/lab/results/build-handoff-installed-sessions-2026-10-20.json), including real CLI session IDs, PIDs, endpoint overrides and observed tool calls. Handoff history alone is only launch intent.
- [Codex independent acceptance](../../tools/lab/results/build-handoff-codex-native-2026-10-20.json), [actual CSV](../../tools/lab/results/build-handoff-codex-607265.csv), [stdout](../../tools/lab/results/build-handoff-codex-607265.stdout).
- [Claude independent acceptance](../../tools/lab/results/build-handoff-claude-native-2026-10-20.json), [actual CSV](../../tools/lab/results/build-handoff-claude-607266.csv), [stdout](../../tools/lab/results/build-handoff-claude-607266.stdout).
- [Codex pre-application review](../../tools/lab/results/build-handoff-codex-review-2026-10-20.json), [Codex applied audit](../../tools/lab/results/build-handoff-codex-applied-audit-2026-10-20.json), [Claude applied audit](../../tools/lab/results/build-handoff-claude-applied-audit-2026-10-20.json).

## Report delivery and remaining work

**Report posting passed.** Both original Process Monitor rows show Success / Posted, and both native queue/report rows have DISTSTATUS 5, **Posted to Web**. Native View Log/Trace lists the original stdout (349 bytes) and CSV (123 bytes) for each report. Both stdout links open and show the expected summary and normal completion; both CSV downloads match the original expected SHA-256 above. [Delivery evidence](../../tools/lab/results/report-delivery-2026-10-20.json).

The old Distribution Agent attempted port 80 despite the saved REPORTS_HCMDMO HTTPS/443 node. A targeted graceful recycle of idle BASE/103 restored port 443; scheduler and AE workers stayed running. Transfers then reached the servlet but compressed HTTP 200 acknowledgements failed native XML parsing. Disabling gzip only for the exact HTTPS `/SchedulerTransfer/HCMDMO` location resolved posting. The developer ran the prepared, backed-up Nginx trial with sudo; Nginx validation/reload succeeded. Authentication, TLS and node values were retained. Successful distribution moved the files into the native repository and removed their spool directories; the independent verifier now follows PS_CDM_LIST.OUTPUTDIR after posting.

This also corrects older documentation that called instance 607175
Success/Posted even though its retained native row has DISTSTATUS 4. Its
successful execution and exact CSV remain valid evidence; posting was not proved.

The MCP PENDING schema and visible write-approval timeout recovery have since passed local and installed acceptance; see [priority tasks](../PRIORITY_TASKS.md). Additional follow-ups: representative production
interfaces; and native Windows handoff. None is certified by this bounded
Linux/HRDMO trial. The tests used the existing corrected PeopleCode attachment;
no encoder or decoder rules changed.

## Launcher and installed identity

The launcher pins PeopleSoft Studio MCP to the requesting extension's running
HTTP loopback `/mcp` endpoint. Codex receives a `--config` URL override; Claude
receives a `--mcp-config` entry. Global client auth/model/MCP settings are retained.
POSIX terminals receive literal arguments; Windows uses quoted shell tasks.
After starting MCP, the page rereads the running state before launch.

Tested installed extension bundle SHA-256:
`1a167a45a7d11622ff7dc4f1814a8cc205c8539fc52bc121749969baf9d8a125`.
Worker SHA-256:
`2022a1104d48cd47f48806708a56dfdbd689e7dcf657e913277f287f885b2c01`.
Latest full candidate validation: 2,105 tests / one skipped; compile/bundle,
activation and relevant editor/workflow checks passed. Earlier read-only CLI
routing probes remain [separate evidence](../../tools/lab/results/build-handoff-clients-2026-10-20.json), not substitutes for this installed trial.

## Reproduction

`installed-host.mjs` opens a normal separate installed VS Code window and a
private loopback test-control bridge. It requires HRDMO lab credentials in the
environment and existing configured CLI authentication. The bridge token stays
in a mode-600 temporary descriptor and is never included in retained evidence.
`control.mjs` operates actual installed controls/terminals. `review.mts` audits
the concrete request-linked Change Sets without approving or applying them.

The independent verifier never approves, stages, applies or submits a process:

```sh
PSFT_HANDOFF_MCP_URL=http://127.0.0.1:<window-port>/mcp npx tsx tools/lab/build-handoff/verify.mts codex 607265
PSFT_HANDOFF_MCP_URL=http://127.0.0.1:<window-port>/mcp npx tsx tools/lab/build-handoff/verify.mts claude 607266
npx tsx tools/lab/build-handoff/run-status.mts
```

The endpoint override is necessary while verifying a separate window. Default
endpoint is 7337. `prepare.mts` is trial setup only; do not replace an existing
approved request or reuse occupied definition names to rerun acceptance.
