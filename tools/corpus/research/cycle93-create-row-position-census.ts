/*
 * Cycle 93: position of the `create` PACKAGE row relative to the rows its
 * constructor arguments allocate (research only, stored evidence).
 *
 * For every stored `create PKG:Class(args)` whose argument list contains at
 * least one FIRST-USE name operand (a row allocated inside the arguments),
 * report whether a PACKAGE.<CLASS> row sits immediately BEFORE the first
 * argument row (NAMENUM = firstArgRow - 1), immediately AFTER the last
 * argument row (NAMENUM = lastArgRow + 1), both, or neither, split by
 * statement form and by whether the definition is an Application Class.
 *
 * Usage: npx tsx tools/corpus/research/cycle93-create-row-position-census.ts
 */
import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { decodeProgram } from '../../../src/peoplecode/decoder';
import { NameTable } from '../../../src/peoplecode/progtext';

const tally = new Map<string, number[]>();
const add = (key: string, id: number) => { const l = tally.get(key) ?? []; l.push(id); tally.set(key, l); };

for (const def of listSnapshotDefinitions(openSnapshotDatabase()) as any[]) {
  const names = new NameTable();
  const keyByRow = new Map<number, string>();
  for (const r of def.names) {
    const key = `${String(r.recname ?? '').trim().toUpperCase()}.${String(r.refname ?? '').trim().toUpperCase()}`;
    names.add(Number(r.namenum), key);
    keyByRow.set(Number(r.namenum), key);
  }
  let tokens: any[];
  try {
    tokens = decodeProgram(def.storedProgram, names, { mode: 'auto', isApplicationClass: def.objectid1 === 104 }).tokens;
  } catch { continue; }
  const seen = new Set<number>();
  let statementStart = 0;
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const text = String(token.text ?? '').trim();
    if (token.opcode === 0x15) statementStart = i + 1;
    if (/^(If|For|While|Evaluate|try|Repeat)$/.test(text) && token.nameNum === undefined) depth++;
    if (/^(End-If|End-For|End-While|End-Evaluate|end-try|Until)$/.test(text)) depth--;
    if (token.opcode !== 0x69) {
      if (token.nameNum !== undefined) seen.add(token.nameNum);
      continue;
    }
    const createIndex = i;
    // class path tokens up to '('
    let j = i + 1;
    let className = '';
    while (j < tokens.length && String(tokens[j].text ?? '').trim() !== '(') {
      const t = String(tokens[j].text ?? '').trim();
      if (t !== ':' && t !== '') className = t;
      j++;
    }
    let paren = 0;
    const argRows: number[] = [];
    let k = j;
    for (; k < tokens.length; k++) {
      const t = String(tokens[k].text ?? '').trim();
      if (tokens[k].nameNum === undefined) {
        if (t === '(') paren++;
        if (t === ')') { paren--; if (paren === 0) break; }
        continue;
      }
      const n = tokens[k].nameNum;
      if (!seen.has(n) && n !== 1) argRows.push(n);
      seen.add(n);
    }
    i = k;
    if (argRows.length === 0) continue;
    const first = Math.min(...argRows);
    const last = Math.max(...argRows);
    const wanted = `PACKAGE.${className.toUpperCase()}`;
    const before = keyByRow.get(first - 1) === wanted;
    const after = keyByRow.get(last + 1) === wanted;
    const significant = tokens.slice(statementStart, createIndex + 1)
      .filter(t => ![0x2d, 0x4f, 0x24, 0x4e, 0x1f, 0x1b].includes(t.opcode) && !/^(Then|Else)$/.test(String(t.text ?? '').trim()))
      .map(t => String(t.text ?? '').trim());
    const previous = String(tokens[createIndex - 1]?.text ?? '').trim();
    const form = significant[0] === 'Local' && previous === '=' ? 'Local-initializer'
      : previous === '=' && significant.length === 3 ? 'assignment'
      : previous === '=' ? 'member-assignment' : 'embedded';
    add(`${def.objectid1 === 104 ? 'appclass' : 'other   '} ${form.padEnd(17)} ${depth > 0 ? 'nested' : 'top   '} row: ${before ? 'BEFORE' : '-'}${after ? ' AFTER' : ''}`, def.definitionId);
  }
}
for (const [key, ids] of [...tally].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(String(ids.length).padStart(5), key, [...new Set(ids)].slice(0, 10).join(','));
}
