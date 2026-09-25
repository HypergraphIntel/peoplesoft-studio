/**
 * Batch analysis: for a sample of definitions using GetRecord(Record.X) or
 * .GetRecord(Record.X)/.GETRECORD(Record.X), find every pair of CONSECUTIVE
 * generated occurrences sharing the same reference identity (kind +
 * recordName), classify the relationship between them using branchPath
 * (sibling-branch vs sequential vs cross-frame), and tabulate stored
 * decision x relationship. One in-process run over many definitions,
 * reusing generateEvidence directly instead of spawning the CLI per
 * definition.
 *
 * Read-only research infrastructure. Does not touch encoder/decoder
 * decision logic.
 *
 * Usage:
 *   tsx tools/corpus/research/getrecord-branch-analysis.ts --definition-ids 26,1420,...
 *   tsx tools/corpus/research/getrecord-branch-analysis.ts --from-file path/to/ids.txt
 */

import fs from 'node:fs';

import {
  generateEvidence,
  GeneratedOccurrence
} from './reference-lifecycle';

import {
  openSnapshotDatabase
} from '../snapshot/store';

import {
  getSnapshotDefinition,
  listSnapshotDefinitionIds
} from '../snapshot/reader';

type Relationship =
  | 'sequential' // same branchPath, later blockStatementIndex
  | 'sibling-branch' // branchPath diverges only in the last frame's branch label
  | 'cross-frame' // branchPath diverges at a frame other than the last (different loop iteration semantics, nested deeper, etc.)
  | 'same-statement'; // same branchPath AND same blockStatementIndex (two references in one statement)

function classifyRelationship(
  a: GeneratedOccurrence,
  b: GeneratedOccurrence
): Relationship {
  if (a.branchPath === b.branchPath) {
    return a.blockStatementIndex === b.blockStatementIndex
      ? 'same-statement'
      : 'sequential';
  }

  const aFrames = a.branchPath.split('>');
  const bFrames = b.branchPath.split('>');

  // Same frame stack up to the last entry, differing only in that last
  // entry's branch label (e.g. "If#10:Then" vs "If#10:Else",
  // "Evaluate#3:When1" vs "Evaluate#3:When2") -> sibling branches.
  if (aFrames.length === bFrames.length && aFrames.length > 0) {
    const aParent = aFrames.slice(0, -1).join('>');
    const bParent = bFrames.slice(0, -1).join('>');
    const aLastId = aFrames[aFrames.length - 1].split(':')[0];
    const bLastId = bFrames[bFrames.length - 1].split(':')[0];

    if (aParent === bParent && aLastId === bLastId) {
      return 'sibling-branch';
    }
  }

  return 'cross-frame';
}

interface AnalysisRow {
  definitionId: number;
  displayName: string;
  identityKey: string;
  fromOccurrence: number;
  toOccurrence: number;
  relationship: Relationship;
  storedDecision: 'ALLOC' | 'REUSE' | undefined;
  generatedDecision: 'ALLOC' | 'REUSE';
  agree: boolean | undefined;
  fromBranch: string;
  toBranch: string;
  fromStmt: number;
  toStmt: number;
  intervening: string[];
  enclosingCall?: string;
  /** Is the GetRecord call a postfix method call (<receiver>.GetRecord(...)) rather than a bare call (GetRecord(...))? */
  isPostfix?: boolean;
  fromSite: 'argument' | 'result-chain' | 'unknown';
  toSite: 'argument' | 'result-chain' | 'unknown';
  // Phase 1A fields (see .claude/corpus-progress.md's research-cycle
  // section): testing whether a header/body or loop-epoch boundary
  // between the two occurrences predicts the ALLOC/REUSE disagreement.
  fromConstruct: string;
  toConstruct: string;
  fromPhase: string;
  toPhase: string;
  /** True when the two occurrences sit in different phases (header/condition/body/top) of their respective innermost constructs -- generalizes "loop header vs body" to If-condition-vs-body, Evaluate-selector-vs-When, etc. */
  phaseChanged: boolean;
  /** True when at least one For/While/Repeat frame was entered between the two occurrences (loopEpochId differs) -- operationalizes "entering a loop creates a new reference epoch." */
  loopEpochChanged: boolean;
  /** True when both occurrences share the exact same innermost scopeId (same block). */
  sameScope: boolean;
  /**
   * True when the CURRENT occurrence sits at the encoder's own flat
   * program top level (controlDepth === 0 AND functionDepth === 0 --
   * genuinely no enclosing If/For/While/Evaluate AND no enclosing
   * Function/Method). Distinct from controlPhase/controlConstruct, which
   * come from this tool's OWN heuristic source scan; this field reads the
   * encoder's actual controlDepth/functionDepth counters directly.
   * Motivated by definitions 802 (agrees; FetchValue calls nested inside
   * a Function+For+If) vs 6352/1305/6403/12544 (disagree; FetchValue
   * calls at flat top level) -- see .claude/corpus-progress.md.
   */
  toIsFlatTopLevel: boolean;
  fromIsFlatTopLevel: boolean;
}

/**
 * Whether the GetRecord/GETRECORD call whose "(" is at `openParenIndex`
 * is written as a postfix method call (`<receiver>.GetRecord(...)`) rather
 * than a bare call (`GetRecord(...)`) -- i.e. whether a `.` (allowing
 * whitespace) immediately precedes the call name. This is the dimension
 * the branch-vs-sequential hypothesis turned out to actually hinge on, not
 * branch structure itself: see .claude/corpus-progress.md's research-cycle
 * section for the evidence trail.
 */
function isPostfixCall(source: string, callName: string, openParenIndex: number): boolean {
  const nameStart = openParenIndex - callName.length;
  const before = source.slice(Math.max(0, nameStart - 5), nameStart);
  return /\.\s*$/.test(before);
}

function findCallOpenParen(source: string, callName: string, beforeOffset: number): number | undefined {
  const window = source.slice(0, beforeOffset);
  const pattern = new RegExp(`\\b${callName}\\s*\\(`, 'gi');
  let lastEnd: number | undefined;
  for (const m of window.matchAll(pattern)) {
    lastEnd = (m.index ?? 0) + m[0].length - 1;
  }
  return lastEnd;
}

function callSite(
  source: string,
  occurrence: GeneratedOccurrence
): AnalysisRow['toSite'] {
  const open = occurrence.enclosingCallOpenParenIndex;
  if (open === undefined) return 'unknown';

  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '(') depth++;
    if (source[i] === ')') {
      depth--;
      if (depth === 0) {
        return occurrence.sourceOffset < i ? 'argument' : 'result-chain';
      }
    }
  }

  return 'unknown';
}

function analyzeDefinition(
  definitionId: number,
  displayName: string,
  source: string,
  rows: ReturnType<typeof generateEvidence>['rows'],
  callFilter: RegExp,
  argPositionFilter?: number,
  alignedOnly = false
): AnalysisRow[] {
  const out: AnalysisRow[] = [];

  // Only consider generated occurrences whose enclosing call matches the
  // requested filter (default GetRecord; also used for FetchValue with
  // argPositionFilter=0 to isolate its own leading Record.X/Scroll.X
  // argument, not every argument).
  const byIdentity = new Map<string, typeof rows>();

  for (const row of rows) {
    const g = row.generated;
    if (g === undefined) continue;
    if (alignedOnly && row.alignmentTrust !== 'aligned') continue;
    if (!callFilter.test(g.enclosingCall ?? '')) continue;
    if (argPositionFilter !== undefined && g.argumentPosition !== argPositionFilter) continue;

    const list = byIdentity.get(g.identityKey) ?? [];
    list.push(row);
    byIdentity.set(g.identityKey, list);
  }

  for (const [identityKey, occurrenceRows] of byIdentity) {
    for (let i = 1; i < occurrenceRows.length; i++) {
      const prevRow = occurrenceRows[i - 1];
      const currRow = occurrenceRows[i];
      const prev = prevRow.generated!;
      const curr = currRow.generated!;

      const openParen =
        curr.enclosingCall === undefined
          ? undefined
          : findCallOpenParen(source, curr.enclosingCall, curr.sourceOffset + 1);

      out.push({
        definitionId,
        displayName,
        identityKey,
        fromOccurrence: prev.occurrenceIndex,
        toOccurrence: curr.occurrenceIndex,
        relationship: classifyRelationship(prev, curr),
        storedDecision: currRow.stored?.decision,
        generatedDecision: curr.decision,
        agree: currRow.decisionAgree,
        fromBranch: prev.branchPath,
        toBranch: curr.branchPath,
        fromStmt: prev.blockStatementIndex,
        toStmt: curr.blockStatementIndex,
        intervening: curr.interveningIntrinsics,
        enclosingCall: curr.enclosingCall,
        isPostfix:
          openParen === undefined || curr.enclosingCall === undefined
            ? undefined
            : isPostfixCall(source, curr.enclosingCall, openParen),
        fromSite: callSite(source, prev),
        toSite: callSite(source, curr),
        fromConstruct: prev.controlConstruct,
        toConstruct: curr.controlConstruct,
        fromPhase: prev.controlPhase,
        toPhase: curr.controlPhase,
        phaseChanged: prev.controlPhase !== curr.controlPhase,
        loopEpochChanged: prev.loopEpochId !== curr.loopEpochId,
        sameScope: prev.scopeId === curr.scopeId,
        toIsFlatTopLevel: curr.controlDepth === 0 && curr.functionDepth === 0,
        fromIsFlatTopLevel: prev.controlDepth === 0 && prev.functionDepth === 0
      });
    }
  }

  return out;
}

interface CliOptions {
  ids: number[];
  callFilter: RegExp;
  argPositionFilter?: number;
  allContaining?: RegExp;
  alignedOnly: boolean;
  summaryOnly: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const ids: number[] = [];
  let callFilter = /getrecord/i;
  let argPositionFilter: number | undefined;
  let allContaining: RegExp | undefined;
  let alignedOnly = false;
  let summaryOnly = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--definition-ids') {
      for (const raw of argv[++i].split(',')) {
        ids.push(Number(raw.trim()));
      }
    } else if (argv[i] === '--from-file') {
      const text = fs.readFileSync(argv[++i], 'utf8');
      for (const line of text.split('\n')) {
        const match = /^(\d+)/.exec(line.trim());
        if (match) ids.push(Number(match[1]));
      }
    } else if (argv[i] === '--call-filter') {
      callFilter = new RegExp(argv[++i], 'i');
    } else if (argv[i] === '--arg-position') {
      argPositionFilter = Number(argv[++i]);
    } else if (argv[i] === '--all-containing') {
      allContaining = new RegExp(argv[++i], 'i');
    } else if (argv[i] === '--aligned-only') {
      alignedOnly = true;
    } else if (argv[i] === '--summary-only') {
      summaryOnly = true;
    }
  }

  return {
    ids: [...new Set(ids)],
    callFilter,
    argPositionFilter,
    allContaining,
    alignedOnly,
    summaryOnly
  };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const { callFilter, argPositionFilter } = options;

  const db = openSnapshotDatabase();

  const ids = options.allContaining === undefined
    ? options.ids
    : listSnapshotDefinitionIds(db).filter(id =>
        options.allContaining!.test(
          getSnapshotDefinition(db, id).sourceText
        )
      );

  if (ids.length === 0) {
    db.close();
    throw new Error(
      'Usage: getrecord-branch-analysis.ts --definition-ids <id,id,...> | --from-file <path> | --all-containing <regex> [--call-filter <regex>] [--arg-position <n>]'
    );
  }

  const allRows: AnalysisRow[] = [];
  let processed = 0;
  let errors = 0;

  for (const id of ids) {
    try {
      const definition = getSnapshotDefinition(db, id);
      const evidence = generateEvidence(id, definition);
      allRows.push(
        ...analyzeDefinition(
          id,
          evidence.displayName,
          definition.sourceText,
          evidence.rows,
          callFilter,
          argPositionFilter,
          options.alignedOnly
        )
      );
      processed++;
    } catch (error) {
      errors++;
    }
  }

  db.close();

  console.log(
    `Processed ${processed}/${ids.length} definitions (${errors} errors), ` +
      `${allRows.length} consecutive-same-identity target-call occurrence pairs found.\n`
  );

  // Tabulate: relationship x (stored decision, generated decision, agree)
  const table = new Map<string, { count: number; examples: AnalysisRow[] }>();

  for (const row of allRows) {
    const postfixLabel =
      row.isPostfix === undefined ? 'postfix=?' : row.isPostfix ? 'postfix=YES' : 'postfix=NO(bare)';
    const key = `${row.relationship} | ${postfixLabel} | site=${row.fromSite}->${row.toSite} | stored=${row.storedDecision ?? '?'} generated=${row.generatedDecision} agree=${row.agree ?? '?'}`;
    const entry = table.get(key) ?? { count: 0, examples: [] };
    entry.count++;
    if (entry.examples.length < 3) entry.examples.push(row);
    table.set(key, entry);
  }

  const sorted = [...table.entries()].sort((a, b) => b[1].count - a[1].count);

  console.log('--- Summary: relationship | postfix? | stored=X generated=Y agree=Z : count ---');
  for (const [key, entry] of sorted) {
    console.log(`${key} : ${entry.count}`);
  }

  if (!options.summaryOnly) {
    console.log('\n--- Examples per bucket (up to 3 each) ---');
    for (const [key, entry] of sorted) {
      console.log(`\n${key}:`);
      for (const ex of entry.examples) {
        console.log(
          `  def ${ex.definitionId} (${ex.displayName}) occ ${ex.fromOccurrence}->${ex.toOccurrence} ` +
            `[${ex.fromBranch}#${ex.fromStmt}] -> [${ex.toBranch}#${ex.toStmt}] ` +
            `intervening=[${ex.intervening.join(',')}]`
        );
      }
    }
  }

  const disagreements = allRows.filter(r => r.agree === false);
  console.log(
    `\n--- Total disagreements: ${disagreements.length} / ${allRows.length} pairs ---`
  );

  const seenDefs = new Set<number>();
  if (!options.summaryOnly) {
    console.log('\n--- All disagreements (definition_id, relationship, postfix, occ range) ---');
    for (const d of disagreements) {
      console.log(
        `  def ${d.definitionId} (${d.displayName}) ${d.relationship} postfix=${d.isPostfix} ` +
          `occ ${d.fromOccurrence}->${d.toOccurrence} stored=${d.storedDecision} generated=${d.generatedDecision}`
      );
      seenDefs.add(d.definitionId);
    }
  } else {
    for (const d of disagreements) seenDefs.add(d.definitionId);
  }
  console.log(`\n--- Distinct definitions with a disagreement: ${seenDefs.size} ---`);
  console.log([...seenDefs].sort((a, b) => a - b).join(','));

  // Phase 1A quantification, per the research directive's own reporting
  // format: for each candidate rule, how many disagreements does a
  // "boundary crossed" predicate actually cover, how many does it miss,
  // and does it wrongly flag any currently-correct (agree=true) pair too?
  const rules: { name: string; predicate: (r: AnalysisRow) => boolean }[] = [
    { name: 'phaseChanged (header/condition/body boundary crossed)', predicate: r => r.phaseChanged },
    { name: 'loopEpochChanged (a For/While/Repeat was entered in between)', predicate: r => r.loopEpochChanged },
    { name: 'sameScope=false (different innermost block)', predicate: r => !r.sameScope },
    { name: 'relationship=sequential', predicate: r => r.relationship === 'sequential' },
    { name: 'relationship=sibling-branch', predicate: r => r.relationship === 'sibling-branch' },
    { name: 'flatTopLevel (both occurrences at controlDepth=0 AND functionDepth=0)', predicate: r => r.toIsFlatTopLevel && r.fromIsFlatTopLevel }
  ];

  console.log('\n--- Phase 1A candidate-rule quantification ---');
  console.log(
    'A rule "explains" a disagreement when the predicate is TRUE there, and\n' +
      '"contradicts" when it is ALSO true on a currently-correct (agree=true) pair\n' +
      '(i.e. the predicate does not cleanly separate agree from disagree).'
  );

  for (const rule of rules) {
    const explained = disagreements.filter(rule.predicate).length;
    const notExplained = disagreements.length - explained;
    const agreeing = allRows.filter(r => r.agree === true);
    const touchedAmongAgreeing = agreeing.filter(rule.predicate).length;

    console.log(
      `\n${rule.name}:\n` +
        `  disagreements explained (predicate true):     ${explained} / ${disagreements.length}\n` +
        `  disagreements NOT explained (predicate false): ${notExplained} / ${disagreements.length}\n` +
        `  currently-correct pairs the rule also touches: ${touchedAmongAgreeing} / ${agreeing.length}\n` +
        `  => predicate-true rate: disagreements ${disagreements.length > 0 ? (100 * explained / disagreements.length).toFixed(1) : '0.0'}% vs agreeing ${agreeing.length > 0 ? (100 * touchedAmongAgreeing / agreeing.length).toFixed(1) : '0.0'}%` +
        (touchedAmongAgreeing > 0 && explained === disagreements.length
          ? '\n  NOTE: predicate true on ALL disagreements but ALSO true on some correct pairs -- necessary but not sufficient.'
          : '')
    );
  }

  // Sequential pairs carry nearly all disagreements but are themselves a
  // near-majority of the whole population -- look INSIDE that subset for
  // what actually separates its disagreeing minority (statement distance,
  // whether any watched intrinsic intervened).
  const sequentialRows = allRows.filter(r => r.relationship === 'sequential');
  const seqDisagree = sequentialRows.filter(r => r.agree === false);
  const seqAgree = sequentialRows.filter(r => r.agree === true);

  const stmtGap = (r: AnalysisRow): number => r.toStmt - r.fromStmt;
  const mean = (xs: number[]): number =>
    xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
  const median = (xs: number[]): number => {
    if (xs.length === 0) return NaN;
    const sorted = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };

  console.log('\n--- Within sequential pairs only: what separates the disagreeing minority? ---');
  console.log(
    `sequential pairs: ${sequentialRows.length} total, ${seqDisagree.length} disagree, ${seqAgree.length} agree`
  );
  console.log(
    `statement gap (toStmt - fromStmt): disagree mean=${mean(seqDisagree.map(stmtGap)).toFixed(2)} median=${median(seqDisagree.map(stmtGap))} | ` +
      `agree mean=${mean(seqAgree.map(stmtGap)).toFixed(2)} median=${median(seqAgree.map(stmtGap))}`
  );
  const hadIntervening = (r: AnalysisRow): boolean => r.intervening.length > 0;
  console.log(
    `had ANY watched-intrinsic intervening: disagree ${seqDisagree.filter(hadIntervening).length}/${seqDisagree.length} ` +
      `(${seqDisagree.length > 0 ? (100 * seqDisagree.filter(hadIntervening).length / seqDisagree.length).toFixed(1) : '0.0'}%) | ` +
      `agree ${seqAgree.filter(hadIntervening).length}/${seqAgree.length} ` +
      `(${seqAgree.length > 0 ? (100 * seqAgree.filter(hadIntervening).length / seqAgree.length).toFixed(1) : '0.0'}%)`
  );

  const interveningNameCounts = new Map<string, { disagree: number; agree: number }>();
  for (const r of seqDisagree) {
    for (const name of r.intervening) {
      const entry = interveningNameCounts.get(name) ?? { disagree: 0, agree: 0 };
      entry.disagree++;
      interveningNameCounts.set(name, entry);
    }
  }
  for (const r of seqAgree) {
    for (const name of r.intervening) {
      const entry = interveningNameCounts.get(name) ?? { disagree: 0, agree: 0 };
      entry.agree++;
      interveningNameCounts.set(name, entry);
    }
  }
  console.log('intervening-call breakdown (name: disagree-count / agree-count):');
  for (const [name, counts] of [...interveningNameCounts.entries()].sort((a, b) => b[1].disagree - a[1].disagree)) {
    console.log(`  ${name}: ${counts.disagree} / ${counts.agree}`);
  }
}

main();
