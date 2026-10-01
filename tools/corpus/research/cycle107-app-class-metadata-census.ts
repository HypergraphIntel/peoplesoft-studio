/*
 * Cycle 107: which stored Application Class PACKAGE rows that a program's
 * own source never names are recoverable from class definitions in the
 * local snapshot (research only).
 *
 * Population: every stored PACKAGE row whose REFNAME is the name of an
 * Application Class (a snapshot class of that name, or a class row of the
 * program) and appears nowhere in the program's masked source (comments
 * and strings removed). Such a row comes from a member the source does not
 * spell out: a property / instance / method-result type declared by
 * ANOTHER class.
 *
 * Every member-access chain of the source is typed: the base is a variable
 * of a declared Application Class type (Local / Global / Component /
 * ComponentLife / instance / parameter, qualified or resolved through a
 * named import), `%This` (the program's own class) or `%Super` (its parent);
 * each `.member` step is typed through the snapshot provider
 * (`createApplicationClassTypeMetadataProvider`): a property / instance's
 * declared type, or a method's return type, own or inherited (nearest
 * ancestor first). A method call on a class-typed receiver is a use of that
 * class (Cycle 94). A hidden row is RESOLVABLE when some chain reaches a
 * class of that name through at least one provider step; otherwise the
 * census records why not (the receiver class is not in the snapshot, the
 * member is not declared there, the type is not an available class).
 *
 * Usage: npx tsx tools/corpus/research/cycle107-app-class-metadata-census.ts [--json out.jsonl] [--taxonomy t.json]
 */
import fs from 'node:fs';
import path from 'node:path';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { listSnapshotApplicationClassDefinitions } from '../snapshot/applicationClassTypeMetadata';
import {
  canonicalClassKey,
  createApplicationClassTypeMetadataProvider,
  type ApplicationClassPath
} from '../../../src/peoplecode/applicationClassTypeMetadata';
import { parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';
import { isBuiltinObjectTypeName } from '../../../src/peoplecode/encoder';
import { maskSource } from './cycle103-builtin-package-lifetime-census';

const ROOT = path.join(__dirname, '../../..');
const taxonomyIndex = process.argv.indexOf('--taxonomy');
const taxonomy = JSON.parse(fs.readFileSync(taxonomyIndex >= 0 ? process.argv[taxonomyIndex + 1] : path.join(ROOT, '.claude/nonexact-taxonomy.json'), 'utf8'));
const nonexact = new Set<number>(taxonomy.rows.map((r: any) => r.definitionId));

const db = openSnapshotDatabase();
const classDefinitions = listSnapshotApplicationClassDefinitions(db);
const provider = createApplicationClassTypeMetadataProvider(classDefinitions, { isBuiltinType: isBuiltinObjectTypeName });
const snapshotClassNames = new Set(classDefinitions.map(d => d.path[d.path.length - 1].toUpperCase()));
const snapshotKeys = new Set(classDefinitions.map(d => canonicalClassKey(d.path)));
const ownMembers = new Map<string, { members: Set<string>; methods: Set<string> }>();
const ownTables = (classPath: ApplicationClassPath) => {
  const key = canonicalClassKey(classPath);
  if (!ownMembers.has(key)) {
    const definition = classDefinitions.find(d => canonicalClassKey(d.path) === key);
    const program = definition ? parseApplicationClassSource(definition.source) : undefined;
    ownMembers.set(key, {
      members: new Set((program?.members ?? []).filter(m => m.kind !== 'method').map(m => m.name.replace(/^&/, '').toLowerCase())
        .concat((program?.statements ?? []).flatMap(s => s.kind === 'instance-statement' ? s.names.map(n => n.replace(/^&/, '').toLowerCase()) : []))),
      methods: new Set((program?.members ?? []).filter(m => m.kind === 'method').map(m => m.name.toLowerCase()))
    });
  }
  return ownMembers.get(key)!;
};

const jsonIndex = process.argv.indexOf('--json');
const out = jsonIndex >= 0 ? fs.openSync(process.argv[jsonIndex + 1], 'w') : undefined;
const tally = new Map<string, number[]>();
const add = (key: string, id: number) => { const l = tally.get(key) ?? []; l.push(id); tally.set(key, l); };

interface Step { via: 'source' | 'property' | 'method-result'; where?: 'own' | 'inherited'; member?: string }
interface Reach { cls: ApplicationClassPath; steps: Step[]; method?: string; text: string }

for (const def of listSnapshotDefinitions(db) as any[]) {
  if (!nonexact.has(def.definitionId)) continue;
  const source = String(def.sourceText ?? '');
  const masked = maskSource(source);
  const hidden = def.names
    .filter((r: any) => String(r.recname).trim() === 'PACKAGE' && String(r.refname).trim() !== '')
    .map((r: any) => ({ name: String(r.refname).trim().toUpperCase(), method: String(r.appclassmethod ?? '').trim().toUpperCase(), root: String(r.packageroot ?? '').trim(), qualify: String(r.qualifypath ?? '').trim() }))
    .filter((r: any) => !new RegExp(`(?<![A-Za-z0-9_&])${r.name}(?![A-Za-z0-9_])`, 'i').test(masked));
  const appClassHidden = hidden.filter((r: any) => snapshotClassNames.has(r.name) || r.root !== '');
  if (appClassHidden.length === 0) continue;

  /* ---- type environment ---- */
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7].map((v: string) => (v ?? '').trim());
  const app = def.objectid1 === 104;
  const event = values.findIndex(v => v.toLowerCase() === 'onexecute');
  const ownPath = app ? values.slice(0, event < 0 ? values.length : event).filter(Boolean) : undefined;
  const named = new Map<string, string[]>();
  for (const m of masked.matchAll(/\bimport\s+([%A-Za-z0-9_:\s]+?)\s*;/gi)) {
    const c = m[1].replace(/\s+/g, '').split(':');
    if (c[c.length - 1] !== '*') named.set(c[c.length - 1].toUpperCase(), c);
  }
  const typeOf = (written: string): ApplicationClassPath | undefined => {
    const t = written.replace(/\s+/g, '');
    if (/^array/i.test(t)) return undefined;
    if (t.includes(':')) return t.split(':');
    return named.get(t.toUpperCase());
  };
  const variables = new Map<string, ApplicationClassPath>();
  for (const m of masked.matchAll(/\b(?:Local|Global|ComponentLife|Component|instance|private\s+instance)\s+([%A-Za-z_][\w:]*)\s+(&\w+(?:\s*,\s*&\w+)*)/gi)) {
    const t = typeOf(m[1]);
    if (t) for (const v of m[2].split(',')) variables.set(v.trim().toLowerCase(), t);
  }
  for (const m of masked.matchAll(/(&\w+)\s+As\s+([%A-Za-z_][\w:]*)/gi)) {
    const t = typeOf(m[2]);
    if (t) variables.set(m[1].toLowerCase(), t);
  }
  let superPath: ApplicationClassPath | undefined;
  if (ownPath) {
    const program = parseApplicationClassSource(source);
    if (program?.extendsType) superPath = typeOf(program.extendsType);
  }

  /* ---- chains ---- */
  const reaches: Reach[] = [];
  const unresolved: string[] = [];
  const chainRe = /(&\w+|%This|%Super)((?:\s*\.\s*\w+\s*(?:\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))?(?:\s*\[[^\]]*\])*)+)/gi;
  for (const m of masked.matchAll(chainRe)) {
    const base = m[1].toLowerCase();
    let current: ApplicationClassPath | undefined =
      base === '%this' ? ownPath : base === '%super' ? superPath : variables.get(base);
    if (current === undefined) continue;
    const steps: Step[] = [{ via: 'source' }];
    for (const s of m[2].matchAll(/\.\s*(\w+)\s*(\()?/g)) {
      if (current === undefined) break;
      const member = s[1];
      const isCall = s[2] !== undefined;
      if (isCall) {
        reaches.push({ cls: current, steps: [...steps], method: member.toUpperCase(), text: m[0].slice(0, 120) });
        const result = provider.methodReturnType(current, member);
        const where: Step['where'] = snapshotKeys.has(canonicalClassKey(current)) ? (ownTables(current).methods.has(member.toLowerCase()) ? 'own' : 'inherited') : undefined;
        if (result === undefined && steps.length > 0 && !snapshotKeys.has(canonicalClassKey(current))) unresolved.push(`class-not-in-snapshot:${canonicalClassKey(current)}`);
        current = result?.kind === 'class' ? result.path : undefined;
        steps.push({ via: 'method-result', where, member });
      } else {
        const result = provider.memberType(current, member);
        const where: Step['where'] = snapshotKeys.has(canonicalClassKey(current)) ? (ownTables(current).members.has(member.toLowerCase()) ? 'own' : 'inherited') : undefined;
        if (result === undefined && !snapshotKeys.has(canonicalClassKey(current))) unresolved.push(`class-not-in-snapshot:${canonicalClassKey(current)}`);
        else if (result === undefined) unresolved.push(`member-not-found:${canonicalClassKey(current)}.${member}`);
        reaches.push({ cls: current, steps: [...steps], text: m[0].slice(0, 120) });
        current = result?.kind === 'class' ? result.path : undefined;
        steps.push({ via: 'property', where, member });
      }
      if (current !== undefined) reaches.push({ cls: current, steps: [...steps], text: m[0].slice(0, 120) });
    }
  }

  for (const row of appClassHidden) {
    const viaProvider = reaches.filter(r => r.cls[r.cls.length - 1].toUpperCase() === row.name && r.steps.some(s => s.via !== 'source'));
    let verdict: string;
    let relation = '';
    if (viaProvider.length > 0) {
      const best = viaProvider.find(r => !row.method || r.method === row.method) ?? viaProvider[0];
      const hops = best.steps.filter(s => s.via !== 'source');
      relation = hops.map(s => `${s.via}${s.where === 'inherited' ? '(inherited)' : ''}`).join('>');
      verdict = 'RESOLVABLE';
      if (row.root !== '' && canonicalClassKey(best.cls) !== canonicalClassKey([row.root, ...row.qualify.split(':').filter(Boolean), row.name])) verdict = 'RESOLVABLE-but-PATH-DIFFERS';
    } else {
      verdict = 'unresolved:' + ([...new Set(unresolved.map(u => u.split(':')[0]))].join('+') || 'no-chain-reaches-it');
    }
    const key = `${app ? 'app' : 'ord'} ${verdict.padEnd(44)} ${relation}`;
    add(key, def.definitionId);
    if (out !== undefined) fs.writeSync(out, JSON.stringify({ id: def.definitionId, app, row, verdict, relation, chains: viaProvider.slice(0, 2).map(r => r.text), unresolved: [...new Set(unresolved)].slice(0, 4) }) + '\n');
  }
}
if (out !== undefined) fs.closeSync(out);
console.log('hidden Application Class rows in NONEXACT programs: program kind, verdict, relation (provider hops)');
for (const [k, ids] of [...tally].sort((a, b) => b[1].length - a[1].length)) console.log(String(ids.length).padStart(5), k, [...new Set(ids)].slice(0, 8).join(','));
const all = [...tally.values()].flat();
console.log('rows', all.length, 'definitions', new Set(all).size);
