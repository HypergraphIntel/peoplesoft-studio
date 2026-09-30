/*
 * Cycle 93: STORED reference lifetime census (research only).
 *
 * For every definition, decode the stored program and walk its name-operand
 * tokens (0x21 / 0x4A / 0x48). For each operand whose PSPCMNAME key (RECNAME
 * + REFNAME) was already allocated by an earlier row, record whether stored
 * REUSES that earlier row or ALLOCATES a new row, together with the lexical
 * relation between this use and the earlier row's allocation point:
 *
 *   same-block     the allocating block is this use's block
 *   enclosing-open the allocating block is an open ancestor of this use
 *   closed         the allocating block has already ended
 *   other-function the allocation was in a different Function/method body
 *
 * Blocks: If / Else arms, For, While, Repeat, Evaluate / each When arm,
 * try / catch, Function, method. Kinds are RECNAME classes: RECORD, FIELD,
 * SCROLL, and RECORD.FIELD (everything else with both parts).
 *
 * This measures PeopleTools' own behavior, independent of the encoder.
 *
 * Usage: npx tsx tools/corpus/research/cycle93-reference-lifetime-census.ts [--json out.json]
 */
import fs from 'node:fs';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { decodeProgram } from '../../../src/peoplecode/decoder';
import { NameTable } from '../../../src/peoplecode/progtext';

const OPEN = new Set(['If', 'For', 'While', 'Repeat', 'Evaluate', 'try', 'Function', 'method', 'get', 'set']);
const CLOSE = new Set(['End-If', 'End-For', 'End-While', 'Until', 'End-Evaluate', 'end-try', 'End-Function', 'end-method', 'end-get', 'end-set']);
const SIBLING = new Set(['Else', 'When', 'When-Other', 'catch']);
const FUNCTION_OPEN = new Set(['Function', 'method', 'get', 'set']);

function kindOf(recname: string, refname: string): string {
  if (recname === 'RECORD' || recname === 'FIELD' || recname === 'SCROLL') return recname;
  if (recname === 'PACKAGE') return 'PACKAGE';
  if (recname !== '' && refname !== '') return 'RECORD.FIELD';
  return 'OTHER';
}

interface Allocation { row: number; path: number[]; functionId: number; statement: number }

function main(): void {
  const jsonIndex = process.argv.indexOf('--json');
  const tally = new Map<string, number>();
  const examples = new Map<string, number[]>();
  const add = (key: string, id: number) => {
    tally.set(key, (tally.get(key) ?? 0) + 1);
    const list = examples.get(key) ?? [];
    if (list.length < 8 && !list.includes(id)) list.push(id);
    examples.set(key, list);
  };
  const perDefinition: any[] = [];

  for (const def of listSnapshotDefinitions(openSnapshotDatabase()) as any[]) {
    const names = new NameTable();
    const keyByRow = new Map<number, { key: string; kind: string }>();
    for (const r of def.names) {
      const recname = String(r.recname ?? '').trim().toUpperCase();
      const refname = String(r.refname ?? '').trim().toUpperCase();
      names.add(Number(r.namenum), `${recname}.${refname}`);
      keyByRow.set(Number(r.namenum), { key: `${recname}.${refname}`, kind: kindOf(recname, refname) });
    }
    let tokens: any[];
    try {
      tokens = decodeProgram(def.storedProgram, names, { mode: 'auto', isApplicationClass: def.objectid1 === 104 }).tokens;
    } catch { continue; }

    let nextBlockId = 1;
    const path: number[] = [0];
    let functionId = 0;
    let nextFunctionId = 1;
    const functionStack: number[] = [];
    let statement = 0;
    const closedBlocks = new Set<number>();
    const allocationsByKey = new Map<string, Allocation[]>();
    const seenRows = new Set<number>();
    const events = { reuse: 0, realloc: 0 };

    for (const token of tokens) {
      const text = String(token.text ?? '').trim();
      if (token.nameNum === undefined) {
        if (token.opcode === 0x15) statement++;
        if (OPEN.has(text)) {
          path.push(nextBlockId++);
          if (FUNCTION_OPEN.has(text)) { functionStack.push(functionId); functionId = nextFunctionId++; }
        } else if (SIBLING.has(text)) {
          if (path.length > 1) { closedBlocks.add(path[path.length - 1]); path[path.length - 1] = nextBlockId++; }
        } else if (CLOSE.has(text)) {
          if (path.length > 1) closedBlocks.add(path.pop()!);
          if ((text === 'End-Function' || text.startsWith('end-')) && text !== 'end-try' && functionStack.length) functionId = functionStack.pop()!;
        }
        continue;
      }
      const info = keyByRow.get(token.nameNum);
      if (info === undefined || token.nameNum === 1) continue;
      const opcode = token.opcode.toString(16);
      const prior = allocationsByKey.get(info.key) ?? [];
      const isNewRow = !seenRows.has(token.nameNum);
      const relation = (a: Allocation): string => {
        if (a.functionId !== functionId) return 'other-function';
        const allocBlock = a.path[a.path.length - 1];
        if (allocBlock === path[path.length - 1]) return 'same-block';
        if (path.includes(allocBlock)) return 'enclosing-open';
        return 'closed';
      };
      if (isNewRow) {
        seenRows.add(token.nameNum);
        if (prior.length > 0) {
          const last = prior[prior.length - 1];
          add(`${info.kind.padEnd(12)} op=${opcode} REALLOC relation-to-latest-row=${relation(last)}`, def.definitionId);
          events.realloc++;
        }
        prior.push({ row: token.nameNum, path: [...path], functionId, statement });
        allocationsByKey.set(info.key, prior);
      } else {
        const allocation = prior.find(a => a.row === token.nameNum);
        if (allocation !== undefined) {
          add(`${info.kind.padEnd(12)} op=${opcode} REUSE   relation-to-its-row=${relation(allocation)}${allocation.statement === statement ? ' same-statement' : ''}`, def.definitionId);
          events.reuse++;
        }
      }
    }
    perDefinition.push({ id: def.definitionId, ...events });
  }

  for (const [key, count] of [...tally].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(String(count).padStart(7), key, (examples.get(key) ?? []).join(','));
  }
  if (jsonIndex >= 0) fs.writeFileSync(process.argv[jsonIndex + 1], JSON.stringify(perDefinition));
}

main();
