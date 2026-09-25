/**
 * Population census of aligned reference events associated with
 * GetRow/GetRowset/GetRecord calls.
 *
 * The first mismatching row is still aligned evidence; rows after it are
 * excluded because positional pairing is no longer trustworthy. This tool
 * is read-only and uses only the completed local snapshot.
 */

import {
  generateEvidence,
  GeneratedOccurrence,
  PairedRow
} from './reference-lifecycle';

import {
  getSnapshotDefinition,
  listSnapshotDefinitionIds
} from '../snapshot/reader';

import {
  openSnapshotDatabase
} from '../snapshot/store';

type CallName = 'GetRow' | 'GetRowset' | 'GetRecord';
type Form = 'bare' | 'postfix';
type Site = 'argument' | 'result-chain' | 'unknown';
type ArgumentShape = 'empty' | 'record' | 'scroll' | 'number' | 'dynamic' | 'other';

interface Bucket {
  occurrences: number;
  definitionIds: Set<number>;
  agree: number;
  disagree: number;
  unknown: number;
  storedAlloc: number;
  storedReuse: number;
  generatedAlloc: number;
  generatedReuse: number;
  agreementExamples: string[];
  disagreementExamples: string[];
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
        if (source[j] !== quote) j++;
        else if (source[j + 1] === quote) j += 2;
        else {
          j++;
          break;
        }
      }
      masked += ' '.repeat(j - i);
      i = j;
      continue;
    }

    masked += source[i];
    i++;
  }

  return masked;
}

function callName(value: string | undefined): CallName | undefined {
  if (/^GetRow$/i.test(value ?? '')) return 'GetRow';
  if (/^GetRowset$/i.test(value ?? '')) return 'GetRowset';
  if (/^GetRecord$/i.test(value ?? '')) return 'GetRecord';
  return undefined;
}

function callForm(
  source: string,
  name: CallName,
  openParen: number
): Form {
  const beforeName = source.slice(0, openParen - name.length);
  return /\.\s*$/.test(beforeName) ? 'postfix' : 'bare';
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
  const semicolon = prefix.indexOf(';', last.index);
  const statement = prefix.slice(
    last.index,
    semicolon === -1 ? beforeOffset : semicolon + 1
  );

  if (/=\s*CreateRowset\s*\(\s*Record\s*\./i.test(statement)) return 'create-rowset-record';
  if (/=\s*(?:[^;]*\.)?GetRowset\s*\(\s*Scroll\s*\./i.test(statement)) return 'get-rowset-scroll';
  if (/=\s*GetRowset\s*\(\s*\)/i.test(statement)) return 'get-rowset-empty';
  if (/=\s*(?:[^;]*\.)?GetRow\s*\(/i.test(statement)) return 'get-row';
  if (/=\s*(?:[^;]*\.)?GetRecord\s*\(/i.test(statement)) return 'get-record';
  return 'other-assignment';
}

function receiverProvenance(
  source: string,
  name: CallName,
  openParen: number,
  form: Form,
  declaredTypes: Map<string, string>
): string {
  if (form === 'bare') return 'intrinsic';
  let nameEnd = openParen;
  while (nameEnd > 0 && /\s/.test(source[nameEnd - 1])) nameEnd--;
  const nameStart = nameEnd - name.length;
  const prefix = source.slice(0, nameStart);
  const directVariable = /(&[A-Za-z0-9_]+#?)\s*\.\s*$/.exec(prefix)?.[1];
  if (directVariable === undefined) return 'chain';
  const declared = declaredTypes.get(directVariable.toLowerCase()) ?? 'untyped';
  return `${declared}/${latestAssignmentShape(source, directVariable, nameStart)}`;
}

function closeParen(source: string, openParen: number): number | undefined {
  let depth = 0;
  for (let i = openParen; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return undefined;
}

function argumentShape(
  source: string,
  openParen: number,
  close: number
): ArgumentShape {
  const argument = source.slice(openParen + 1, close).trim();
  if (argument.length === 0) return 'empty';
  if (/^Record\s*\./i.test(argument)) return 'record';
  if (/^Scroll\s*\./i.test(argument)) return 'scroll';
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*$/.test(argument)) return 'number';
  if (/^@/.test(argument)) return 'dynamic';
  return 'other';
}

function siteOf(occurrence: GeneratedOccurrence, close: number): Site {
  // Reference trace offsets for a call argument can point at the closing
  // parenthesis after the argument has been consumed.
  if (occurrence.sourceOffset <= close) return 'argument';
  if (occurrence.sourceOffset > close) return 'result-chain';
  return 'unknown';
}

function sourceWindow(source: string, offset: number): string {
  return source
    .slice(Math.max(0, offset - 55), Math.min(source.length, offset + 130))
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function evidenceLabel(
  definitionId: number,
  row: PairedRow,
  source: string
): string {
  const generated = row.generated!;
  return (
    `def ${definitionId} occ ${row.occurrenceIndex} ` +
    `stored=${row.stored?.decision ?? '?'} generated=${generated.decision} ` +
    `identity=${generated.identityKey} context=${sourceWindow(source, generated.sourceOffset)}`
  );
}

function main(): void {
  const summaryOnly = process.argv.includes('--summary-only');
  const receiverDetail = process.argv.includes('--receiver-detail');
  const onlyDisagreements = process.argv.includes('--only-disagreements');
  const minimumOccurrences = (() => {
    const index = process.argv.indexOf('--min-occurrences');
    return index === -1 ? 1 : Number(process.argv[index + 1]);
  })();

  const snapshot = openSnapshotDatabase();
  const ids = listSnapshotDefinitionIds(snapshot).filter(id =>
    /\b(?:GetRowset|GetRecord|GetRow)\s*\(/i.test(
      getSnapshotDefinition(snapshot, id).sourceText
    )
  );

  const buckets = new Map<string, Bucket>();
  let encodeErrors = 0;
  let alignedOccurrences = 0;
  let excludedAfterAlignmentLoss = 0;

  for (const definitionId of ids) {
    const definition = getSnapshotDefinition(snapshot, definitionId);
    const masked = maskCommentsAndStrings(definition.sourceText);
    const declaredTypes = declaredVariableTypes(masked);
    const evidence = generateEvidence(definitionId, definition);
    if (evidence.sourceEncodeError !== undefined) encodeErrors++;

    for (const row of evidence.rows) {
      const occurrence = row.generated;
      if (occurrence === undefined) continue;
      const name = callName(occurrence.enclosingCall);
      if (name === undefined || occurrence.enclosingCallOpenParenIndex === undefined) {
        continue;
      }
      if (row.alignmentTrust !== 'aligned') {
        excludedAfterAlignmentLoss++;
        continue;
      }

      const open = occurrence.enclosingCallOpenParenIndex;
      const close = closeParen(masked, open);
      if (close === undefined) continue;

      alignedOccurrences++;
      const form = callForm(masked, name, open);
      const shape = argumentShape(masked, open, close);
      const site = siteOf(occurrence, close);
      const receiver = receiverDetail
        ? ` | receiver=${receiverProvenance(masked, name, open, form, declaredTypes)}`
        : '';
      const key = `${name} | ${form} | arg=${shape}${receiver} | site=${site} | kind=${occurrence.kind}`;
      const bucket = buckets.get(key) ?? {
        occurrences: 0,
        definitionIds: new Set<number>(),
        agree: 0,
        disagree: 0,
        unknown: 0,
        storedAlloc: 0,
        storedReuse: 0,
        generatedAlloc: 0,
        generatedReuse: 0,
        agreementExamples: [],
        disagreementExamples: []
      };

      bucket.occurrences++;
      bucket.definitionIds.add(definitionId);
      if (row.decisionAgree === true) bucket.agree++;
      else if (row.decisionAgree === false) bucket.disagree++;
      else bucket.unknown++;
      if (row.stored?.decision === 'ALLOC') bucket.storedAlloc++;
      if (row.stored?.decision === 'REUSE') bucket.storedReuse++;
      if (occurrence.decision === 'ALLOC') bucket.generatedAlloc++;
      else bucket.generatedReuse++;

      const label = evidenceLabel(definitionId, row, definition.sourceText);
      if (row.decisionAgree === false && bucket.disagreementExamples.length < 3) {
        bucket.disagreementExamples.push(label);
      } else if (row.decisionAgree === true && bucket.agreementExamples.length < 2) {
        bucket.agreementExamples.push(label);
      }

      buckets.set(key, bucket);
    }
  }

  snapshot.close();

  console.log(`Definitions containing target calls: ${ids.length}`);
  console.log(`Source encode errors: ${encodeErrors}`);
  console.log(`Aligned associated occurrences: ${alignedOccurrences}`);
  console.log(`Generated occurrences excluded after alignment loss: ${excludedAfterAlignmentLoss}`);
  console.log('\n--- Comparable totals by call ---');
  for (const name of ['GetRow', 'GetRowset', 'GetRecord'] as const) {
    const matching = [...buckets.entries()]
      .filter(([key]) => key.startsWith(`${name} | `))
      .map(([, bucket]) => bucket);
    const agree = matching.reduce((sum, bucket) => sum + bucket.agree, 0);
    const disagree = matching.reduce((sum, bucket) => sum + bucket.disagree, 0);
    const unknown = matching.reduce((sum, bucket) => sum + bucket.unknown, 0);
    const comparable = agree + disagree;
    console.log(
      `${name}: agree=${agree} disagree=${disagree} unknown=${unknown}; ` +
      `disagreement=${comparable === 0 ? 'n/a' : `${(100 * disagree / comparable).toFixed(2)}%`}`
    );
  }
  console.log('\n--- Aligned reference-event buckets ---');

  for (const [key, bucket] of [...buckets.entries()]
    .filter(([, bucket]) => bucket.occurrences >= minimumOccurrences)
    .filter(([, bucket]) => !onlyDisagreements || bucket.disagree > 0)
    .sort((a, b) => b[1].occurrences - a[1].occurrences)) {
    const comparable = bucket.agree + bucket.disagree;
    const disagreementRate = comparable === 0
      ? 'n/a'
      : `${(100 * bucket.disagree / comparable).toFixed(2)}%`;
    console.log(
      `\n${key}: ${bucket.occurrences} occurrences / ${bucket.definitionIds.size} defs; ` +
      `agree=${bucket.agree} disagree=${bucket.disagree} unknown=${bucket.unknown} ` +
      `disagreement=${disagreementRate}; ` +
      `stored A/R=${bucket.storedAlloc}/${bucket.storedReuse} ` +
      `generated A/R=${bucket.generatedAlloc}/${bucket.generatedReuse}`
    );
    if (!summaryOnly) {
      for (const example of bucket.disagreementExamples) console.log(`  DISAGREE ${example}`);
      for (const example of bucket.agreementExamples) console.log(`  AGREE ${example}`);
    }
  }
}

main();
