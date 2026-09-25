/**
 * Phase 2D: multi-argument interaction sweep.
 *
 * For every call in the sampled population that contains 2+
 * reference-bearing arguments (kind record/scroll/field/record-field),
 * records each argument position's identity, whether that identity
 * repeated an earlier argument in the SAME call / SAME statement / SAME
 * surrounding scope, and its stored vs. generated ALLOC/REUSE decision.
 * Tests whether argument position itself predicts disagreement, whether
 * repetition-within-the-same-call behaves differently from ordinary
 * repetition, and whether left-to-right order matters (does position 1's
 * outcome correlate with position 2's).
 *
 * Read-only research infrastructure. Does not touch encoder/decoder
 * decision logic.
 *
 * Usage:
 *   tsx tools/corpus/research/multiarg-interaction-analysis.ts --ids-file <path>
 */

import fs from 'node:fs';

import {
  generateEvidence,
  GeneratedOccurrence,
  PairedRow
} from './reference-lifecycle';

import {
  openSnapshotDatabase
} from '../snapshot/store';

import {
  getSnapshotDefinition
} from '../snapshot/reader';

const REFERENCE_BEARING_KINDS = new Set(['record', 'scroll', 'field', 'record-field']);

interface ArgRecord {
  definitionId: number;
  displayName: string;
  callName: string;
  callOpenParenIndex: number;
  totalArgsInCall: number; // count of reference-bearing args in this call
  argPosition: number; // 0-based, among reference-bearing args only (not raw comma position)
  identityKey: string;
  kind: string;
  repeatedInSameCall: boolean;
  repeatedInStatement: boolean;
  repeatedInScope: boolean;
  storedDecision: string;
  generatedDecision: string;
  agree: boolean;
  branchPath: string;
  blockStatementIndex: number;
  controlGroup: number;
  controlDepth: number;
  functionDepth: number;
}

function analyzeDefinition(
  definitionId: number,
  displayName: string,
  rows: PairedRow[]
): ArgRecord[] {
  // All reference-bearing generated occurrences, in source order, paired
  // with their stored decision when alignment is still trustworthy.
  const refRows = rows.filter(
    r =>
      r.generated !== undefined &&
      REFERENCE_BEARING_KINDS.has(r.generated.kind) &&
      r.generated.enclosingCallOpenParenIndex !== undefined &&
      (r.decisionAgree === true || r.decisionAgree === false)
  );

  // Group by call instance (definition-local: callName + openParenIndex),
  // to know each call's total reference-bearing argument count and each
  // row's 0-based position within its own call ahead of time.
  const byCall = new Map<string, { name: string; openParenIndex: number; rows: PairedRow[] }>();
  for (const row of refRows) {
    const g = row.generated!;
    const key = `${g.enclosingCall}@${g.enclosingCallOpenParenIndex}`;
    const entry = byCall.get(key) ?? {
      name: g.enclosingCall!,
      openParenIndex: g.enclosingCallOpenParenIndex!,
      rows: []
    };
    entry.rows.push(row);
    byCall.set(key, entry);
  }
  for (const entry of byCall.values()) {
    entry.rows.sort((a, b) => a.generated!.sourceOffset - b.generated!.sourceOffset);
  }

  const argPositionWithinCall = new Map<PairedRow, number>();
  const callSize = new Map<PairedRow, number>();
  for (const entry of byCall.values()) {
    entry.rows.forEach((row, i) => {
      argPositionWithinCall.set(row, i);
      callSize.set(row, entry.rows.length);
    });
  }

  // Single source-ordered pass: for EVERY reference-bearing occurrence
  // (not just multi-arg-call ones), check "seen before now" against the
  // running same-call/same-statement/same-scope pools BEFORE adding this
  // occurrence's own identity -- this is what makes repeatedIn* mean
  // "an earlier occurrence", not "any occurrence in the definition".
  const seenInStatement = new Map<string, Set<string>>(); // key: branchPath+stmt -> identities
  const seenInScope = new Map<string, Set<string>>(); // key: branchPath -> identities
  const seenInCall = new Map<string, Set<string>>(); // key: callOpenParenIndex -> identities

  const sortedRefRows = [...refRows].sort(
    (a, b) => a.generated!.sourceOffset - b.generated!.sourceOffset
  );

  const out: ArgRecord[] = [];

  for (const row of sortedRefRows) {
    const g = row.generated!;
    const size = callSize.get(row)!;
    const stmtKey = `${g.branchPath}#${g.blockStatementIndex}`;
    const scopeKey = g.branchPath;
    const callKey = String(g.enclosingCallOpenParenIndex);

    const stmtSet = seenInStatement.get(stmtKey) ?? new Set();
    const scopeSet = seenInScope.get(scopeKey) ?? new Set();
    const callSet = seenInCall.get(callKey) ?? new Set();

    if (size >= 2) {
      out.push({
        definitionId,
        displayName,
        callName: g.enclosingCall!,
        callOpenParenIndex: g.enclosingCallOpenParenIndex!,
        totalArgsInCall: size,
        argPosition: argPositionWithinCall.get(row)!,
        identityKey: g.identityKey,
        kind: g.kind,
        repeatedInSameCall: callSet.has(g.identityKey),
        repeatedInStatement: stmtSet.has(g.identityKey),
        repeatedInScope: scopeSet.has(g.identityKey),
        storedDecision: row.stored?.decision ?? '?',
        generatedDecision: g.decision,
        agree: row.decisionAgree === true,
        branchPath: g.branchPath,
        blockStatementIndex: g.blockStatementIndex,
        controlGroup: g.controlGroup,
        controlDepth: g.controlDepth,
        functionDepth: g.functionDepth
      });
    }

    stmtSet.add(g.identityKey);
    seenInStatement.set(stmtKey, stmtSet);
    scopeSet.add(g.identityKey);
    seenInScope.set(scopeKey, scopeSet);
    callSet.add(g.identityKey);
    seenInCall.set(callKey, callSet);
  }

  return out;
}

function parseArgs(argv: string[]): { idsFiles: string[] } {
  const idsFiles: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ids-file') {
      idsFiles.push(argv[++i]);
    }
  }
  return { idsFiles };
}

function main(): void {
  const { idsFiles } = parseArgs(process.argv.slice(2));

  if (idsFiles.length === 0) {
    throw new Error('Usage: multiarg-interaction-analysis.ts --ids-file <path> [--ids-file <path> ...]');
  }

  const ids = new Set<number>();
  for (const file of idsFiles) {
    for (const raw of fs.readFileSync(file, 'utf8').split(',')) {
      const n = Number(raw.trim());
      if (Number.isFinite(n) && n > 0) ids.add(n);
    }
  }

  const db = openSnapshotDatabase();

  const all: ArgRecord[] = [];
  let processed = 0;
  let errors = 0;

  for (const id of ids) {
    try {
      const definition = getSnapshotDefinition(db, id);
      const evidence = generateEvidence(id, definition);
      all.push(...analyzeDefinition(id, evidence.displayName, evidence.rows));
      processed++;
    } catch {
      errors++;
    }
  }

  db.close();

  console.log(
    `Processed ${processed}/${ids.size} definitions (${errors} errors). ` +
      `${all.length} argument-position records from multi-reference-argument calls.\n`
  );

  const disagree = all.filter(r => !r.agree);
  const agree = all.filter(r => r.agree);

  console.log(`Total: ${disagree.length} disagreeing argument-positions / ${all.length} (${(100 * disagree.length / all.length).toFixed(1)}%)\n`);

  const count = <T,>(items: T[], key: (t: T) => string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const item of items) {
      const k = key(item);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };

  const printBreakdown = (title: string, m: Map<string, number>, total: number): void => {
    console.log(`--- ${title} ---`);
    for (const [k, v] of [...m.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k}: ${v} (${(100 * v / total).toFixed(1)}%)`);
    }
    console.log('');
  };

  // A. argument-position semantics: does position 0/1/2/3+ differ?
  printBreakdown('Disagreement rate by argPosition (0-based)', count(disagree, r => `pos${r.argPosition}`), disagree.length);
  console.log('--- Base rate by argPosition (all records) ---');
  const posBase = new Map<number, { total: number; disagree: number }>();
  for (const r of all) {
    const e = posBase.get(r.argPosition) ?? { total: 0, disagree: 0 };
    e.total++;
    if (!r.agree) e.disagree++;
    posBase.set(r.argPosition, e);
  }
  for (const [pos, e] of [...posBase.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  pos${pos}: ${e.disagree}/${e.total} disagree (${(100 * e.disagree / e.total).toFixed(1)}%)`);
  }
  console.log('');

  // C/F: repeated-in-same-call vs not
  console.log('--- Disagreement rate by repeatedInSameCall ---');
  for (const val of [true, false]) {
    const subset = all.filter(r => r.repeatedInSameCall === val);
    const subDisagree = subset.filter(r => !r.agree).length;
    console.log(`  repeatedInSameCall=${val}: ${subDisagree}/${subset.length} disagree (${subset.length > 0 ? (100 * subDisagree / subset.length).toFixed(1) : '0.0'}%)`);
  }
  console.log('');

  console.log('--- Disagreement rate by repeatedInStatement (excluding same-call repeats) ---');
  for (const val of [true, false]) {
    const subset = all.filter(r => !r.repeatedInSameCall && r.repeatedInStatement === val);
    const subDisagree = subset.filter(r => !r.agree).length;
    console.log(`  repeatedInStatement=${val}: ${subDisagree}/${subset.length} disagree (${subset.length > 0 ? (100 * subDisagree / subset.length).toFixed(1) : '0.0'}%)`);
  }
  console.log('');

  console.log('--- Disagreement rate by repeatedInScope (excluding same-call/same-statement repeats) ---');
  for (const val of [true, false]) {
    const subset = all.filter(r => !r.repeatedInSameCall && !r.repeatedInStatement && r.repeatedInScope === val);
    const subDisagree = subset.filter(r => !r.agree).length;
    console.log(`  repeatedInScope=${val}: ${subDisagree}/${subset.length} disagree (${subset.length > 0 ? (100 * subDisagree / subset.length).toFixed(1) : '0.0'}%)`);
  }
  console.log('');

  // B: left-to-right dependency mutation -- within calls that have a
  // disagreement at ANY position, does the disagreement direction depend
  // on position?
  printBreakdown('Direction by argPosition (disagreements only)', count(disagree, r => `pos${r.argPosition}: stored=${r.storedDecision} generated=${r.generatedDecision}`), disagree.length);

  // Same-record-repeated-in-call vs different-records-in-call: F.
  const callHasRepeat = new Map<string, boolean>();
  for (const r of all) {
    const callKey = `${r.definitionId}:${r.callOpenParenIndex}`;
    if (r.repeatedInSameCall) callHasRepeat.set(callKey, true);
    else if (!callHasRepeat.has(callKey)) callHasRepeat.set(callKey, false);
  }
  const callsWithRepeat = new Set([...callHasRepeat.entries()].filter(([, v]) => v).map(([k]) => k));
  const recordsInRepeatCalls = all.filter(r => callsWithRepeat.has(`${r.definitionId}:${r.callOpenParenIndex}`));
  const recordsInDistinctCalls = all.filter(r => !callsWithRepeat.has(`${r.definitionId}:${r.callOpenParenIndex}`));
  console.log('--- Disagreement rate: calls with a repeated name vs calls with all-distinct names ---');
  console.log(`  calls-with-repeat args: ${recordsInRepeatCalls.filter(r => !r.agree).length}/${recordsInRepeatCalls.length} disagree (${recordsInRepeatCalls.length > 0 ? (100 * recordsInRepeatCalls.filter(r => !r.agree).length / recordsInRepeatCalls.length).toFixed(1) : '0.0'}%)`);
  console.log(`  all-distinct-name calls: ${recordsInDistinctCalls.filter(r => !r.agree).length}/${recordsInDistinctCalls.length} disagree (${recordsInDistinctCalls.length > 0 ? (100 * recordsInDistinctCalls.filter(r => !r.agree).length / recordsInDistinctCalls.length).toFixed(1) : '0.0'}%)`);
  console.log('');

  // Record vs Scroll kind mixtures
  printBreakdown('Disagreement rate by kind', count(disagree, r => r.kind), disagree.length);

  // By call name (which intrinsics actually show this pattern)
  printBreakdown('Disagreements by call name', count(disagree, r => r.callName), disagree.length);

  // Cross-check against the flatTopLevel rule from the prior checkpoints,
  // to see whether this broader multi-argument population is explained by
  // the SAME phenomenon rather than a distinct one.
  const flatTopLevel = (r: ArgRecord): boolean => r.controlDepth === 0 && r.functionDepth === 0;
  const flatExplained = disagree.filter(flatTopLevel).length;
  const flatTouched = agree.filter(flatTopLevel).length;
  console.log('--- Cross-check: does flatTopLevel already explain this dataset? ---');
  console.log(
    `  disagreements explained: ${flatExplained}/${disagree.length} (${(100 * flatExplained / disagree.length).toFixed(1)}%)\n` +
      `  correct pairs touched:   ${flatTouched}/${agree.length} (${(100 * flatTouched / agree.length).toFixed(1)}%)`
  );
  console.log('');

  console.log('--- Distinct definitions with a multi-argument disagreement ---');
  const defs = new Set(disagree.map(r => `${r.definitionId} (${r.displayName})`));
  console.log([...defs].sort().join('\n  '));

  console.log('\n--- Sample disagreement rows (up to 20) ---');
  for (const r of disagree.slice(0, 20)) {
    console.log(
      `  def ${r.definitionId} call=${r.callName} pos${r.argPosition}/${r.totalArgsInCall} ${r.identityKey} ` +
        `sameCall=${r.repeatedInSameCall} stmt=${r.repeatedInStatement} scope=${r.repeatedInScope} ` +
        `stored=${r.storedDecision} generated=${r.generatedDecision} cGroup=${r.controlGroup} cDepth=${r.controlDepth}`
    );
  }
}

main();
