/*
 * Cycle 161: the App Class record / field reference tail (research only).
 *
 * Sections (all by default, or one with `--section <name>`):
 *   tail     each listed program's rows only one side has, with the source
 *            line of the neighbouring generated allocation (`--ids a,b,..`;
 *            default: App Class programs in ACTIVE_RECORD / ACTIVE_FIELD /
 *            ACTIVE_RECORD_FIELD);
 *   unique   App Class stored lists: is any REC.FIELD-shaped row identity
 *            (Declare Function targets included) ever repeated;
 *   declare  Declare Function targets also written as a static REC.FIELD:
 *            stored / generated rows of that identity, owner targets apart;
 *   rowdecl  members of a Row declared outside the body (header instance /
 *            property, top-level Global / Component): RECORD row or not;
 *   arrayparam  indexed members of App Class method parameters `As array
 *            of Record`: FIELD row or not;
 *   message  `&msg.GetRowset()...GetRecord(n).X` on a declared Message.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle161-appclass-record-tail-census.ts --taxonomy t.json [--section <name>] [--ids 1,2]
 */
import fs from 'node:fs';

import { maskNonCode, parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';
import { openHarnessContext, encodeAsHarness, isApplicationClass, storedReferenceKeys, generatedReferenceKey } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomyRows: any[] = args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows : [];
const nonexact = new Set<number>(taxonomyRows.map(r => r.definitionId));
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const only = option('--section');
const run = (name: string) => only === undefined || only === name;
const ctx = openHarnessContext();
const tally = new Map<string, { programs: Set<number>[]; sites: number }>();
const add = (key: string, id: number) => {
  const v = tally.get(key) ?? { programs: [new Set(), new Set()], sites: 0 }; tally.set(key, v);
  v.programs[nonexact.has(id) ? 1 : 0].add(id); v.sites++;
};
const flush = (title: string) => {
  console.log(`== ${title}`);
  for (const [k, { programs: [exact, non], sites }] of [...tally].sort()) {
    console.log(`  ${k.padEnd(46)} sites ${String(sites).padStart(4)}  EXACT ${String(exact.size).padStart(4)}  non ${String(non.size).padStart(3)}  e.g. ${[...exact].slice(0, 4).join(' ')}${non.size ? ` | non ${[...non].slice(0, 12).join(' ')}` : ''}`);
  }
  tally.clear();
};
const storedOf = (def: any, rec: string) => new Set([...def.names].filter((r: any) => String(r.recname).trim() === rec).map((r: any) => String(r.refname).trim().toUpperCase()));
const SPECIAL = new Set(['PACKAGE', 'RECORD', 'FIELD', 'SCROLL', 'COMPONENT', 'PAGE', 'MENUNAME', 'SQL', 'IMAGE', 'BARNAME', 'ITEMNAME', 'OPERATION', 'MESSAGE', 'HTML', 'URL', 'FILELAYOUT', 'BUSPROCESS', 'BUSACTIVITY', 'QUERY', 'NODE', 'INTERLINK', 'STYLESHEET', 'MOBILEPAGE', 'PANELGROUP', 'PANEL', 'ANALYTICMODEL', '']);

if (run('tail')) {
  const ids = option('--ids')?.split(',').map(Number) ?? taxonomyRows
    .filter(r => ['REFERENCE_ACTIVE_RECORD', 'REFERENCE_ACTIVE_FIELD', 'REFERENCE_ACTIVE_RECORD_FIELD'].includes(r.primaryCategory))
    .map(r => r.definitionId)
    .filter(id => isApplicationClass(ctx.definitions.find(d => d.definitionId === id)!));
  console.log('== tail: rows only one side has (LCS), with the neighbouring generated allocation line');
  for (const id of ids) {
    const def = ctx.definitions.find(d => d.definitionId === id)! as any;
    const lines = def.sourceText.split('\n'); const lineOf = (o: number) => def.sourceText.slice(0, o).split('\n').length;
    const allocLine = new Map<number, number>();
    const r = encodeAsHarness(ctx, def, { referenceTrace: (e: any) => { if (e.action === 'ALLOC' && !allocLine.has(e.reference.index)) allocLine.set(e.reference.index, lineOf(e.sourceOffset)); } } as any);
    const s = storedReferenceKeys(def), g = (r.artifacts?.references ?? []).map(generatedReferenceKey);
    const L = Array.from({ length: s.length + 1 }, () => new Int32Array(g.length + 1));
    for (let i = s.length - 1; i >= 0; i--) for (let j = g.length - 1; j >= 0; j--) L[i][j] = s[i] === g[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    console.log(`  ${id}${r.fallback ? ' (fallback)' : ''} stored ${s.length} generated ${g.length}`);
    let i = 0, j = 0, shown = 0;
    while ((i < s.length || j < g.length) && shown < 12) {
      if (i < s.length && j < g.length && s[i] === g[j]) { i++; j++; continue; }
      shown++;
      if (j < g.length && (i >= s.length || L[i][j + 1] >= L[i + 1][j])) {
        const ln = allocLine.get(j); console.log(`    + generated ${g[j]} L${ln}: ${lines[(ln ?? 1) - 1]?.trim().slice(0, 100)}`); j++;
      } else {
        const ln = allocLine.get(j); console.log(`    - stored #${i + 1} ${s[i]} before generated L${ln}: ${lines[(ln ?? 1) - 1]?.trim().slice(0, 100)}`); i++;
      }
    }
  }
}

for (const def of ctx.definitions as any[]) {
  const code = maskNonCode(def.sourceText);
  const appClass = isApplicationClass(def);
  if (run('unique') && appClass) {
    const seen = new Map<string, number>();
    for (const r of def.names) {
      const rec = String(r.recname).trim().toUpperCase(); if (SPECIAL.has(rec)) continue;
      const key = `${rec}.${String(r.refname).trim().toUpperCase()}`; seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    for (const n of seen.values()) add(n > 1 ? 'REC.FIELD identity repeated' : 'REC.FIELD identity once', def.definitionId);
  }
  if (run('declare')) {
    const decls = [...code.matchAll(/\bDeclare\s+Function\s+\w+\s+PeopleCode\s+(\w+)\s*\.\s*(\w+)\s+\w+/gi)];
    if (decls.length) {
      const spans = decls.map(x => [x.index!, x.index! + x[0].length]);
      const first = Math.min(...spans.map(x => x[0]));
      const owner = [...def.names].find((r: any) => Number(r.namenum) === 1);
      const ownerKey = owner ? `${String(owner.recname).trim()}.${String(owner.refname).trim()}`.toUpperCase() : '';
      let generated: any[] | undefined; let fallback = false;
      for (const target of new Set(decls.map(x => `${x[1]}.${x[2]}`.toUpperCase()))) {
        const [rec, fld] = target.split('.');
        const uses = [...code.matchAll(new RegExp(`(?<![\\w.&%:])${rec}\\s*\\.\\s*${fld}\\b`, 'gi'))].filter(u => !spans.some(([a, b]) => u.index! >= a && u.index! < b));
        if (!uses.length) continue;
        if (generated === undefined) { const r = encodeAsHarness(ctx, def); fallback = !!r.fallback; generated = r.artifacts?.references ?? []; }
        const stored = [...def.names].filter((r: any) => `${String(r.recname).trim()}.${String(r.refname).trim()}`.toUpperCase() === target).length;
        const gen = generated.filter((r: any) => `${r.recordName ?? ''}.${r.fieldName ?? ''}`.toUpperCase() === target).length;
        add(`${appClass ? 'App Class' : 'ordinary'}${fallback ? ' fallback' : ''}${target === ownerKey ? ' owner target' : ''}${uses.some(u => u.index! < first) ? ' static first' : ''} stored ${stored} generated ${gen}`, def.definitionId);
      }
    }
  }
  if (!appClass) continue;
  const parsed = parseApplicationClassSource(def.sourceText); if (!parsed) continue;
  const body = code.slice(parsed.unitEnd);
  if (run('rowdecl')) {
    const names = new Set<string>();
    for (const s of parsed.statements as any[]) {
      if ((s.kind === 'property' || s.kind === 'instance' || s.kind === 'instance-statement') && /^Row$/i.test(String(s.type).trim())) {
        for (const n of (s.names ?? [s.name])) names.add(`&${String(n).replace(/^&/, '').toLowerCase()}`);
      }
    }
    for (const x of body.matchAll(/\b(?:Global|Component)\s+Row\s+(&\w+(?:\s*,\s*&\w+)*)/gi)) for (const n of x[1].split(',')) names.add(n.trim().toLowerCase());
    const records = storedOf(def, 'RECORD');
    for (const n of names) {
      for (const x of body.matchAll(new RegExp(`${n}\\s*\\.\\s*(\\w+)\\s*(\\()?`, 'gi'))) {
        if (x[2]) add('Row method call', def.definitionId);
        else if (/^(RowNumber|IsNew|IsDeleted|IsChanged|Visible|Selected|Name|DeleteEnabled|ParentRowset|Style|ChildCount|RecordCount|FreeFormStyleName|ParentRow)$/i.test(x[1])) add(`Row property ${x[1]}`, def.definitionId);
        else add(`record member, stored RECORD row ${records.has(x[1].toUpperCase())}`, def.definitionId);
      }
    }
  }
  if (run('arrayparam')) {
    const params = new Set<string>();
    for (const m of parsed.members as any[]) if (m.kind === 'method') for (const p of m.parameters) if (/^array\s+of\s+Record$/i.test(p.type.trim())) params.add(p.name.replace(/^&/, '').toLowerCase());
    const fields = storedOf(def, 'FIELD');
    for (const n of params) {
      for (const x of body.matchAll(new RegExp(`&${n}\\s*\\[[^\\]]*\\]\\s*\\.\\s*(\\w+)\\s*(\\()?`, 'gi'))) {
        if (x[2]) add('element method call', def.definitionId);
        else if (/^(Name|FieldCount|IsChanged|IsDeleted)$/i.test(x[1])) add(`Record property ${x[1]}`, def.definitionId);
        else add(`element member, stored FIELD row ${fields.has(x[1].toUpperCase())}`, def.definitionId);
      }
    }
  }
  if (run('message')) {
    const messages = new Set<string>();
    for (const x of code.matchAll(/\b(?:Local|Global|Component)\s+Message\s+(&\w+(?:\s*,\s*&\w+)*)/gi)) for (const v of x[1].split(',')) messages.add(v.trim().toLowerCase());
    const fields = storedOf(def, 'FIELD');
    for (const x of code.matchAll(/(&\w+)\s*\.\s*GetRowset\s*\([^()]*\)\s*(?:\(\s*[^()]*\)|\.\s*GetRow\s*\([^()]*\))\s*\.\s*GetRecord\s*\(\s*\d+\s*\)\s*\.\s*(\w+)\s*(\()?/gi)) {
      if (!messages.has(x[1].toLowerCase()) || x[3]) continue;
      add(`Message GetRecord(n) member, stored FIELD row ${fields.has(x[2].toUpperCase())}`, def.definitionId);
    }
  }
}
if (run('unique')) flush('unique: App Class REC.FIELD-shaped stored row identities');
if (run('declare')) flush('declare: Declare Function target also written statically');
if (run('rowdecl')) flush('rowdecl: members of a Row declared outside the body');
if (run('arrayparam')) flush('arrayparam: App Class `As array of Record` parameter elements');
if (run('message')) flush('message: declared Message GetRowset ... GetRecord(n) members');
