/*
 * URL definitions and Integration Broker nodes (HRDMO, PeopleTools 8.62;
 * docs/URLS_NODES.md), as read-only text views. A node's passwords are never
 * shown: not its password columns, and no connector property value whose
 * name says it is a secret.
 */

export type Row = Record<string, unknown>;

const str = (v: unknown) => String(v ?? '').trim();
const stamp = (r: Row) => str(r.LASTUPD) || str(r.LASTUPDDTTM);

export function renderUrl(name: string, u: Row): string {
  const out = [`URL Definition ${name}${str(u.DESCR) ? ` -- ${str(u.DESCR)}` : ''}`, `  URL: ${str(u.URL) || '(none)'}`,
    `  Owner ID: ${str(u.OBJECTOWNERID) || '(none)'}   Version: ${str(u.VERSION)}   Last updated: ${stamp(u)} by ${str(u.LASTUPDOPRID)}`];
  const comments = String(u.COMMENTS ?? '').trim();
  if (comments) out.push('', '  Comments', ...comments.replace(/\r\n/g, '\n').split('\n').map((l) => `    ${l}`));
  return out.join('\n') + '\n';
}

/** A property whose value is not shown: its name or id says it holds a secret. */
export function isSecretProperty(name: string): boolean {
  return /PASSWORD|PASSWD|PWD|SECRET|TOKEN|KEY(STORE)?PASS|CREDENTIAL|PRIVATE/i.test(name);
}

export interface NodeView {
  node: Row;
  /** PSNODECONPROP: the connector's properties. */
  connectorProperties: Row[];
  translates: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

export const NODE_TRANSLATE_FIELDS = ['NODE_TYPE', 'ROUTINGTYPE', 'AUTHOPTN', 'ACTIVE_NODE'];

export function renderNode(name: string, view: NodeView): string {
  const n = view.node;
  const x = (field: string) => view.translates.get(field)?.get(str(n[field])) ?? str(n[field]);
  const out = [`Node ${name}${str(n.DESCR) ? ` -- ${str(n.DESCR)}` : ''}`];
  out.push(`  Type: ${x('NODE_TYPE')}   Active: ${x('ACTIVE_NODE')}${Number(n.LOCALNODE) ? '   Local node' : ''}${str(n.LOCALDEFAULTFLG) === 'Y' ? '   Default local node' : ''}` +
    `${str(n.ROUTINGTYPE) ? `   Routing: ${x('ROUTINGTYPE')}` : ''}${str(n.AUTHOPTN) ? `   Authentication: ${x('AUTHOPTN')}` : ''}`);
  const more = [
    str(n.USERID) && `Default user: ${str(n.USERID)}`, str(n.PORTAL_NAME) && `Portal: ${str(n.PORTAL_NAME)}`,
    str(n.TOOLSREL) && `PeopleTools: ${str(n.TOOLSREL)}`, str(n.IB_TGTLOCATION) && `Target location: ${str(n.IB_TGTLOCATION)}`
  ].filter(Boolean);
  if (more.length) out.push(`  ${more.join('   ')}`);
  if (str(n.CONNGATEWAYID) || str(n.CONNID)) out.push(`  Connector: ${str(n.CONNGATEWAYID)} / ${str(n.CONNID)}`);
  const contact = [str(n.CONTACTMNGR), str(n.CONTACTEMAIL), str(n.CONTACTPHONENBR), str(n.CONTACTURL)].filter(Boolean);
  if (contact.length) out.push(`  Contact: ${contact.join(', ')}`);
  out.push(`  Version: ${str(n.VERSION)}   Last updated: ${stamp(n)} by ${str(n.LASTUPDOPRID)}`);
  if (view.connectorProperties.length) {
    out.push('', '  Connector properties');
    for (const p of [...view.connectorProperties].sort((a, b) => Number(a.SEQNUM) - Number(b.SEQNUM))) {
      const secret = isSecretProperty(str(p.PROPNAME)) || isSecretProperty(str(p.PROPID));
      out.push(`    ${str(p.PROPID).padEnd(14)} ${str(p.PROPNAME).padEnd(28)} ${secret ? '(not shown)' : str(p.PROPVALUE)}`.trimEnd());
    }
  }
  return out.join('\n') + '\n';
}
