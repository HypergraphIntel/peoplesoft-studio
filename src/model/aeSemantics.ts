import { ACTION_LABELS, LABELS } from './appEngine.js';
import type { AeDocAction, AeDocStep, AeDocVariant, AeDocument } from './aeDocument.js';
import { bindFields, variantPath } from './aeValidation.js';

/*
 * What an App Engine program does when it runs (docs/APP_ENGINE_SEMANTICS.md):
 * the sections reachable from MAIN and the calls between them, each step's
 * actions as the runtime takes them, and what the program reads, writes and
 * calls. For the MCP tools' "explain" and "analyze" and for the designer.
 * Derived from the definition alone: nothing is run.
 */

export interface AeCall { from: string; step: string; program: string; section: string; dynamic: boolean; external: boolean }

export interface AeFlow {
  entry: string | undefined;
  /** Sections in the order a run first reaches them from MAIN (depth first). */
  reachable: string[];
  unreachable: string[];
  calls: AeCall[];
  /** Call cycles within the program (a section calling itself, directly or not). */
  cycles: string[][];
  external: { program: string; section: string }[];
  dynamicCalls: number;
}

const effective = (variants: AeDocVariant[]): AeDocVariant | undefined =>
  // The variant a default run takes: GBL / default platform, latest effective date; else the first.
  [...variants].filter((v) => v.active).sort((a, b) =>
    Number(b.market === 'GBL') - Number(a.market === 'GBL') || Number(b.dbType === ' ') - Number(a.dbType === ' ') || b.effdt.localeCompare(a.effdt))[0] ?? variants[0];

export function executionFlow(doc: AeDocument): AeFlow {
  const sections = new Map(doc.sections.map((s) => [s.name, s]));
  const calls: AeCall[] = [];
  for (const s of doc.sections) for (const v of s.variants) for (const st of v.steps) {
    if (!st.active || !st.actions.some((a) => a.type === 'C')) continue;
    const program = st.dynamic ? '' : (st.doProgram.trim() || doc.name);
    calls.push({ from: s.name, step: st.name, program, section: st.doSection.trim(), dynamic: st.dynamic, external: !!program && program !== doc.name });
  }
  const entry = sections.has('MAIN') ? 'MAIN' : undefined;
  const reachable: string[] = [];
  const cycles: string[][] = [];
  const visit = (name: string, path: string[]) => {
    if (path.includes(name)) { cycles.push([...path.slice(path.indexOf(name)), name]); return; }
    if (reachable.includes(name)) return;
    reachable.push(name);
    const s = sections.get(name);
    if (!s) return;
    const v = effective(s.variants);
    for (const st of v?.steps ?? []) {
      if (!st.active) continue;
      const c = calls.find((x) => x.from === name && x.step === st.name);
      if (c && !c.dynamic && !c.external && sections.has(c.section)) visit(c.section, [...path, name]);
    }
  };
  if (entry) visit(entry, []);
  // A library's sections are entered from outside: each is reachable on its own.
  if (doc.program.library) for (const s of doc.sections) if (s.isPublic && !reachable.includes(s.name)) visit(s.name, []);
  return {
    entry, reachable, cycles,
    unreachable: doc.sections.map((s) => s.name).filter((n) => !reachable.includes(n) && !calls.some((c) => c.dynamic)),
    calls,
    external: calls.filter((c) => c.external).map((c) => ({ program: c.program, section: c.section })),
    dynamicCalls: calls.filter((c) => c.dynamic).length
  };
}

const one = (text: string | undefined, max = 140) => {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 3)}...` : t;
};

/** One action as the runtime takes it, in words. */
export function describeAction(doc: AeDocument, st: AeDocStep, a: AeDocAction): string {
  switch (a.type) {
    case 'H': return `Do When: runs "${one(a.text)}"; the rest of the step runs only if it returns a row.`;
    case 'W': return `Do While: while "${one(a.text)}" returns a row, the rest of the step runs and the step repeats.`;
    case 'D': {
      const kind = a.doSelectType === 'R' ? 'Reselect (re-opened after each row)' : a.doSelectType === 'Y' ? 'Restartable (may commit inside the loop)' : 'Select/Fetch (one cursor)';
      return `Do Select, ${kind}: for each row of "${one(a.text)}" -- fetched into the state record -- the rest of the step runs` +
        `${st.commitFrequency ? `; commits every ${st.commitFrequency} rows` : ''}.`;
    }
    case 'P': return `PeopleCode${(a.peopleCode ?? '').trim() ? ` (${(a.peopleCode ?? '').trim().split('\n').length} lines)` : ' (empty)'}; returning False: ${LABELS.onReturn[st.onReturn] ?? st.onReturn}.`;
    case 'S': return `SQL: "${one(a.text)}"; if it affects or returns no row: ${LABELS.onNoRows[st.onNoRows] ?? st.onNoRows}.`;
    case 'C': return st.dynamic ? 'Call Section, dynamic: the section and program named in the state record (AE_SECTION, AE_APPLID).'
      : `Call Section ${st.doProgram.trim() && st.doProgram.trim() !== doc.name ? `${st.doProgram.trim()}.` : ''}${st.doSection.trim() || '(none)'}, then the step goes on.`;
    case 'M': return `Log Message ${st.messageSet}, ${st.messageNumber}${(st.messageParms ?? '').trim() ? ` with ${st.messageParms!.trim()}` : ''}.`;
    case 'N': return `Do Until: after the step's actions, the step repeats until "${one(a.text)}" returns a row.`;
    case 'X': return `XSLT transform (${(a.text ?? '').length} characters).`;
  }
}

/** The program's execution, in words, in the order a run takes it. */
export function explainProgram(doc: AeDocument): string {
  const flow = executionFlow(doc);
  const out: string[] = [];
  const p = doc.program;
  out.push(`${doc.name}: ${p.descr.trim() || '(no description)'} -- ${['Standard', 'Upgrade Only', 'Import Only', 'Daemon Only', 'Transform Only'][Number(p.programType)] ?? p.programType} program` +
    `${p.library ? ', Application Library (no MAIN; its Public sections are called by other programs)' : ''}.`);
  out.push(`Restart ${p.disableRestart ? 'disabled' : 'enabled'}. State records: ${doc.stateRecords.map((s) => s.record + (s.isDefault ? ' (default)' : '')).join(', ') || 'none'}.` +
    `${doc.tempTables.length ? ` Temporary tables: ${doc.tempTables.join(', ')} (${p.tempTableInstances} instances).` : ''}`);
  const order = [...flow.reachable, ...flow.unreachable];
  for (const name of order) {
    const s = doc.sections.find((x) => x.name === name);
    if (!s) continue;
    const v = effective(s.variants);
    if (!v) continue;
    out.push('');
    out.push(`Section ${name} (${variantPath(name, v)}${s.isPublic ? ', Public' : ', Private'}${v.autoCommit === 'Y' ? ', commits after each step' : ''})` +
      `${flow.reachable.includes(name) ? '' : ' -- not reached from MAIN'}:`);
    v.steps.forEach((st, i) => {
      out.push(`  ${i + 1}. ${st.name}${st.active ? '' : ' (inactive: skipped)'}${st.descr.trim() ? ` -- ${st.descr.trim()}` : ''}` +
        `; on error: ${LABELS.onError[st.onError] ?? st.onError}; commit: ${LABELS.commit[st.commitAfter] ?? st.commitAfter}.`);
      for (const a of st.actions) out.push(`     - ${describeAction(doc, st, a)}`);
      if (!st.actions.length) out.push('     - (no actions)');
    });
  }
  if (flow.external.length) out.push('', `Calls other programs: ${flow.external.map((c) => `${c.program}.${c.section}`).join(', ')}.`);
  if (flow.cycles.length) out.push('', `Recursive calls: ${flow.cycles.map((c) => c.join(' -> ')).join('; ')}.`);
  return out.join('\n');
}

export interface AeDependencies {
  stateRecords: string[];
  tempTables: string[];
  /** Tables (records) the SQL reads, writes, and names through %Table / %TruncateTable. */
  tablesRead: string[];
  tablesWritten: string[];
  calledPrograms: { program: string; section: string }[];
  messages: { set: number; number: number }[];
  metaSql: string[];
  bindFields: string[];
}

const rec = (name: string) => name.toUpperCase().replace(/^PS_/, '');

export function dependencies(doc: AeDocument): AeDependencies {
  const read = new Set<string>();
  const written = new Set<string>();
  const meta = new Set<string>();
  const binds = new Set<string>();
  const messages = new Map<string, { set: number; number: number }>();
  for (const s of doc.sections) for (const v of s.variants) for (const st of v.steps) {
    if (st.actions.some((a) => a.type === 'M') && st.messageSet) messages.set(`${st.messageSet}/${st.messageNumber}`, { set: st.messageSet, number: st.messageNumber });
    for (const a of st.actions) {
      const t = a.type === 'X' ? '' : (a.text ?? '');
      if (!t) continue;
      for (const m of t.matchAll(/%(\w+)\s*\(/g)) meta.add(`%${m[1]}`);
      bindFields(t).forEach((f) => binds.add(f));
      const tables = (re: RegExp, to: Set<string>) => { for (const m of t.matchAll(re)) to.add(rec(m[1])); };
      tables(/\bfrom\s+(?:%Table\s*\(\s*)?([A-Za-z0-9_#@$]+)/gi, read);
      tables(/\bjoin\s+(?:%Table\s*\(\s*)?([A-Za-z0-9_#@$]+)/gi, read);
      tables(/\b(?:insert\s+into|update|delete\s+from)\s+(?:%Table\s*\(\s*)?([A-Za-z0-9_#@$]+)/gi, written);
      tables(/%InsertSelect\s*\(\s*(?:DISTINCT\s*,\s*)?([A-Za-z0-9_#@$]+)\s*,\s*([A-Za-z0-9_#@$]+)/gi, written);
      for (const m of t.matchAll(/%InsertSelect\s*\(\s*(?:DISTINCT\s*,\s*)?[A-Za-z0-9_#@$]+\s*,\s*([A-Za-z0-9_#@$]+)/gi)) read.add(rec(m[1]));
      tables(/%TruncateTable\s*\(\s*(?:%Table\s*\(\s*)?([A-Za-z0-9_#@$]+)/gi, written);
    }
  }
  for (const n of ['SELECT', 'DUAL']) { read.delete(n); written.delete(n); }
  const flow = executionFlow(doc);
  return {
    stateRecords: doc.stateRecords.map((s) => s.record), tempTables: doc.tempTables,
    tablesRead: [...read].sort(), tablesWritten: [...written].sort(),
    calledPrograms: flow.external, messages: [...messages.values()], metaSql: [...meta].sort(), bindFields: [...binds].sort()
  };
}

export { ACTION_LABELS };
