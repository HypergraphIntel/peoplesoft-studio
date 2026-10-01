/*
 * Cycle 103: built-in PACKAGE dependency rows in ORDINARY programs --
 * trigger and lifetime, stored vs generated (research only).
 *
 * PACKAGE rows are never operands, so a stored built-in row cannot be tied
 * to source by its operand position. It can be tied by its NEIGHBOURS: in a
 * definition whose non-PACKAGE rows align exactly with the generated
 * references, every non-PACKAGE row has a source offset (the encoder's
 * referenceTrace ALLOC event for the same row), so a stored built-in
 * PACKAGE row sits in the source interval between the operand rows around
 * it. The built-in type EVENTS of the same type inside that interval
 * (declarations scanned from the comment- / string-masked source) are the
 * candidates that opened it. Generated rows are placed the same way.
 *
 * Per (type, interval): k events, m stored rows, g generated rows.
 *   m == k  every event opened a row       m == 0  every event reused one
 *   0 < m < k  ambiguous (excluded from the lifetime matrix) -- except
 *              m == 1 in the interval holding the type's FIRST event of the
 *              program: that event must have opened the row, the rest of
 *              the interval reused it (`inferred`)
 *   k == 0, m > 0  a row with no declaration event (other trigger)
 *
 * Events: `Local` / `Global` / `Component` declarations (scalar or `array
 * of`, bare or initialized), Function parameters (`&x As T`) and
 * `Returns T`, for every type in BUILTINS -- the registry types plus the
 * Cycle 103 candidates (registered or not; an unregistered type has no
 * generated row at all). Each event carries: control depth, function body,
 * top-level / body statement index, whether an executable statement
 * preceded it in its body ("late"), and its enclosing top-level control
 * structure.
 *
 * Lifetime matrix: for each event with a determined stored outcome and an
 * earlier event of the same type in the program, the relation to that
 * previous event and the outcomes, stored and generated.
 *
 * Usage: npx tsx tools/corpus/research/cycle103-builtin-package-lifetime-census.ts [--json out.jsonl] [--ids a,b,c]
 */
import fs from 'node:fs';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';

export const BUILTINS = [
  'Record', 'Row', 'Rowset', 'SQL', 'File', 'Field', 'XmlDoc', 'XmlNode', 'ApiObject', 'Grid', 'Message',
  'GridColumn', 'JavaObject', 'TransformData', 'Chart', 'ProcessRequest',
  // Cycle 103 candidates (unregistered at 6d591af)
  'Page', 'Exception', 'JsonObject', 'JsonArray', 'JsonParser', 'JsonBuilder', 'CubeCollection',
  'AnalyticInstance', 'AnalyticModel', 'AnalyticGrid', 'RatingBoxChart', 'Interlink', 'PostReport',
  'Request', 'SOAPDoc', 'IntBroker', 'CompositeQuery', 'DocumentKey', 'Compound', 'Primitive', 'BIDocs', 'IBInfo'
];
const BUILTIN_BY_LOWER = new Map(BUILTINS.map(t => [t.toLowerCase(), t]));

/* Comments and string literals -> spaces, offsets preserved. */
export function maskSource(src: string): string {
  const out = src.split('');
  const n = src.length;
  const blank = (a: number, b: number) => { for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0;
  let statementStart = true;
  while (i < n) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (two === '/*' || two === '/+') {
      const close = two === '/*' ? '*/' : '+/';
      const j = src.indexOf(close, i + 2);
      const e = j < 0 ? n : j + 2;
      blank(i, e); i = e; continue;
    }
    if (two === '<*') {
      let depth = 0, k = i;
      while (k < n) {
        if (src.startsWith('<*', k)) { depth++; k += 2; } else if (src.startsWith('*>', k)) { depth--; k += 2; if (depth === 0) break; } else k++;
      }
      blank(i, k); i = k; continue;
    }
    if (c === '"') {
      let k = i + 1;
      while (k < n) { if (src[k] === '"') { if (src[k + 1] === '"') { k += 2; continue; } k++; break; } k++; }
      blank(i, k); i = k; statementStart = false; continue;
    }
    const lineStart = /^[ \t]*$/.test(src.slice(src.lastIndexOf('\n', i - 1) + 1, i));
    if ((statementStart || lineStart) && /^rem(?![\w(])/i.test(src.slice(i, i + 4)) && !/[\w&.]/.test(src[i - 1] ?? ' ')) {
      const j = src.indexOf(';', i);
      const e = j < 0 ? n : j + 1;
      blank(i, e); i = e; continue;
    }
    if (c === ';') statementStart = true; else if (!/\s/.test(c)) statementStart = false;
    i++;
  }
  return out.join('');
}

export interface BuiltinEvent {
  offset: number;
  type: string;
  kind: 'local' | 'global' | 'component' | 'param' | 'returns';
  array: boolean;
  initialized: boolean;
  controlDepth: number;
  functionId: number;
  statement: number;
  late: boolean;
  structure: number;
  /**
   * The top-level leading declaration section was already closed -- by a
   * top-level executable statement or control structure, or by an earlier
   * initialized declaration of ANY type (the initialized one itself still
   * belongs to the section). Function definitions do not close it. For a
   * Function's own events: the state when that Function began.
   */
  leadingClosed: boolean;
  /** Function definitions started before this event's own top-level position. */
  functionsBefore: number;
}

const OPENERS = new Set(['if', 'for', 'while', 'repeat', 'evaluate', 'try']);
const CLOSERS = new Set(['end-if', 'end-for', 'end-while', 'until', 'end-evaluate', 'end-try']);
const DECLARATION_WORDS = new Set(['local', 'global', 'component', 'componentlife', 'declare', 'function', 'end-function', 'import', 'constant', 'panelgroup']);
const VARIABLE_DECLARATION_WORDS = new Set(['local', 'global', 'component', 'componentlife']);

/* Structure facts at every offset, from one word / ';' walk of the masked source. */
function structureAt(masked: string) {
  type Mark = { offset: number; controlDepth: number; functionId: number; statement: number; late: boolean; structure: number; leadingClosed: boolean; functionsBefore: number };
  const marks: Mark[] = [];
  let controlDepth = 0, functionId = 0, nextFunction = 1, statement = 0, structure = 0, nextStructure = 1;
  let sawExecutable = false, atStatementStart = true, previousWord = '';
  let leadingClosed = false, closedAtFunctionStart = false, functionsBefore = 0, topStatement = 0;
  let statementWord = '', statementStart = 0;
  const re = /[A-Za-z_%][\w-]*|;/g;
  for (let m = re.exec(masked); m; m = re.exec(masked)) {
    const word = m[0].toLowerCase();
    if (word === ';') {
      if (controlDepth === 0) statement++;
      if (
        functionId === 0 && controlDepth === 0 && VARIABLE_DECLARATION_WORDS.has(statementWord) &&
        /&\w+#?\s*=(?!=)/.test(masked.slice(statementStart, m.index))
      ) leadingClosed = true;
      atStatementStart = true;
      previousWord = ';';
      marks.push({ offset: m.index + 1, controlDepth, functionId, statement, late: sawExecutable, structure, leadingClosed: functionId ? closedAtFunctionStart : leadingClosed, functionsBefore });
      continue;
    }
    if (atStatementStart) { statementWord = word; statementStart = m.index; }
    if (word === 'function' && previousWord !== 'declare') {
      closedAtFunctionStart = leadingClosed;
      topStatement = statement;
      functionId = nextFunction++; statement = 0; sawExecutable = false;
    } else if (word === 'end-function') {
      functionId = 0; functionsBefore++; statement = topStatement + 1; sawExecutable = false;
    } else if (OPENERS.has(word) && !(word === 'for' && previousWord === 'when')) {
      if (controlDepth === 0) structure = nextStructure++;
      controlDepth++;
      if (atStatementStart) sawExecutable = true;
    } else if (CLOSERS.has(word)) {
      controlDepth = Math.max(0, controlDepth - 1);
    } else if (atStatementStart && controlDepth === 0 && !DECLARATION_WORDS.has(word)) {
      sawExecutable = true;
    }
    if (functionId === 0 && sawExecutable) leadingClosed = true;
    atStatementStart = false;
    previousWord = word;
    marks.push({ offset: m.index, controlDepth, functionId, statement, late: sawExecutable, structure: controlDepth > 0 ? structure : 0, leadingClosed: functionId ? closedAtFunctionStart : leadingClosed, functionsBefore });
  }
  return (offset: number) => {
    let lo = 0, hi = marks.length - 1;
    let best: Mark = { offset: 0, controlDepth: 0, functionId: 0, statement: 0, late: false, structure: 0, leadingClosed: false, functionsBefore: 0 };
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (marks[mid].offset <= offset) { best = marks[mid]; lo = mid + 1; } else hi = mid - 1; }
    return best;
  };
}

export function builtinEvents(source: string): BuiltinEvent[] {
  const masked = maskSource(source);
  const at = structureAt(masked);
  const events: BuiltinEvent[] = [];
  const add = (offset: number, type: string, kind: BuiltinEvent['kind'], array: boolean, initialized: boolean) => {
    const canonical = BUILTIN_BY_LOWER.get(type.toLowerCase());
    if (canonical === undefined) return;
    const s = at(offset);
    // A declaration's own `late` is whether an executable statement came BEFORE it.
    events.push({ offset, type: canonical, kind, array, initialized, controlDepth: s.controlDepth, functionId: s.functionId, statement: s.statement, late: s.late, structure: s.structure, leadingClosed: s.leadingClosed, functionsBefore: s.functionsBefore });
  };
  for (const m of masked.matchAll(/\b(Local|Global|Component)\s+((?:array\s+of\s+)*)([A-Za-z_]\w*)(?=\s+&)(\s+&\w+#?(?:\s*,\s*&\w+#?)*)\s*(=(?!=))?/gi)) {
    const typeOffset = m.index! + m[0].indexOf(m[3], m[1].length + m[2].length);
    add(typeOffset, m[3], m[1].toLowerCase() as BuiltinEvent['kind'], m[2].length > 0, m[5] !== undefined);
  }
  for (const f of masked.matchAll(/\bFunction\s+\w+\s*(?:\(([^)]*)\))?\s*(?:Returns\s+((?:array\s+of\s+)*)([A-Za-z_]\w*))?/gi)) {
    if (/\bdeclare\s*$/i.test(masked.slice(Math.max(0, f.index! - 12), f.index!))) continue;
    const paramsOffset = f.index! + f[0].indexOf('(') + 1;
    for (const p of (f[1] ?? '').matchAll(/&\w+\s+As\s+((?:array\s+of\s+)*)([A-Za-z_]\w*)/gi)) {
      add(paramsOffset + p.index! + p[0].lastIndexOf(p[2]), p[2], 'param', p[1].length > 0, false);
    }
    if (f[3] !== undefined) add(f.index! + f[0].lastIndexOf(f[3]), f[3], 'returns', (f[2] ?? '').length > 0, false);
  }
  return events.sort((a, b) => a.offset - b.offset);
}

function context(def: any) {
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7]
    .map((v: string) => (v ?? '').trim());
  const ids = [def.objectid1, def.objectid2, def.objectid3, def.objectid4, def.objectid5, def.objectid6, def.objectid7];
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  const recordIndex = ids.findIndex(id => id === 1);
  const fieldIndex = ids.findIndex(id => id === 2);
  return {
    recordName: recordIndex >= 0 ? values[recordIndex] : values[0],
    fieldName: fieldIndex >= 0 ? values[fieldIndex] : values[1],
    packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean)
  };
}

function generatedKey(g: any): string {
  const up = (v: unknown) => String(v ?? '').toUpperCase();
  switch (g.kind) {
    case 'package': return `PACKAGE.${up(g.packageName)}`;
    case 'scroll': return `SCROLL.${up(g.recordName)}`;
    case 'record': return `RECORD.${up(g.recordName)}`;
    case 'field': return `FIELD.${up(g.fieldName)}`;
    case 'component': return `COMPONENT.${up(g.objectName)}`;
    default: return `${up(g.recordName)}.${up(g.fieldName)}`;
  }
}

export interface EventOutcome extends BuiltinEvent {
  definitionId: number;
  stored: 'open' | 'reuse' | 'ambiguous';
  generated: 'open' | 'reuse' | 'ambiguous';
  inferred: boolean;
  /** The interval (between aligned non-PACKAGE rows) and its stored / generated rows of this type. */
  interval: number;
  storedRows: number;
  generatedRows: number;
  previous?: BuiltinEvent & { stored: string; generated: string };
}

/*
 * Place built-in rows of one side into intervals. `rows` is that side's
 * key list (row 1 excluded); `anchors` the source offsets of the aligned
 * non-PACKAGE rows, in order.
 */
function rowsByInterval(rows: string[], anchors: number[], type: string): Map<number, number> {
  const key = `PACKAGE.${type.toUpperCase()}`;
  const counts = new Map<number, number>();
  let interval = 0;
  for (const row of rows) {
    if (!row.startsWith('PACKAGE.')) { interval++; continue; }
    if (row === key) counts.set(interval, (counts.get(interval) ?? 0) + 1);
  }
  return counts;
}
const intervalOf = (anchors: number[], offset: number) => { let i = 0; while (i < anchors.length && anchors[i] < offset) i++; return i; };

/* Control keywords balance (and no Function inside a control structure): the scanner's structure facts are trustworthy. */
export function balanced(source: string): boolean {
  let depth = 0;
  for (const m of maskSource(source).matchAll(/[A-Za-z_%][\w-]*/g)) {
    const w = m[0].toLowerCase();
    if (OPENERS.has(w)) depth++; else if (CLOSERS.has(w)) depth--;
    if (depth < 0 || (w === 'function' && depth !== 0)) return false;
  }
  return depth === 0;
}

export function censusDefinition(def: any): { aligned: boolean; outcomes: EventOutcome[]; untriggered: Map<string, number>; exact: boolean } | undefined {
  if (!balanced(String(def.sourceText))) return undefined;
  const events = builtinEvents(String(def.sourceText));
  if (events.length === 0 && !def.names.some((r: any) => String(r.recname).trim() === 'PACKAGE' && BUILTIN_BY_LOWER.has(String(r.refname).trim().toLowerCase()))) return undefined;
  const allocOffset = new Map<number, number>();
  let artifacts: any;
  try {
    artifacts = encodeProgramArtifacts(String(def.sourceText), {
      owner: context(def),
      referenceTrace: (e: any) => { if (e.action === 'ALLOC' && !allocOffset.has(e.reference.sequence)) allocOffset.set(e.reference.sequence, e.sourceOffset); }
    } as any);
  } catch { return undefined; }
  const generatedRefs = artifacts.references.filter((r: any) => r.kind !== 'owner');
  const generated: string[] = generatedRefs.map(generatedKey);
  const stored: string[] = def.names.slice(1).map((r: any) => `${String(r.recname ?? '').trim().toUpperCase()}.${String(r.refname ?? '').trim().toUpperCase()}`);
  const nonPackage = (l: string[]) => l.filter(k => !k.startsWith('PACKAGE.'));
  const aligned = nonPackage(stored).join('|') === nonPackage(generated).join('|');
  const exact = stored.join('|') === generated.join('|');
  if (!aligned) return { aligned, outcomes: [], untriggered: new Map(), exact };
  const anchors = generatedRefs.filter((r: any) => r.kind !== 'package').map((r: any) => allocOffset.get(r.sequence) ?? -1);

  const outcomes: EventOutcome[] = [];
  const untriggered = new Map<string, number>();
  for (const type of new Set(events.map(e => e.type).concat(
    stored.filter(k => k.startsWith('PACKAGE.')).map(k => BUILTIN_BY_LOWER.get(k.slice(8).toLowerCase())).filter((t): t is string => t !== undefined)
  ))) {
    const typeEvents = events.filter(e => e.type === type);
    const storedRows = rowsByInterval(stored, anchors, type);
    const generatedRows = rowsByInterval(generated, anchors, type);
    const byInterval = new Map<number, BuiltinEvent[]>();
    for (const e of typeEvents) { const i = intervalOf(anchors, e.offset); byInterval.set(i, [...(byInterval.get(i) ?? []), e]); }
    for (const [i, m] of storedRows) if (!byInterval.has(i)) untriggered.set(type, (untriggered.get(type) ?? 0) + m);
    const firstInterval = typeEvents.length > 0 ? intervalOf(anchors, typeEvents[0].offset) : -1;
    const decide = (list: BuiltinEvent[], rows: number, interval: number, index: number): ['open' | 'reuse' | 'ambiguous', boolean] => {
      if (rows === 0) return ['reuse', false];
      if (rows === list.length) return ['open', false];
      if (rows === 1 && interval === firstInterval) return [index === 0 ? 'open' : 'reuse', true];
      return ['ambiguous', false];
    };
    for (const [i, list] of byInterval) {
      list.forEach((e, index) => {
        const [s, si] = decide(list, storedRows.get(i) ?? 0, i, index);
        const [g, gi] = decide(list, generatedRows.get(i) ?? 0, i, index);
        outcomes.push({ ...e, definitionId: def.definitionId, stored: s, generated: g, inferred: si || gi, interval: i, storedRows: storedRows.get(i) ?? 0, generatedRows: generatedRows.get(i) ?? 0 });
      });
    }
  }
  outcomes.sort((a, b) => a.offset - b.offset);
  const lastByType = new Map<string, EventOutcome>();
  for (const o of outcomes) {
    const previous = lastByType.get(o.type);
    if (previous) o.previous = { ...previous, previous: undefined } as any;
    lastByType.set(o.type, o);
  }
  return { aligned, outcomes, untriggered, exact };
}

export function eventShape(e: BuiltinEvent): string {
  return `${e.kind}${e.array ? '[]' : ''}${e.initialized ? '=' : ''}${e.controlDepth > 0 ? ' nested' : ''}${e.functionId > 0 ? ' fn' : ''}${e.late ? ' late' : ''}`;
}
export function relation(e: BuiltinEvent, p: BuiltinEvent): string {
  if (e.functionId !== p.functionId) return 'other-body';
  if (e.statement === p.statement && e.controlDepth === 0 && p.controlDepth === 0) return 'same-statement';
  if (e.structure !== 0 && e.structure === p.structure) return 'same-structure';
  if (!e.late && !p.late) return 'same-declaration-region';
  return 'other-statement';
}

if (require.main === module) {
  const idsIndex = process.argv.indexOf('--ids');
  const only = idsIndex >= 0 ? new Set(process.argv[idsIndex + 1].split(',').map(Number)) : undefined;
  const jsonIndex = process.argv.indexOf('--json');
  const out = jsonIndex >= 0 ? fs.openSync(process.argv[jsonIndex + 1], 'w') : undefined;
  let considered = 0, aligned = 0;
  const first = new Map<string, [number, number, number]>();
  const later = new Map<string, [number, number, number, number]>();
  const untriggeredTotal = new Map<string, number>();
  for (const def of listSnapshotDefinitions(openSnapshotDatabase()) as any[]) {
    if (def.objectid1 === 104) continue;
    if (only && !only.has(def.definitionId)) continue;
    const r = censusDefinition(def);
    if (!r) continue;
    considered++;
    if (!r.aligned) continue;
    aligned++;
    for (const [t, n] of r.untriggered) untriggeredTotal.set(t, (untriggeredTotal.get(t) ?? 0) + n);
    for (const o of r.outcomes) {
      if (out !== undefined) fs.writeSync(out, JSON.stringify({ ...o, exact: r.exact }) + '\n');
      if (o.stored === 'ambiguous') continue;
      if (!o.previous) {
        const k = `${o.type.padEnd(16)} ${eventShape(o)}`;
        const v = first.get(k) ?? [0, 0, 0]; v[0]++; if (o.stored === 'open') v[1]++; if (o.generated === 'open') v[2]++; first.set(k, v);
      } else {
        const k = `${o.type.padEnd(16)} ${relation(o, o.previous).padEnd(24)} ${eventShape(o.previous).padEnd(22)} -> ${eventShape(o)}`;
        const v = later.get(k) ?? [0, 0, 0, 0];
        v[0]++; if (o.stored === 'open') v[1]++; if (o.generated === 'open') v[2]++; if (o.stored !== o.generated) v[3]++;
        later.set(k, v);
      }
    }
  }
  console.log(`ordinary programs with built-in events or rows: ${considered}; non-PACKAGE rows aligned: ${aligned}`);
  console.log('\n== first event of a type in a program: n, stored opens, generated opens');
  for (const [k, [n, s, g]] of [...first].sort((a, b) => b[1][0] - a[1][0])) console.log(String(n).padStart(6), String(s).padStart(6), String(g).padStart(6), ' ', k);
  console.log('\n== later events: n, stored opens, generated opens, disagreements   type relation previous -> current');
  for (const [k, [n, s, g, d]] of [...later].sort((a, b) => b[1][0] - a[1][0])) console.log(String(n).padStart(6), String(s).padStart(6), String(g).padStart(6), String(d).padStart(6), ' ', k);
  console.log('\n== stored built-in rows with no declaration event in their interval');
  for (const [t, n] of [...untriggeredTotal].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(6), t);
  if (out !== undefined) fs.closeSync(out);
}
