# Permission lists, roles and the Message Catalog

How PeopleTools stores permission lists (1,370 on HRDMO), roles (853) and
Message Catalog entries (109,515 in 698 sets), mapped by querying HRDMO
(PeopleTools 8.62.09), and what PeopleSoft Studio shows from them
(`src/model/adminDefinitions.ts`). Read-only.

## Permission lists

| Table | Rows | Holds |
|---|---|---|
| `PSCLASSDEFN` | 1,370 | `CLASSID`, description, `TIMEOUTMINUTES` (0: never), `DEFAULTBPM` |
| `PSAUTHITEM` | 31,938 | grants: `MENUNAME`, `BARNAME`, `BARITEMNAME` (the component's menu item), `PNLITEMNAME` (the page; blank on the item's own row), `AUTHORIZEDACTIONS`, `DISPLAYONLY` |
| `PSAUTHSIGNON` | 7,466 | sign-on times: `DAYOFWEEK` 0-6, `STARTTIME` / `ENDTIME` in minutes after midnight (7,470 rows are 0-1439) |
| `PSAUTHBUSCOMP` | 8,933 | Component Interface methods (`BCNAME`, `BCMETHOD`); `AUTHORIZEDACTIONS` always 4 |
| `PSAUTHWS` | 1,959 | web service operations; `AUTHORIZEDACTIONS` always 4 |
| `PSAUTHPRCS` | 265 | process groups |
| `PS_SCRTY_ACC_GRP` | 305 | query access groups (tree, access group) |
| `PSPRCSPRFL`, `PSAUTHOPTN`, `PSAUTHCB`, `PSAUTHAS`, `PSAUTHMP`, ... | | not shown yet |

A page's `AUTHORIZEDACTIONS` are the component action bits (1 Add, 2
Update/Display, 4 Update/Display All, 8 Correction): on 29,606 of HRDMO's
30,358 page grants they lie within the component's own `ACTIONS`. 48 grants
also carry 0x80, shown as stored.

`PSAUTHITEM` menus that are not in `PSMENUDEFN` are Web Libraries
(`WEBLIB_*`: record, field, iScript) and PeopleTools areas
(`APPLICATION_DESIGNER`, `DATA_MOVER`, `QUERY`, `OBJECT_SECURITY` ...); they
are listed apart, their access as stored.

Which weekday `DAYOFWEEK` 0 is has not been checked against the Sign-on
Times page; the view shows the number.

## Roles

| Table | Rows | Holds |
|---|---|---|
| `PSROLEDEFN` | 853 | `ROLETYPE` (PSXLATITEM: U User List 838, Q Query 16), `ROLESTATUS`, description, role query / PeopleCode rule |
| `PSROLECLASS` | 1,734 | the role's permission lists |
| `PSROLEUSER` | 6,087 | its users |
| `PSROLECANGRANT` | 85 | roles it may grant |

## Message Catalog

| Table | Rows | Holds |
|---|---|---|
| `PSMSGSETDEFN` | 698 | the sets |
| `PSMSGCATDEFN` | 109,515 | `MESSAGE_SET_NBR`, `MESSAGE_NBR`, `MESSAGE_TEXT`, `MSG_SEVERITY` (PSXLATITEM: M Message, W Warning, E Error, C Cancel), `DESCRLONG` (explanation) |

## Projects

| OBJECTTYPE | Item | OBJECTIDs |
|---|---|---|
| 19 | role | 32 |
| 25 | Message Catalog entry | 48 set, 49 number (and 50, the set's description) |
| 53 | permission list | 89 |

## In PeopleSoft Studio

A permission list shows its roles, sign-on times, pages by menu and
component with their actions, Web Libraries, PeopleTools areas, Component
Interface methods, web services, process groups and query access groups. A
role shows its type, status, users, permission lists and grantable roles. A
Message Catalog entry shows its set, severity, text and explanation. Roles
and permission lists are in the Definition Browser and Open Definition.
