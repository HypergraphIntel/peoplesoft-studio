/*
 * Portal registry structures -- folders and content references (PSPRSMDEFN
 * and its child tables; HRDMO, PeopleTools 8.62; docs/PORTAL_REGISTRY.md)
 * -- as a read-only text view.
 */

export type Row = Record<string, unknown>;

const str = (v: unknown) => String(v ?? '').trim();
const stamp = (r: Row) => str(r.LASTUPD) || str(r.LASTUPDDTTM);

/** The coded columns shown, each a PSXLATITEM field. */
export const PORTAL_TRANSLATE_FIELDS = ['PORTAL_REFTYPE', 'PORTAL_CREF_USGT', 'PORTAL_CREF_URLT', 'PORTAL_CREF_STGT', 'PORTAL_CREF_TMPT'];

/** PSPRSMPERM.PORTAL_PERMTYPE: 43,116 of 43,746 P entries name a permission list, all 659 R entries a role. */
export const PERMISSION_TYPES: Readonly<Record<string, string>> = { P: 'Permission List', R: 'Role' };

export interface PortalView {
  item: Row;
  /** The folders above the item, nearest first (their PORTAL_LABEL / PORTAL_OBJNAME). */
  path: Row[];
  /** A folder's children, by PORTAL_SEQ_NUM. */
  children: Row[];
  permissions: Row[];
  attributes: Row[];
  translates: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

export function renderPortalItem(view: PortalView): string {
  const p = view.item;
  const x = (field: string, row: Row = p) => view.translates.get(field)?.get(str(row[field])) ?? str(row[field]);
  const out: string[] = [];
  const folder = str(p.PORTAL_REFTYPE) === 'F';
  // A link (navigation collections) has no label of its own: its target's (LINK_LABEL, read with it) stands in.
  const labelOf = (r: Row) => str(r.PORTAL_LABEL) || str(r.LINK_LABEL) || str(r.PORTAL_OBJNAME);
  out.push(`${folder ? 'Folder' : 'Content Reference'} ${str(p.PORTAL_OBJNAME)} -- ${labelOf(p)}`);
  out.push(`  Portal: ${str(p.PORTAL_NAME)}   Parent: ${str(p.PORTAL_PRNTOBJNAME) || '(none)'}   Sequence: ${str(p.PORTAL_SEQ_NUM)}` +
    `${str(p.PORTAL_ISPUBLIC) === 'Y' ? '   Public' : ''}${str(p.FLUIDMODE) === '1' ? '   Fluid' : ''}`);
  if (view.path.length) out.push(`  Navigation: ${[...view.path].reverse().map(labelOf).join(' > ')} > ${labelOf(p)}`);
  if (str(p.PORTAL_LINKOBJNAME)) {
    out.push(`  Links to: ${str(p.PORTAL_LINKOBJNAME)}${str(p.PORTAL_LINK_PORTAL) ? ` in ${str(p.PORTAL_LINK_PORTAL)}` : ''}${str(p.LINK_LABEL) ? ` (${str(p.LINK_LABEL)})` : ''}`);
  }
  if (!folder) {
    out.push(`  Usage: ${x('PORTAL_CREF_USGT')}   URL type: ${x('PORTAL_CREF_URLT')}${str(p.PORTAL_CREF_TMPT) ? `   Template: ${x('PORTAL_CREF_TMPT')}` : ''}`);
    const component = [p.PORTAL_URI_SEG1, p.PORTAL_URI_SEG2, p.PORTAL_URI_SEG3].map(str).filter(Boolean);
    if (component.length) out.push(`  Menu / component / market: ${component.join(' / ')}`);
    if (str(p.PORTAL_URLTEXT)) out.push(`  URL: ${str(p.PORTAL_URLTEXT)}`);
  }
  if (str(p.DESCR254)) out.push(`  ${str(p.DESCR254)}`);
  out.push(`  Owner ID: ${str(p.OBJECTOWNERID) || '(none)'}   Product: ${str(p.PORTAL_PRODUCT) || '(none)'}   Last updated: ${stamp(p)} by ${str(p.LASTUPDOPRID)}`);
  if (view.children.length) {
    out.push('', `  Contents (${view.children.length})`);
    for (const c of view.children) {
      out.push(`    ${str(c.PORTAL_REFTYPE) === 'F' ? '[folder] ' : ''}${labelOf(c).padEnd(40)} ${str(c.PORTAL_OBJNAME)}`);
    }
  }
  if (view.permissions.length) {
    out.push('', `  Security (${view.permissions.length})`);
    for (const s of view.permissions) {
      out.push(`    ${(PERMISSION_TYPES[str(s.PORTAL_PERMTYPE)] ?? str(s.PORTAL_PERMTYPE)).padEnd(16)} ${str(s.PORTAL_PERMNAME)}`);
    }
  }
  if (view.attributes.length) {
    out.push('', '  Attributes');
    for (const a of view.attributes) out.push(`    ${str(a.PORTAL_ATTR_NAM).padEnd(30)} ${str(a.PORTAL_ATTR_VAL)}`);
  }
  return out.join('\n') + '\n';
}
