/*
 * Cycle 95: RECORD row lifetime versus the Cycle 94 allocation unit
 * (research only).
 *
 * RECORD rows are operands (0x21 `Record.REC`, 0x4A row shorthand
 * `<row>.REC`), so the stored allocate / reuse decision of every occurrence
 * is directly visible: an occurrence allocates when its NAMENUM has not been
 * used before. For every RECORD occurrence of every definition (EXACT ones
 * included, as controls) this records:
 *
 *   - kind: explicit (0x21) or shorthand (0x4A), and the construct around it
 *     (the call it is an argument of, the receiver shape of a shorthand);
 *   - the allocation unit it sits in, computed from the stored token stream
 *     with the Cycle 94 boundaries (leading declaration section through the
 *     first initialized Local; then each top-level statement, a whole
 *     control structure being one statement; each Function body statement);
 *   - whether the same record already occurred in the same unit, and with
 *     which kind / construct; whether it occurred in an earlier unit;
 *   - stored decision (NEW / REUSE, and whether a reuse points into the same
 *     unit); generated decision where the generated token identities match
 *     the stored ones.
 *
 * Output: JSON lines, one per occurrence.
 *
 * With --all every name operand is included, `kind` = <family>/<opcode>.
 *
 * Usage: npx tsx tools/corpus/research/cycle95-record-unit-census.ts <out.jsonl> [--all]
 */
import fs from 'node:fs';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';
import { decodeProgram } from '../../../src/peoplecode/decoder';
import { NameTable } from '../../../src/peoplecode/progtext';

function ownerOf(def: any) {
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

function generatedKeyOf(g: any): string {
  switch (g.kind) {
    case 'owner': return (g.recordName || g.fieldName) ? `${(g.recordName ?? '').toUpperCase()}.${(g.fieldName ?? '').toUpperCase()}` : '.';
    case 'package': return `PACKAGE.${(g.packageName ?? '').toUpperCase()}`;
    case 'scroll': return `SCROLL.${(g.recordName ?? '').toUpperCase()}`;
    case 'record': return `RECORD.${(g.recordName ?? '').toUpperCase()}`;
    case 'field': return `FIELD.${(g.fieldName ?? '').toUpperCase()}`;
    case 'component': return `COMPONENT.${(g.objectName ?? '').toUpperCase()}`;
    default: return `${(g.recordName ?? '').toUpperCase()}.${(g.fieldName ?? '').toUpperCase()}`;
  }
}

const OPEN = /^(If|For|While|Evaluate|Repeat|try)$/i;
const CLOSE = /^(End-If|End-For|End-While|End-Evaluate|Until|end-try)$/i;
const TRIVIA = new Set([0x2d, 0x4f, 0x24, 0x4e, 0xa0]);
const LEADING = /^(import|Component|Global|Declare|Local|Constant|PanelGroup|ComponentLife)\b/i;

interface Occurrence { i: number; nn: number; key: string; unit: number; kind: string; construct: string; statement: number; subStatement: number; depth: number; inFunction: boolean }

function occurrences(tokens: any[], keyOf: (nn: number) => string | undefined): Occurrence[] {
  const out: Occurrence[] = [];
  let depth = 0, inFunction = false, leading = true, unit = 0, nextUnit = 1, statement = 0;
  let atStatementStart = true, statementFirst = '', statementHasEquals = false, inDeclare = false, subStatement = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const text = String(token.text ?? '').trim();
    if (TRIVIA.has(token.opcode)) continue;
    if (atStatementStart && depth === 0) {
      statement++;
      statementFirst = text;
      statementHasEquals = false;
      inDeclare = /^Declare/i.test(text);
      const keepsLeading = !inFunction && leading && LEADING.test(text);
      if (!keepsLeading) {
        leading = false;
        unit = nextUnit++;
      }
      atStatementStart = false;
    }
    if (token.nameNum === undefined) {
      if (text === '=' && depth === 0) statementHasEquals = true;
      if (/^Function$/i.test(text) && !inDeclare && depth === 0) { inFunction = true; leading = false; }
      else if (/^End-Function$/i.test(text)) { inFunction = false; atStatementStart = true; }
      else if (OPEN.test(text)) depth++;
      else if (CLOSE.test(text)) depth = Math.max(0, depth - 1);
      if (token.opcode === 0x15 || /^(Then|Else|Do|When|When-Other|catch)$/i.test(text)) subStatement++;
      if (token.opcode === 0x15 && depth === 0) {
        if (leading && /^Local$/i.test(statementFirst) && statementHasEquals) leading = false;
        atStatementStart = true;
      }
      continue;
    }
    const key = keyOf(token.nameNum);
    if (key === undefined || token.nameNum === 1 || (!ALL_KINDS && !key.startsWith('RECORD.'))) continue;
    let construct: string;
    if (token.opcode === 0x4a) {
      const receiver = tokens[i - 2];
      const receiverText = String(receiver?.text ?? '').trim();
      construct = receiverText === ')' ? 'shorthand:call-or-index' : receiverText.startsWith('&') ? 'shorthand:variable' : `shorthand:${receiverText || receiver?.opcode?.toString(16)}`;
    } else {
      const previous = String(tokens[i - 1]?.text ?? '').trim();
      construct = inDeclare
        ? 'declare-function'
        : previous === '(' || previous === ','
          ? `explicit-arg:${previous === '(' ? String(tokens[i - 2]?.text ?? '').trim() : 'later-arg'}`
          : 'explicit:bare';
    }
    const family = key.startsWith('RECORD.') ? 'RECORD' : key.startsWith('FIELD.') ? 'FIELD' : key.startsWith('SCROLL.') ? 'SCROLL' : key.startsWith('PACKAGE.') ? 'PACKAGE' : /^[A-Z]+\./.test(key) && ['COMPONENT', 'PAGE', 'MENUNAME', 'SQL', 'MESSAGE', 'URL', 'BARNAME', 'ITEMNAME', 'PANELGROUP', 'IMAGE', 'HTML', 'FILELAYOUT', 'OPERATION', 'NODE', 'MARKET', 'PORTAL', 'STYLESHEET', 'BUSPROCESS', 'BUSACTIVITY', 'BUSEVENT', 'COMPINTFC', 'INTERLINK', 'ANALYTICMODEL'].includes(key.split('.')[0]) ? 'QUOTED:' + key.split('.')[0] : 'RECORD.FIELD';
    out.push({ subStatement, depth, inFunction, i, nn: token.nameNum, key, unit, kind: ALL_KINDS ? `${family}/${token.opcode.toString(16)}` : token.opcode === 0x4a ? 'shorthand' : 'explicit', construct, statement });
  }
  return out;
}

const ALL_KINDS = process.argv.includes('--all');
const out = fs.openSync(process.argv[2], 'w');
let written = 0;
for (const def of listSnapshotDefinitions(openSnapshotDatabase()) as any[]) {
  if (def.objectid1 === 104) continue;
  const names = new NameTable();
  const storedKey = new Map<number, string>();
  for (const r of def.names) {
    const key = `${String(r.recname ?? '').trim().toUpperCase()}.${String(r.refname ?? '').trim().toUpperCase()}`;
    names.add(Number(r.namenum), key);
    storedKey.set(Number(r.namenum), key);
  }
  if (!ALL_KINDS && ![...storedKey.values()].some(k => k.startsWith('RECORD.'))) continue;
  let storedTokens: any[];
  try { storedTokens = decodeProgram(def.storedProgram, names, { mode: 'auto', isApplicationClass: false }).tokens; } catch { continue; }
  const stored = occurrences(storedTokens, nn => storedKey.get(nn));
  if (stored.length === 0) continue;

  let generated: Occurrence[] | undefined;
  let exact = false;
  try {
    const artifacts = encodeProgramArtifacts(def.sourceText, { owner: ownerOf(def) } as any) as any;
    exact = artifacts.program.equals(def.storedProgram);
    const generatedKey = new Map<number, string>();
    const generatedNames = new NameTable();
    for (const r of artifacts.references) { generatedKey.set(r.sequence, generatedKeyOf(r)); generatedNames.add(r.sequence, generatedKeyOf(r)); }
    const tokens = decodeProgram(artifacts.program, generatedNames, { mode: 'auto', isApplicationClass: false }).tokens;
    const g = occurrences(tokens, nn => generatedKey.get(nn));
    if (g.length === stored.length && g.every((o, k) => o.key === stored[k].key && o.kind === stored[k].kind)) generated = g;
  } catch { /* unsupported syntax: stored evidence only */ }

  const seenStored = new Map<number, Occurrence>();
  const seenGenerated = new Set<number>();
  for (let k = 0; k < stored.length; k++) {
    const o = stored[k];
    const earlier = stored.slice(0, k).filter(e => e.key === o.key);
    const inUnit = earlier.filter(e => e.unit === o.unit);
    const reuseOf = seenStored.get(o.nn);
    const storedNew = reuseOf === undefined;
    if (storedNew) seenStored.set(o.nn, o);
    let generatedNew: boolean | null = null;
    if (generated) {
      generatedNew = !seenGenerated.has(generated[k].nn);
      seenGenerated.add(generated[k].nn);
    }
    fs.writeSync(out, JSON.stringify({
      id: def.definitionId, exact, key: o.key, kind: o.kind, construct: o.construct,
      unit: o.unit, statement: o.statement,
      earlierInUnit: inUnit.length,
      earlierInUnitKinds: [...new Set(inUnit.map(e => e.construct))].sort().join('+') || '-',
      earlierSameStatement: inUnit.filter(e => e.subStatement === o.subStatement).length,
      depth: o.depth, inFunction: o.inFunction,
      earlierOtherUnit: earlier.length - inUnit.length,
      storedNew,
      storedReuseSameUnit: reuseOf === undefined ? null : reuseOf.unit === o.unit,
      storedReuseKind: reuseOf?.construct ?? null,
      generatedNew
    }) + '\n');
    written++;
  }
}
fs.closeSync(out);
console.log(`${written} RECORD occurrences written`);
