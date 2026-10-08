# URL definitions, XSLT, message nodes

Three small definition types on HRDMO (PeopleTools 8.62.09), read-only
(`src/model/miscDefinitions.ts`).

| Type | Project OBJECTTYPE | Table | Shown |
|---|---|---|---|
| URL definition (268) | 56, OBJECTID1 103 | `PSURLDEFN` | the URL, description, comments |
| XSLT (44) | 62, OBJECTIDs 65 / 81 | `PSSQLDEFN` / `PSSQLTEXTDEFN`, `SQLTYPE` 6 | the stylesheet text, through the SQL reader |
| Message node (62) | 35, OBJECTID1 62 | `PSMSGNODEDEFN`, `PSNODECONPROP` | type, active, local / default, routing, authentication, default user, connector and its properties, contact |

A node's passwords are never read or shown: the password columns of
`PSMSGNODEDEFN` (`IBPASSWORD`, `IBEXTERNALPWD`) are not selected, and a
connector property whose name or ID says it holds a secret (password,
token, key store password ...) is shown as "(not shown)". On HRDMO that
hides the `Password` and `MCF_Password` properties; the other property
names there (URLs, JMS settings, servers, ports, user IDs) are shown.

The coded node columns (`NODE_TYPE`, `ROUTINGTYPE`, `AUTHOPTN`,
`ACTIVE_NODE`) are shown in PSXLATITEM's words. All three types are in Open
Definition; every one on HRDMO renders without an error.
