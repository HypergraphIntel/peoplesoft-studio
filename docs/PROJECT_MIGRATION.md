# Project migration in PeopleSoft Studio

Studio exports and imports its own versioned JSON packages. Application Designer is not required.

## Export

Right-click a project and choose **Export Migration Package...**, or use the command palette. Choose a destination for `<project>.psft-migration.json`.

Version 1 carries custom field definitions, SQL Table and Derived/Work record metadata, and complete App Engine documents with their SQL and PeopleCode. AE sections and PeopleCode retain their separate project memberships while their contents travel with the owning program.

Unsupported project members or record/field settings stop export with a concrete error. They are never silently omitted. Current unsupported adapters include pages, components, menus, queries, standalone PeopleCode, standalone SQL/HTML/stylesheets, subrecords, secondary indexes, translate values and advanced field properties. Existing readers for App Designer XML remain available for compatibility; that format is not the Studio package format.

Packages include the source PeopleTools release family, project member keys, explicit external prerequisites, and a SHA-256 content checksum. Credentials, database connection strings, application data, and installation-local version/update stamps are not included. The checksum detects changed content; it is not a digital signature.

## Review and import

Run **Import Migration Package...**, choose the package and target database connection, and inspect the preview. Import requires Writable access and a PeopleSoft Operator ID.

The preview classifies assets as create, update, or same, checks known prerequisites, compiles AE PeopleCode for the target release, and reports release or scope blockers. Apply only after reviewing the target and changes. The current source and target release families must match; cross-release migration is not inferred.

Before applying, Studio reads the preview state again. Concurrent target edits invalidate the preview. Changes run in dependency order through the existing guarded writers; each stored definition is read back and checked against the package. Finally the target project is created or its memberships are added with a version check.

The receipt lists verified saves, the failed definition (if any), and the error. Writers commit independently: if a later save fails, earlier saves remain. Re-previewing a package recognizes unchanged definitions and resumes the remaining work. Existing project items are preserved; import does not remove definitions or members absent from the package.

Record migration writes metadata. Use Studio's Build commands for physical SQL tables; application data is not copied. SQL views and complex record shapes need additional migration adapters.

## Dependency review

**Review Project Migration...** opens a saveable Markdown report with project members, optional modeled target comparison, explicit dependencies, and unresolved coverage. On Writable sources, select supported dependencies to include through the existing project writer. Nothing is selected automatically.

Direct dependencies come from record fields, prompt/default/property records, AE state and temporary records, sections, variant-specific PeopleCode, and static external calls. Dynamic calls and references inside SQL/PeopleCode are not a complete dependency closure. Dependencies outside the source project may already be delivered in the target. Include the custom definitions your program requires and validate the resulting runtime behavior.

Text comparison normalizes CRLF and trailing whitespace. Record/field comparison uses modeled metadata and excludes local version/update stamps. Target read failures remain errors unless a successful untruncated search establishes exact-key absence. Packed AE PeopleCode identities normalize through the existing project-item model.

## MCP

- `psft_project_migration_review`: `connection`, `project`, optional `target`; structured review and Markdown.
- `psft_project_export_migration`: `connection`, `project`; Studio package JSON.
- `psft_project_preview_migration`: `connection`, `packageJson`; read-only target preview.

Apply imports through the extension's preview-and-apply command. The existing MCP project-add tool remains available for membership additions.

## Validation

Tests cover package round trips, dependency ordering, idempotent import, checksum failures, unsupported members, missing prerequisites, release mismatch, concurrent target edits, verification failures and orphan AE members. Comparison tests cover real export fixtures, read errors, wildcard/truncated searches, omitted payloads, record stamps, metadata changes, and packed AE keys.
