# File Layouts and Component Interfaces

How PeopleTools stores File Layouts (533 on HRDMO) and Component Interfaces
(458), mapped by querying HRDMO (PeopleTools 8.62.09), and what PeopleSoft
Studio shows from them (`src/model/integrationDefinitions.ts`). Read-only.
PSXLATITEM has no labels for any of these codes; each name rests on the
evidence given.

## File Layouts

| Table | Rows | Holds |
|---|---|---|
| `PSFLDDEFN` | 533 | the layout: `FLDFORMAT`, delimiter, qualifier, default file name, segment ID position, description |
| `PSFLDSEGDEFN` | 1,930 | segments (`FLDSEGNAME`), a tree by `FLDSEGPARENT`, ordered by `FLDSEQNO`; `RECNAME_FILE`, `FLDSEGID`, `FLDTAG` |
| `PSFLDFIELDDEFN` | 23,490 | each segment's fields: `FLDSTART`, `FLDLENGTH`, `FLDFIELDTYPE`, `DECIMAL_POS`, `FLDTAG`, `FLDDATEFMT`, `FLDFIELDDFLT` |

| `FLDFORMAT` | | Evidence |
|---|---|---|
| 0 | FIXED | 224 layouts, 14 with a delimiter |
| 1 | CSV | 220; the 11 layouts named *CSV* |
| 2 | XML | 89; the 23 layouts named *XML* |

`FLDFIELDTYPE` uses `PSDBFIELD.FIELDTYPE`'s numbers -- 0 Character, 1 Long
Character, 2 Number, 3 Signed Number, 4 Date, 5 Time, 6 DateTime: joined to
the record field of the same name, 12,864 Character fields are 0, 1,391
Number 2, 913 Date 4; the rest are layouts overriding the type.
`FLDDATEFMT` is filled on every field (MMDDYYYY) and applies to dates.

File Layout PeopleCode: project type 59 is not on HRDMO.

## Component Interfaces

| Table | Rows | Holds |
|---|---|---|
| `PSBCDEFN` | 458 | the interface: component (`BCPGNAME` + `MARKET`), menu, search records, `BCSTDMETHODS` |
| `PSBCITEM` | 26,617 | keys, collections and properties: `BCTYPE`, `BCITEMNAME`, `BCITEMPARENT` (`PS_ROOT` at the top), `SEQUENCE_NBR_6`, record field, scroll |

| `BCTYPE` | | Evidence |
|---|---|---|
| 1 | Get Key | 791 items, in 444 of 457 interfaces |
| 2 | Create Key | 558; 301 of the 303 interfaces with the Create method bit have them, 5 without it |
| 5 | Find Key | 1,396; the largest of the three key sets (WSDL_NODE_CI: MSGNODENAME, NODE_TYPE against MSGNODENAME) |
| 3 | Collection | 1,546; a record (`BCSCROLLNAME` 00-00-01-02 ...) and no field |
| 4 | Property | 22,326; a record field |

`BCSTDMETHODS` bits: 2 Create (above). The others, in the same
alphabetical order -- 1 Cancel, 4 Find, 8 Get, 16 Save -- fit CI_JOB_DATA
(29: no Create), USER_PROFILE (27: no Find, and no Find keys) and
PROCESSREQUEST (15: no Save); not yet confirmed in App Designer.

`BCACCESS` is 1, except 2 on 2,445 properties; what 2 means is not
established (shown as stored).

Component Interface PeopleCode: `PSPCMPROG` 74 interface / 12 method
(project type 42).

## In PeopleSoft Studio

A File Layout opens as its format and options, then its segments as a tree,
each field with its type and position (FIXED) or length. A Component
Interface opens as its component, standard methods, keys, then its
collections and properties as a tree. Read-only.
