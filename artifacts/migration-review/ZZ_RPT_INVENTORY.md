# Migration review: ZZ\_RPT\_INVENTORY

Source: HRDMO (connector readback). Target: not selected.

This is a review of modeled definitions and explicit dependencies. It is not a migration package or a complete dependency closure.

## Project members

| Definition | Type | Target comparison | Detail |
| --- | --- | --- | --- |
| ZZ\_RPT\_AET | Records | not compared |  |
| ZZ\_RPT\_LINE | Records | not compared |  |
| ZZ\_RPT\_SUM | Records | not compared |  |
| ZZ\_RPT\_COUNT | Fields | not compared |  |
| ZZ\_RPT\_FILE | Fields | not compared |  |
| ZZ\_RPT\_LABEL | Fields | not compared |  |
| ZZ\_RPT\_TOTAL | Fields | not compared |  |
| ZZ\_RPT\_INV | App Engine Programs | not compared |  |
| ZZ\_RPT\_INV.MAIN | App Engine Sections | not compared |  |
| ZZ\_RPT\_INV.MAIN    GBLdefault  1900-01-01.DETAIL.OnExecute | App Engine PeopleCode | not compared |  |
| ZZ\_RPT\_INV.MAIN    GBLdefault  1900-01-01.FINISH.OnExecute | App Engine PeopleCode | not compared |  |
| ZZ\_RPT\_INV.MAIN    GBLdefault  1900-01-01.INIT.OnExecute | App Engine PeopleCode | not compared |  |

## Explicit dependencies

Dependencies outside the project may already be delivered in the target. Review before including them.

| Definition | Type | Project membership | Required by |
| --- | --- | --- | --- |
| PROCESS\_INSTANCE | Fields | outside project | ZZ\_RPT\_AET, ZZ\_RPT\_SUM |
| RECTYPE | Fields | outside project | ZZ\_RPT\_AET, ZZ\_RPT\_LINE |
| ZZ\_RPT\_AET | Records | included | ZZ\_RPT\_INV |
| ZZ\_RPT\_COUNT | Fields | included | ZZ\_RPT\_AET, ZZ\_RPT\_LINE |
| ZZ\_RPT\_FILE | Fields | included | ZZ\_RPT\_AET, ZZ\_RPT\_SUM |
| ZZ\_RPT\_INV.MAIN | App Engine Sections | included | ZZ\_RPT\_INV |
| ZZ\_RPT\_INV.MAIN.GBL.default.1900-01-01.DETAIL.OnExecute | App Engine PeopleCode | included | ZZ\_RPT\_INV |
| ZZ\_RPT\_INV.MAIN.GBL.default.1900-01-01.FINISH.OnExecute | App Engine PeopleCode | included | ZZ\_RPT\_INV |
| ZZ\_RPT\_INV.MAIN.GBL.default.1900-01-01.INIT.OnExecute | App Engine PeopleCode | included | ZZ\_RPT\_INV |
| ZZ\_RPT\_LABEL | Fields | included | ZZ\_RPT\_LINE |
| ZZ\_RPT\_TOTAL | Fields | included | ZZ\_RPT\_AET, ZZ\_RPT\_SUM |

## Unresolved review

- ZZ\_RPT\_AET: record indexes, associated PeopleCode and SQL dependency coverage is incomplete.
- ZZ\_RPT\_INV.MAIN    GBLdefault  1900-01-01.DETAIL.OnExecute: dependency analysis is not available for App Engine PeopleCode.
- ZZ\_RPT\_INV.MAIN    GBLdefault  1900-01-01.FINISH.OnExecute: dependency analysis is not available for App Engine PeopleCode.
- ZZ\_RPT\_INV.MAIN    GBLdefault  1900-01-01.INIT.OnExecute: dependency analysis is not available for App Engine PeopleCode.
- ZZ\_RPT\_INV: SQL, PeopleCode, message and Transform dependency coverage is incomplete.
- ZZ\_RPT\_LINE: record indexes, associated PeopleCode and SQL dependency coverage is incomplete.
- ZZ\_RPT\_SUM: record indexes, associated PeopleCode and SQL dependency coverage is incomplete.

## Export and import in Studio

Use PeopleSoft: Export Migration Package to save a versioned Studio package. Unsupported definitions block export; they are never silently omitted.
On the target, use PeopleSoft: Import Migration Package to preview creates, updates, unchanged definitions and blockers before applying.
Build required SQL records with Studio and validate runtime behavior. Metadata migration does not move application data.
