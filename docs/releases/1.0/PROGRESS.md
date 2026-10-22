# 1.0 completion tracker

Active objective: complete every V1-1 through V1-5 requirement in
[the release plan](../../RELEASE_PLAN.md). This tracker records evidence and
open work; it does not replace or narrow those requirements. The 1.5/2.0
expansions and Low-priority scheduler work remain deferred. No tag or
publication is authorized by this qualification effort.

## Qualification matrix

| Gate | Requirements retained | Current evidence | Remaining work |
| --- | --- | --- | --- |
| V1-1 | Explicit database/PeopleTools/client support matrix; operation limits and consistent UI/MCP/docs maturity | Oracle 8.62.09 named primary profile; existing native Oracle 8.61/8.62 findings remain release-specific | Shared contract implemented in Settings, tool descriptions, MCP orientation/catalog and support matrix; finish native client qualification and stale-claim audit |
| V1-2 | Correctness, authorized writes, native readback, conflict/refusal/recovery; no critical stable-path defect | Current full verify passes; existing installed/native review/recovery evidence retained | Audit current code and fix defects; exercise final artifact's supported save/refusal/recovery paths; retain native evidence |
| V1-3 | Protected 430 baseline; targeted regression and representative native compilation for declared profiles; explicit unsupported refusals | Fresh local snapshot gate: 430 EXACT, zero regressions, zero source changes | Retain reproducible gate report and native validation evidence bound to final compiler artifact |
| V1-4 | Fresh install/upgrade, credentials/drafts/history, client OS coverage, connection loss/reload/interrupted-save safety | Linux installed native test infrastructure exists; Windows ps-win-client is running and reachable by SSH; guest agent is absent | Verify final installed artifact on Linux and Windows, upgrade from published 0.9.7, real SecretStorage/draft/history persistence and recovery; Windows sign-in verified; interactive installed acceptance running |
| V1-5 | Representative native core journeys, clean CI, exact artifact fingerprints, reconciled docs, frozen committed scope and support/upgrade notes | Current full verify passes; old native/installed reports are historical evidence | Fix browser-dependent CI setup, add Windows/runtime matrix, run exact-candidate installed/native checks, write upgrade/support notes, freeze/commit and obtain remote CI evidence |

## Current execution

- Initial full `npm run verify`: passed (2,237 tests; 2,236 pass, one skip),
  activation/editor/package fixtures and runtime Chromium/HTTP checks.
- Fresh `npm run corpus:verify -- --limit 430`: PASS, 430 EXACT; zero
  regressions, unchanged failures, new definitions or source changes.
- Current local `npm run verify`: 2,239 tests (2,238 pass, one skip), plus
  activation, editor, package and runtime rendered/HTTP checks. Production MCP
  workflow fixtures: all 70 pass. These are not native runtime certification.
- CI source now targets Ubuntu/Windows and Node 22/24, with explicit Chrome
  provisioning and a portable browser resolver. Remote matrix results remain open.
- Packaged SQL grammar was missing despite its manifest contribution. Added the
  grammar and smoke checks for every contributed grammar/configuration path.
- Linux normal installed VS Code 1.143.0: all 12 upgrade/reload checks pass,
  published 0.9.7 to the unmodified 0.9.8 candidate. Real SecretStorage reuse,
  hot-exit native SQL drafts, history, disconnect/reconnect, dirty refusal,
  rendered apply/inverse/redo, stale-reversal refusal and fresh reviewed cleanup
  pass. [Report](../../../tools/lab/results/release-1.0/linux-upgrade.json).
  The three abandoned diagnostic fixtures were removed only after validating
  their original absent-scope ownership receipts and synthetic source.
- Initial draft loss was isolated to the test's Extension Development Host,
  whose backups did not persist across launches. Installing the independent
  driver into a normal isolated profile proves actual hot-exit persistence.
- Exact Linux candidate SHA-256:
  `426f08576249872ec7444af116b760902023d8e867c1c5a96f8c88ec8bdc870e`.
  Fresh installed PeopleCode editor checks pass on that same VSIX. Query checks
  and Windows interactive acceptance are running; no pass is claimed yet.
- Windows VM sign-in and HRDMO reachability are verified. The isolated driver
  runs in the existing interactive desktop; SSH's session-zero launch cannot
  qualify UI behavior. Credentials remain outside reports, settings and source.

All gates remain open until their final evidence is inspected. Historical
native trials, fixture approvals and an artifact existing are not substitutes
for the required scope of final installed/native acceptance.


## Windows defect found during qualification

The first four-way CI run passed both Linux jobs and failed both Windows jobs.
Native Windows testing also reproduced `EPERM: operation not permitted, fsync`
from the published 0.9.7 Change Review store. The newly written file was already
renamed, but flushing its containing directory failed. The shared fix retains
file flushing and atomic replacement everywhere, and directory flushing on
platforms that support it; Windows errors from actual file writes/flushes are
not swallowed. Local full verification passes after the correction. Remote CI
and installed Windows acceptance of the corrected candidate remain required.

The unmodified 0.9.7 Windows upgrade seed records that refusal and verifies the
retained DRAFT history. It uses an independent owned SQL fixture for the dirty
editor setup. No passing native write is attributed to that old Windows asset.
Current-candidate save, inverse, redo and deletion still require actual rendered
review. A final restart checks the resulting history and cleanup without replay.
