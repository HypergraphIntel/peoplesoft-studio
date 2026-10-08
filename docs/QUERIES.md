# Queries

How PeopleTools stores PeopleSoft Query definitions (2,397 on HRDMO), mapped
by querying HRDMO (PeopleTools 8.62.09), and what PeopleSoft Studio shows
from them (`src/model/queryDefinition.ts`). Read-only.

## The tables

Every table is keyed by `OPRID` (blank: a public query) and `QRYNAME`.

| Table | Rows | Holds |
|---|---|---|
| `PSQRYDEFN` | 2,397 | the query: description, `QRYTYPE`, folder, version, stamps |
| `PSQRYSELECT` | 2,836 | its selects (`SELNUM`): `SELECTTYPE`, `PARENTSELNUM`, `QRYDISTINCT` ('Y' / blank) |
| `PSQRYRECORD` | 5,996 | each select's records: `RCDNUM`, `RECNAME`, `CORRNAME` (the alias, A, B ...), `JOINTYPE`, `JOINRCDNUM` |
| `PSQRYFIELD` | 52,221 | fields used by the select (`FLDNUM`): record field (`FLDRCDNUM` + `FIELDNAME`) or expression (`FLDEXPNUM`); `COLUMNNUM` > 0 for output columns, with heading, order and aggregate |
| `PSQRYCRITERIA` | 15,712 | criteria (`CRTNUM`): connector, operator, left field, right operands (fields, expressions, a subquery), parentheses, outer-join target |
| `PSQRYEXPR` | 9,737 | expressions (constants, prompts `:1`, lists, expression text) |
| `PSQRYBIND` | 3,040 | prompts: number, name, field, heading, prompt table, required |

## Codes

| Column | Values | Evidence |
|---|---|---|
| `CONDTYPE` | 1 none, 2 equal to, 3 not equal to, 4 greater than, 5 not greater than, 6 less than, 7 not less than, 8 in list, 9 not in list, 10 between, 11 not between, 12 exists, 13 does not exist, 14 like, 15 not like, 16 is null, 17 is not null, 20 Eff Date <=, 21 Eff Date >= | PSXLATITEM `CONDTYPE_CHAR`, `CPQCONDTYPE`, `EQRY_OPERATOR` agree; the operands match (8: a list `('A','P','W')` or subquery; 10: two operands; 12 / 13: a subquery, no left field). 23 and 25 (3 rows each) are not named |
| `COMBTYPE` | 3 the first criterion, 1 AND, 2 OR | 2,606 of 2,606 type-3 rows are first; 4 and 6 (14 rows, mostly aggregate selects) are not named |
| `EXPRTYPE` | 1 constant, 2 field, 3 expression, 4 subquery, 5 list, 6 current date, 8 prompt; 9 / 11 / 13 / 17 two operands (between) | the operands each holds; PSXLATITEM `QRYCRIT2TYPE` names the kinds |
| `SELECTTYPE` | 1 Top Level, 2 Subquery, 3 Union | PSXLATITEM `QRYLEVELTYPE`; 2,397 top levels for 2,397 queries, 328 subqueries for 328 subquery operands |
| `JOINTYPE` | 1 the first record or a standard join, 5 Left Outer Join | all 608 type-5 records carry outer-join criteria (`QRYOJSELNUM`), no other type does; 2, 3, 8 are not named |
| `QRYTYPE` | 1 User, 3 Process, 4 Role, 5 Database Agent, 7 Archive | the queries' names (`_ROLE_...`, `_DBAG_...`, `..._ARCHVE`); 2 (the `_SEARCH_` queries) not named |
| `ORDERBYDIR` | A, D | PSXLATITEM |

An expression may name a query field as `:%select.field` -- `:%1.22` is
select 1's field 22: all 405 output-column expressions of the form name an
existing field, and COMP_SRCH_TRW_CHILD1's column headed "E.HR_SSTEXT_TEXT"
is `:%1.22`, field 22 being E.HR_SSTEXT_TEXT. The view resolves them.

Rendered for all 2,397 public queries on HRDMO without an error or an
unresolved field or expression; the codes left unnamed appear in 104
queries (join types 2, 3, 8), 12 (connector 6) and 6 (conditions 23, 25).

## Projects

OBJECTTYPE 10, OBJECTIDs 30 query name / 25 owner (blank: public).

## In PeopleSoft Studio

A query shows its owner, type and prompts, then each select -- the query,
its subqueries and unions -- with its records and joins, output columns
(heading, order, aggregate) and criteria in Query Manager's words, then its
expressions. Not as SQL: Query adds effective-date subselects, security
joins and date formatting when it runs. Public queries are in the Definition
Browser and Open Definition; private ones open from projects.
