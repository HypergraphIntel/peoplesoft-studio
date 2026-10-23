# Application Package and class lifecycle review (V15-1)

Development state as of October 22, 2026: implemented, production HTTP/UI
fixture verified (routing, destructive consent, undo/redo, stale-undo refusal)
and HRDMO native verified (rollback previews and one rolled-back transaction);
installed developer-approved acceptance passed October 23, 2026 (package
ZZ_ACC15 and class ZZ_ACC15:Greeter created, the class deleted with destructive
consent and restored by undo with identical source; App Designer opens it).
A new class cannot be staged in the same Change Set as its new package: the
class preview needs the package to exist.

## What stages

On Oracle with Change Review:

| Request | Adapter | Operation | Writer (calibration) |
| --- | --- | --- | --- |
| `psft_save_peoplecode` type 58 for a class that does not exist | `app-class` | CREATE | PeopleCode writer's new class (c04–c06) |
| `psft_delete_application_class` (review-only) | `app-class` | DELETE | `deleteClass` (dl09) |
| `psft_create_package` | `app-package` | CREATE | `createPackage` (c03) |
| `psft_delete_package` (review-only, empty package) | `app-package` | DELETE | `deletePackage` (dl04) |

Saving an existing class's source keeps the `peoplecode` adapter. Deletions
require the developer's explicit destructive approval in the review UI.

## Checkpoints

`classLifecycle.ts` reads two catalog-driven scopes (every column, LOBs in full,
binary as hex, timestamps as nine-digit text; VERSION/LASTUPDDTTM/LASTUPDOPRID
excluded from content):

- `app-class/1`: the class's PSAPPCLASSDEFN row, its PeopleCode
  (PSPCMPROG/PSPCMTXT/PSPCMNAME under its seven-part key) and the package
  rows on its path. Null when the class row is absent.
- `app-package/1`: every PSPACKAGEDEFN row of the root and its
  PSAPPCLASSDEFN rows. Null when the root row is absent.

Deletion markers (PSPCMPROGDEL, PSPACKAGEDEL) and the class's own stamps bind
the token, not the content: a deleted definition reads as null, and
re-creating it clears its marker as App Designer does. Package-row stamps are
left out of a class token because saving any sibling class restamps every
package row (c06).

## Exactness

Staging turns the request into an intent (the class source, or the bare root
row), runs the calibrated writers on a connection whose commit is suppressed,
reads the after-image in the same transaction and rolls back. Validation and
application rerun the typed writers from the checkpoint (`writeClassChange`,
`writePackageChange`) against the live token; application commits once.

- A new class's subpackages must already exist: deleting it again would leave
  an empty subpackage behind (App Designer keeps it), so no exact undo exists.
- A class with a description or reference, and subpackage properties or
  package references, have no calibrated writer and are refused.
- A package with classes is not deleted here: stage the classes' deletion
  first. Undoing a package deletion re-creates the root, its subpackages
  (c05) and Package Properties (pk01).
- Undoing a class deletion re-creates the class and recompiles its source;
  the checkpoint (row, program bytes, names) must match exactly.
- Outside users of the package (any table with PACKAGEROOT, projects) refuse
  deletion as the writers already do.

## Evidence

- HTTP/UI fixture (writers modelled in memory): package + class creation in
  dependency order; class deletion with destructive consent; undo and redo;
  package deletion refused while it has classes; an undo whose class moved on
  since application is refused rather than replayed.
- `tools/lab/lifecycle-native.mts`
  (`tools/lab/results/lifecycle-native.json`), HRDMO: rollback previews of a
  new class in ZZ_PCODE_LAB_PK3:SUB1, deletion of
  ZZ_PCODE_LAB_PK3:SUB1:Second and a new package ZZ_PKG_REVIEW; deleting
  ZZ_PCODE_LAB_PK3 refused while it has classes. In one rolled-back
  transaction: class ZZReview created, undone and redone exactly; class Second
  deleted and re-created from its checkpoint exactly (PeopleCode recompiled
  byte for byte); package ZZ_PKG_REVIEW with SUB1 and properties deleted and
  re-created from its checkpoint exactly. Nothing persisted.
