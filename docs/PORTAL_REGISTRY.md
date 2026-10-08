# Portal registry

Portal registry folders and content references (20,143 on HRDMO,
PeopleTools 8.62.09) and what PeopleSoft Studio shows from them
(`src/model/portalRegistry.ts`). Read-only.

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
