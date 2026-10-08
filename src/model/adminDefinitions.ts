/*
 * Permission lists, roles and Message Catalog entries, as the PeopleTools
 * tables hold them (HRDMO, PeopleTools 8.62; docs/SECURITY_MESSAGES.md), and
 * their read-only text views.
 */

import { COMPONENT_ACTIONS } from './uiDefinitions.js';

export type Row = Record<string, unknown>;

const str = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => Number(v ?? 0);
const stamp = (r: Row) => str(r.LASTUPD) || str(r.LASTUPDDTTM);

/**
 * A page's authorized actions: the component action bits (on 29,606 of
 * HRDMO's 30,358 page grants the bits lie within the component's own
 * ACTIONS); any other bit is shown as stored.
 */
export function describeActions(bits: number): string {
  const named = COMPONENT_ACTIONS.filter(([bit]) => (bits & bit) !== 0).map(([, label]) => label);
  const rest = bits & ~COMPONENT_ACTIONS.reduce((m, [bit]) => m | bit, 0);
  return [...named, ...(rest ? [`bits 0x${rest.toString(16)}`] : [])].join(', ') || '(none)';
}

/** PSAUTHSIGNON times: minutes after midnight (0-1439). */
const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export interface PermissionListView {
  list: Row;
  /** PSAUTHITEM rows; MENUNAME / BARNAME / BARITEMNAME / PNLITEMNAME / DISPLAYONLY / AUTHORIZEDACTIONS. */
  items: Row[];
  /** The menus of PSMENUDEFN among the items' menus: the others are Web Libraries and PeopleTools areas. */
  realMenus: ReadonlySet<string>;
  roles: Row[];
  signon: Row[];
  componentInterfaces: Row[];
  webServices: Row[];
  processGroups: Row[];
  queryAccess: Row[];
}

export function renderPermissionList(name: string, view: PermissionListView): string {
  const l = view.list;
  const out: string[] = [];
  out.push(`Permission List ${name}${str(l.CLASSDEFNDESC) ? ` -- ${str(l.CLASSDEFNDESC)}` : ''}`);
  out.push(`  Timeout: ${num(l.TIMEOUTMINUTES) ? `${num(l.TIMEOUTMINUTES)} minutes` : 'never'}   Navigator homepage: ${str(l.DEFAULTBPM) || '(none)'}` +
    `   Version: ${num(l.VERSION)}   Last updated: ${stamp(l)} by ${str(l.LASTUPDOPRID)}`);
  if (view.roles.length) out.push(`  In roles: ${view.roles.map((r) => str(r.ROLENAME)).join(', ')}`);
  if (view.signon.length) {
    const days = [...view.signon].sort((a, b) => num(a.DAYOFWEEK) - num(b.DAYOFWEEK))
      .map((s) => `day ${num(s.DAYOFWEEK)} ${clock(num(s.STARTTIME))}-${clock(num(s.ENDTIME))}`);
    out.push(`  Sign-on times: ${days.join(', ')}`);
  }

  const pages = view.items.filter((i) => view.realMenus.has(str(i.MENUNAME)));
  const other = view.items.filter((i) => !view.realMenus.has(str(i.MENUNAME)));
  const menus = new Map<string, Row[]>();
  for (const i of pages) menus.set(str(i.MENUNAME), [...(menus.get(str(i.MENUNAME)) ?? []), i]);
  out.push('', `  Pages (${menus.size} menus)`);
  for (const [menu, items] of [...menus].sort((a, b) => a[0].localeCompare(b[0]))) {
    out.push(`    ${menu}`);
    const components = new Map<string, Row[]>();
    for (const i of items) {
      const k = `${str(i.BARNAME)}.${str(i.BARITEMNAME)}`;
      components.set(k, [...(components.get(k) ?? []), i]);
    }
    for (const [component, rows] of [...components].sort((a, b) => a[0].localeCompare(b[0]))) {
      out.push(`      ${component}`);
      for (const r of rows.filter((x) => str(x.PNLITEMNAME)).sort((a, b) => str(a.PNLITEMNAME).localeCompare(str(b.PNLITEMNAME)))) {
        out.push(`        ${str(r.PNLITEMNAME).padEnd(24)} ${describeActions(num(r.AUTHORIZEDACTIONS))}${num(r.DISPLAYONLY) ? '  [display only]' : ''}`);
      }
    }
  }
  const weblibs = other.filter((i) => str(i.MENUNAME).startsWith('WEBLIB_'));
  if (weblibs.length) {
    out.push('', `  Web Libraries (${weblibs.length})`);
    for (const w of weblibs) out.push(`    ${str(w.MENUNAME)}.${str(w.BARNAME)}.${str(w.BARITEMNAME)}   access ${num(w.AUTHORIZEDACTIONS)}`);
  }
  const tools = other.filter((i) => !str(i.MENUNAME).startsWith('WEBLIB_'));
  if (tools.length) {
    out.push('', `  PeopleTools (${tools.length})`);
    for (const t of tools) {
      out.push(`    ${str(t.MENUNAME)}.${str(t.BARNAME)}.${str(t.BARITEMNAME)}${str(t.PNLITEMNAME) ? `.${str(t.PNLITEMNAME)}` : ''}   access ${num(t.AUTHORIZEDACTIONS)}` +
        `${num(t.DISPLAYONLY) ? '  [display only]' : ''}`);
    }
  }
  if (view.componentInterfaces.length) {
    out.push('', `  Component Interfaces (${view.componentInterfaces.length} methods)`);
    const byCi = new Map<string, string[]>();
    for (const r of view.componentInterfaces) byCi.set(str(r.BCNAME), [...(byCi.get(str(r.BCNAME)) ?? []), str(r.BCMETHOD)]);
    for (const [ci, methods] of [...byCi].sort((a, b) => a[0].localeCompare(b[0]))) out.push(`    ${ci.padEnd(28)} ${methods.sort().join(', ')}`);
  }
  if (view.webServices.length) {
    out.push('', `  Web Services (${view.webServices.length} operations)`);
    for (const w of [...view.webServices].sort((a, b) => str(a.IB_OPERATIONNAME).localeCompare(str(b.IB_OPERATIONNAME)))) out.push(`    ${str(w.IB_OPERATIONNAME)}`);
  }
  if (view.processGroups.length) out.push('', `  Process Groups: ${view.processGroups.map((p) => str(p.PRCSGRP)).sort().join(', ')}`);
  if (view.queryAccess.length) {
    out.push('', `  Query Access Groups`);
    for (const q of view.queryAccess) out.push(`    ${str(q.TREE_NAME)}  ${str(q.ACCESS_GROUP)}${str(q.ACCESSIBLE) ? `  accessible ${str(q.ACCESSIBLE)}` : ''}`);
  }
  return out.join('\n') + '\n';
}

/** PSXLATITEM ROLETYPE. */
export const ROLE_TYPES: Readonly<Record<string, string>> = { U: 'User List', Q: 'Query' };

export interface RoleView {
  role: Row;
  permissionLists: Row[];
  userCount: number;
  /** Roles this role may grant (PSROLECANGRANT). */
  canGrant: Row[];
}

export function renderRole(name: string, view: RoleView): string {
  const r = view.role;
  const out: string[] = [];
  out.push(`Role ${name}${str(r.DESCR) ? ` -- ${str(r.DESCR)}` : ''}`);
  out.push(`  Type: ${ROLE_TYPES[str(r.ROLETYPE)] ?? str(r.ROLETYPE)}   Status: ${str(r.ROLESTATUS) === 'I' ? 'Inactive' : 'Active'}   Users: ${view.userCount}` +
    `   Version: ${num(r.VERSION)}   Last updated: ${stamp(r)} by ${str(r.LASTUPDOPRID)}`);
  if (str(r.QRYNAME)) out.push(`  Role query: ${str(r.QRYNAME)}`);
  if (str(r.PC_FUNCTION_NAME)) out.push(`  PeopleCode rule: ${str(r.RECNAME)}.${str(r.FIELDNAME)} ${str(r.PC_EVENT_TYPE)} ${str(r.PC_FUNCTION_NAME)}`);
  out.push('', `  Permission Lists (${view.permissionLists.length})`);
  for (const p of view.permissionLists) out.push(`    ${str(p.CLASSID).padEnd(24)} ${str(p.CLASSDEFNDESC)}`);
  if (view.canGrant.length) out.push('', `  Can grant: ${view.canGrant.map((g) => str(g.GRANTROLENAME)).join(', ')}`);
  return out.join('\n') + '\n';
}

/** PSXLATITEM MSG_SEVERITY. */
export const MESSAGE_SEVERITIES: Readonly<Record<string, string>> = { M: 'Message', W: 'Warning', E: 'Error', C: 'Cancel' };

export interface MessageView {
  set: Row | undefined;
  message: Row;
}

export function renderMessage(view: MessageView): string {
  const m = view.message;
  const out: string[] = [];
  out.push(`Message ${num(m.MESSAGE_SET_NBR)}, ${num(m.MESSAGE_NBR)}${view.set && str(view.set.DESCR) ? `  (set: ${str(view.set.DESCR)})` : ''}`);
  out.push(`  Severity: ${MESSAGE_SEVERITIES[str(m.MSG_SEVERITY)] ?? str(m.MSG_SEVERITY)}   Last updated: ${stamp(m)}`);
  out.push('', `  ${str(m.MESSAGE_TEXT)}`);
  const explanation = String(m.DESCRLONG ?? '').trim();
  if (explanation) out.push('', '  Explanation', ...explanation.replace(/\r\n/g, '\n').split('\n').map((l) => `    ${l}`));
  return out.join('\n') + '\n';
}
