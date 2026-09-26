/**
 * Cycle 17 (part 2): isolates the fixed method/constructor TERMINATOR
 * shape (`64 15 2d`, established in Cycle 14's own hand-written wrapper)
 * from the name- and body-dependent bytes around it, by searching for
 * that exact 3-byte sequence directly in STORED bytes near each member's
 * own end offset (as already located by
 * `appclass-wrapper-structure-analysis.ts`'s technique), then reporting
 * only the 2 bytes immediately BEFORE it and the bytes immediately AFTER
 * it up to the next member's own header (or class end). This isolates
 * the transition grammar independent of what body text precedes it.
 *
 * Usage:
 *   npx tsx tools/corpus/research/appclass-wrapper-terminator-analysis.ts
 */

import { readProgramLayout } from '../../../src/peoplecode/programLayout';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { openSnapshotDatabase } from '../snapshot/store';

const APPLICATION_CLASS_OBJECT_ID = 104;

function maskCommentsAndStrings(source: string): string {
  const chars = [...source];
  let i = 0;
  while (i < chars.length) {
    const pair = `${chars[i] ?? ''}${chars[i + 1] ?? ''}`;
    if (pair === '/*' || pair === '<*') {
      const close = pair === '/*' ? '*/' : '*>';
      chars[i++] = ' '; chars[i++] = ' ';
      while (i < chars.length && `${chars[i]}${chars[i + 1] ?? ''}` !== close) {
        if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
        i++;
      }
      if (i < chars.length) chars[i++] = ' ';
      if (i < chars.length) chars[i++] = ' ';
      continue;
    }
    if (pair === '//') { while (i < chars.length && chars[i] !== '\n') chars[i++] = ' '; continue; }
    if (chars[i] === '"') {
      chars[i++] = ' ';
      while (i < chars.length) {
        if (chars[i] === '"') { chars[i++] = ' '; if (chars[i] === '"') { chars[i++] = ' '; continue; } break; }
        if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
        i++;
      }
      continue;
    }
    i++;
  }
  return chars.join('');
}

interface RawMember { name: string; implIndex: number; body: string; }
interface RawClass { className: string; members: RawMember[]; }

function extractRawClass(source: string): RawClass | undefined {
  const masked = maskCommentsAndStrings(source);
  const classMatch = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/i.exec(masked);
  if (!classMatch) return undefined;
  const endClass = /\bend-class\s*;?/i.exec(masked.slice((classMatch.index ?? 0) + classMatch[0].length));
  if (!endClass) return undefined;
  const classRegionStart = (classMatch.index ?? 0) + classMatch[0].length;
  const classRegionEnd = classRegionStart + (endClass.index ?? 0);
  const classRegion = masked.slice(classRegionStart, classRegionEnd);
  const implementationRegionStart = classRegionEnd + endClass[0].length;
  const implementationRegion = masked.slice(implementationRegionStart);
  const rawImplementationRegion = source.slice(implementationRegionStart);

  const headerNames = new Set(
    [...classRegion.matchAll(/\bmethod\s+([A-Za-z_][A-Za-z0-9_$]*)\s*(?:\([^;]*?\))?\s*(?:Returns\s+[^;]+?)?\s*(?:abstract\s*)?;/gi)]
      .map(m => m[1].toLowerCase())
  );

  const implementationPattern = /\bmethod\s+([A-Za-z_][A-Za-z0-9_$]*)\s*((?:\/\+[\s\S]*?\+\/\s*)*)([\s\S]*?)\bend-method\s*;/gid;
  const members: RawMember[] = [];
  for (const match of implementationRegion.matchAll(implementationPattern)) {
    if (!headerNames.has(match[1].toLowerCase())) continue;
    const indices = (match as RegExpMatchArray & { indices: Array<[number, number]> }).indices;
    const [bodyStart, bodyEnd] = indices[3];
    members.push({ name: match[1], implIndex: match.index ?? 0, body: rawImplementationRegion.slice(bodyStart, bodyEnd) });
  }
  return { className: classMatch[1], members };
}

function classifyBody(body: string): 'truly-empty' | 'comment-only' | 'non-empty' {
  if (body.trim() === '') return 'truly-empty';
  if (maskCommentsAndStrings(body).trim() === '') return 'comment-only';
  return 'non-empty';
}

function locateStarts(stored: Buffer, statementsEnd: number, members: readonly RawMember[]): number[] {
  const starts: number[] = [];
  let searchFrom = 0;
  for (const member of members) {
    const namePrefix = Buffer.from(member.name, 'utf16le');
    let at = -1;
    let cursor = searchFrom;
    while (true) {
      const nameAt = stored.indexOf(namePrefix, cursor);
      if (nameAt < 0 || nameAt >= statementsEnd) break;
      const precedingWindow = stored.subarray(Math.max(0, nameAt - 4), nameAt);
      if (precedingWindow.includes(0x41) && precedingWindow.includes(0x63)) { at = nameAt - 3; break; }
      cursor = nameAt + 1;
    }
    starts.push(at);
    if (at >= 0) searchFrom = at + 3 + namePrefix.length;
  }
  return starts;
}

function countBy<T>(values: readonly T[], key: (value: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) { const k = key(value); result[k] = (result[k] ?? 0) + 1; }
  return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1]));
}

const TERMINATOR = Buffer.from([0x64, 0x15, 0x2d]);

interface Row {
  id: number;
  name: string;
  isConstructor: boolean;
  emptiness: string;
  nextEmptiness: string;
  isLast: boolean;
  beforeTerminator: string;
  afterTerminator: string;
}

function main(): void {
  const db = openSnapshotDatabase();
  const definitions = listSnapshotDefinitions(db).filter(d => d.objectid1 === APPLICATION_CLASS_OBJECT_ID);
  db.close();

  const rows: Row[] = [];
  const focusIds = new Set([29640, 29664, 29965, 29967, 29976, 29977]);
  const focusRows: unknown[] = [];

  for (const definition of definitions) {
    const raw = extractRawClass(definition.sourceText);
    if (raw === undefined || raw.members.length === 0) continue;
    let layout;
    try { layout = readProgramLayout(definition.storedProgram); } catch { continue; }
    const statementsEnd = layout.names.offset;

    const membersInSourceOrder = [...raw.members].sort((a, b) => a.implIndex - b.implIndex);
    const starts = locateStarts(definition.storedProgram, statementsEnd, membersInSourceOrder);
    if (starts.some(s => s < 0)) continue;

    for (let i = 0; i < membersInSourceOrder.length; i++) {
      const member = membersInSourceOrder[i];
      const regionEnd = i + 1 < membersInSourceOrder.length ? starts[i + 1] : statementsEnd;
      const region = definition.storedProgram.subarray(starts[i], regionEnd);
      const termAt = region.lastIndexOf(TERMINATOR);
      if (termAt < 0) continue; // e.g. last method in class may have a different trailer -- inspected separately
      const before = region.subarray(Math.max(0, termAt - 2), termAt);
      const after = region.subarray(termAt + TERMINATOR.length, region.length);
      const isLast = i === membersInSourceOrder.length - 1;
      const next = i + 1 < membersInSourceOrder.length ? membersInSourceOrder[i + 1] : undefined;
      const row: Row = {
        id: definition.definitionId,
        name: member.name,
        isConstructor: member.name.toLowerCase() === raw.className.toLowerCase(),
        emptiness: classifyBody(member.body),
        nextEmptiness: next === undefined ? 'none' : classifyBody(next.body),
        isLast,
        beforeTerminator: before.toString('hex').replace(/(..)/g, '$1 ').trim(),
        afterTerminator: after.toString('hex').replace(/(..)/g, '$1 ').trim()
      };
      rows.push(row);
      if (focusIds.has(definition.definitionId)) focusRows.push(row);
    }
  }

  console.log(JSON.stringify({
    total: rows.length,
    beforeTerminatorByEmptiness: {
      empty: countBy(rows.filter(r => r.emptiness === 'truly-empty'), r => r.beforeTerminator),
      nonEmpty: countBy(rows.filter(r => r.emptiness === 'non-empty'), r => r.beforeTerminator),
      commentOnly: countBy(rows.filter(r => r.emptiness === 'comment-only'), r => r.beforeTerminator)
    },
    afterTerminatorByPosition: {
      notLast: countBy(rows.filter(r => !r.isLast), r => r.afterTerminator),
      last: countBy(rows.filter(r => r.isLast), r => r.afterTerminator)
    },
    afterTerminatorByEmptinessNotLast: {
      empty: countBy(rows.filter(r => !r.isLast && r.emptiness === 'truly-empty'), r => r.afterTerminator),
      nonEmpty: countBy(rows.filter(r => !r.isLast && r.emptiness === 'non-empty'), r => r.afterTerminator)
    },
    beforeTerminatorByConstructorVsMethod: {
      constructorEmpty: countBy(rows.filter(r => r.isConstructor && r.emptiness === 'truly-empty'), r => r.beforeTerminator),
      methodEmpty: countBy(rows.filter(r => !r.isConstructor && r.emptiness === 'truly-empty'), r => r.beforeTerminator)
    },
    focusRows
  }, null, 2));
}

main();
