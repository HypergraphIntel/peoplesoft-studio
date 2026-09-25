/**
 * Phase 2A: cluster the residual disagreement population (the cases the
 * flatTopLevel rule from the last checkpoint does NOT explain) across
 * FetchValue, ActiveRowCount, ScrollFlush, and GetRecord.
 *
 * For every disagreement, classifies:
 *  - quadrant: which of {functionDepth>0 x controlDepth>0} the CURRENT
 *    occurrence sits in (1-func-only, 2-depth-only, 3-both, 4-flat)
 *  - constructSubtype: the innermost control construct (If/Evaluate/For/
 *    While/Repeat/Try) when controlDepth>0
 *  - establishmentRelation: where the PREVIOUS matching reference sits
 *    relative to the current occurrence's own scope chain (same
 *    statement, earlier statement same scope, sibling branch, an
 *    enclosing header/condition, an enclosing body, an enclosing
 *    Function/Method, or the reverse -- current has exited back out to a
 *    parent scope relative to where the previous one was)
 *
 * Read-only research infrastructure. Does not touch encoder/decoder
 * decision logic.
 *
 * Usage:
 *   tsx tools/corpus/research/residual-cluster-analysis.ts \
 *     --family FetchValue:fetchvalue:0 \
 *     --family ActiveRowCount:activerowcount:0 \
 *     --family ScrollFlush:^ScrollFlush$: \
 *     --family GetRecord:getrecord: \
 *     --ids-file <path-per-family or combined>
 *
 * Simpler: pass one combined --definition-ids and a --call-filter/--arg-position
 * pair per invocation (mirrors getrecord-branch-analysis.ts), with
 * --family-label for the report.
 */

import fs from 'node:fs';

import {
  generateEvidence,
  GeneratedOccurrence,
  ScopeChainFrame
} from './reference-lifecycle';

import {
  openSnapshotDatabase
} from '../snapshot/store';

import {
  getSnapshotDefinition
} from '../snapshot/reader';

type Quadrant = '1-func-only' | '2-depth-only' | '3-both' | '4-flat';

function quadrantOf(occ: GeneratedOccurrence): Quadrant {
  const f = occ.functionDepth > 0;
  const d = occ.controlDepth > 0;
  if (f && !d) return '1-func-only';
  if (!f && d) return '2-depth-only';
  if (f && d) return '3-both';
  return '4-flat';
}

type EstablishmentRelation =
  | 'same-statement'
  | 'earlier-statement-same-scope'
  | 'sibling-branch'
  | 'enclosing-header-or-condition'
  | 'enclosing-body'
  | 'enclosing-function-or-method'
  | 'exited-to-parent-scope'
  | 'other-cross-frame';

function commonPrefixLength(a: ScopeChainFrame[], b: ScopeChainFrame[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i].id === b[i].id) i++;
  return i;
}

// Mirrors getrecord-branch-analysis.ts's own classifyRelationship, needed
// here too since this script computes establishmentRelation independently
// of that one's Relationship type.
function isSiblingBranch(a: GeneratedOccurrence, b: GeneratedOccurrence): boolean {
  if (a.branchPath === b.branchPath) return false;
  const aFrames = a.branchPath.split('>');
  const bFrames = b.branchPath.split('>');
  if (aFrames.length !== bFrames.length || aFrames.length === 0) return false;
  const aParent = aFrames.slice(0, -1).join('>');
  const bParent = bFrames.slice(0, -1).join('>');
  const aLastId = aFrames[aFrames.length - 1].split(':')[0];
  const bLastId = bFrames[bFrames.length - 1].split(':')[0];
  return aParent === bParent && aLastId === bLastId;
}

function classifyEstablishment(
  prev: GeneratedOccurrence,
  curr: GeneratedOccurrence
): EstablishmentRelation {
  if (prev.branchPath === curr.branchPath) {
    return prev.blockStatementIndex === curr.blockStatementIndex
      ? 'same-statement'
      : 'earlier-statement-same-scope';
  }

  if (isSiblingBranch(prev, curr)) {
    return 'sibling-branch';
  }

  const prevChain = prev.scopeChain;
  const currChain = curr.scopeChain;
  const common = commonPrefixLength(prevChain, currChain);

  if (common === prevChain.length && prevChain.length < currChain.length) {
    // prev sits at or above the point where curr's extra nesting begins.
    const prevInnermost = prevChain[prevChain.length - 1];
    if (prevInnermost === undefined) {
      return 'enclosing-body'; // prev at program top level
    }
    if (prevInnermost.type === 'Function' || prevInnermost.type === 'Method') {
      return 'enclosing-function-or-method';
    }
    if (prevInnermost.phase === 'header' || prevInnermost.phase === 'condition') {
      return 'enclosing-header-or-condition';
    }
    return 'enclosing-body';
  }

  if (common === currChain.length && currChain.length < prevChain.length) {
    return 'exited-to-parent-scope';
  }

  return 'other-cross-frame';
}

interface PairRecord {
  family: string;
  definitionId: number;
  displayName: string;
  occurrenceIndex: number;
  agree: boolean;
  quadrant: Quadrant;
  constructSubtype?: string;
  establishmentRelation: EstablishmentRelation;
  argumentPosition?: number;
  kind: string;
  storedDecision: string;
  generatedDecision: string;
  intervening: string[];
  hadRowScrollFamilyIntervening: boolean;
  controlDepth: number;
  functionDepth: number;
  controlGroup: number;
}

const ROW_SCROLL_FAMILY = new Set([
  'RowScrollSelect',
  'RowScrollSelectNew',
  'ScrollSelect',
  'ScrollFlush'
]);

function analyzeFamily(
  family: string,
  definitionId: number,
  displayName: string,
  rows: ReturnType<typeof generateEvidence>['rows'],
  callFilter: RegExp,
  argPositionFilter?: number
): PairRecord[] {
  const byIdentity = new Map<string, typeof rows>();

  for (const row of rows) {
    const g = row.generated;
    if (g === undefined) continue;
    if (!callFilter.test(g.enclosingCall ?? '')) continue;
    if (argPositionFilter !== undefined && g.argumentPosition !== argPositionFilter) continue;

    const list = byIdentity.get(g.identityKey) ?? [];
    list.push(row);
    byIdentity.set(g.identityKey, list);
  }

  const out: PairRecord[] = [];

  for (const occurrenceRows of byIdentity.values()) {
    for (let i = 1; i < occurrenceRows.length; i++) {
      const prevRow = occurrenceRows[i - 1];
      const currRow = occurrenceRows[i];
      const prev = prevRow.generated!;
      const curr = currRow.generated!;

      if (currRow.decisionAgree !== true && currRow.decisionAgree !== false) {
        continue; // alignment lost / unknown
      }

      const intervening = curr.interveningIntrinsics;

      out.push({
        family,
        definitionId,
        displayName,
        occurrenceIndex: curr.occurrenceIndex,
        agree: currRow.decisionAgree,
        quadrant: quadrantOf(curr),
        constructSubtype: curr.controlDepth > 0 ? curr.controlConstruct : undefined,
        establishmentRelation: classifyEstablishment(prev, curr),
        argumentPosition: curr.argumentPosition,
        kind: curr.kind,
        storedDecision: currRow.stored?.decision ?? '?',
        generatedDecision: curr.decision,
        intervening,
        hadRowScrollFamilyIntervening: intervening.some(name => ROW_SCROLL_FAMILY.has(name)),
        controlDepth: curr.controlDepth,
        functionDepth: curr.functionDepth,
        controlGroup: curr.controlGroup
      });
    }
  }

  return out;
}

interface FamilySpec {
  label: string;
  callFilter: RegExp;
  argPosition?: number;
  idsFile: string;
}

function parseArgs(argv: string[]): FamilySpec[] {
  const specs: FamilySpec[] = [];

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--family') {
      const [label, filterStr, argPosStr, idsFile] = argv[++i].split('|');
      specs.push({
        label,
        callFilter: new RegExp(filterStr, 'i'),
        argPosition: argPosStr === '' || argPosStr === undefined ? undefined : Number(argPosStr),
        idsFile
      });
    }
  }

  return specs;
}

function main(): void {
  const specs = parseArgs(process.argv.slice(2));

  if (specs.length === 0) {
    throw new Error(
      'Usage: residual-cluster-analysis.ts --family "Label|regex|argPos|idsFile" [--family ...]\n' +
        '  argPos may be empty (no restriction). Example:\n' +
        '  --family "FetchValue|fetchvalue|0|/tmp/fv_ids.txt"'
    );
  }

  const db = openSnapshotDatabase();

  const allPairs: PairRecord[] = [];

  for (const spec of specs) {
    const idsText = fs.readFileSync(spec.idsFile, 'utf8');
    const ids = idsText
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(Number);

    let familyDisagreements = 0;
    let familyAgreeing = 0;

    for (const id of ids) {
      try {
        const definition = getSnapshotDefinition(db, id);
        const evidence = generateEvidence(id, definition);
        const records = analyzeFamily(
          spec.label,
          id,
          evidence.displayName,
          evidence.rows,
          spec.callFilter,
          spec.argPosition
        );
        allPairs.push(...records);
        familyDisagreements += records.filter(r => !r.agree).length;
        familyAgreeing += records.filter(r => r.agree).length;
      } catch {
        // skip
      }
    }

    console.log(
      `${spec.label}: ${familyDisagreements} disagreements, ${familyAgreeing} agreeing (${ids.length} definitions scanned)`
    );
  }

  db.close();

  const allDisagreements = allPairs.filter(r => !r.agree);
  const allAgreeing = allPairs.filter(r => r.agree);

  console.log(`\n=== Total: ${allDisagreements.length} disagreements / ${allPairs.length} pairs across all families ===\n`);

  const count = <T,>(items: T[], key: (t: T) => string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const item of items) {
      const k = key(item);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };

  const printBreakdown = (title: string, m: Map<string, number>): void => {
    console.log(`--- ${title} ---`);
    for (const [k, v] of [...m.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k}: ${v} (${(100 * v / allDisagreements.length).toFixed(1)}%)`);
    }
    console.log('');
  };

  printBreakdown('By quadrant', count(allDisagreements, d => d.quadrant));
  printBreakdown(
    'By quadrant x family',
    count(allDisagreements, d => `${d.quadrant} | ${d.family}`)
  );
  printBreakdown(
    'By constructSubtype (quadrant 2/3 only)',
    count(allDisagreements.filter(d => d.quadrant === '2-depth-only' || d.quadrant === '3-both'), d => d.constructSubtype ?? '(none)')
  );
  printBreakdown('By establishmentRelation', count(allDisagreements, d => d.establishmentRelation));
  printBreakdown(
    'By establishmentRelation x quadrant',
    count(allDisagreements, d => `${d.establishmentRelation} | ${d.quadrant}`)
  );
  printBreakdown(
    'By hadRowScrollFamilyIntervening',
    count(allDisagreements, d => String(d.hadRowScrollFamilyIntervening))
  );
  printBreakdown('By stored/generated direction', count(allDisagreements, d => `stored=${d.storedDecision} generated=${d.generatedDecision}`));

  // Candidate-rule quantification, same format as getrecord-branch-analysis.ts's
  // Phase 1A report: for each rule, how many disagreements does it explain,
  // how many correct pairs does it also touch (false positives).
  const rules: { name: string; predicate: (r: PairRecord) => boolean }[] = [
    { name: 'quadrant=4-flat', predicate: r => r.quadrant === '4-flat' },
    { name: 'quadrant!=4-flat (nested)', predicate: r => r.quadrant !== '4-flat' },
    { name: "establishmentRelation='earlier-statement-same-scope'", predicate: r => r.establishmentRelation === 'earlier-statement-same-scope' },
    {
      name: "quadrant=4-flat OR establishmentRelation='earlier-statement-same-scope' (union)",
      predicate: r => r.quadrant === '4-flat' || r.establishmentRelation === 'earlier-statement-same-scope'
    },
    {
      name: "establishmentRelation='earlier-statement-same-scope' AND quadrant!=4-flat (the nested residual specifically)",
      predicate: r => r.establishmentRelation === 'earlier-statement-same-scope' && r.quadrant !== '4-flat'
    },
    { name: "establishmentRelation='sibling-branch'", predicate: r => r.establishmentRelation === 'sibling-branch' },
    { name: 'hadRowScrollFamilyIntervening', predicate: r => r.hadRowScrollFamilyIntervening }
  ];

  console.log('--- Candidate-rule quantification (Phase 2A) ---');
  for (const rule of rules) {
    const explained = allDisagreements.filter(rule.predicate).length;
    const touched = allAgreeing.filter(rule.predicate).length;
    console.log(
      `\n${rule.name}:\n` +
        `  disagreements explained: ${explained} / ${allDisagreements.length} (${(100 * explained / allDisagreements.length).toFixed(1)}%)\n` +
        `  correct pairs touched:   ${touched} / ${allAgreeing.length} (${(100 * touched / allAgreeing.length).toFixed(1)}%)`
    );
  }

  console.log('\n--- Sample rows per quadrant (up to 5 each) ---');
  for (const q of ['1-func-only', '2-depth-only', '3-both', '4-flat'] as Quadrant[]) {
    const sample = allDisagreements.filter(d => d.quadrant === q).slice(0, 5);
    console.log(`\n${q}:`);
    for (const d of sample) {
      console.log(
        `  ${d.family} def ${d.definitionId} occ ${d.occurrenceIndex}: establishment=${d.establishmentRelation} ` +
          `construct=${d.constructSubtype ?? '-'} cDepth=${d.controlDepth} fDepth=${d.functionDepth} cGroup=${d.controlGroup} ` +
          `stored=${d.storedDecision} generated=${d.generatedDecision} intervening=[${d.intervening.join(',')}]`
      );
    }
  }
}

main();
