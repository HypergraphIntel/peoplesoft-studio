/*
 * Cycle 93: Application Class method-dependency rows in ordinary (non-class)
 * programs, read from stored descriptive PSPCMNAME content (research only).
 *
 * Newer compiles store PACKAGEROOT / APPCLASSMETHOD on PACKAGE rows. A row
 * whose APPCLASSMETHOD is populated is a row a method call USED -- either a
 * dedicated method row or a create row the call reused (22882: the single
 * post-import GRNBASIC row carries POPULATEVARGRID), so a populated method
 * name alone does not prove a separate row.
 *
 * For every method call `&var.Method(` on a declared Application Class
 * variable this tallies how many stored rows carry that method name, split
 * by the variable's declaration (Local/Component/Global; leading, late,
 * nested, function; uninitialized / create-initialized; class named-imported
 * or wildcard-resolved) and by where the call sits (top level, nested,
 * function). Source parsing is line/regex based and approximate.
 *
 * Usage: npx tsx tools/corpus/research/cycle93-method-row-census.ts
 */
import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
const allDefs = (): any[] => listSnapshotDefinitions(openSnapshotDatabase()) as any[];
const tally = new Map<string, number[]>();
const add = (k: string, id: number) => { const l = tally.get(k) ?? []; l.push(id); tally.set(k, l); };
let withDesc = 0, withoutDesc = 0;
for (const def of allDefs()) {
  if (def.objectid1 === 104) continue;
  const rows = [...def.names];
  const pk = rows.filter((r: any) => String(r.recname).trim() === 'PACKAGE');
  if (pk.length === 0) continue;
  const hasDesc = pk.some((r: any) => String(r.packageroot ?? '').trim() !== '');
  if (!hasDesc) { withoutDesc++; continue; }
  withDesc++;
  const methodRows = new Map<string, number>();
  for (const r of pk) { const m = String(r.appclassmethod ?? '').trim().toUpperCase(); if (m) methodRows.set(`${String(r.refname).trim().toUpperCase()}.${m}`, (methodRows.get(`${String(r.refname).trim().toUpperCase()}.${m}`) ?? 0) + 1); }
  const src = (def.sourceText as string).replace(/<\*[\s\S]*?\*>/g, m => m.replace(/[^\n]/g, ' ')).replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/^\s*rem\b[^;]*;/gim, m => m.replace(/[^\n]/g, ' ')).replace(/"(?:[^"]|"")*"/g, '""');
  const named = new Set([...src.matchAll(/\bimport\s+([A-Za-z0-9_:]+):([A-Za-z0-9_]+)\s*;/gi)].map(m => `${m[1]}:${m[2]}`.toLowerCase()));
  // variable declarations
  const vars = new Map<string, { cls: string; full: string; kind: string }>();
  const lines = src.split(/\r?\n/);
  let depth = 0, fdepth = 0, sawExec = false;
  const sites: { v: string; method: string; depth: number; fdepth: number; line: number }[] = [];
  lines.forEach((line, ln) => {
    const t = line.trim();
    if (/^(Function|method)\b/i.test(t)) fdepth++;
    const d = /^(Local|Component|Global)\s+([A-Za-z0-9_]+(?::[A-Za-z0-9_]+)+)\s+(&[A-Za-z0-9_]+(?:\s*,\s*&[A-Za-z0-9_]+)*)\s*(=\s*create\b|=|;)/i.exec(t);
    if (d) {
      const full = d[2].toLowerCase(); const cls = full.split(':').pop()!.toUpperCase();
      const init = d[4].startsWith('=') ? (/create/i.test(d[4]) ? 'init-create' : 'init-other') : 'uninit';
      const where = fdepth > 0 ? 'function' : depth > 0 ? 'nested' : sawExec ? 'late' : 'leading';
      for (const v of d[3].split(',')) vars.set(v.trim().toLowerCase(), { cls, full, kind: `${d[1]}/${where}/${init}/${named.has(full) ? 'named' : 'wild'}` });
    }
    for (const m of t.matchAll(/(&[A-Za-z0-9_]+)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) sites.push({ v: m[1].toLowerCase(), method: m[2].toUpperCase(), depth, fdepth, line: ln });
    if (t !== '' && !/^(import|Local|Component|Global|Declare|Function|End-Function|Constant)\b/i.test(t) && fdepth === 0) sawExec = true;
    if (/^Local\b.*=/.test(t) && fdepth === 0) sawExec = true;
    if (/^(If|For|While|Evaluate|try|Repeat)\b/i.test(t)) depth++;
    if (/^(End-If|End-For|End-While|End-Evaluate|end-try|Until)\b/i.test(t)) depth = Math.max(0, depth - 1);
    if (/^End-Function\b/i.test(t)) fdepth = Math.max(0, fdepth - 1);
  });
  const seenMethod = new Map<string, number>();
  for (const s of sites) {
    const v = vars.get(s.v); if (!v) continue;
    const key = `${v.cls}.${s.method}`;
    const occurrence = (seenMethod.get(key) ?? 0) + 1; seenMethod.set(key, occurrence);
    const stored = methodRows.get(key) ?? 0;
    add(`${v.kind.padEnd(38)} call:${s.fdepth > 0 ? 'function' : s.depth > 0 ? 'nested' : 'top   '} occ=${Math.min(occurrence, 2)}  storedRowsForMethod=${Math.min(stored, 3)}`, def.definitionId);
  }
}
console.log('non-class defs with PACKAGE rows: descriptive', withDesc, 'blank', withoutDesc);
for (const [k, ids] of [...tally].sort((a, b) => a[0].localeCompare(b[0]))) if (ids.length >= 3) console.log(String(ids.length).padStart(5), k, [...new Set(ids)].slice(0, 5).join(','));
