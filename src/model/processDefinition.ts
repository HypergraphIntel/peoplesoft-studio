/*
 * Process Scheduler process definitions (PS_PRCSDEFN and its child tables;
 * HRDMO, PeopleTools 8.62; docs/PROCESS_DEFINITIONS.md), as a read-only text
 * view. Every coded column has PSXLATITEM labels, read from the database
 * with the rows.
 */

export type Row = Record<string, unknown>;

const str = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => Number(v ?? 0);
const stamp = (r: Row) => str(r.LASTUPD) || str(r.LASTUPDDTTM);

/** PSXLATITEM labels: field -> value -> long name. */
export type Translates = ReadonlyMap<string, ReadonlyMap<string, string>>;

/** The coded PS_PRCSDEFN columns, each a PSXLATITEM field. */
export const PROCESS_TRANSLATE_FIELDS = [
  'PRCSPRIORITY', 'RUNLOCATION', 'APIAWARE', 'LOGRQST', 'PARMLISTTYPE', 'CMDLINETYPE', 'WORKINGDIRTYPE',
  'OUTDESTTYPE', 'OUTDESTFORMAT', 'OUTDESTSRC', 'SQRRTFLAG', 'PRCSREADONLY'
];

export interface ProcessView {
  process: Row;
  components: Row[];
  groups: Row[];
  translates: Translates;
}

export function renderProcessDefinition(view: ProcessView): string {
  const p = view.process;
  const t = (field: string) => {
    const value = str(p[field]);
    return view.translates.get(field)?.get(value) ?? value;
  };
  const out: string[] = [];
  out.push(`Process Definition ${str(p.PRCSTYPE)} / ${str(p.PRCSNAME)}${str(p.DESCR) ? ` -- ${str(p.DESCR)}` : ''}`);
  out.push(`  Priority: ${t('PRCSPRIORITY')}   Run location: ${t('RUNLOCATION')}   API aware: ${t('APIAWARE')}   Log request: ${t('LOGRQST')}` +
    `${str(p.PRCSCATEGORY) ? `   Category: ${str(p.PRCSCATEGORY)}` : ''}`);
  const override = (label: string, value: string, type: string) =>
    (value || num(p[type]) !== 0) ? [`  ${label}: ${value || '(blank)'}  (${t(type)})`] : [];
  out.push(...override('Parameter list', str(p.PARMLIST), 'PARMLISTTYPE'));
  out.push(...override('Command line', str(p.CMDLINE), 'CMDLINETYPE'));
  out.push(...override('Working directory', str(p.WORKINGDIR), 'WORKINGDIRTYPE'));
  out.push(`  Output: ${t('OUTDESTTYPE')}, ${t('OUTDESTFORMAT')}   Source: ${t('OUTDESTSRC')}${str(p.OUTDEST) ? `   Destination: ${str(p.OUTDEST)}` : ''}`);
  const extra = [
    str(p.SERVERNAME) && `Server: ${str(p.SERVERNAME)}`,
    str(p.RECURNAME) && `Recurrence: ${str(p.RECURNAME)}`,
    num(p.MAXCONCURRENT) && `Max concurrent: ${num(p.MAXCONCURRENT)}`,
    num(p.TIMEOUTMINUTES) && `Timeout: ${num(p.TIMEOUTMINUTES)} minutes`,
    str(p.RESTARTENABLED) === '1' && 'Restart enabled',
    num(p.RETRYCOUNT) && `Retries: ${num(p.RETRYCOUNT)}`,
    num(p.RETENTIONDAYS) && `Retention: ${num(p.RETENTIONDAYS)} days`,
    str(p.RECVRYPRCSNAME) && `Recovery: ${str(p.RECVRYPRCSTYPE)} / ${str(p.RECVRYPRCSNAME)}`
  ].filter(Boolean);
  if (extra.length) out.push(`  ${extra.join('   ')}`);
  out.push(`  Version: ${num(p.VERSION)}   Last updated: ${stamp(p)} by ${str(p.LASTUPDOPRID)}`);
  if (view.components.length) out.push('', `  Components: ${view.components.map((c) => str(c.PNLGRPNAME)).sort().join(', ')}`);
  if (view.groups.length) out.push('', `  Process groups: ${view.groups.map((g) => str(g.PRCSGRP)).sort().join(', ')}`);
  const long = String(p.DESCRLONG ?? '').trim();
  if (long) out.push('', '  Description', ...long.replace(/\r\n/g, '\n').split('\n').map((l) => `    ${l}`));
  return out.join('\n') + '\n';
}
