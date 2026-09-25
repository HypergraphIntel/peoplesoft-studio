/**
 * Cycle 6: runs encodeProgram over a set of definitions, collecting every
 * ChainSemanticsDiagnostic (a disagreement between ChainSemantics' own
 * receiver-provenance-based binding prediction and what the existing,
 * purely name-based `expectedReferenceMember` logic actually decided for a
 * bare postfix member).
 *
 * Read-only research tooling. Does not touch encoder/decoder decision
 * logic; the diagnostic hook this reads from is purely observational.
 *
 * Usage:
 *   tsx tools/corpus/research/chain-semantics-diagnostics.ts --ids-file <path>
 *   tsx tools/corpus/research/chain-semantics-diagnostics.ts --definition-ids 432,524,1423,1424,1721,1722
 */

import fs from 'node:fs';

import {
  encodeProgram,
  ChainSemanticsDiagnostic
} from '../../../src/peoplecode/encoder';

import {
  openSnapshotDatabase
} from '../snapshot/store';

import {
  getSnapshotDefinition,
  listSnapshotDefinitionIds
} from '../snapshot/reader';

interface Row {
  definitionId: number;
  displayName: string;
  diagnostic: ChainSemanticsDiagnostic;
  sourceContext: string;
  category: string;
}

/**
 * Best-effort classification of a ChainSemantics/legacy-flag discrepancy.
 * `sourceBefore` is the source text UP TO (not including) the member name
 * itself -- `d.sourceOffset` marks where the member starts, so a chain like
 * `&Der_Parent.GETRECORD(Record.DERIVED_IBAN).GP_IBAN_VALIDATED` has
 * `sourceBefore` ending in the literal characters `...DERIVED_IBAN).` (the
 * member name `GP_IBAN_VALIDATED` is NOT part of this string).
 *
 * Three known discrepancy populations, corpus-evidenced:
 *
 * 1. predicted=rowset/dependency-bound/* with actualEligible=false (def 432):
 *    NOT a genuine bug -- Rowset intrinsic properties (.ActiveRowCount, ...)
 *    never expose bare-member reference shorthand regardless of receiver
 *    binding. This is ChainSemantics' own incompleteness (it has no notion
 *    of "this member is a Rowset intrinsic property, not a chain
 *    continuation"), not a legacy-flag bug. Detected from the diagnostic
 *    tuple directly, not source pattern.
 *
 * 2. bare-intrinsic-derived receiver (1423/1424/1721/1722 shape): a chain
 *    rooted at an undeclared `.GetRecord(...)`/`.GetRow(...)`/
 *    `.GetRowset(...)` call result, optionally with one already-consumed
 *    `.MEMBER` hop for the RECORD-then-FIELD shorthand pair (e.g.
 *    `.GetRow(&F).BC_WRK.BCMETHODACCESS`). This is the confirmed,
 *    evidence-backed genuine bug class: the legacy `expectedReferenceMember`
 *    flag is purely name-based and does not check receiver provenance.
 *
 * 3. rowset-selector-shorthand `&rs(N).RECORD.FIELD` (not modeled): a plain
 *    variable call `&VAR(...)` (NOT a `.GetRow/.GetRowset/.GetRecord`
 *    method call) followed by `.RECORD.`. This is a separate,
 *    already-correct mechanism the encoder handles on its own terms; it
 *    produces the same {row/field, dynamic, unknown} prediction tuple as
 *    category 2 and is therefore only distinguishable by source shape.
 */
function classifyDiscrepancy(sourceBefore: string, diagnostic: ChainSemanticsDiagnostic): string {
  if (diagnostic.predicted.valueType === 'rowset' && diagnostic.predicted.binding === 'dependency-bound' && !diagnostic.actualBindingEligible) {
    return 'rowset-intrinsic-property (ChainSemantics incompleteness, e.g. .ActiveRowCount)';
  }

  // sourceBefore ends with the `.` that precedes the member this
  // diagnostic is about (the member itself is excluded). Strip it.
  let s = sourceBefore.replace(/\s*\.\s*$/, '');
  if (s === sourceBefore) {
    return 'other/unclassified';
  }

  // Optionally strip one already-consumed `.MEMBER` hop (the
  // RECORD-then-FIELD shorthand pair, e.g. `.GetRow(&F).BC_WRK.FIELD`).
  const memberHop = /\.\s*[A-Za-z_][A-Za-z0-9_]*\s*$/.exec(s);
  if (memberHop) {
    s = s.slice(0, s.length - memberHop[0].length);
  }

  s = s.replace(/\s+$/, '');

  // Peel back chained trailing call groups one at a time (e.g.
  // `GetLevel0()(1).GetRowset(Scroll.X)(1)` is TWO chained `(...)` calls
  // applied to the GetRowset(...) result -- the row-selector call `(1)`
  // and the GetRowset(...) call underneath it). At each layer, classify
  // by what immediately precedes that layer's matching `(`.
  while (s.endsWith(')')) {
    let depth = 0;
    let openIndex = -1;
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i] === ')') depth++;
      else if (s[i] === '(') {
        depth--;
        if (depth === 0) {
          openIndex = i;
          break;
        }
      }
    }
    if (openIndex < 0) {
      return 'other/unclassified';
    }
    const callee = s.slice(0, openIndex);

    if (/\.\s*Get(?:Record|Row|Rowset)\s*$/i.test(callee)) {
      return 'bare-intrinsic-derived receiver (1423/1424/1721/1722 shape)';
    }
    // `GetLevel0()` is the encoder's own separately-evidenced, always
    // dependency-bound Level0-rowset root (see the `GetLevel0()(N)`
    // handling around encoder.ts:4059/8467) -- not an undeclared/dynamic
    // GetRecord/GetRow/GetRowset intrinsic, so a bare `.RECORD.FIELD` off
    // it (or off a `(N)` row-selector on it) belongs with the
    // rowset-selector-shorthand family, not the genuine-bug family.
    if (/(?:^|[^A-Za-z0-9_])GetLevel0\s*$/i.test(callee)) {
      return 'rowset-selector-shorthand (not modeled, separate mechanism)';
    }
    // `&VAR(N)...` (a Rowset variable selector) or `.PROPNAME(N)...` (a
    // nested Rowset/Scroll property selected the same way, e.g.
    // `&RS(&I).AA_ONE_JPN_VW(&HireRow).FIELD`) are the same shorthand
    // mechanism: neither is a Get(Record|Row|Rowset)() intrinsic call.
    if (/&[A-Za-z0-9_]+#?\s*$/.test(callee) || /\.\s*[A-Za-z_][A-Za-z0-9_]*\s*$/.test(callee)) {
      return 'rowset-selector-shorthand (not modeled, separate mechanism)';
    }
    // Neither shape at this layer -- if the callee itself ends in `)`,
    // it's another chained call group (e.g. `GetLevel0()(1)`); peel back
    // once more. Otherwise there is nothing left to classify.
    if (!callee.endsWith(')')) {
      return 'other/unclassified';
    }
    s = callee;
  }
  return 'other/unclassified';
}

function sourceWindow(source: string, offset: number, radius = 70): string {
  const start = Math.max(0, offset - radius);
  const end = Math.min(source.length, offset + radius);
  return source.slice(start, end).replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}

interface ParsedArgs {
  ids: number[];
  all: boolean;
  rows: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const ids = new Set<number>();
  let all = false;
  let rows = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--definition-ids') {
      for (const raw of argv[++i].split(',')) {
        const n = Number(raw.trim());
        if (Number.isFinite(n)) ids.add(n);
      }
    } else if (argv[i] === '--ids-file') {
      for (const raw of fs.readFileSync(argv[++i], 'utf8').split(',')) {
        const n = Number(raw.trim());
        if (Number.isFinite(n) && n > 0) ids.add(n);
      }
    } else if (argv[i] === '--all') {
      all = true;
    } else if (argv[i] === '--rows') {
      rows = true;
    }
  }
  return { ids: [...ids], all, rows };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.ids.length === 0 && !args.all) {
    throw new Error('Usage: chain-semantics-diagnostics.ts --definition-ids <ids> | --ids-file <path> | --all [--rows]');
  }

  const db = openSnapshotDatabase();
  const ids = args.all ? listSnapshotDefinitionIds(db) : args.ids;

  const allRows: Row[] = [];
  let processed = 0;
  let errors = 0;

  for (const id of ids) {
    try {
      const definition = getSnapshotDefinition(db, id);
      const diagnostics: ChainSemanticsDiagnostic[] = [];

      encodeProgram(definition.sourceText, {
        owner: {
          recordName: definition.objectvalue1.trim(),
          fieldName: definition.objectvalue2.trim()
        },
        chainSemanticsTrace: event => diagnostics.push(event)
      });

      for (const d of diagnostics) {
        allRows.push({
          definitionId: id,
          displayName: definition.displayName,
          diagnostic: d,
          sourceContext: sourceWindow(definition.sourceText, d.sourceOffset),
          category: classifyDiscrepancy(definition.sourceText.slice(0, d.sourceOffset), d)
        });
      }
      processed++;
    } catch {
      errors++;
    }
  }

  db.close();

  console.log(`Processed ${processed}/${ids.length} definitions (${errors} encode errors -- discrepancies before the error point are still counted).`);
  console.log(`Total discrepancies: ${allRows.length}\n`);

  const count = <T,>(items: T[], key: (t: T) => string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const item of items) {
      const k = key(item);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };

  console.log('--- By category (best-effort source-pattern classification) ---');
  for (const [k, v] of [...count(allRows, r => r.category).entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }
  console.log('');

  console.log('--- Category x predicted/actual direction ---');
  for (const [k, v] of [...count(
    allRows,
    r => `${r.category} | predicted=${r.diagnostic.predicted.valueType}/${r.diagnostic.predicted.binding}/${r.diagnostic.predicted.provenance} actualEligible=${r.diagnostic.actualBindingEligible}`
  ).entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }
  console.log('');

  console.log('--- By predicted valueType/binding/provenance vs actual ---');
  for (const [k, v] of [...count(allRows, r => `predicted=${r.diagnostic.predicted.valueType}/${r.diagnostic.predicted.binding}/${r.diagnostic.predicted.provenance} actualEligible=${r.diagnostic.actualBindingEligible}`).entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }

  const defs = new Set(allRows.map(r => `${r.definitionId} (${r.displayName})`));
  console.log(`\nDistinct definitions with at least one discrepancy: ${defs.size}`);

  if (args.rows) {
    console.log('\n--- Distinct definitions with at least one discrepancy ---');
    console.log([...defs].sort().join('\n  '));

    console.log('\n--- All rows ---');
    for (const r of allRows) {
      console.log(
        `def ${r.definitionId} off=${r.diagnostic.sourceOffset} member=${r.diagnostic.member} category=${r.category} ` +
          `predicted=${r.diagnostic.predicted.valueType}/${r.diagnostic.predicted.binding}/${r.diagnostic.predicted.provenance} ` +
          `actualEligible=${r.diagnostic.actualBindingEligible}\n  ctx: ${r.sourceContext}`
      );
    }
  } else {
    console.log('(pass --rows to print the distinct-definition list and every discrepancy row)');
  }
}

main();
