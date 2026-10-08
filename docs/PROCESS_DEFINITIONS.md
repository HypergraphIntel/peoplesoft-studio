# Process definitions

Process Scheduler process definitions (2,873 on HRDMO, PeopleTools
8.62.09), and what PeopleSoft Studio shows from them
(`src/model/processDefinition.ts`). Read-only.

| Table | Rows | Holds |
|---|---|---|
| `PS_PRCSDEFN` | 2,873 | the definition, by `PRCSTYPE` + `PRCSNAME`: priority, run location, parameter list / command line / working directory and how each combines with the process type's, output destination, server, recurrence, restart, retries, retention, timeout, description |
| `PS_PRCSDEFNPNL` | 2,623 | the components it runs from |
| `PS_PRCSDEFNGRP` | 4,668 | its process groups |
| `PS_PRCSDEFNMESSAGE`, `PS_PRCSDEFNXFER`, `PS_PRCSDEFNNOTIFY` | 563, 34, 1 | messages, page transfer, notification: not shown yet |

Unlike the PeopleTools definitions, every coded column of `PS_PRCSDEFN` has
PSXLATITEM labels, and the view reads them from the database with the row:
`PRCSPRIORITY` (1 Low, 5 Medium, 9 High), `RUNLOCATION` (0 Both, 1 Client,
2 Server), `PARMLISTTYPE` / `CMDLINETYPE` / `WORKINGDIRTYPE` (0 None, 1
Override, 2 Prepend, 3 Append), `OUTDESTTYPE`, `OUTDESTFORMAT`,
`OUTDESTSRC`, `APIAWARE`, `LOGRQST`. `RESTARTENABLED` is '1' / '0' / blank.

Projects: OBJECTTYPE 20, OBJECTIDs 29 process type / 28 name.

Every process definition on HRDMO renders without an error. They are in the
Definition Browser and Open Definition (searched by name, listed as
"NAME (Type)").
