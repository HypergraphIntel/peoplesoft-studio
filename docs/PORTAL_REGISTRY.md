# Portal registry

Portal registry folders and content references (20,143 on HRDMO,
PeopleTools 8.62.09) and what PeopleSoft Studio shows from them
(`src/model/portalRegistry.ts`). The Structure & Content tool also creates and edits registry entries.

| Table | Holds |
|---|---|
| `PSPRSMDEFN` | the entry, by `PORTAL_NAME` + `PORTAL_REFTYPE` (C content reference 17,242, F folder 2,901) + `PORTAL_OBJNAME`: label, parent folder, sequence, usage, URL type, template, the component (`PORTAL_URI_SEG1`-`3`: menu, component, market), `PORTAL_URLTEXT` (a CLOB), link target (`PORTAL_LINKOBJNAME`, `PORTAL_LINK_PORTAL`) |
| `PSPRSMPERM` | security: `PORTAL_PERMTYPE` P permission list (43,116 of 43,746 name one), R role (659 of 659) |
| `PSPRSMATTRVAL` | attributes |

`PORTAL_REFTYPE`, `PORTAL_CREF_USGT`, `PORTAL_CREF_URLT`,
`PORTAL_CREF_STGT` and `PORTAL_CREF_TMPT` have PSXLATITEM labels, read with
the row. Navigation-collection entries are links with no label of their
own; they are named by their target's label.

An entry shows its label, navigation path (its folders to the root), usage,
URL type, component and URL, description, security and attributes; a
folder lists its contents. Projects: OBJECTTYPE 55, OBJECTIDs 99 portal /
100 type / 101 name. Entries are in the Definition Browser and Open
Definition (searched by name).

Configuration Tools → Portal Registry → Structure & Content opens a portal
picker populated from `PSPRDMDEFN` (EMPLOYEE, CUSTOMER, VENDOR, SUPPLIER,
and any other portals installed in the selected database). Each selected
portal opens its own editor with expandable folders and content
references. Entries retain their database sibling sequence; selecting an
entry displays the existing registry detail view, including security and
attributes. Refresh reloads the selected portal without imposing the
Definition Browser's search limit.


## Creating and editing

Select a folder, then New Folder or New Content Reference. The selected folder
is the draft parent; the parent can be changed before saving. New references
support a PeopleSoft component (node, menu, component, market, optional page
and URL parameters) or an external HTTP(S) URL. Save writes the label,
description, sequence, parent, owner, optional public access, and permission
list/role grants. Folder grants may cascade to children. Component/iScript
references accept permission lists rather than roles, following
[Oracle's registry security rules](https://docs.oracle.com/cd/E92519_02/pt856pbr3/eng/pt/tpcr/concept_UnderstandingthePortalRegistry-071095.html).

Writable access and a PeopleSoft Operator ID are required. The editor confirms
discarding unsaved edits when navigating. Existing definitions pass the
ownership guard. A stale opened token refuses a save. Folder cycles, missing
parents, invalid security principals, invalid menu/component registrations,
and edits to PORTAL_ROOT_OBJECT are refused.

Existing targets remain intact unless explicitly replaced. Existing attributes,
translations, template settings and Fluid settings are preserved. This tool
creates ordinary target references; creation of links, templates, homepages,
iScripts, attribute editing, renaming and deletion are not offered yet.

## MCP

- `psft_portal_list`: installed portals; start here.
- `psft_portal_structure`: every node in one portal, with parent and sibling sequence.
- `psft_portal_get`: portal, refType (F/C), name; returns editable input and token,
  stored properties, security and attributes.
- `psft_portal_create_folder`: input includes portal, name, parent and label.
- `psft_portal_create_content_reference`: the same plus a component/external target.
- `psft_portal_edit`: edit the input returned by get, and pass expectedToken.

All writes support dryRun (the transaction is rolled back), use the standard
MCP write/approval gates, and refuse to write while that portal editor has
unsaved changes. Create tools use an absent token internally and cannot
overwrite an existing entry. Omit target, permissions or publicAccess on an
edit to preserve those properties. Permissions supplied to Save are the entry's
own grants, including each folder grant's cascade flag; inherited permissions
are evaluated from ancestors rather than copied into the entry.

## Evidence and verification

The native PIA capture `em02-cref-register` establishes PRSM/SYS increments,
PSLOCK.PRSM, a new content reference and PSPRSMNUI defaults. Its other restamped
row was identified in the live database as the immediate parent folder (same
PRSM version and timestamp; existing operator preserved). The checksum formula
matches all 17,243 native non-null content-reference URLs: see
`tools/lab/results/portal-native-evidence.json` and `portal-evidence.mts`.
Schema lengths and cascading permissions were also inspected in HRDMO 8.62.09.
The native checksum finding is recorded as `f-ceb6c26a7a6154e53cffd32d` in the
local Discovery & Intelligence store.

`tools/lab/portal-e2e.mts` exercises the shared writer on HRDMO, retains fresh
restricted custom entries and records results in `results/portal-e2e.json`.
`portal-mcp-e2e.mts` checks the production HTTP MCP server for discovery,
portal-scoped tree data, create/edit, rollback, off/dirty/approval/stale gates,
and list/get/save of each administration catalog. Native PIA navigation after
a Studio save has not yet been verified. Save readback verifies database rows
and supporting display settings; it is not a native PIA save replay.

The headless browser fixture `tools/lab/portal-ui-check.mts` exercises the real
webview script: nested folders, new-entry editing, target and security
submission, disabled fields during save, error recovery and root protection.
