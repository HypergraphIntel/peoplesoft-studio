# Menu and action placement

User direction, October 15, 2026: all developer actions need a mouse-accessible
home; placement must make sense and menus must stay uncluttered. UX takes priority.

## Placement

| Surface | Primary controls | Secondary actions |
| --- | --- | --- |
| Projects | Open definition/project, Find in Project | Header overflow: recent project, project export, refresh. Project right-click: find, build, compare, Migration submenu, close. |
| Definition Browser | Open, New | Header overflow: refresh. Object right-click: open, supported PeopleCode navigation, compare, object history, insert into project, supported description/properties, record deletion. |
| Change Review | Open Review | Sidebar groups: pending changes and completed history. Header overflow: pending, history, compare revisions. |
| Configuration Tools | Existing named tools | Categories start collapsed. PS Query right-click offers New PS Query. |
| Data Migration Tools | Existing named tools | Import Migration Package is a direct entry. Review/export belong to the selected project's Migration menu. |
| Connections | Add | Row connect/disconnect/settings/remove; header overflow selects the target or opens settings/DB2 setup. |
| Customization Strategy | Open Plan | Pin/follow, refresh, settings, baseline and audit actions in overflow; definition-specific configuration rows keep their arguments. |
| Discoveries | Refresh | Find discovery, record active JSON, Knowledge and Discovery Server submenus. |
| Settings | Open Settings | AI client setup is a direct row; MCP row and native submenu expose server controls. |
| Editors | Relevant Run/Preview/Validate/Refresh | PeopleCode object/event navigation is grouped; references and supported properties/history are secondary. Tab context actions resolve the clicked tab's URI. |

Each view header has at most two primary actions. Menus reuse registered
commands and existing save, policy, writable, operator, concurrency and approval
checks. Presentation context keys cannot authorize a write.

Object context values use provider text-read support for Compare and the actual
adapter-key mapping for Object History. Record Field PeopleCode, description,
properties and deletion retain their existing type restrictions. Clicking Open
on a project member retains the missing-project-definition checks.

Object History looks up the exact connection, adapter and canonical key in
retained local Change Sets. It opens the selected object's existing timeline;
it does not invent revisions or perform a live write. Unsupported types have no
Object History menu. With no retained observation, the command explains that.

## Review workspace

The sidebar is navigation only: it never approves, applies, reverts or redoes.
Pending work includes drafts, conflicts, failures and partial/uncertain outcomes.
History lists completed Change Sets (applied/reverted/rejected/cancelled), plus
original partial applications whose exact remaining work has a verified applied
direct continuation. The partial outcome is retained with a completed-follow-up
link; missing approvals, unknown results, changed keys/target/baselines, or
incomplete follow-ups keep it pending. This is historical classification, not a
live-state check or permission to write. History shows
the newest 20 entries in the sidebar and an explicit link to full history. Verified
objects from partial applications remain available in their object timelines.

The workspace has All/Pending/History list controls. Selection does not change
approvals. Primary actions follow the current state: validation, approval,
application or reconciliation. Secondary actions are under **More actions**:
reject, controlled pause, supported checkpoint revert/redo, report and cancel.
For a multi-object proposal, controlled pause remains visible before approval,
disabled with an explanation until at least two objects are approved.
Destructive approval is shown only when the proposal includes deletions.
Execution details remain available in a collapsed section.

Revision-bound approval/application stay inside the trusted workspace. Older
`psft.changeReview.apply`, `.revert` and `.redo` commands are navigation aliases;
they do not perform those operations directly.

## Coverage and verification

Run `node scripts/navigation-audit.mjs` (`--json` for individual command homes).
The audit covers every contributed command through native menus, tree rows,
existing New/Recent pickers or trusted review controls. It follows submenu
attachments from actual menu roots, so an unattached submenu does not count.
Internal argument-only commands use their existing tree/row bindings. It is
also part of the extension activation smoke check.

The smoke check validates menu references, the header action limit, activation
and clicked-definition routing. Fixture HTTP/UI checks exercise pending/history
navigation and state-dependent controls while proving navigation performs no
approval or native write. These checks do not certify actual Electron menu
layout or replace a developer check in the installed VS Code window.

Implementation uses VS Code's supported
[menu contributions](https://code.visualstudio.com/api/references/contribution-points#contributes.menus)
and [tree view actions](https://code.visualstudio.com/api/extension-guides/tree-view#view-actions).
