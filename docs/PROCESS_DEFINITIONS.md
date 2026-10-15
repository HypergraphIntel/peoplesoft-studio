# Process definitions

Process Scheduler process definitions (2,873 on HRDMO, PeopleTools
8.62.09), and what PeopleSoft Studio shows from them
(`src/model/processDefinition.ts`). Database definitions open in the default
`*.psprcs` custom editor, with General, Overrides, Output, Options, Components,
Process groups, and Stored details tabs. The text summary remains available
through the text editor and MCP reads.

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

## Editing existing definitions

On an Oracle connection set to Writable with a PeopleSoft Operator ID, the
editor supports description and long description, priority, run location,
API/log flags, category, server, recurrence, parameter/command/directory
modes and values, output defaults, restart/retries, recovery, concurrency,
timeout, retention, and component/process-group associations. Other parent
columns are displayed under Stored details and preserved. Related-language,
notification, message, transfer, mutual-exclusion and URL-link editing are
not implemented; use PIA for those sections. This edits Process Scheduler
metadata, not the underlying SQR source file.

Ctrl+S and Save changes use the same VS Code save lifecycle. Changes support
undo/redo, unsaved-close handling and backups. Revert / refresh discards the
draft through VS Code and rereads the definition. Existing text tabs can use
Reopen Editor With > PeopleSoft Process Definition.

The writer locks the cache counters and parent, rejects a stale whole-row and
association token, validates field lengths, coded values, numeric ranges,
component existence, scheduler references and the observed SaveEdit checks,
updates only changed properties/associations, and verifies before commit.
The configured write prefix and delivered-object policy apply to saves.
Unknown translated codes remain visible, but new codes must be installed.

### Evidence and validation limits

The HCDEV snapshot definitions 14017, 24092-24105 and 24117 and live HRDMO
PRCSDEFN component/record SavePreChange and SavePostChange, plus
FUNCLIB_PSM.FUNCLIB.FieldFormula, establish the save hooks. Cache updates
use PPC = max(PSVERSION PPC, PSLOCK PPC) + 1; both PPC counters are written.
Component UpdateSysVersion and post-save UpdateSysObject account for two
SYS increments. LASTUPDDTTM and LASTUPDOPRID are stamped. Native field-change
code clears override values for None, server/recurrence when run location
changes, and retries when restart changes. Output None/Window clears the
source/destination; changing destination source away from Process Definition
removes the associated content-distribution rows.

HRDMO record metadata confirms the parent field sizes and three-column
component and process-group association tables. The component's prompt is a
dynamic view; saves check component existence in PSPNLGRPDEFN. Process-group
names are a prompt without edit, so new names are allowed.

Transaction tests cover counters, rollback, stale tokens, validation,
preservation and previews; the production webview runs in a Chromium fixture
covering coded labels, tab switching, drafts, override enablement, association
editing and read-only controls. Native PIA save/runtime cache equivalence has
not been captured end to end for this writer. No delivered process has been
changed during these checks.

## MCP workflows in 0.9.0

`psft_process_reference`, `psft_process_get` and `psft_process_save` expose the
editor's bounded workflow. Read the complete input and token, preview with
`dryRun`, then save with the original token. Existing ownership is established
from PRCSTYPE/PRCSNAME and the native save stamp; the agent delivered-object
policy applies. Live HRDMO checks verified delivered ownership, rollback preview
and stale-token refusal without committing a delivered Process Definition edit.
See [MCP reference](MCP_REFERENCE.md) for schemas and validation scope.
