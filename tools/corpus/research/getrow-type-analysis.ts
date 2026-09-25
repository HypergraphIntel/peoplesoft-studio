/**
 * Population census of GetRow/GetRowset/GetRecord call forms and the syntax
 * immediately chained from their results.
 *
 * Read-only research infrastructure. It reads the completed local HCDEV
 * snapshot and the latest completed full-corpus classification run. It does
 * not query HCDEV or alter encoder behavior.
 */

import Database from 'better-sqlite3';

import {
  getSnapshotDefinition,
  listSnapshotDefinitionIds
} from '../snapshot/reader';

import {
  openSnapshotDatabase
} from '../snapshot/store';

interface CallOccurrence {
  name: 'GetRow' | 'GetRowset' | 'GetRecord';
  nameOffset: number;
  openParen: number;
  closeParen: number;
  form: 'bare' | 'postfix';
  argumentShape: 'empty' | 'record' | 'scroll' | 'number' | 'dynamic' | 'other';
  receiverProvenance: string;
  signature: string;
}

interface Bucket {
  occurrences: number;
  definitionIds: Set<number>;
  exactOccurrences: number;
  exactDefinitionIds: Set<number>;
  exactExamples: string[];
  nonExactExamples: string[];
}

function maskCommentsAndStrings(source: string): string {
  let masked = '';
  let i = 0;

  while (i < source.length) {
    const delimiter = source.startsWith('/*', i)
      ? '*/'
      : source.startsWith('<*', i)
        ? '*>'
        : source.startsWith('/+', i)
          ? '+/'
          : undefined;

    if (delimiter !== undefined) {
      const end = source.indexOf(delimiter, i + 2);
      const stop = end === -1 ? source.length : end + 2;
      masked += ' '.repeat(stop - i);
      i = stop;
      continue;
    }

    if (source[i] === '"' || source[i] === "'") {
      const quote = source[i];
      let j = i + 1;

      while (j < source.length) {
        if (source[j] !== quote) {
          j++;
        } else if (source[j + 1] === quote) {
          j += 2;
        } else {
          j++;
          break;
        }
      }

      masked += ' '.repeat(j - i);
      i = j;
      continue;
    }

    if (
      (i === 0 || !/[A-Za-z0-9_]/.test(source[i - 1])) &&
      /^(?:rem|remark)\b/i.test(source.slice(i))
    ) {
      const semicolon = source.indexOf(';', i);
      const stop = semicolon === -1 ? source.length : semicolon + 1;
      masked += ' '.repeat(stop - i);
      i = stop;
      continue;
    }

    masked += source[i];
    i++;
  }

  return masked;
}

function skipSpace(source: string, from: number): number {
  let i = from;
  while (i < source.length && /\s/.test(source[i])) i++;
  return i;
}

function matchingParen(source: string, open: number): number | undefined {
  let depth = 0;

  for (let i = open; i < source.length; i++) {
    if (source[i] === '(') depth++;
    if (source[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }

  return undefined;
}

function identifierAt(
  source: string,
  from: number
): { value: string; end: number } | undefined {
  const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(from));
  return match === null
    ? undefined
    : { value: match[0], end: from + match[0].length };
}

function continuationSignature(source: string, closeParen: number): string {
  let i = skipSpace(source, closeParen + 1);
  const parts: string[] = [];

  // Record at most four postfix steps. That is enough to distinguish the
  // return-type transitions under study without pretending to parse the
  // rest of the expression.
  for (let step = 0; step < 4; step++) {
    if (source[i] === '(') {
      const close = matchingParen(source, i);
      if (close === undefined) break;
      parts.push('()');
      i = skipSpace(source, close + 1);
      continue;
    }

    if (source[i] !== '.') break;
    i = skipSpace(source, i + 1);
    const identifier = identifierAt(source, i);
    if (identifier === undefined) break;
    i = skipSpace(source, identifier.end);

    if (source[i] === '(') {
      const close = matchingParen(source, i);
      if (close === undefined) break;
      parts.push(`.${identifier.value}()`);
      i = skipSpace(source, close + 1);
    } else {
      parts.push(`.${identifier.value}`);
    }
  }

  if (parts.length === 0) return '(terminal)';

  return parts
    .join('')
    .replace(/\.([A-Za-z_][A-Za-z0-9_]*)/g, (_all, member: string) => {
      if (/^(?:GetRow|GetRowset|GetRecord|GetField)$/i.test(member)) {
        return `.${member.toLowerCase()}`;
      }
      if (/^(?:Value|IsDeleted|IsNew|IsChanged|Visible|RowNumber|ActiveRowCount|ParentRow|ParentRowset)$/i.test(member)) {
        return `.${member.toLowerCase()}`;
      }
      return '.MEMBER';
    });
}

function argumentShape(
  source: string,
  openParen: number,
  closeParen: number
): CallOccurrence['argumentShape'] {
  const argument = source.slice(openParen + 1, closeParen).trim();

  if (argument.length === 0) return 'empty';
  if (/^Record\s*\./i.test(argument)) return 'record';
  if (/^Scroll\s*\./i.test(argument)) return 'scroll';
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*$/.test(argument)) return 'number';
  if (/^@/.test(argument)) return 'dynamic';
  return 'other';
}

function declaredVariableTypes(source: string): Map<string, string> {
  const types = new Map<string, string>();
  const declaration = /\b(?:Local|Component|Global)\s+(Rowset|Row|Record)\s+([^;]+);/gi;
  let match: RegExpExecArray | null;

  while ((match = declaration.exec(source)) !== null) {
    for (const variable of match[2].matchAll(/&[A-Za-z0-9_]+#?/g)) {
      types.set(variable[0].toLowerCase(), match[1].toLowerCase());
    }
  }

  return types;
}

function latestAssignmentShape(
  source: string,
  variableName: string,
  beforeOffset: number
): string {
  const prefix = source.slice(0, beforeOffset);
  const assignment = new RegExp(
    `${variableName.replace('&', '\\&')}\\s*=`,
    'gi'
  );
  let last: RegExpExecArray | undefined;
  for (const match of prefix.matchAll(assignment)) last = match;
  if (last === undefined || last.index === undefined) return 'no-assignment';

  const statement = prefix.slice(last.index, prefix.indexOf(';', last.index) === -1
    ? beforeOffset
    : prefix.indexOf(';', last.index) + 1);

  if (/=\s*CreateRowset\s*\(\s*Record\s*\./i.test(statement)) return 'create-rowset-record';
  if (/=\s*(?:[^;]*\.)?GetRowset\s*\(\s*Scroll\s*\./i.test(statement)) return 'get-rowset-scroll';
  if (/=\s*GetRowset\s*\(\s*\)/i.test(statement)) return 'get-rowset-empty';
  if (/=\s*(?:[^;]*\.)?GetRow\s*\(/i.test(statement)) return 'get-row';
  if (/=\s*(?:[^;]*\.)?GetRecord\s*\(/i.test(statement)) return 'get-record';
  return 'other-assignment';
}

function receiverProvenance(
  source: string,
  nameOffset: number,
  form: CallOccurrence['form'],
  declaredTypes: Map<string, string>
): string {
  if (form === 'bare') return 'intrinsic';

  const prefix = source.slice(0, nameOffset);
  const directVariable = /(&[A-Za-z0-9_]+#?)\s*\.\s*$/.exec(prefix)?.[1];
  if (directVariable === undefined) return 'chain';

  const declared = declaredTypes.get(directVariable.toLowerCase()) ?? 'untyped';
  const assignment = latestAssignmentShape(source, directVariable, nameOffset);
  return `${declared}/${assignment}`;
}

function findCalls(source: string): CallOccurrence[] {
  const masked = maskCommentsAndStrings(source);
  const declaredTypes = declaredVariableTypes(masked);
  const calls: CallOccurrence[] = [];
  const pattern = /\b(GetRowset|GetRecord|GetRow)\s*\(/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(masked)) !== null) {
    const name = /^getrowset$/i.test(match[1])
      ? 'GetRowset'
      : /^getrecord$/i.test(match[1])
        ? 'GetRecord'
        : 'GetRow';
    const nameOffset = match.index;
    const openParen = pattern.lastIndex - 1;
    const closeParen = matchingParen(masked, openParen);
    if (closeParen === undefined) continue;

    const before = masked.slice(0, nameOffset).match(/\S\s*$/)?.[0].trim();
    const form: CallOccurrence['form'] = before === '.' ? 'postfix' : 'bare';

    calls.push({
      name,
      nameOffset,
      openParen,
      closeParen,
      form,
      argumentShape: argumentShape(masked, openParen, closeParen),
      receiverProvenance: receiverProvenance(
        masked,
        nameOffset,
        form,
        declaredTypes
      ),
      signature: continuationSignature(masked, closeParen)
    });
  }

  return calls;
}

function sourceWindow(source: string, offset: number): string {
  const start = Math.max(0, offset - 45);
  const end = Math.min(source.length, offset + 150);
  return source
    .slice(start, end)
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function main(): void {
  const summaryOnly = process.argv.includes('--summary-only');
  const minimumOccurrences = (() => {
    const index = process.argv.indexOf('--min-occurrences');
    return index === -1 ? 5 : Number(process.argv[index + 1]);
  })();
  const receiverDetail = process.argv.includes('--receiver-detail');
  const snapshot = openSnapshotDatabase();
  const results = new Database('tools/corpus/corpus-results.sqlite', {
    readonly: true
  });

  const fullRun = results.prepare(`
    SELECT MAX(run_id) AS run_id
    FROM corpus_run
    WHERE definitions = 30209 AND completed_at IS NOT NULL
  `).get() as { run_id: number };

  const classificationFor = results.prepare(`
    SELECT classification
    FROM result
    WHERE run_id = ? AND definition_id = ?
  `);

  const buckets = new Map<string, Bucket>();
  const definitionPopulation = new Map<string, Set<number>>();
  let totalCalls = 0;

  for (const definitionId of listSnapshotDefinitionIds(snapshot)) {
    const definition = getSnapshotDefinition(snapshot, definitionId);
    const calls = findCalls(definition.sourceText);
    if (calls.length === 0) continue;

    const row = classificationFor.get(
      fullRun.run_id,
      definitionId
    ) as { classification: string } | undefined;
    const exact = row?.classification === 'EXACT';

    for (const call of calls) {
      totalCalls++;
      const familyKey = `${call.form} ${call.name}`;
      const population = definitionPopulation.get(familyKey) ?? new Set();
      population.add(definitionId);
      definitionPopulation.set(familyKey, population);

      const receiver = receiverDetail
        ? `[receiver=${call.receiverProvenance}]`
        : '';
      const key = `${familyKey}[${call.argumentShape}]${receiver} -> ${call.signature}`;
      const bucket = buckets.get(key) ?? {
        occurrences: 0,
        definitionIds: new Set<number>(),
        exactOccurrences: 0,
        exactDefinitionIds: new Set<number>(),
        exactExamples: [],
        nonExactExamples: []
      };

      bucket.occurrences++;
      bucket.definitionIds.add(definitionId);

      const example =
        `def ${definitionId}: ${sourceWindow(definition.sourceText, call.nameOffset)}`;

      if (exact) {
        bucket.exactOccurrences++;
        bucket.exactDefinitionIds.add(definitionId);
        if (bucket.exactExamples.length < 2) bucket.exactExamples.push(example);
      } else if (bucket.nonExactExamples.length < 2) {
        bucket.nonExactExamples.push(example);
      }

      buckets.set(key, bucket);
    }
  }

  snapshot.close();
  results.close();

  console.log(`Full classification run: ${fullRun.run_id}`);
  console.log(`Call occurrences: ${totalCalls}\n`);
  console.log('--- Definition population by call form ---');
  for (const [key, ids] of [...definitionPopulation].sort()) {
    console.log(`${key}: ${ids.size} definitions`);
  }

  console.log('\n--- Continuation signatures ---');
  for (const [key, bucket] of [...buckets.entries()]
    .sort((a, b) => b[1].occurrences - a[1].occurrences)
    .filter(([, bucket]) => bucket.occurrences >= minimumOccurrences)) {
    console.log(
      `${key}: ${bucket.occurrences} occurrences / ` +
        `${bucket.definitionIds.size} definitions; ` +
        `${bucket.exactOccurrences} occurrences in ` +
        `${bucket.exactDefinitionIds.size} EXACT definitions`
    );

    if (!summaryOnly) {
      for (const example of bucket.exactExamples) {
        console.log(`  EXACT ${example}`);
      }
      for (const example of bucket.nonExactExamples) {
        console.log(`  NONEXACT ${example}`);
      }
    }
  }
}

main();
