# Trees

Trees (326 effective-dated versions on HRDMO, PeopleTools 8.62.09) and
what PeopleSoft Studio shows from them (`src/model/treeDefinition.ts`).
Read-only.

| Table | Rows | Holds |
|---|---|---|
| `PSTREEDEFN` | 326 | the tree, by `SETID` + `SETCNTRLVALUE` + `TREE_NAME` + `EFFDT`: status, structure, level use, counts, access method |
| `PSTREESTRCT` | 20 | the structure: node and detail records and fields, type |
| `PSTREELEVEL` | 754 | levels (`TREE_LEVEL_NUM` -> `TREE_LEVEL`) |
| `PSTREENODE` | 22,094 | nodes: `TREE_NODE_NUM`, `TREE_NODE`, `TREE_LEVEL_NUM`, `PARENT_NODE_NUM` (0 at the top) |
| `PSTREELEAF` | 220 | detail ranges under a node: `RANGE_FROM` / `RANGE_TO`, `DYNAMIC_RANGE` ('Y' with no range: all detail values) |

The coded columns have PSXLATITEM labels, read with the rows:
`USE_LEVELS` (S Strictly Enforced, L Loosely Enforced, N Level Not Used),
`VALID_TREE` (Y Valid Tree, N Draft Tree), `TREE_ACC_METHOD`,
`TREE_ACC_SELECTOR`, `TREE_ACC_SEL_OPT`, `TREE_STRCT_TYPE` (D Detail, S
Summary), `EFF_STATUS`.

Projects: OBJECTTYPE 12, OBJECTIDs 34 SetID / 68 set control value / 36
tree name / 21 effective date. Query trees have a blank SetID.

Every tree on HRDMO renders without an error. Trees are in the Definition
Browser and Open Definition, one entry per effective-dated version, named
"TREE (SETID, EFFDT)".
