# 1.0 core support and upgrade notes

Release **0.9.8** ships the qualified focused 1.0 core. These notes describe
that release; version 1.0 is not yet published and preview boundaries remain.

**0.9.9** upgrades the same way: install `peoplesoft-studio-0.9.9.vsix` from its
[GitHub release](https://github.com/HypergraphIntel/peoplesoft-studio/releases/tag/v0.9.9)
over 0.9.8 in the same profile and reload. It keeps credentials, drafts and
Change Review history, and changes no stored setting. Promotion uses two Oracle
connections configured in the same profile. Migration packages that contain the
new asset kinds (process definitions, File Layouts) are refused by 0.9.8. See the [0.9.9 notes](../0.9.9.md).
Use the [support matrix](../../SUPPORT_MATRIX.md) for exact operation limits and
[qualification tracker](PROGRESS.md) for completed checks and remaining gates.

## Installation and upgrade

Install `peoplesoft-studio-0.9.8.vsix` from the
[GitHub release](https://github.com/HypergraphIntel/peoplesoft-studio/releases/tag/v0.9.8) with VS Code's **Extensions: Install from VSIX…**, or
`code --install-extension peoplesoft-studio-0.9.8.vsix --force`, using the existing VS Code
profile and workspace. The extension ID remains
`JaredNorris.peoplesoft-studio`. Reload the window after installation.

Connection credentials stay in VS Code SecretStorage. Native text drafts use
VS Code's hot-exit backups; keep hot exit enabled and reopen the same workspace
and user profile to recover them. Change Sets and history remain in that
profile's extension global storage, separate from the repository. A separate
profile or `--user-data-dir` creates separate credential, backup and history
storage rather than migrating the original profile.

The qualification journey upgrades the untouched published 0.9.7 VSIX,
checks dirty SQL drafts and stored credentials, reloads again, applies/inverts/
redoes through rendered review, and restarts after verified cleanup. Windows
0.9.7 can retain a local DRAFT while reporting directory-fsync `EPERM`; 0.9.8
fixes that OS incompatibility and preserves the retained history. Local atomic
replacement also retries bounded Windows sharing conflicts. Neither change
authorizes a proposal or retries a PeopleSoft write.

## Supported save and recovery behavior

Writable access, Operator ID, configured name/ownership policy, native token
checks and the operation's current approval path still apply. A Change Set
requires its current revision to be reviewed in **PeopleSoft → Change Review**.
Older partial histories retain their original reversal limits; upgrading does
not create missing checkpoints or grant old approvals new authority.

After an interrupted application or lost response, inspect Change Review and
use its live reconciliation action. A matching committed after-image is recorded
without replay. An unchanged baseline or remaining work requires a new reviewed
continuation; unknown or drifted outcomes stop for inspection. The
[crash evidence](../../../tools/lab/results/release-1.0/recovery-crash-native.json)
distinguishes an actual process kill from fixture and installed UI checks.

Build and Execute remains a separate DDL confirmation. Oracle DDL commits as it
runs and can stop after earlier statements succeeded. Metadata inverse/redo
does not restore physical tables or application data. Query rename uses copy
plus reviewed deletion and does not rewrite external references.

## Preview and later targets

Run and Monitor stays preview with its remaining native acceptance explicitly
**Low priority**. Standalone class lifecycle review, broader structural review,
separate-environment promotion and native Windows AI Build handoff target 1.5.
SQL Server/DB2 production qualification, cross-platform promotion, Data Migration
Workbench and broader parity/security work target 2.0. Current calibrated
features retain their existing guards and documented limits.

## Support evidence

Record the extension version and VSIX hash, OS/architecture, VS Code version,
database/PeopleTools patch, exact definition key, Change Set ID/revision/status,
and the visible error. Include the outcome of a fresh native readback or
reconciliation when available. Keep passwords and SecretStorage data out of
reports. Reported fixture coverage, installed UI behavior, native metadata
readback and actual runtime execution are separate evidence categories.
