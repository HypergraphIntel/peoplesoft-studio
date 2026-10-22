# 1.0 core qualification — complete

Completed October 22, 2026: **V1-1 through V1-5 pass** for the bounded Oracle /
PeopleTools **8.62.09** core on **Linux x64 and Windows x64**. This qualified
core ships in [0.9.8](../0.9.8.md); no version 1.0 is published. The
[release plan](../../RELEASE_PLAN.md) retains the 1.5/2.0 expansions and the
explicitly Low-priority scheduler acceptance work.

The [machine-checked qualification manifest](../../../tools/lab/results/release-1.0/qualification.json)
binds every installed report to the same VSIX and frozen product source.

| Gate | Completed evidence | Boundaries retained |
| --- | --- | --- |
| V1-1 | [Support contract](../../SUPPORT_MATRIX.md), shared `CORE_READY` model in Settings/tool descriptions/MCP orientation and operation catalog; stale Query/project reversal claims reconciled | Oracle 8.61.15 remains bounded preview; SQL Server/DB2 production and macOS are unqualified. Standalone class lifecycle and unverified event-write variants retain preview labels |
| V1-2 | 2,240 local tests pass, 70 production HTTP/UI workflow fixtures pass; native save/readback, dirty and stale refusal, actual reviewed inverse/redo; Windows persistence defects and packaged editor configuration fixed | Per-writer transactions, current authorization/approval/native-token gates and explicit legacy save paths remain. No universal rollback or complete dynamic-reference closure |
| V1-3 | Fresh 430/430 protected EXACT gate, zero regressions/source changes; targeted IDs 27362, 28098 and 19282 EXACT; compiler worker byte-identical to published 0.9.7 with retained native 8.62.09 validation | One existing 0x4F golden-fixture calibration TODO remains skipped; no full-language or new full-corpus certification. Unsupported or unprovable saves retain their refusals |
| V1-4 | Normal installed upgrade/reload: 17 checks each on Linux VS Code 1.143.0 and Windows VS Code 1.141.0; blank-profile native SQL creation/draft/comment/inverse: four checks each; actual SecretStorage/drafts/history and disconnect/reconnect | Same profile/workspace is required for its backups/history. Actual before/after-commit SIGKILL tests cover the shared recovery service; they are separate from installed UI checks and do not certify OS power-loss durability |
| V1-5 | One exact VSIX passes all 65 installed acceptance checks, Query and physical Build checks, both native crash boundaries and four CI jobs; frozen committed source, matching artifact fingerprints, reconciled trackers and [upgrade/support notes](UPGRADE.md) | No publication/version bump to 1.0. Separate-environment promotion, broader structural review and native scheduler acceptance remain later scope |

## Frozen candidate and checksums

Product source freeze: `32177c66d62406cc9c29d7e25e83e442b4c2bc7c`.
The qualification verifier refuses runtime-source drift from that commit.
The tested qualification artifact is `peoplesoft-studio-0.9.8-core-candidate.vsix` in the repository
root (ignored by Git). The final 0.9.8 release updates packaged release
documentation only; its separate checksum and runtime equivalence are recorded
in the [release artifact record](../../../tools/lab/results/release-0.9.8.json).

- VSIX SHA-256: `ae4082f77ce72cf19110aff405bc75dfe607511569b00e263785fac92ce443d0`
- Extension bundle SHA-256: `37997adb101fdf07de01f1ffa3718963020d32e36ab1794e1be7f1e2dbd1663e`
- Compiler worker SHA-256: `2022a1104d48cd47f48806708a56dfdbd689e7dcf657e913277f287f885b2c01`

[Source-freeze CI](https://github.com/HypergraphIntel/peoplesoft-studio/actions/runs/39726848453)
passes Ubuntu/Windows × Node 22/24, including required rendered browser checks
and all 70 production MCP fixture workflows on every job. The
[CI record](../../../tools/lab/results/release-1.0/ci.json) retains the exact SHA,
job results and URLs. Evidence-only follow-up commits do not change the tested
product files or artifact.

## Acceptance reports

| Report | Checks | What it proves |
| --- | ---: | --- |
| [Linux upgrade](../../../tools/lab/results/release-1.0/linux-upgrade.json) | 17 | Untouched published 0.9.7 upgrade; SecretStorage, dirty native SQL drafts, history, disconnect/reconnect, dirty/stale refusal, rendered save/inverse/redo, physical Create Tables/Alter/Create Indexes with an owned row retained, cleanup and final restart |
| [Windows upgrade](../../../tools/lab/results/release-1.0/windows-upgrade.json) | 17 | Same journey on the actual Windows client; records the old asset's directory-fsync refusal without attributing a successful reviewed write to 0.9.7 |
| [Linux fresh install](../../../tools/lab/results/release-1.0/linux-fresh-install.json) | 4 | Blank current-candidate profile, credential path, staged creation without persistence, rendered application, actual SQL comment toggling, draft isolation, destructive creation inverse and cleanup |
| [Windows fresh install](../../../tools/lab/results/release-1.0/windows-fresh-install.json) | 4 | Same fresh-profile journey on the Windows desktop |
| [Query](../../../tools/lab/results/release-1.0/query-installed.json) | 10 | Installed designer criteria/aggregate/join/expression/translate/effective-date/subquery/union editing and actual displayed values; consent refusal, reviewed rename/delete and exact undo |
| [PeopleCode editor](../../../tools/lab/results/release-1.0/peoplecode-editor-installed.json) | 13 | Fresh installed completion/navigation/diagnostics/settings, actual popups, large-class responsiveness and connection behavior; native database unchanged |

[Compiler qualification](../../../tools/lab/results/release-1.0/compiler-qualification.json)
retains reproducible protected/targeted logs and the unchanged worker binding.
The previous native App Designer validation and scheduler acceptance are retained
historical evidence for that compiler; no fresh full-corpus run or new scheduler
execution is claimed.

[Hard-crash recovery](../../../tools/lab/results/release-1.0/recovery-crash-native.json)
uses actual SIGKILL before and after real HRDMO commits, durable state and native
readback. Recovery changes no native token/counter and never replays a writer;
remaining work requires fresh approval. Its approval is a trusted service-test
API, distinct from the rendered installed review journeys above.

[Cleanup audit](../../../tools/lab/results/release-1.0/native-cleanup.json)
finds zero qualification SQL/Record headers, children, markers and physical
tables. Failed diagnostic fixtures were removed only from their recorded fresh
ownership receipts; unrelated definitions and the original workbench were
preserved. Native cache counters were not rewound.

## Defects closed during qualification

- Windows rejected directory fsync after local history publication. Files still
  flush before atomic replacement; directory flushing remains enabled where
  supported. Windows sharing/scan conflicts retry only the same local rename,
  never a PeopleSoft writer. Permanent errors retain explicit failures.
- The package declared an absent SQL grammar and reused PeopleCode comments for
  SQL. The grammar/configuration now ship, SQL comments use `--`, and malformed
  PeopleCode JSON/regex flags are corrected. Smoke parses every configuration
  and regex. The compiler was not changed.
- CI now provisions its browser portably. Windows fixture APIs are registered
  before importing production modules; legal review fixture clicks wait for the
  actual idle/enabled render. No approval, disabled-control or writer gate was
  weakened to obtain passing results.
- Initial draft loss was isolated to the test's Extension Development Host.
  Installing its independent driver in a normal private profile proves actual
  persistent backups. The product bundle, worker and manifest remain unmodified
  during each installed run.

## Reproduce and next work

With the established HRDMO lab credentials in the environment, use the installed
host tools in `tools/lab/release-1.0/`; Windows runs through the existing active
interactive desktop and a temporary user-bound DPAPI credential bridge. Secrets
are excluded from source, settings and reports. The verifier needs no credentials:

```sh
python3 tools/lab/release-1.0/verify-evidence.py \
  peoplesoft-studio-0.9.8-core-candidate.vsix \
  --source-freeze 32177c66d62406cc9c29d7e25e83e442b4c2bc7c
```

Recommended next big win: **V15-1, structural Page Change Review**, starting with
insert/delete/rebind/order and native persisted-ID mapping. Separate Oracle
promotion and realistic business/Windows AI handoff remain 1.5 expansions.
Run and Monitor RT-L1–RT-L4 remain **Low priority**; no gateway patch was deployed
and no scheduler process was submitted by this qualification effort.
