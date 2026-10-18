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
description, sequence, parent, owner, access, and permission list/role grants. Folder grants may cascade to children. Component/iScript
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
overwrite an existing entry. Omit target, permissions or access on an
edit to preserve those properties. Permissions supplied to Save are the entry's
own grants, including each folder grant's cascade flag; inherited permissions
are evaluated from ancestors rather than copied into the entry.

## Access and security (PIA's rules)

Measured on PeopleTools 8.61.15 and 8.62.09, in Folder and Content Ref
Administration and their delivered PeopleCode:

- `PSPRSMDEFN.PORTAL_ISPUBLIC` holds three settings, not a yes/no flag:
  **0 public**, **1 Author Access**, **2 neither** (only the entry's own or
  inherited grants). The portal root and Portal Objects folders are 0. Studio's
  `access` input is `public`, `author` or `permissions`. A new folder or
  content reference defaults to `author` (Public N, Author Access Y), as PIA's
  work records do. Before this fix Studio wrote 1 for "public" and 0 for
  "restricted", so its restricted entries were public.
- An entry that is neither public nor Author Access needs a grant of its own or
  one cascaded from an ancestor folder; otherwise PIA refuses it ("No security
  authorizations exist and Author Access isn't selected", 95,49), and so does
  Studio.
- A content reference to a component, iScript or worklist on a local node
  inherits its permission lists from that object's security; PIA shows the
  grid read only (`IsPermEditable`). For a component, PIA grants every
  permission list authorized to the component's menu item (PSAUTHITEM; 15 of
  15 on 8.61.15). Studio derives the same list and refuses a different one.
- Saving a content reference grants its permission lists to its folders, as
  Content Ref Administration does. From the parent up, every folder that is not
  public gets the lists it lacks, not cascading, and is saved with its own PRSM
  version (PRSM and SYS +1 per folder). The walk passes folders that already
  hold them and stops at the first public folder. A folder the reference moves
  out of keeps its lists. On 8.61.15, PIA and Studio produced equal grants,
  versions and counters across two levels, a public parent, a fully-held parent
  and a move.
- A portal holds one content reference per URL: PIA refuses a second
  ("... already exists", 96,3), and so does Studio.
- A new folder gets three system attributes, `PORTAL_ABN_DISABLE_MOUSE_OVER`,
  `PORTAL_DEFAULT_CHART_NAV` and `PORTAL_IS_FOLDER_NAV`, each `N`
  (PSPRSMSYSATTR / PSPRSMSYSATTRVL). A plain content reference gets none.
- One save: PRSM and SYS +1, and the parent folder takes the entry's version
  (an attempt PIA refused still used up one PRSM version).

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
