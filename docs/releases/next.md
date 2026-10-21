# PeopleSoft Studio 0.9.7 — unreleased

Development starts from [0.9.6](0.9.6.md), published October 20, 2026.
The `v0.9.6` tag and published VSIX remain the released build.

Application Packages now open in a tree workspace instead of falling through
to the unsupported-text message. New packages open there immediately; insert
empty subpackages or classes, then open class PeopleCode in its normal editor.
The tree refreshes after class creation and offers read-only browsing. Empty
subpackage saves use root-version checks, policy/scope guards, transactional
readback and independent verification. See [package workflow and acceptance](../APPLICATION_PACKAGES.md).

The PeopleCode language server's follow-ups are in: definition references
(`Record.X`, `Page.X`, `Component.X`, `SQL.X` ...) are checked against the
connection -- as notes, since native probes showed App Designer compiles them
unchecked, except `Image.X`'s 2,68 warning -- and completion offers a record's
fields after `RECORD.`, every built-in function, and an application class's
own and inherited members after `%This.`/`%Super.`. This also fixes 0.9.6
reporting `SQL.X` and `Page.X` as undefined fields.

Editor acceptance fixes keep inherited/record member completion available as a
name is typed, bound slow completion reads, invalidate connection caches and
drop stale/cancelled results. Explicit validation now uses a background worker
and stops obsolete work after an edit. Live diagnostics also discard results
after closure, settings or connection changes; failed metadata reads no longer
invent missing-field warnings. The editor acceptance task is complete: 13
checks against the unmodified installed VSIX pass on VS Code/HRDMO, including
rendered suggestion popups, full validation of a real large delivered class and
close/reopen cleanup, with no database saves. See
[editor acceptance](../PEOPLECODE_EDITOR.md) for the completion audit,
reproduction commands, timings and evidence.

Project migration now includes bounded Oracle standalone SQL definitions with
text, descriptions, full comments and owner. Preview shows the target baseline
alongside the package payload and binds the native target identity. Full-row
SQL fingerprints are checked under lock before writing; complete text and
metadata are read back after saving. Imports add only missing project members,
so repeat imports remain unchanged and resume preserves unrelated memberships.
Eleven native HRDMO 8.62.09 pipeline checks passed, including long SQL/comments,
create/update, stale SQL/metadata/project refusal and independent full readback.
The native trial used the same lab database for source export and vacant-target
import. See [migration scope and evidence](../PROJECT_MIGRATION.md). Current development also adds HTML/freeform stylesheets, authoritative standalone and associated Record PeopleCode, bounded PS Query and scoped standard/popup menus. Target changes and project membership stage into durable Change Review. Native text, Query and Menu trials pass with cleanup; a separate installed VSIX completed Import and rendered Menu/project approval with full native readback. Pages/components, package/class creation, subrecords/indexes/translates and advanced fields remain open migration adapters.

Change Review now offers **Approve and apply** as the primary action for
validated proposals, with approach approval separate and approval-only retained
under More actions. Approval and application share one store lock and bind the
exact rendered revision and eligible object IDs. Rejected objects and their
blocked dependents stay excluded. The existing approval hashes, destructive
checkbox, policy/dirty-editor gates, native precommit checks, checkpoint and
readback path remain. Duplicate clicks cannot replay writes. Production HTTP/UI
fixtures execute the rendered click script and verify stale-page/dirty-editor
refusal and exact guarded application; this is not a new live PeopleSoft apply
trial. See [design and verification](../change-review/APPROVE_AND_APPLY.md).

Build Request handoff now uses a per-session MCP endpoint override so the
configured Codex/Claude client reaches the requesting Studio window. POSIX
launches pass literal process arguments; Windows uses quoted shell tasks.
Starting MCP refreshes the write-capability state before launch. Both installed
clients passed actual installed Build-button trials in a separate window,
read the approved specs, built through normal review/confirmation, and completed
native runs 607265/607266 with exact CSVs. Both original reports are now Posted to Web with usable native View Log/Trace
and exact CSV downloads after the targeted agent recycle and transfer-location gzip exclusion. See [handoff acceptance](../build-requests/BUILD_HANDOFF.md).

Track the remaining project completion gates in
[1.0 readiness](../RELEASE_1_0_READINESS.md). No 1.0 delivery date is committed.

Current recovery development adds schema-3 combined continuation inverse/redo,
full inverse approval and calibrated Record/AE deletion/recreation with tombstone
fingerprints. Actual native SIGKILL before/after HTML commit reconciled without
replay. A separate installed VSIX passed Record-only pause, fresh AE continuation,
combined destructive inverse and fresh redo restoring exact native checkpoints,
with cleanup. See [recovery evidence and limits](../change-review/PROGRESS.md).

Interrupted undo now supports freshly reviewed remaining work with schema-4
lineage, checked completed steps, and full-chain redo. Native Record/AE lost-reply
and restoration checks pass with cleanup; broader creation deletion remains
unsupported. See [current recovery progress](../change-review/PROGRESS.md).

Separate installed acceptance now verifies rendered interrupted-undo continuation,
exact-state checkbox retention and redo from the original source history against
HRDMO, with complete native checkpoint restoration and cleanup.

Complete Oracle 8.62 SQL/HTML/freeform stylesheet checkpoints now support
reviewed creation deletion and fresh redo, including interrupted inverse
continuation. Typed transactions use full native tokens, calibrated tombstones,
known-reference refusal, rollback preview and exact metadata readback. SQL CLOB
locator reads preserve supplementary Unicode at inline-fetch boundaries.
Legacy partial text histories keep their original limits; Query/project
creation deletion remains open. See [text recovery scope](../change-review/TEXT_DELETION.md).

Project migration now carries pages and components (complete native rows,
created or replaced), Application Packages with their classes and root
properties, SubRecords and subrecord rows, SQL Table user-defined indexes,
translate values and every stored field property (owner ID, formats, default
century, IME mode, format family). Export no longer refuses ordinary fields
(New Field's default century of 50 was read as an advanced property) and no
longer drops owner IDs or non-character formats. Each new writer follows a
Windows App Designer capture and was compared row for row with App Designer's
own rows; definitions made by migration open and re-save cleanly in App
Designer. See [project migration](../PROJECT_MIGRATION.md).

An applied migration can be undone and redone from Change Review history,
including pages, components, fields, packages and classes, through deletion
writers calibrated against App Designer's File > Delete. Query and project
creation can also be reversed. Applying a review that creates a definition and
something judged by it (Record PeopleCode under a new record) no longer stops
with "Authorization context changed"; the changed ownership evidence is
re-stamped and journaled after the live policy check.

Applying a reviewed change that creates a definition and then saves more of it
(a migrated field's properties after creating it, a package's subpackages after
its root) is no longer stopped by the delivered-object guard as "ownership or
policy changed after Change Review".
