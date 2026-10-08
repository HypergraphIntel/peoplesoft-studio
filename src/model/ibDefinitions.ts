/*
 * Integration Broker definitions -- messages, services, service operations
 * (HRDMO, PeopleTools 8.62; docs/INTEGRATION_BROKER.md) -- as read-only text
 * views. Coded columns are shown in PSXLATITEM's words where it has them
 * (read from the database with the rows), else as stored.
 */

export type Row = Record<string, unknown>;
export type Translates = ReadonlyMap<string, ReadonlyMap<string, string>>;

const str = (v: unknown) => String(v ?? '').trim();
const stamp = (r: Row) => str(r.LASTUPD) || str(r.LASTUPDDTTM);

/** The coded columns these views show, each a PSXLATITEM field where it has one. */
/**
 * PSMSGVER.IB_MSGTYPE (no PSXLATITEM labels): 1 Rowset (all 910 have record
 * structures), 2 Nonrowset (none of 3,515 does), 6 Document (all 157 name a
 * package); 3-5 are shown as stored.
 */
export const MESSAGE_TYPES: Readonly<Record<string, string>> = { 1: 'Rowset', 2: 'Nonrowset', 6: 'Document' };

export const IB_TRANSLATE_FIELDS = [
  'RTNGTYPE', 'HANDLERTYPE', 'ACTIVE_FLAG', 'EFF_STATUS', 'IB_RESTMETHOD', 'IB_DELIVERYMODE', 'NR_FLAG'
];

const label = (t: Translates, field: string, row: Row | undefined) => {
  const value = str(row?.[field]);
  return t.get(field)?.get(value) ?? value;
};

const header = (kind: string, name: string, r: Row) => [
  `${kind} ${name}${str(r.DESCR) ? ` -- ${str(r.DESCR)}` : ''}`
];
const footer = (r: Row) => `  Owner ID: ${str(r.OBJECTOWNERID) || '(none)'}   Last updated: ${stamp(r)} by ${str(r.LASTUPDOPRID)}`;

export interface MessageView {
  message: Row;
  versions: Row[];
  records: Row[];
  operations: Row[];
  translates: Translates;
}

/** A message: its versions and, for rowset messages, their record structure; the operations that use it. */
export function renderMessage(name: string, view: MessageView): string {
  const m = view.message;
  const out = header('Message', name, m);
  // MSGSTATUS has no PSXLATITEM labels and is 0 on HRDMO's messages: not shown.
  if (str(m.DEFAULTVER)) out.push(`  Default version: ${str(m.DEFAULTVER)}`);
  out.push(footer(m));
  for (const v of [...view.versions].sort((a, b) => str(a.APMSGVER).localeCompare(str(b.APMSGVER)))) {
    const ver = str(v.APMSGVER);
    out.push('', `  Version ${ver}${ver === str(m.DEFAULTVER) ? ' (default)' : ''}   Type: ${MESSAGE_TYPES[str(v.IB_MSGTYPE)] ?? `type ${str(v.IB_MSGTYPE)}`}` +
      `${str(v.IB_ROOTELEMENT) ? `   Root element: ${str(v.IB_ROOTELEMENT)}` : ''}${str(v.IB_PACKAGEID) ? `   Class: ${str(v.IB_PACKAGEID)}` : ''}`);
    const recs = view.records.filter((r) => str(r.APMSGVER) === ver).sort((a, b) => Number(a.SEQNO) - Number(b.SEQNO));
    // A root record's parent is "--" (or a record not in the version).
    const names = new Set(recs.map((r) => str(r.RECNAME)));
    const tree = (parent: string | undefined, depth: number) => {
      for (const r of recs.filter((x) => (parent === undefined ? !names.has(str(x.PRNTRECNAME)) : str(x.PRNTRECNAME) === parent))) {
        out.push(`${'  '.repeat(depth + 2)}${str(r.RECNAME)}${str(r.XMLALIAS) && str(r.XMLALIAS) !== str(r.RECNAME) ? `  <${str(r.XMLALIAS)}>` : ''}`);
        if (depth < 20) tree(str(r.RECNAME), depth + 1);
      }
    };
    tree(undefined, 0);
  }
  if (view.operations.length) {
    out.push('', `  Used by: ${view.operations.map((o) => `${str(o.IB_OPERATIONNAME)}.${str(o.VERSIONNAME)}`).join(', ')}`);
  }
  return out.join('\n') + '\n';
}

export interface ServiceView {
  service: Row;
  operations: Row[];
  translates: Translates;
}

/** A service: namespace, REST or not, and its operations with their routing types. */
export function renderService(name: string, view: ServiceView): string {
  const s = view.service;
  const out = header('Service', name, s);
  out.push(`  Namespace: ${str(s.IB_NAMESPACE) || '(none)'}${str(s.IB_ALIASNAME) ? `   Alias: ${str(s.IB_ALIASNAME)}` : ''}` +
    `${str(s.IB_REST_SERVICE) === 'Y' ? '   REST' : ''}`, footer(s));
  out.push('', `  Operations (${view.operations.length})`);
  for (const o of [...view.operations].sort((a, b) => str(a.IB_OPERATIONNAME).localeCompare(str(b.IB_OPERATIONNAME)))) {
    out.push(`    ${str(o.IB_OPERATIONNAME).padEnd(32)} ${label(view.translates, 'RTNGTYPE', o).padEnd(26)} ${str(o.DESCR)}`.trimEnd());
  }
  return out.join('\n') + '\n';
}

export interface OperationView {
  operation: Row;
  versions: Row[];
  parameters: Row[];
  handlers: Row[];
  routings: Row[];
  translates: Translates;
}

/** A service operation: its service and type, versions with their messages, handlers and routings. */
export function renderOperation(name: string, view: OperationView): string {
  const o = view.operation;
  const t = view.translates;
  const out = header('Service Operation', name, o);
  out.push(`  Service: ${str(o.IB_SERVICENAME) || '(none)'}   Type: ${label(t, 'RTNGTYPE', o)}   Default version: ${str(o.DEFAULTVER)}` +
    `${str(o.IB_RESTMETHOD) ? `   REST method: ${label(t, 'IB_RESTMETHOD', o)}` : ''}`, footer(o));
  for (const v of [...view.versions].sort((a, b) => str(a.VERSIONNAME).localeCompare(str(b.VERSIONNAME)))) {
    const ver = str(v.VERSIONNAME);
    out.push('', `  Version ${ver}${ver === str(o.DEFAULTVER) ? ' (default)' : ''}   ${label(t, 'ACTIVE_FLAG', v)}${str(v.DESCR) ? ` -- ${str(v.DESCR)}` : ''}`);
    for (const p of view.parameters.filter((x) => str(x.VERSIONNAME) === ver)) {
      out.push(`    ${str(p.PARAMETERNAME).padEnd(10)} ${str(p.MSGNAME)}.${str(p.IB_MSGVERSION)}${str(p.QUEUENAME) ? `   queue ${str(p.QUEUENAME)}` : ''}` +
        `${str(p.XFRMNAME) ? `   transform ${str(p.XFRMNAME)}` : ''}`);
    }
  }
  if (view.handlers.length) {
    out.push('', '  Handlers');
    for (const h of [...view.handlers].sort((a, b) => Number(a.SEQNO) - Number(b.SEQNO))) {
      out.push(`    ${str(h.HANDLERNAME).padEnd(20)} ${label(t, 'HANDLERTYPE', h).padEnd(18)} ${label(t, 'ACTIVE_FLAG', h).padEnd(9)} ${str(h.HANDLERID)}`.trimEnd());
    }
  }
  if (view.routings.length) {
    out.push('', `  Routings (${view.routings.length})`);
    for (const r of [...view.routings].sort((a, b) => str(a.ROUTINGDEFNNAME).localeCompare(str(b.ROUTINGDEFNNAME)))) {
      out.push(`    ${str(r.ROUTINGDEFNNAME).padEnd(32)} ${str(r.SENDERNODENAME)} -> ${str(r.RECEIVERNODENAME)}   ${label(t, 'EFF_STATUS', r)}`);
    }
  }
  return out.join('\n') + '\n';
}
