# Query and project creation reversal: native calibration

Production deletion writers and reviewed creation reversal are implemented for
the bounded Oracle 8.62 scope below. Six native cases establish their Oracle
HRDMO / PeopleTools 8.62 protocol. This evidence comes from actual Windows Application Designer
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

## Implemented writers and reviewed recovery

Complete typed Query/project checkpoints include native deletion markers and
freshness tokens. Writers retain operator, writable-name scope, owner/access,
known-reference and ancillary-table checks, rollback previews and exact native
readback. Project deletion removes its own header/memberships and preserves
contained definitions. Nondefault metadata and target credentials refuse
project deletion; existing-project membership reversal is not calibrated.
Ordinary creation refuses tombstones. Only a freshly reviewed recreation can
clear the exact marker bound to its retained checkpoint.

The [nine native writer checks](../../tools/lab/results/query-project-reversal-native-2026-10-20.json)
and [16 reviewed native checks](../../tools/lab/results/query-project-reversal-reviewed-native-2026-10-20.json)
pass, including public/private owner markers, project-before-Query inverse,
lost committed deletion reply, reconciliation without replay, fresh remaining
approval and exact redo. Both reports verify owned-scope cleanup. These service
trials use trusted test approval and do not claim installed UI certification.

Separate installed acceptance covers Query rename/delete, destructive-consent
refusal and reviewed undo ([Query report](../../tools/lab/results/query-installed-2026-10-21.json)),
and bounded migration import/inverse/redo with its project
([migration report](../../tools/lab/results/migration-installed-2026-10-21.json)).
Current-candidate evidence is tracked in [1.0 progress](../releases/1.0/PROGRESS.md).
Dynamic references remain unknown; no raw-row replay, application-data undo or
separate-environment certification is implied.
