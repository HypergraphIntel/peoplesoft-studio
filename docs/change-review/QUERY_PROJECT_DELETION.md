# Query and project creation reversal: native calibration

Production deletion writers and reviewed creation reversal for these families
remain open. Six native cases now establish their Oracle HRDMO / PeopleTools
8.62 protocol. This evidence comes from actual Windows Application Designer
and Windows Query, rather than assumptions about the existing readers.

| Case | Native operation | Captured behavior |
| --- | --- | --- |
| qp01-native-project-delete | Delete disposable project `ZZ_PCODE_LAB_DPR8` containing public/private Query memberships | Removes PSPROJECTDEFN and both PSPROJECTITEM rows; inserts PSPROJECTDEL at new PJM. PSVERSION PJM/SYS and PSLOCK PJM each advance once. Both Query definitions remain unchanged. |
| qp02-native-project-recreate | New Project, then Save Project As under the deleted name | Creates only the empty project header, clears PSPROJECTDEL, and advances PJM/SYS and lock-PJM once. Membership restoration remains a separate typed project save. |
| qp03-native-public-query-delete | Delete public `ZZ_PCODE_LAB_DQP8` in Windows Query | Removes its four populated Query table families, inserts PSQRYDEL with blank OPRID and new QDM; QDM/SYS and lock-QDM advance once. |
| qp04-native-public-query-recreate | Windows Query Save As from the owned private fixture to the deleted public name | Recreates all seven supported Query table families, including criterion/expression/bind rows; clears the blank-owner PSQRYDEL marker. QDM/SYS and lock-QDM advance once. |
| qp05-native-private-query-delete | Delete JARED-owned `ZZ_PCODE_LAB_DQJ8` with a prompt | Removes all seven populated Query families and inserts PSQRYDEL with OPRID JARED and new QDM. QDM/SYS and lock-QDM advance once. |
| qp06-native-private-query-recreate | Windows Query Save As from the owned public fixture with Owner PRIVATE | Recreates all seven Query families with OPRID JARED and clears only that owner-specific deletion marker. QDM/SYS and lock-QDM advance once. |

The private fixture was enriched through the existing calibrated writer between
cases 3 and 4, outside every native capture window. Public/private recreation
uses native Save As, so the source Query stays intact while the deleted identity
is created again. No query execution, grants, report delivery or application data
are changed by these captures.

The snapshot tool now discovers every PeopleTools base table keyed by QRYNAME or
PROJECTNAME, retaining only lab-prefixed rows. Project target-login/account
columns are excluded. Global table-count observations remain, while unrelated
swept row values are omitted; unknown nonlab side effects are not certified.
Each capture has an empty incomplete list. Six regression tests in
`src/test/queryProjectDeletionProtocol.test.ts` freeze the exact changed table
sets, child identities, marker ownership and counter movements.

[Calibration and complete owned-scope cleanup](../../tools/lab/results/query-project-deletion-calibration-2026-10-20.json).
The helper `tools/lab/query-project-delete-lab.mts` refuses every pre-existing
fixture name and unexpected reference/ancillary cleanup. It removes only its
owned Query/project headers, children and markers and verifies absence across
the complete discovered scope. Native global counters remain monotonic. The
original project and package view are restored after the trial.

## Next implementation

Add explicit marker-aware vacant checkpoints without reinterpreting old history
or weakening native ownership/access checks. Implement typed deletion with
reference and ancillary refusal, locked complete native tokens/counters,
operator/write scope, rollback validation and exact precommit/readback checks.
Project deletion must remove only its own header and memberships, never the
contained definitions or unrelated project metadata. Ordinary creation must
refuse tombstones; only freshly reviewed restoration can clear bound markers.

Integrate the typed paths with Query/project creation, migration and history,
including dependency-ordered inverse, fresh continuation approval and full redo.
Use native rollback/application trials and separately installed rendered review
controls before claiming creation reversal support. Dynamic Query references,
project ancillary/configuration state and credentials need explicit refusal
boundaries rather than raw-row replay.

Validation: all six native-protocol tests pass, including explicit checks that
project account columns are absent from all twelve snapshots. Full
`npm run verify` passes 2,155 tests / one skipped, activation smoke, 18 editor
checks and 9 package checks. Both lab helpers pass strict TypeScript checking.
No production runtime, encoder or decoder change is made by this calibration.
