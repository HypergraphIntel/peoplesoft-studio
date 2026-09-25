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
  getSnapshotDefinition
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

function analyzeDefinition(
  definitionId: number,
  displayName: string,
  source: string,
  rows: ReturnType<typeof generateEvidence>['rows'],
  callFilter: RegExp,
  argPositionFilter?: number
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
            : isPostfixCall(source, curr.enclosingCall, openParen)
      });
    }
  }

  return out;
}

interface CliOptions {
  ids: number[];
  callFilter: RegExp;
  argPositionFilter?: number;
}

function parseArgs(argv: string[]): CliOptions {
  const ids: number[] = [];
  let callFilter = /getrecord/i;
  let argPositionFilter: number | undefined;

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
    }
  }

  return { ids: [...new Set(ids)], callFilter, argPositionFilter };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const { ids, callFilter, argPositionFilter } = options;

  if (ids.length === 0) {
    throw new Error(
      'Usage: getrecord-branch-analysis.ts --definition-ids <id,id,...> | --from-file <path> [--call-filter <regex>] [--arg-position <n>]'
    );
  }

  const db = openSnapshotDatabase();

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
          argPositionFilter
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
      `${allRows.length} consecutive-same-identity GetRecord occurrence pairs found.\n`
  );

  // Tabulate: relationship x (stored decision, generated decision, agree)
  const table = new Map<string, { count: number; examples: AnalysisRow[] }>();

  for (const row of allRows) {
    const postfixLabel =
      row.isPostfix === undefined ? 'postfix=?' : row.isPostfix ? 'postfix=YES' : 'postfix=NO(bare)';
    const key = `${row.relationship} | ${postfixLabel} | stored=${row.storedDecision ?? '?'} generated=${row.generatedDecision} agree=${row.agree ?? '?'}`;
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

  const disagreements = allRows.filter(r => r.agree === false);
  console.log(
    `\n--- Total disagreements: ${disagreements.length} / ${allRows.length} pairs ---`
  );

  console.log('\n--- All disagreements (definition_id, relationship, postfix, occ range) ---');
  const seenDefs = new Set<number>();
  for (const d of disagreements) {
    console.log(
      `  def ${d.definitionId} (${d.displayName}) ${d.relationship} postfix=${d.isPostfix} ` +
        `occ ${d.fromOccurrence}->${d.toOccurrence} stored=${d.storedDecision} generated=${d.generatedDecision}`
    );
    seenDefs.add(d.definitionId);
  }
  console.log(`\n--- Distinct definitions with a disagreement: ${seenDefs.size} ---`);
  console.log([...seenDefs].sort((a, b) => a - b).join(','));
}

main();
