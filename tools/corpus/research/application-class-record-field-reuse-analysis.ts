/**
 * Cycle 42: investigates whether PeopleTools reuses RECORD/FIELD
 * identities differently inside Application Class method fragments
 * than in ordinary PeopleCode, using definition 29389
 * (GPS_EDITFUNCTIONS:Reset) as the originating example: stored
 * PeopleTools reuses one RECORD.GPS_DATA_WRK identity across two
 * separate `GetRecord(Record.GPS_DATA_WRK).GetField(...)` statements in
 * the same method; the current encoder allocates it twice. Read-only,
 * no encoder changes.
 *
 * Method: for every definition (Application Class and ordinary), find
 * RECORD names referenced via `GetRecord(Record.X)`/`CreateRecord(Record.X)`
 * two or more times within one method/program body, in DIFFERENT
 * statements. For each candidate, count the real STORED distinct RECORD
 * rows for that name (`recname=RECORD, refname=X` in the snapshot's
 * `names` table) and compare against how many times it textually
 * recurs, to see whether stored reuses (1 row for 2+ occurrences) or
 * allocates fresh (2+ rows). Separately performs the same census for
 * FIELD identities.
 *
 * Usage:
 *   npx tsx tools/corpus/research/application-class-record-field-reuse-analysis.ts
 */

import { parseApplicationClassSource, type ApplicationClassMethodMember } from '../../../src/peoplecode/applicationClassProgram';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { openSnapshotDatabase } from '../snapshot/store';
import type { SnapshotDefinition } from '../snapshot/types';

const APPLICATION_CLASS_OBJECT_ID = 104;

function maskNonExecutable(source: string): string {
  const chars = [...source];
  let i = 0;
  while (i < chars.length) {
    if (
      source.slice(i, i + 3).toLowerCase() === 'rem' &&
      (i === 0 || !/[A-Za-z0-9_%&]/.test(source[i - 1])) &&
      /[\s:]/.test(source[i + 3] ?? '')
    ) {
      while (i < chars.length && chars[i] !== ';') { if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' '; i++; }
      if (i < chars.length) chars[i++] = ' ';
      continue;
    }
    const pair = `${chars[i] ?? ''}${chars[i + 1] ?? ''}`;
    if (pair === '/*' || pair === '<*') {
      const close = pair === '/*' ? '*/' : '*>';
      chars[i++] = ' '; chars[i++] = ' ';
      while (i < chars.length && `${chars[i]}${chars[i + 1] ?? ''}` !== close) { if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' '; i++; }
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

interface Candidate {
  definitionId: number;
  isAppClass: boolean;
  scope: string; // method name, or '(top-level)'
  recordName: string;
  occurrenceCount: number;
  statementSpread: boolean; // occurrences span 2+ distinct statements (approximated by distinct source offsets far apart)
  storedDistinctRows: number;
  reuseClass: 'stored-reuses' | 'stored-fresh-each-time' | 'ambiguous';
}

function countBy<T>(values: readonly T[], key: (value: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) { const k = key(value); result[k] = (result[k] ?? 0) + 1; }
  return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1]));
}

/**
 * Cycle 42 refinement: `CreateRecord(Record.X)` and
 * `<receiver>.GetRecord(Record.X)` are different PROVENANCE (a new
 * standalone record vs. an existing record bound through some other
 * receiver) even when they name the same RECORD definition -- conflating
 * them produced a false "fresh each time" reading for definition 30170's
 * `saveClone` (its own two `Record.PTAI_ITEM` occurrences are one
 * `CreateRecord` and one `&rowset(1).GetRecord`, never reused against
 * each other in the stored program either). Each provenance is now
 * tracked as its own candidate key (`<CONSTRUCT>:<RECORD>`) so reuse is
 * only tested within the SAME construct.
 */
function findRecordCandidates(body: string): Map<string, number[]> {
  const masked = maskNonExecutable(body);
  const byRecord = new Map<string, number[]>();
  for (const m of masked.matchAll(/\b(CreateRecord|GetRecord)\s*\(\s*Record\.([A-Za-z_][A-Za-z0-9_]*)/gi)) {
    const construct = m[1].toLowerCase();
    const name = `${construct}:${m[2].toUpperCase()}`;
    const offset = m.index ?? 0;
    byRecord.set(name, [...(byRecord.get(name) ?? []), offset]);
  }
  return byRecord;
}

function findFieldCandidates(body: string): Map<string, number[]> {
  const masked = maskNonExecutable(body);
  const byField = new Map<string, number[]>();
  for (const m of masked.matchAll(/\bGetField\s*\(\s*Field\.([A-Za-z_][A-Za-z0-9_]*)/gi)) {
    const name = m[1].toUpperCase();
    const offset = m.index ?? 0;
    byField.set(name, [...(byField.get(name) ?? []), offset]);
  }
  return byField;
}

function classify(occurrences: number[], storedRows: number): Candidate['reuseClass'] {
  if (storedRows <= 0) return 'ambiguous';
  if (storedRows === 1) return 'stored-reuses';
  if (storedRows >= occurrences.length) return 'stored-fresh-each-time';
  return 'ambiguous';
}

function main(): void {
  const db = openSnapshotDatabase();
  const definitions = listSnapshotDefinitions(db);
  db.close();

  const recordCandidates: Candidate[] = [];
  const fieldCandidates: Candidate[] = [];

  for (const definition of definitions) {
    const isAppClass = definition.objectid1 === APPLICATION_CLASS_OBJECT_ID;
    const scopes: Array<{ name: string; body: string }> = [];

    if (isAppClass) {
      const parsed = parseApplicationClassSource(definition.sourceText);
      if (parsed === undefined) continue;
      const methods = parsed.members.filter((m): m is ApplicationClassMethodMember => m.kind === 'method');
      for (const method of methods) scopes.push({ name: method.name, body: method.body });
    } else {
      scopes.push({ name: '(top-level)', body: definition.sourceText });
    }

    for (const scope of scopes) {
      const recordMap = findRecordCandidates(scope.body);
      for (const [candidateKey, offsets] of recordMap) {
        if (offsets.length < 2) continue;
        const recordName = candidateKey.split(':')[1];
        const storedRows = definition.names.filter(row => row.recname.trim() === 'RECORD' && row.refname.trim().toUpperCase() === recordName).length;
        recordCandidates.push({
          definitionId: definition.definitionId,
          isAppClass,
          scope: scope.name,
          recordName: candidateKey,
          occurrenceCount: offsets.length,
          statementSpread: offsets[offsets.length - 1] - offsets[0] > 20,
          storedDistinctRows: storedRows,
          reuseClass: classify(offsets, storedRows)
        });
      }

      const fieldMap = findFieldCandidates(scope.body);
      for (const [fieldName, offsets] of fieldMap) {
        if (offsets.length < 2) continue;
        const storedRows = definition.names.filter(row => row.recname.trim() === 'FIELD' && row.refname.trim().toUpperCase() === fieldName).length;
        fieldCandidates.push({
          definitionId: definition.definitionId,
          isAppClass,
          scope: scope.name,
          recordName: fieldName,
          occurrenceCount: offsets.length,
          statementSpread: offsets[offsets.length - 1] - offsets[0] > 20,
          storedDistinctRows: storedRows,
          reuseClass: classify(offsets, storedRows)
        });
      }
    }
  }

  const summarize = (list: Candidate[]) => {
    const appClass = list.filter(c => c.isAppClass);
    const ordinary = list.filter(c => !c.isAppClass);
    return {
      appClass: { total: appClass.length, byReuseClass: countBy(appClass, c => c.reuseClass) },
      ordinary: { total: ordinary.length, byReuseClass: countBy(ordinary, c => c.reuseClass) }
    };
  };

  console.log(JSON.stringify({
    recordCensus: summarize(recordCandidates),
    fieldCensus: summarize(fieldCandidates),
    appClassRecordStoredReusesExamples: recordCandidates.filter(c => c.isAppClass && c.reuseClass === 'stored-reuses').slice(0, 20),
    appClassRecordStoredFreshExamples: recordCandidates.filter(c => c.isAppClass && c.reuseClass === 'stored-fresh-each-time').slice(0, 20),
    appClassFieldStoredReusesExamples: fieldCandidates.filter(c => c.isAppClass && c.reuseClass === 'stored-reuses').slice(0, 10),
    appClassFieldStoredFreshExamples: fieldCandidates.filter(c => c.isAppClass && c.reuseClass === 'stored-fresh-each-time').slice(0, 10)
  }, null, 2));
}

main();
