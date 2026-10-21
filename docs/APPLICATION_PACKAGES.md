# Application Package workspace

Opening an Application Package from **Open Definition**, Projects or the
Definition Browser opens its package tree. Package definitions are containers,
not text files. **New Definition → Application Package** creates the empty root
and opens the same workspace immediately.

Select a package and use **Insert Subpackage** or **Insert Class**. Empty
subpackages are saved immediately. A new class opens with its declaration in
the normal PeopleCode editor; its first save creates the class. Double-click
an existing class, or select it and use **Open PeopleCode**, to open its source.
Normal source save, dirty state, undo/redo and conflict handling stay in that
editor. Saving a new class refreshes the package tree. **Refresh** reloads the
package, retaining the selected node when it still exists.

The tree uses compact, uniform rows with aligned package/class icons, consistent
indentation and subtle hierarchy guides. The selection details move below the
tree in a narrow editor. See the rendered fixtures at
[wide](../tools/lab/results/application-package-alignment-wide.png) and
[narrow](../tools/lab/results/application-package-alignment-narrow.png) widths;
these reproduce the supplied example hierarchy, not a native save trial.

Root packages and subpackages also offer insertion commands in the Projects
and Definition Browser context menus. Packages inferred from selected project
classes can be opened. A live database package shows all of its package/class
metadata, including empty subpackages; a project export shows the members it
carries and stays read-only.

## Save scope

Writable connections require a PeopleSoft Operator ID and a root within the
configured write scope. Existing-package customization policy also applies.
The new standalone subpackage writer is bounded to Oracle and two subpackage
levels. It locks the root, checks the displayed native version, refuses an
occupied sibling or missing parent, updates package rows and APM/SYS counters,
and verifies readback before commit and on an independent connection. Stale
trees require Refresh. A failed precommit check rolls back the transaction.
Empty subpackage saves leave PeopleCode and class rows unchanged.

The row layout and package-save counter protocol come from the existing
[c03–c06 captures](CREATE_DEFINITIONS.md#application-package-c03-zz_pcode_lab_pk2).
The standalone empty-subpackage path has HRDMO provider save/readback evidence;
this does not claim a new native App Designer capture for that operation.
Package/class rename, deletion and editable package properties remain outside
this workspace's scope. Structural package changes are immediate native saves;
they do not introduce a new Change Review creation or reversal adapter.

## Verification — October 20, 2026

- Unit checks cover search/project/program key layouts, empty nested packages,
  stale version and duplicate/missing-parent refusal, transaction rollback and
  dry run.
- Nine production panel checks cover exact source navigation, selected parent,
  forged messages, stale rendered versions, duplicate clicks, read-only changes,
  escaping and overlapping refreshes without lost selections. A tenth check
  executes the actual page scripts/buttons in
  Chromium; [rendered fixture](../tools/lab/results/application-package-panel.png).
- Six live Oracle HRDMO 8.62.09 provider checks create/read back an empty root,
  empty and nested subpackages, a nested class and a normal PeopleCode edit,
  plus stale-save/dry-run checks. Only unique disposable lab rows are touched;
  cleanup is independently verified. See
  [native provider results](../tools/lab/results/application-package-native-2026-10-20.json).
- Six checks against the unmodified installed VSIX in real VS Code 1.141.0
  pass on HRDMO 8.62.09: New Definition, empty/nested subpackage buttons, class
  declaration and actual source save, search/project-key opening, rendered
  Open PeopleCode and read-only mode. Disposable metadata cleanup and installed
  bundle/worker integrity checks pass. See [installed results](../tools/lab/results/application-package-installed-2026-10-20.json)
  and [actual workbench capture](../tools/lab/results/application-package-installed.png).

The installed trial exposed a late-refresh selection race. Overlapping reloads
now share a single read, unchanged snapshots avoid a redraw, and source-opening
messages wait for a pending refresh. A controlled delayed-read check protects
this case alongside the installed button trial.

Commands:

```sh
npm run verify
npm run test:application-packages -- --browser
npm run test:application-packages:native
npm run test:application-packages:installed
```

The installed check uses an isolated VS Code profile and the unmodified VSIX,
with a disposable HRDMO package. It records actual menu/button/source-save
results and package integrity independently of the fixture checks.
