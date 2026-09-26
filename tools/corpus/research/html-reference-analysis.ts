/**
 * Cycle 19/20: population analysis and implementation audit of HTML.NAME
 * dependencies.
 *
 * Read-only. Uses the completed local HCDEV snapshot plus the latest completed
 * 30,209-definition corpus result run. It invokes the current local encoder but
 * does not connect to Oracle or write corpus results.
 *
 * Usage:
 *   npx tsx tools/corpus/research/html-reference-analysis.ts
 *   npx tsx tools/corpus/research/html-reference-analysis.ts --csv
 */

import crypto from 'node:crypto';

import Database from 'better-sqlite3';

import { decodeProgram } from '../../../src/peoplecode/decoder';
import {
  encodeProgramArtifacts,
  type PeopleCodeReference
} from '../../../src/peoplecode/encoder';
import { NameTable } from '../../../src/peoplecode/progtext';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { openSnapshotDatabase } from '../snapshot/store';
import type { SnapshotDefinition, SnapshotNameRow } from '../snapshot/types';

const APPLICATION_CLASS_OBJECT_ID = 104;

interface SourceOccurrence {
  definitionId: number;
  displayName: string;
  isApplicationClass: boolean;
  sourceOffset: number;
  name: string;
  caller: string;
  argumentPosition: number;
  callArity: number;
  callKey: string;
  statement: number;
  controlDepth: number;
  controlGroup: string;
  functionName?: string;
  methodName?: string;
}

interface StoredOccurrence {
  byteOffset: number;
  opcode: number;
  nameNum: number;
  row: SnapshotNameRow;
}

interface AlignedOccurrence extends SourceOccurrence {
  classification: string;
  byteOffset: number;
  opcode: number;
  nameNum: number;
  recname: string;
  refname: string;
  packageroot: string;
  qualifypath: string;
  appclassmethod: string;
  previousSameName?: AlignedOccurrence;
  allocation: 'FIRST' | 'NEW' | 'REUSE';
}

interface ContextState {
  functionName?: string;
  methodName?: string;
  blocks: number[];
}

interface ModelScore {
  label: string;
  explained: number;
  contradictions: number;
  contradictionExamples: string[];
}

interface BaselineResult {
  classification: string;
  generatedSha256?: string;
}

interface HtmlUse {
  name: string;
  sequence: number;
}

interface ImplementationAudit {
  definitionId: number;
  displayName: string;
  isApplicationClass: boolean;
  baseline: BaselineResult;
  success: boolean;
  error?: string;
  generatedSha256?: string;
  generatedChanged: boolean;
  generatedProgramExact: boolean;
  sourceOccurrenceCount: number;
  emittedUses: HtmlUse[];
  emittedRows: PeopleCodeReference[];
  operandAgreements: number;
  operandDisagreements: number;
  absoluteOperandAgreements: number;
  absoluteOperandDisagreements: number;
  rowShapeAgreements: number;
  rowShapeDisagreements: number;
  repeatedDecisionAgreements: number;
  repeatedDecisionDisagreements: number;
}

function sha256(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function ownerContext(definition: SnapshotDefinition): {
  recordName: string;
  fieldName: string;
  packagePath: string[];
} {
  const objectValues = [
    definition.objectvalue1,
    definition.objectvalue2,
    definition.objectvalue3,
    definition.objectvalue4,
    definition.objectvalue5,
    definition.objectvalue6,
    definition.objectvalue7
  ].map(value => value.trim());
  const eventIndex = objectValues.findIndex(
    value => value.toLowerCase() === 'onexecute'
  );

  return {
    recordName: objectValues[0],
    fieldName: objectValues[1],
    packagePath: objectValues
      .slice(0, eventIndex < 0 ? objectValues.length : eventIndex)
      .filter(Boolean)
  };
}

function isHtmlReference(reference: PeopleCodeReference): boolean {
  return reference.kind === 'record-field' &&
    reference.recordName?.toUpperCase() === 'HTML';
}

function auditImplementation(
  definition: SnapshotDefinition,
  expectedOccurrences: readonly AlignedOccurrence[],
  baseline: BaselineResult
): ImplementationAudit {
  const emittedUses: HtmlUse[] = [];
  const emittedRowsBySequence = new Map<number, PeopleCodeReference>();
  let generated: Buffer | undefined;
  let error: string | undefined;

  try {
    const encoded = encodeProgramArtifacts(definition.sourceText, {
      owner: ownerContext(definition),
      referenceTrace: event => {
        if (event.action !== 'USE' || !isHtmlReference(event.reference)) return;
        emittedUses.push({
          name: event.reference.fieldName ?? '',
          sequence: event.reference.sequence
        });
        emittedRowsBySequence.set(event.reference.sequence, event.reference);
      }
    });
    generated = encoded.program;
    for (const reference of encoded.references) {
      if (isHtmlReference(reference)) {
        emittedRowsBySequence.set(reference.sequence, reference);
      }
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  let operandAgreements = 0;
  let operandDisagreements = 0;
  let absoluteOperandAgreements = 0;
  let absoluteOperandDisagreements = 0;
  for (let index = 0; index < emittedUses.length; index++) {
    const expected = expectedOccurrences[index];
    const actual = emittedUses[index];
    if (
      expected !== undefined &&
      actual.name.toUpperCase() === expected.name.toUpperCase()
    ) {
      operandAgreements++;
      if (actual.sequence === expected.nameNum) absoluteOperandAgreements++;
      else absoluteOperandDisagreements++;
    } else {
      operandDisagreements++;
      absoluteOperandDisagreements++;
    }
  }

  const storedRowsBySequence = new Map(
    definition.names
      .filter(row => row.recname.trim().toUpperCase() === 'HTML')
      .map(row => [row.namenum, row] as const)
  );
  const emittedRows = [...emittedRowsBySequence.values()]
    .sort((a, b) => a.sequence - b.sequence);
  let rowShapeAgreements = 0;
  let rowShapeDisagreements = 0;
  for (const reference of emittedRows) {
    const useIndex = emittedUses.findIndex(
      use => use.sequence === reference.sequence
    );
    const expectedOccurrence = expectedOccurrences[useIndex];
    const stored = expectedOccurrence === undefined
      ? undefined
      : storedRowsBySequence.get(expectedOccurrence.nameNum);
    if (
      stored !== undefined &&
      reference.index === reference.sequence - 1 &&
      reference.kind === 'record-field' &&
      reference.recordName === stored.recname.trim() &&
      reference.fieldName === stored.refname.trim() &&
      stored.packageroot.trim() === '' &&
      stored.qualifypath.trim() === '' &&
      stored.appclassmethod.trim() === '' &&
      reference.eventName === undefined &&
      reference.packageName === undefined &&
      reference.objectName === undefined &&
      reference.packagePath === undefined &&
      reference.className === undefined &&
      reference.methodName === undefined
    ) {
      rowShapeAgreements++;
    } else {
      rowShapeDisagreements++;
    }
  }

  let repeatedDecisionAgreements = 0;
  let repeatedDecisionDisagreements = 0;
  const previousEmittedByName = new Map<string, HtmlUse>();
  for (let index = 0; index < emittedUses.length; index++) {
    const expected = expectedOccurrences[index];
    const actual = emittedUses[index];
    if (expected === undefined) continue;
    const key = expected.name.toLowerCase();
    const previousActual = previousEmittedByName.get(key);
    if (expected.previousSameName !== undefined) {
      const actualAllocation = previousActual?.sequence === actual.sequence
        ? 'REUSE'
        : 'NEW';
      if (actualAllocation === expected.allocation) repeatedDecisionAgreements++;
      else repeatedDecisionDisagreements++;
    }
    previousEmittedByName.set(key, actual);
  }

  const generatedSha256 = generated === undefined ? undefined : sha256(generated);
  return {
    definitionId: definition.definitionId,
    displayName: definition.displayName,
    isApplicationClass: definition.objectid1 === APPLICATION_CLASS_OBJECT_ID,
    baseline,
    success: generated !== undefined,
    error,
    generatedSha256,
    generatedChanged:
      generatedSha256 !== undefined &&
      baseline.generatedSha256 !== undefined &&
      generatedSha256 !== baseline.generatedSha256,
    generatedProgramExact: generated?.equals(definition.storedProgram) === true,
    sourceOccurrenceCount: expectedOccurrences.length,
    emittedUses,
    emittedRows,
    operandAgreements,
    operandDisagreements,
    absoluteOperandAgreements,
    absoluteOperandDisagreements,
    rowShapeAgreements,
    rowShapeDisagreements,
    repeatedDecisionAgreements,
    repeatedDecisionDisagreements
  };
}

function maskNonCode(source: string): string {
  const chars = [...source];
  let i = 0;
  while (i < chars.length) {
    if (/^REM\b/i.test(source.slice(i))) {
      const lineBoundary = Math.max(source.lastIndexOf('\n', i - 1), source.lastIndexOf('\r', i - 1), source.lastIndexOf(';', i - 1));
      if (/^\s*$/.test(source.slice(lineBoundary + 1, i))) {
        const semicolon = source.indexOf(';', i);
        const stop = semicolon < 0 ? source.length : semicolon + 1;
        while (i < stop) {
          if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
          i++;
        }
        continue;
      }
    }
    const pair = `${chars[i] ?? ''}${chars[i + 1] ?? ''}`;
    if (pair === '/*' || pair === '<*' || pair === '/+') {
      const close = pair === '/*' ? '*/' : pair === '<*' ? '*>' : '+/';
      chars[i++] = ' ';
      chars[i++] = ' ';
      while (i < chars.length && `${chars[i]}${chars[i + 1] ?? ''}` !== close) {
        if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
        i++;
      }
      if (i < chars.length) chars[i++] = ' ';
      if (i < chars.length) chars[i++] = ' ';
      continue;
    }
    if (pair === '//') {
      chars[i++] = ' ';
      chars[i++] = ' ';
      while (i < chars.length && chars[i] !== '\n') chars[i++] = ' ';
      continue;
    }
    if (chars[i] === '"' || chars[i] === "'") {
      const quote = chars[i];
      chars[i++] = ' ';
      while (i < chars.length) {
        if (chars[i] === quote) {
          chars[i++] = ' ';
          if (chars[i] === quote) {
            chars[i++] = ' ';
            continue;
          }
          break;
        }
        if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
        i++;
      }
      continue;
    }
    i++;
  }
  return chars.join('');
}

function identifierBefore(source: string, offset: number): string | undefined {
  let i = offset - 1;
  while (i >= 0 && /\s/.test(source[i])) i--;
  const end = i + 1;
  while (i >= 0 && /[A-Za-z0-9_$#]/.test(source[i])) i--;
  const value = source.slice(i + 1, end);
  return /^[A-Za-z_$][A-Za-z0-9_$#]*$/.test(value) ? value : undefined;
}

function enclosingCall(masked: string, offset: number): {
  caller: string;
  argumentPosition: number;
  callArity: number;
  callKey: string;
} {
  const stack: Array<{ open: number; caller?: string; commas: number }> = [];
  for (let i = 0; i < offset; i++) {
    if (masked[i] === '(') {
      stack.push({ open: i, caller: identifierBefore(masked, i), commas: 0 });
    } else if (masked[i] === ',' && stack.length > 0) {
      stack[stack.length - 1].commas++;
    } else if (masked[i] === ')') {
      stack.pop();
    }
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].caller !== undefined) {
      let depth = 1;
      let commas = 0;
      let close = stack[i].open + 1;
      for (; close < masked.length; close++) {
        if (masked[close] === '(') depth++;
        else if (masked[close] === ')') {
          depth--;
          if (depth === 0) break;
        } else if (masked[close] === ',' && depth === 1) commas++;
      }
      const empty = masked.slice(stack[i].open + 1, close).trim() === '';
      return {
        caller: stack[i].caller!,
        argumentPosition: stack[i].commas + 1,
        callArity: empty ? 0 : commas + 1,
        callKey: `${stack[i].open}:${stack[i].caller!.toLowerCase()}`
      };
    }
  }
  return { caller: '(none)', argumentPosition: 0, callArity: 0, callKey: '(none)' };
}

function sourceContextAt(masked: string, offset: number): ContextState {
  const state: ContextState = { blocks: [] };
  let nextBlock = 1;
  const tokenPattern = /\b(?:end-function|end-method|end-if|end-for|end-while|end-evaluate|end-try|function|method|if|for|while|evaluate|try)\b(?:\s+([A-Za-z_][A-Za-z0-9_$#]*))?/gi;
  for (const match of masked.slice(0, offset).matchAll(tokenPattern)) {
    const keyword = match[0].trim().split(/\s+/)[0].toLowerCase();
    const name = match[1];
    if (keyword === 'function') state.functionName = name;
    else if (keyword === 'method') state.methodName = name;
    else if (keyword === 'end-function') state.functionName = undefined;
    else if (keyword === 'end-method') state.methodName = undefined;
    else if (/^end-/.test(keyword)) state.blocks.pop();
    else if (/^(?:if|for|while|evaluate|try)$/.test(keyword)) state.blocks.push(nextBlock++);
  }
  return state;
}

function statementOrdinal(masked: string, offset: number): number {
  let count = 0;
  for (let i = 0; i < offset; i++) if (masked[i] === ';') count++;
  return count;
}

function sourceOccurrences(definition: SnapshotDefinition): SourceOccurrence[] {
  const masked = maskNonCode(definition.sourceText);
  const occurrences: SourceOccurrence[] = [];
  for (const match of masked.matchAll(/(?<![A-Za-z0-9_&])HTML\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/gi)) {
    const sourceOffset = match.index ?? 0;
    const call = enclosingCall(masked, sourceOffset);
    const context = sourceContextAt(masked, sourceOffset);
    occurrences.push({
      definitionId: definition.definitionId,
      displayName: definition.displayName,
      isApplicationClass: definition.objectid1 === APPLICATION_CLASS_OBJECT_ID,
      sourceOffset,
      name: match[1],
      caller: call.caller,
      argumentPosition: call.argumentPosition,
      callArity: call.callArity,
      callKey: call.callKey,
      statement: statementOrdinal(masked, sourceOffset),
      controlDepth: context.blocks.length,
      controlGroup: [
        context.functionName === undefined ? 'top' : `function:${context.functionName.toLowerCase()}`,
        context.methodName === undefined ? '' : `method:${context.methodName.toLowerCase()}`,
        `blocks:${context.blocks.join('/')}`
      ].filter(Boolean).join('|'),
      functionName: context.functionName,
      methodName: context.methodName
    });
  }
  return occurrences;
}

function rowDisplayName(row: SnapshotNameRow): string {
  const recname = row.recname.trim();
  const refname = row.refname.trim();
  if (recname !== '' && refname !== '') return `${recname}.${refname}`;
  return refname || recname;
}

function storedOccurrences(definition: SnapshotDefinition): StoredOccurrence[] {
  const names = new NameTable();
  const rows = new Map<number, SnapshotNameRow>();
  for (const row of definition.names) {
    names.add(row.namenum, rowDisplayName(row));
    rows.set(row.namenum, row);
  }
  const decoded = decodeProgram(definition.storedProgram, names, {
    mode: 'auto',
    isApplicationClass: definition.objectid1 === APPLICATION_CLASS_OBJECT_ID
  });
  const result: StoredOccurrence[] = [];
  for (const token of decoded.tokens) {
    if (token.nameNum === undefined) continue;
    const row = rows.get(token.nameNum);
    if (row?.recname.trim().toUpperCase() !== 'HTML') continue;
    result.push({
      byteOffset: token.offset,
      opcode: token.opcode,
      nameNum: token.nameNum,
      row
    });
  }
  return result;
}

function countBy<T>(values: readonly T[], key: (value: T) => string): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const label = key(value);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function printCounts(label: string, counts: Record<string, number>): void {
  console.log(`\n${label}`);
  for (const [name, count] of Object.entries(counts)) console.log(`  ${name}: ${count}`);
}

function sameUnit(a: AlignedOccurrence, b: AlignedOccurrence): boolean {
  return a.functionName?.toLowerCase() === b.functionName?.toLowerCase() &&
    a.methodName?.toLowerCase() === b.methodName?.toLowerCase();
}

function transitionCategory(current: AlignedOccurrence): string {
  const previous = current.previousSameName;
  if (previous === undefined) return 'first occurrence';
  if (previous.callKey === current.callKey) return 'same call/expression';
  if (previous.statement === current.statement && sameUnit(previous, current)) return 'same statement';
  if (!sameUnit(previous, current)) {
    if (previous.methodName?.toLowerCase() !== current.methodName?.toLowerCase()) return 'different method';
    return 'different function';
  }
  if (previous.controlGroup === current.controlGroup) {
    if (current.statement === previous.statement + 1) return 'sequential statements, same control group';
    return 'same control group';
  }
  return 'different control groups';
}

function inferredHtmlNamespace(occurrence: AlignedOccurrence): string {
  if (occurrence.isApplicationClass) return 'application-class compilation unit';
  if (occurrence.functionName !== undefined) {
    return `function:${occurrence.functionName.toLowerCase()}`;
  }
  const outerBlock = /blocks:([^/|]+)/.exec(occurrence.controlGroup)?.[1];
  return outerBlock === undefined || outerBlock === ''
    ? 'ordinary top-level flat region'
    : `ordinary top-level control group:${outerBlock}`;
}

function scoreModel(
  aligned: readonly AlignedOccurrence[],
  label: string,
  predictedReuse: (current: AlignedOccurrence, previous: AlignedOccurrence) => boolean
): ModelScore {
  let explained = 0;
  let contradictions = 0;
  const contradictionExamples: string[] = [];
  for (const current of aligned) {
    const previous = current.previousSameName;
    if (previous === undefined) continue;
    const predicted = predictedReuse(current, previous) ? 'REUSE' : 'NEW';
    if (predicted === current.allocation) explained++;
    else {
      contradictions++;
      if (contradictionExamples.length < 8) {
        contradictionExamples.push(
          `${current.definitionId}:${current.name}@${current.sourceOffset} ` +
          `pred=${predicted} stored=${current.allocation} prev=${previous.nameNum} now=${current.nameNum} ` +
          `(${transitionCategory(current)})`
        );
      }
    }
  }
  return { label, explained, contradictions, contradictionExamples };
}

function csv(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function main(): void {
  const snapshotDb = openSnapshotDatabase();
  const definitions = listSnapshotDefinitions(snapshotDb);
  snapshotDb.close();

  const resultDb = new Database('tools/corpus/corpus-results.sqlite', { readonly: true });
  const fullRun = resultDb.prepare(`
    SELECT run_id, git_commit, definitions, exact_count
    FROM corpus_run
    WHERE completed_at IS NOT NULL AND definitions = 30209
    ORDER BY run_id DESC
    LIMIT 1
  `).get() as { run_id: number; git_commit: string; definitions: number; exact_count: number } | undefined;
  if (fullRun === undefined) throw new Error('No completed 30,209-definition corpus run found.');
  const baselineStatement = resultDb.prepare(`
    SELECT classification, generated_sha256 AS generatedSha256
    FROM result
    WHERE run_id = ? AND definition_id = ?
  `);

  const sourceAll: SourceOccurrence[] = [];
  const storedAll: Array<StoredOccurrence & { definitionId: number }> = [];
  const aligned: AlignedOccurrence[] = [];
  const unaligned: Array<{ definitionId: number; source: string[]; stored: string[] }> = [];
  const baselineByDefinitionId = new Map<number, BaselineResult>();
  let definitionsWithSource = 0;
  let definitionsWithStoredRows = 0;

  for (const definition of definitions) {
    const source = sourceOccurrences(definition);
    const stored = storedOccurrences(definition);
    if (source.length > 0) definitionsWithSource++;
    if (definition.names.some(row => row.recname.trim().toUpperCase() === 'HTML')) definitionsWithStoredRows++;
    sourceAll.push(...source);
    storedAll.push(...stored.map(item => ({ ...item, definitionId: definition.definitionId })));
    if (source.length === 0 && stored.length === 0) continue;

    const sourceNames = source.map(item => item.name.toUpperCase());
    const storedNames = stored.map(item => item.row.refname.trim().toUpperCase());
    if (sourceNames.join('\0') !== storedNames.join('\0')) {
      unaligned.push({ definitionId: definition.definitionId, source: sourceNames, stored: storedNames });
      continue;
    }

    const baseline = baselineStatement.get(
      fullRun.run_id,
      definition.definitionId
    ) as BaselineResult | undefined;
    const classification = baseline?.classification ?? '(missing)';
    baselineByDefinitionId.set(definition.definitionId, {
      classification,
      generatedSha256: baseline?.generatedSha256
    });
    const previousByName = new Map<string, AlignedOccurrence>();
    const usedNameNums = new Set<number>();
    source.forEach((occurrence, index) => {
      const storedOccurrence = stored[index];
      const key = occurrence.name.toLowerCase();
      const previousSameName = previousByName.get(key);
      const item: AlignedOccurrence = {
        ...occurrence,
        classification,
        byteOffset: storedOccurrence.byteOffset,
        opcode: storedOccurrence.opcode,
        nameNum: storedOccurrence.nameNum,
        recname: storedOccurrence.row.recname.trim(),
        refname: storedOccurrence.row.refname.trim(),
        packageroot: storedOccurrence.row.packageroot.trim(),
        qualifypath: storedOccurrence.row.qualifypath.trim(),
        appclassmethod: storedOccurrence.row.appclassmethod.trim(),
        previousSameName,
        allocation: previousSameName === undefined
          ? 'FIRST'
          : usedNameNums.has(storedOccurrence.nameNum) ? 'REUSE' : 'NEW'
      };
      aligned.push(item);
      previousByName.set(key, item);
      usedNameNums.add(storedOccurrence.nameNum);
    });
  }
  resultDb.close();

  const uniqueNames = new Set(sourceAll.map(item => item.name.toUpperCase()));
  const sourceDefinitionIds = new Set(sourceAll.map(item => item.definitionId));
  const alignedDefinitionIds = new Set(aligned.map(item => item.definitionId));
  const repeated = aligned.filter(item => item.previousSameName !== undefined);
  const first = aligned.filter(item => item.previousSameName === undefined);
  const htmlRows = definitions.flatMap(definition => definition.names
    .filter(row => row.recname.trim().toUpperCase() === 'HTML')
    .map(row => ({ definitionId: definition.definitionId, row })));
  const referencedKeys = new Set(storedAll.map(item => `${item.definitionId}:${item.nameNum}`));
  const unreferencedRows = htmlRows.filter(item => !referencedKeys.has(`${item.definitionId}:${item.row.namenum}`));

  const alignedByDefinitionId = new Map<number, AlignedOccurrence[]>();
  for (const occurrence of aligned) {
    const definitionOccurrences = alignedByDefinitionId.get(occurrence.definitionId) ?? [];
    definitionOccurrences.push(occurrence);
    alignedByDefinitionId.set(occurrence.definitionId, definitionOccurrences);
  }
  const implementationAudits = definitions
    .filter(definition => sourceDefinitionIds.has(definition.definitionId))
    .map(definition => auditImplementation(
      definition,
      alignedByDefinitionId.get(definition.definitionId) ?? [],
      baselineByDefinitionId.get(definition.definitionId) ?? {
        classification: '(missing)'
      }
    ));

  console.log('=== Cycle 19 HTML.NAME population ===');
  console.log(`Snapshot definitions: ${definitions.length}`);
  console.log(`Latest full classification run: ${fullRun.run_id} (${fullRun.git_commit.slice(0, 7)}), exact ${fullRun.exact_count}/${fullRun.definitions}`);
  console.log(`Definitions with source HTML.NAME: ${definitionsWithSource}`);
  console.log(`Source occurrences: ${sourceAll.length}`);
  console.log(`Unique HTML names: ${uniqueNames.size}`);
  console.log(`Definitions with stored RECNAME=HTML rows: ${definitionsWithStoredRows}`);
  console.log(`Stored HTML rows: ${htmlRows.length}`);
  console.log(`Decoded stored HTML operands: ${storedAll.length}`);
  console.log(`Safely aligned definitions: ${alignedDefinitionIds.size}/${sourceDefinitionIds.size}`);
  console.log(`Safely aligned occurrences: ${aligned.length}/${sourceAll.length}`);
  console.log(`Unaligned definitions: ${unaligned.length}`);
  console.log(`Unreferenced stored HTML rows: ${unreferencedRows.length}`);
  printCounts('Source caller distribution', countBy(sourceAll, item => `${item.caller} arg${item.argumentPosition}`));
  printCounts('GetHTMLText form', countBy(sourceAll.filter(item => item.caller.toLowerCase() === 'gethtmltext'), item => item.callArity === 1 ? 'GetHTMLText(HTML.NAME)' : 'GetHTMLText(HTML.NAME, ...)'));
  printCounts('Definition context', countBy(sourceAll, item => item.isApplicationClass ? 'Application Class' : 'ordinary PeopleCode'));
  printCounts('Definition count by context', countBy([...sourceDefinitionIds], id => definitions.find(definition => definition.definitionId === id)?.objectid1 === APPLICATION_CLASS_OBJECT_ID ? 'Application Class' : 'ordinary PeopleCode'));
  printCounts('Definition occurrence shape', countBy([...sourceDefinitionIds], id => {
    const occurrences = sourceAll.filter(item => item.definitionId === id);
    const names = new Set(occurrences.map(item => item.name.toLowerCase()));
    if (occurrences.length === 1) return 'single occurrence';
    if (occurrences.length === names.size) return 'multiple occurrences, all distinct';
    return 'repeated same name';
  }));
  printCounts('Definition classification', countBy([...sourceDefinitionIds], id => aligned.find(item => item.definitionId === id)?.classification ?? '(unaligned)'));
  printCounts('Occurrence classification', countBy(aligned, item => item.classification));
  printCounts('Stored HTML row shape', countBy(htmlRows, item => {
    const row = item.row;
    return `REC=${row.recname.trim() || '(blank)'} REF=${row.refname.trim() ? '<name>' : '(blank)'} PACKAGE=${row.packageroot.trim() || '(blank)'} QUALIFY=${row.qualifypath.trim() || '(blank)'} METHOD=${row.appclassmethod.trim() || '(blank)'}`;
  }));
  printCounts('Stored operand opcode', countBy(storedAll, item => `0x${item.opcode.toString(16).padStart(2, '0')}`));
  printCounts('Repeated same-name outcome', countBy(repeated, item => item.allocation));
  printCounts('Repeated same-name transition/outcome', countBy(repeated, item => `${transitionCategory(item)} -> ${item.allocation}`));
  printCounts('Repeated transition/outcome by program kind', countBy(repeated, item => `${item.isApplicationClass ? 'Application Class' : 'ordinary'}: ${transitionCategory(item)} -> ${item.allocation}`));
  const repeatedWithinCall = repeated.filter(item => item.previousSameName?.callKey === item.callKey);
  console.log(`\nRepeated same HTML name within one call: ${repeatedWithinCall.length}`);
  console.log(`Allocated HTML identities (FIRST + NEW): ${first.length + repeated.filter(item => item.allocation === 'NEW').length}`);
  console.log(`Stored HTML rows: ${htmlRows.length}`);
  const identityRows = new Map<string, Set<number>>();
  const rowIdentities = new Map<string, Set<string>>();
  for (const item of aligned) {
    const identity = `${item.definitionId}:${inferredHtmlNamespace(item)}:${item.name.toLowerCase()}`;
    const row = `${item.definitionId}:${item.nameNum}`;
    if (!identityRows.has(identity)) identityRows.set(identity, new Set());
    identityRows.get(identity)!.add(item.nameNum);
    if (!rowIdentities.has(row)) rowIdentities.set(row, new Set());
    rowIdentities.get(row)!.add(identity);
  }
  console.log(`Distinct inferred (namespace, HTML name) identities: ${identityRows.size}`);
  console.log(`Identities mapping to multiple rows: ${[...identityRows.values()].filter(rows => rows.size !== 1).length}`);
  console.log(`Rows mapping to multiple identities: ${[...rowIdentities.values()].filter(identities => identities.size !== 1).length}`);
  printCounts('Allocated identity by program kind', countBy(aligned.filter(item => item.allocation !== 'REUSE'), item => item.isApplicationClass ? 'Application Class' : 'ordinary PeopleCode'));
  const crossCaller = repeated.filter(item => item.previousSameName?.caller.toLowerCase() !== item.caller.toLowerCase());
  console.log(`Cross-caller repeated same-name transitions: ${crossCaller.length}`);
  if (crossCaller.length > 0) {
    printCounts('Cross-caller repeated same-name outcome', countBy(crossCaller, item => `${item.previousSameName!.caller} -> ${item.caller}: ${item.allocation}`));
  }

  const models = [
    scoreModel(aligned, 'global HTML-name identity', () => true),
    scoreModel(aligned, 'unit-aware HTML identity', (current, previous) => inferredHtmlNamespace(current) === inferredHtmlNamespace(previous)),
    scoreModel(aligned, '(source lexical controlGroup, HTML name)', (current, previous) => current.controlGroup === previous.controlGroup && sameUnit(current, previous)),
    scoreModel(aligned, 'statement-local HTML-name identity', (current, previous) => current.statement === previous.statement && sameUnit(current, previous)),
    scoreModel(aligned, 'occurrence identity (always NEW)', () => false)
  ];
  console.log('\nCandidate identity scores (repeated same-name transitions only)');
  for (const model of models) {
    console.log(`  ${model.label}: explained=${model.explained}, contradictions=${model.contradictions}`);
    for (const example of model.contradictionExamples) console.log(`    ${example}`);
  }

  const successfulAudits = implementationAudits.filter(item => item.success);
  const failedAudits = implementationAudits.filter(item => !item.success);
  const comparableGeneratedAudits = successfulAudits.filter(
    item => item.baseline.generatedSha256 !== undefined
  );
  const exactRegressions = implementationAudits.filter(
    item => item.baseline.classification === 'EXACT' && !item.generatedProgramExact
  );
  const newlyExact = implementationAudits.filter(
    item => item.baseline.classification !== 'EXACT' && item.generatedProgramExact
  );
  const operandAgreements = implementationAudits.reduce(
    (sum, item) => sum + item.operandAgreements,
    0
  );
  const operandDisagreements = implementationAudits.reduce(
    (sum, item) => sum + item.operandDisagreements,
    0
  );
  const absoluteOperandAgreements = implementationAudits.reduce(
    (sum, item) => sum + item.absoluteOperandAgreements,
    0
  );
  const absoluteOperandDisagreements = implementationAudits.reduce(
    (sum, item) => sum + item.absoluteOperandDisagreements,
    0
  );
  const emittedUseCount = implementationAudits.reduce(
    (sum, item) => sum + item.emittedUses.length,
    0
  );
  const rowShapeAgreements = implementationAudits.reduce(
    (sum, item) => sum + item.rowShapeAgreements,
    0
  );
  const rowShapeDisagreements = implementationAudits.reduce(
    (sum, item) => sum + item.rowShapeDisagreements,
    0
  );
  const emittedRowCount = implementationAudits.reduce(
    (sum, item) => sum + item.emittedRows.length,
    0
  );
  const repeatedDecisionAgreements = implementationAudits.reduce(
    (sum, item) => sum + item.repeatedDecisionAgreements,
    0
  );
  const repeatedDecisionDisagreements = implementationAudits.reduce(
    (sum, item) => sum + item.repeatedDecisionDisagreements,
    0
  );

  console.log('\n=== Cycle 20 current-encoder implementation audit ===');
  console.log(`HTML definitions audited: ${implementationAudits.length}`);
  console.log(`Complete current encodes: ${successfulAudits.length}`);
  console.log(`Current encode errors: ${failedAudits.length}`);
  console.log(`Observed HTML operands: ${emittedUseCount}/${sourceAll.length}`);
  console.log(`HTML operand name agreements: ${operandAgreements}`);
  console.log(`HTML operand name disagreements: ${operandDisagreements}`);
  console.log(`Absolute NAMENUM agreements: ${absoluteOperandAgreements}`);
  console.log(`Absolute NAMENUM disagreements (includes unrelated prior-reference drift): ${absoluteOperandDisagreements}`);
  console.log(`Observed emitted HTML rows: ${emittedRowCount}/${htmlRows.length}`);
  console.log(`HTML row-shape agreements: ${rowShapeAgreements}`);
  console.log(`HTML row-shape disagreements: ${rowShapeDisagreements}`);
  console.log(`Observed repeated decisions: ${repeatedDecisionAgreements + repeatedDecisionDisagreements}/${repeated.length}`);
  console.log(`Repeated-decision agreements: ${repeatedDecisionAgreements}`);
  console.log(`Repeated-decision disagreements: ${repeatedDecisionDisagreements}`);
  console.log(`Comparable generated SHA results: ${comparableGeneratedAudits.length}`);
  console.log(`Changed generated programs: ${comparableGeneratedAudits.filter(item => item.generatedChanged).length}`);
  console.log(`Newly exact HTML definitions: ${newlyExact.length}`);
  console.log(`Previously exact HTML regressions: ${exactRegressions.length}`);

  if (failedAudits.length > 0) {
    printCounts(
      'Current HTML-definition encode errors',
      countBy(failedAudits, item => item.error ?? '(unknown)')
    );
  }

  const implementationDisagreements = implementationAudits.filter(item =>
    item.operandDisagreements > 0 ||
    item.rowShapeDisagreements > 0 ||
    item.repeatedDecisionDisagreements > 0
  );
  if (implementationDisagreements.length > 0) {
    console.log('\nImplementation disagreement definitions');
    for (const item of implementationDisagreements) {
      console.log(
        `  ${item.definitionId} ${item.displayName}: ` +
        `operand=${item.operandDisagreements} ` +
        `row=${item.rowShapeDisagreements} ` +
        `lifetime=${item.repeatedDecisionDisagreements}`
      );
    }
  }

  if (exactRegressions.length > 0) {
    console.log('\nPreviously exact HTML regressions');
    for (const item of exactRegressions) {
      console.log(`  ${item.definitionId} ${item.displayName}`);
    }
  }

  console.log('\nMatched controls');
  const controls: Array<[string, AlignedOccurrence | undefined]> = [
    ['single HTML reference', aligned.find(item => !aligned.some(other => other.definitionId === item.definitionId && other !== item))],
    ['same-name REUSE', repeated.find(item => item.allocation === 'REUSE')],
    ['same-name NEW', repeated.find(item => item.allocation === 'NEW')],
    ['cross-method REUSE', repeated.find(item => item.allocation === 'REUSE' && transitionCategory(item) === 'different method')],
    ['top-level control-region NEW', repeated.find(item => item.allocation === 'NEW' && transitionCategory(item) === 'different control groups')],
    ['multiple distinct names', aligned.find(item => new Set(aligned.filter(other => other.definitionId === item.definitionId).map(other => other.name.toLowerCase())).size > 1)],
    ['direct HTML.NAME outside a call', aligned.find(item => item.caller === '(none)')],
    ['Application Class', aligned.find(item => item.isApplicationClass)],
    ['ordinary PeopleCode', aligned.find(item => !item.isApplicationClass)]
  ];
  for (const [label, item] of controls) {
    console.log(`  ${label}: ${item === undefined ? '(none)' : `${item.definitionId} ${item.displayName} ${item.name} NAMENUM=${item.nameNum} opcode=0x${item.opcode.toString(16)} ${item.allocation}`}`);
  }

  if (unaligned.length > 0) {
    console.log('\nUnaligned/counterexample population');
    for (const item of unaligned) {
      console.log(`  ${item.definitionId}: source=[${item.source.join(',')}] stored=[${item.stored.join(',')}]`);
    }
  }
  if (unreferencedRows.length > 0) {
    console.log('\nUnreferenced stored HTML rows');
    for (const item of unreferencedRows) console.log(`  ${item.definitionId}: NAMENUM=${item.row.namenum} ${rowDisplayName(item.row)}`);
  }

  if (process.argv.includes('--csv')) {
    console.log('\nCSV');
    const headers = [
      'definition_id', 'display_name', 'classification', 'application_class',
      'source_offset', 'html_name', 'caller', 'argument_position', 'call_arity', 'statement',
      'control_group', 'control_depth', 'function', 'method', 'byte_offset',
      'opcode', 'namenum', 'recname', 'refname', 'packageroot', 'qualifypath',
      'appclassmethod', 'previous_source_offset', 'previous_namenum',
      'transition', 'allocation'
    ];
    console.log(headers.join(','));
    for (const item of aligned) {
      console.log([
        item.definitionId, item.displayName, item.classification, item.isApplicationClass,
        item.sourceOffset, item.name, item.caller, item.argumentPosition, item.callArity, item.statement,
        item.controlGroup, item.controlDepth, item.functionName, item.methodName,
        item.byteOffset, `0x${item.opcode.toString(16)}`, item.nameNum,
        item.recname, item.refname, item.packageroot, item.qualifypath,
        item.appclassmethod, item.previousSameName?.sourceOffset,
        item.previousSameName?.nameNum, transitionCategory(item), item.allocation
      ].map(csv).join(','));
    }
  }
}

main();
