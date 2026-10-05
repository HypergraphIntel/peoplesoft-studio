/*
 * Cycle 179: write-safety interlocks for the controlled-compile lab.
 *
 * Cycle 178 incident: an Application Designer project import (-PJFF) wrote
 * PeopleCode under the identity embedded in an imported compiled blob,
 * not under the project's own keys, and so overwrote the delivered
 * APPS_RLR:Utilities program. From here on, a lab write is allowed only
 * when:
 * - every definition identity it involves is proven to lie in the scratch
 *   namespace (exact prefix ZZ_PCODE_LAB) before it runs, and
 * - a database audit afterwards shows zero non-scratch changes.
 *
 * Note: HRDMO ships delivered ZZ_PAY_* definitions, so `ZZ%` is never a
 * scratch predicate.
 */

export const SCRATCH_PREFIX = 'ZZ_PCODE_LAB';

/** SQL LIKE for scratch keys; `_` escaped so it cannot match ZZxPCODExLAB. */
export const SCRATCH_LIKE = "LIKE 'ZZ\\_PCODE\\_LAB%' ESCAPE '\\'";

export const isScratchName = (value: string | undefined | null): boolean =>
  typeof value === 'string' && value.trim().toUpperCase().startsWith(SCRATCH_PREFIX);

export function assertScratchName(kind: string, value: string): void {
  if (!isScratchName(value)) throw new Error(`${kind} ${JSON.stringify(value)} is outside the scratch namespace ${SCRATCH_PREFIX}%.`);
}

export interface ProjectValidation {
  ok: boolean;
  violations: string[];
  /** Identities found, for the record. */
  identities: string[];
}

const ALLOWED_INSTANCES = new Set(['PJM', 'APM', 'PCM']);
const tag = (block: string, name: string): string | undefined => {
  const match = new RegExp(`<${name.replace(/\./g, '\\.')}>([^<]*)</${name.replace(/\./g, '\\.')}>`).exec(block);
  return match === null ? undefined : match[1];
};
const allTags = (block: string, name: string): string[] =>
  [...block.matchAll(new RegExp(`<${name.replace(/\./g, '\\.')}>([^<]*)</${name.replace(/\./g, '\\.')}>`, 'g'))].map(m => m[1]);

/**
 * Validate a generated Application Designer project file before -PJFF.
 *
 * Rejects:
 * - any instance class other than PJM / APM / PCM;
 * - a non-scratch project name;
 * - a project item that is not an Application Package (57) or App Package
 *   PeopleCode (58), or whose package root is not scratch;
 * - an APM whose own root, or any listed class or sub-package root, is not
 *   scratch;
 * - a PCM keyed outside the scratch namespace or outside Application Class
 *   PeopleCode (OBJECTID1 104);
 * - ANY compiled payload: a non-empty <peoplecode_blob>, PSPCMNAME rows
 *   (PcmPnt), or a non-zero name count. A blob carries its own identity;
 *   -PJFF writes there.
 */
export function validateScratchProjectXml(xml: string): ProjectValidation {
  const violations: string[] = [];
  const identities: string[] = [];
  const instances = [...xml.matchAll(/<instance class="([^"]*)">/g)].map(m => ({ cls: m[1], start: m.index! }));
  if (instances.length === 0) violations.push('no instances');
  const blockOf = (start: number) => xml.slice(start, xml.indexOf('</instance>', start));

  let projects = 0;
  for (const { cls, start } of instances) {
    if (!ALLOWED_INSTANCES.has(cls)) {
      violations.push(`instance class ${cls} is not allowed`);
      continue;
    }
    const block = blockOf(start);
    if (cls === 'PJM') {
      projects++;
      const name = tag(block, 'szProjectName') ?? '';
      identities.push(`project ${name}`);
      if (!isScratchName(name)) violations.push(`project name ${name} is not scratch`);
      for (const row of block.match(/<row>\s*<eObjectType>[\s\S]*?<\/row>/g) ?? []) {
        const type = Number(tag(row, 'eObjectType'));
        const values = [0, 1, 2, 3].map(i => tag(row, `szObjectValue_${i}`) ?? '');
        identities.push(`item ${type} ${values.filter(Boolean).join('.')}`);
        if (type === 57) {
          if (!isScratchName(values[1])) violations.push(`package item root ${values[1]} is not scratch`);
        } else if (type === 58) {
          if (!isScratchName(values[0])) violations.push(`package PeopleCode item root ${values[0]} is not scratch`);
        } else {
          violations.push(`project item type ${type} is not allowed`);
        }
      }
    } else if (cls === 'APM') {
      const root = tag(block, 'szPackageRoot') ?? '';
      const id = tag(block, 'szPackageId') ?? '';
      identities.push(`package ${root}:${id}`);
      if (!isScratchName(root)) violations.push(`package root ${root} is not scratch`);
      for (const value of [...allTags(block, 'ApmClassKey.szPackageRoot'), ...allTags(block, 'ApmDefnKey.szPackageRoot')]) {
        if (!isScratchName(value)) violations.push(`package list root ${value} is not scratch`);
      }
    } else {
      const root = tag(block, 'szObjectValue_0') ?? '';
      const id0 = Number(tag(block, 'eObjectID_0'));
      const key = [0, 1, 2, 3, 4, 5, 6].map(i => tag(block, `szObjectValue_${i}`) ?? '').filter(Boolean).join('.');
      identities.push(`peoplecode ${key}`);
      if (!isScratchName(root)) violations.push(`PeopleCode key ${key} is not scratch`);
      if (id0 !== 104) violations.push(`PeopleCode key ${key} is not Application Class PeopleCode`);
      const blob = /<peoplecode_blob>([\s\S]*?)<\/peoplecode_blob>/.exec(block)?.[1] ?? '';
      if (blob.trim() !== '') violations.push(`PeopleCode ${key} carries a compiled payload`);
      if (/<rowset name="PcmPnt"/.test(block)) violations.push(`PeopleCode ${key} carries PSPCMNAME rows`);
      if (Number(tag(block, 'nNameCount') ?? 0) !== 0) violations.push(`PeopleCode ${key} declares names`);
      if (!/<peoplecode_text>/.test(block)) violations.push(`PeopleCode ${key} has no source text`);
    }
  }
  if (projects !== 1) violations.push(`expected exactly one PJM instance, found ${projects}`);
  return { ok: violations.length === 0, violations, identities };
}

/** One audited definition: key -> fingerprint (row count, length, timestamp and content hash). */
export type AuditInventory = Record<string, Record<string, string>>;

export interface AuditDiff {
  changed: string[];
  added: string[];
  removed: string[];
}

/** Compare two inventories table by table; returns `table key` entries. */
export function diffAudit(before: AuditInventory, after: AuditInventory): AuditDiff {
  const result: AuditDiff = { changed: [], added: [], removed: [] };
  const tables = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const table of [...tables].sort()) {
    const a = before[table] ?? {};
    const b = after[table] ?? {};
    for (const key of Object.keys(a).sort()) {
      if (!(key in b)) result.removed.push(`${table} ${key}`);
      else if (a[key] !== b[key]) result.changed.push(`${table} ${key}`);
    }
    for (const key of Object.keys(b).sort()) if (!(key in a)) result.added.push(`${table} ${key}`);
  }
  return result;
}

export const auditChangeCount = (diff: AuditDiff): number => diff.changed.length + diff.added.length + diff.removed.length;

export interface DmsValidation {
  ok: boolean;
  violations: string[];
  statements: string[];
}

/** Split a Data Mover script into statements on `;` outside string literals. */
export function splitDmsStatements(script: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (const ch of script.replace(/^\s*--.*$/gm, '')) {
    if (ch === "'") quoted = !quoted;
    if (ch === ';' && !quoted) {
      if (current.trim() !== '') out.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim() !== '') out.push(current.trim());
  return out;
}

/**
 * Validate a scratch-cleanup Data Mover script. The only statement form
 * allowed is
 *
 *   DELETE FROM <allowed table> WHERE <column> = 'lit'
 *   DELETE FROM <allowed table> WHERE <column> IN ('lit', ...)
 *
 * with every literal in the scratch namespace. Nothing else is allowed:
 * no OR, no sub-query, no other DML / DDL / Data Mover command. The
 * runner adds SET LOG itself.
 */
export function validateScratchCleanupDms(script: string, allowedTables: readonly string[]): DmsValidation {
  const violations: string[] = [];
  const statements = splitDmsStatements(script);
  const allowed = new Set(allowedTables.map(t => t.toUpperCase()));
  const form = /^DELETE\s+FROM\s+([A-Z][A-Z0-9_]*)\s+WHERE\s+([A-Z][A-Z0-9_]*)\s*(=\s*'[^']*'|IN\s*\(\s*'[^']*'(?:\s*,\s*'[^']*')*\s*\))$/i;
  if (statements.length === 0) violations.push('empty script');
  for (const statement of statements) {
    const normalized = statement.replace(/\s+/g, ' ').trim();
    const match = form.exec(normalized);
    if (match === null) {
      violations.push(`statement form not allowed: ${normalized.slice(0, 80)}`);
      continue;
    }
    if (!allowed.has(match[1].toUpperCase())) violations.push(`table ${match[1]} is not allowed`);
    for (const literal of [...match[3].matchAll(/'([^']*)'/g)].map(m => m[1])) {
      if (!isScratchName(literal)) violations.push(`literal ${JSON.stringify(literal)} is not scratch`);
    }
  }
  return { ok: violations.length === 0, violations, statements };
}
