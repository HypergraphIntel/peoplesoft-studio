/**
 * Cycle 7 Phase 7A: for every discrepancy in the Cycle 6
 * "bare-intrinsic-derived receiver" population (postfix .GetRecord(...)/
 * .GetRow(...)/.GetRowset(...) where ChainSemantics predicts a dynamic
 * receiver but the legacy encoder nevertheless enables dependency
 * binding), determine the RECEIVER's own declaration provenance from
 * source, independent of what ChainSemantics currently tracks -- this
 * separates genuine undeclared/dynamic receivers (the real target
 * population) from receivers that ARE declared (Local Row/Record/Rowset,
 * or a typed function parameter) or schema-bound (CreateRowset(Record.X)),
 * where ChainSemantics' own current derivation has a detection gap rather
 * than the legacy encoder having a genuine binding bug.
 *
 * Read-only. Does not touch encoder/decoder decision logic.
 *
 * Usage:
 *   tsx tools/corpus/research/postfix-call-provenance-analysis.ts --all
 *   tsx tools/corpus/research/postfix-call-provenance-analysis.ts --definition-ids 435,926,939,1423,1424,1721,1722
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
  receiver: string | undefined;
  provenance: string;
}

/** Finds the `(` matching a trailing `)` in `s`, or -1. */
function matchingOpenParen(s: string): number {
  let depth = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] === ')') depth++;
    else if (s[i] === '(') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Phase 7C's scope is specifically the postfix .GetRecord(...)/.GetRow(...)/
 * .GetRowset(...) call family -- NOT the rowset-selector-shorthand family
 * (`&rs(N)`, `.PROPNAME(N)`, `GetLevel0()(N)`), which produces the
 * identical {row/field, dynamic, unknown} diagnostic tuple but is a
 * separate, already-correct mechanism (Cycle 6's own finding). Family
 * membership is decided ONLY by what call is IMMEDIATELY before the
 * flagged member (after at most one already-consumed `.MEMBER` hop for
 * the RECORD-then-FIELD shorthand pair) -- not by anything further back
 * in the chain, since a `&VAR(...)` selector applied to a GetRow(...)
 * result is still a selector application at that point, in scope for
 * Cycle 6's separate mechanism, not this cycle's target.
 */
function classifyFamily(sourceBefore: string): 'get-call' | 'bare-chain-start' | 'out-of-scope' {
  let s = sourceBefore.replace(/\s*\.\s*$/, '');
  if (s === sourceBefore) {
    return 'out-of-scope';
  }

  const memberHop = /\.\s*[A-Za-z_][A-Za-z0-9_]*\s*$/.exec(s);
  if (memberHop) {
    s = s.slice(0, s.length - memberHop[0].length);
  }
  s = s.replace(/\s+$/, '');

  if (!s.endsWith(')')) {
    return 'out-of-scope';
  }
  const openIndex = matchingOpenParen(s);
  if (openIndex < 0) {
    return 'out-of-scope';
  }
  const callee = s.slice(0, openIndex);

  const getMatch = /(?:^|[^A-Za-z0-9_])(Get(?:Record|Row|Rowset))\s*$/i.exec(callee);
  if (!getMatch) {
    return 'out-of-scope';
  }
  const before = callee.slice(0, callee.length - getMatch[1].length);
  return /\.\s*$/.test(before) ? 'get-call' : 'bare-chain-start';
}

type ReceiverResolution =
  | { kind: 'variable'; name: string }
  | { kind: 'chained-get-call' }
  | { kind: 'selector-derived'; baseName: string | undefined }
  | { kind: 'getlevel0-rooted' }
  | { kind: 'unresolved' };

/**
 * Resolves what a `.Get(Record|Row|Rowset)(...)` call's OWN receiver is
 * (the thing directly before its dot), distinguishing:
 *  - a plain declared/undeclared variable (`&RS2.GetRow(...)`)
 *  - another chained `.Get(...)` call (`X.GetRow(...).GetRowset(...)`) --
 *    in scope for Phase 7C's own inheritance rule, so the caller should
 *    recurse into ITS receiver rather than treat this call itself as the
 *    provenance source
 *  - a rowset-selector application (`&rs(N).GetRecord(...)`) -- the `(N)`
 *    selector is Cycle 6's own separately-scoped, deliberately-not-
 *    inherited mechanism, so `&rs`'s OWN declaration is NOT what governs
 *    this receiver's provenance, regardless of whether `&rs` is declared
 *  - the `GetLevel0()(N)` root (a separate, always-bound special case,
 *    per Cycle 6's own finding)
 */
function resolveGetCallOwnReceiver(sourceBefore: string): ReceiverResolution {
  let s = sourceBefore.replace(/\s*\.\s*$/, '');
  const memberHop = /\.\s*[A-Za-z_][A-Za-z0-9_]*\s*$/.exec(s);
  if (memberHop) {
    s = s.slice(0, s.length - memberHop[0].length);
  }
  s = s.replace(/\s+$/, '');

  // Strip the confirmed `.Get(Record|Row|Rowset)(...)` call itself,
  // including its own leading dot.
  const openIndex = matchingOpenParen(s);
  const getMatch = /(?:^|[^A-Za-z0-9_])(Get(?:Record|Row|Rowset))\s*$/i.exec(s.slice(0, openIndex));
  s = s.slice(0, openIndex - (getMatch?.[1].length ?? 0)).replace(/\.\s*$/, '');

  if (!s.endsWith(')')) {
    const varMatch = /(&[A-Za-z0-9_]+#?)\s*$/.exec(s);
    return varMatch ? { kind: 'variable', name: varMatch[1] } : { kind: 'unresolved' };
  }

  const inner = matchingOpenParen(s);
  if (inner < 0) return { kind: 'unresolved' };
  const innerCallee = s.slice(0, inner);

  const innerGetMatch = /(?:^|[^A-Za-z0-9_])(Get(?:Record|Row|Rowset))\s*$/i.exec(innerCallee);
  if (innerGetMatch) {
    return { kind: 'chained-get-call' };
  }
  if (/(?:^|[^A-Za-z0-9_])GetLevel0\s*$/i.test(innerCallee)) {
    return { kind: 'getlevel0-rooted' };
  }
  const baseVarMatch = /(&[A-Za-z0-9_]+#?)\s*$/.exec(innerCallee);
  return { kind: 'selector-derived', baseName: baseVarMatch?.[1] };
}

/**
 * Only called once `classifyFamily` has confirmed this member follows a
 * `.Get(Record|Row|Rowset)(...)` call -- finds the ultimate plain-variable
 * receiver feeding it, recursing through further CHAINED `.Get(...)` calls
 * (in scope) but stopping at a rowset-selector or GetLevel0() root
 * (out of scope for the receiver's own provenance).
 */
function findGetCallReceiver(sourceBefore: string): { receiver: string | undefined; note?: string } {
  let current = sourceBefore;
  for (let hops = 0; hops < 10; hops++) {
    const resolution = resolveGetCallOwnReceiver(current);
    switch (resolution.kind) {
      case 'variable':
        return { receiver: resolution.name };
      case 'unresolved':
        return { receiver: undefined };
      case 'getlevel0-rooted':
        return { receiver: undefined, note: 'getlevel0-rooted' };
      case 'selector-derived':
        return { receiver: undefined, note: 'selector-derived' };
      case 'chained-get-call': {
        // Recurse: strip this call and its member-hop, then resolve the
        // NEXT call back in the chain (still within Phase 7C's own
        // receiver-inheritance mechanism).
        let s = current.replace(/\s*\.\s*$/, '');
        const memberHop = /\.\s*[A-Za-z_][A-Za-z0-9_]*\s*$/.exec(s);
        if (memberHop) s = s.slice(0, s.length - memberHop[0].length);
        s = s.replace(/\s+$/, '');
        const openIndex = matchingOpenParen(s);
        const getMatch = /(?:^|[^A-Za-z0-9_])(Get(?:Record|Row|Rowset))\s*$/i.exec(s.slice(0, openIndex));
        current = s.slice(0, openIndex - (getMatch?.[1].length ?? 0)).replace(/\.\s*$/, '');
        continue;
      }
    }
  }
  return { receiver: undefined, note: 'hop-limit-exceeded' };
}

function classifyReceiverProvenance(
  source: string,
  receiver: string | undefined,
  bareChainStart: boolean,
  note: string | undefined
): string {
  if (bareChainStart) {
    return 'bare-chain-start (no receiver -- intrinsic per Cycle 4/5)';
  }
  if (note === 'getlevel0-rooted') {
    return 'GetLevel0()-rooted receiver (separate, always-bound mechanism per Cycle 6)';
  }
  if (note === 'selector-derived') {
    return 'rowset-selector-derived receiver (out of Phase 7C scope -- governed by the separate, not-yet-modeled selector mechanism, regardless of the base variable\'s own declaration)';
  }
  if (receiver === undefined) {
    return 'unresolved receiver (neither a plain variable nor a recognized selector/intrinsic root)';
  }

  const escaped = receiver.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const paramMatch = new RegExp(
    `\\(([^()]*\\b)?${escaped}\\s+As\\s+(Row|Record|Rowset)\\b`,
    'i'
  ).test(source) || new RegExp(
    `,\\s*${escaped}\\s+As\\s+(Row|Record|Rowset)\\b`,
    'i'
  ).test(source);
  if (paramMatch) {
    const typeMatch = new RegExp(`${escaped}\\s+As\\s+(Row|Record|Rowset)\\b`, 'i').exec(source);
    return `typed function parameter (As ${typeMatch?.[1] ?? '?'})`;
  }

  const localMatch = new RegExp(
    `Local\\s+(Row|Record|Rowset)\\s+(?:[A-Za-z0-9_&,\\s]*)${escaped}\\b`,
    'i'
  ).exec(source);
  if (localMatch) {
    return `Local ${localMatch[1]} declaration`;
  }

  const componentMatch = new RegExp(
    `(Component|Global)\\s+(Row|Record|Rowset)\\s+(?:[A-Za-z0-9_&,\\s]*)${escaped}\\b`,
    'i'
  ).exec(source);
  if (componentMatch) {
    return `${componentMatch[1]} ${componentMatch[2]} declaration`;
  }

  const createRowsetMatch = new RegExp(
    `${escaped}\\s*=\\s*CreateRowset\\s*\\(\\s*Record\\s*\\.`,
    'i'
  ).test(source);
  if (createRowsetMatch) {
    return 'schema-bound (CreateRowset(Record.X) assignment)';
  }

  return 'no declaration/schema evidence found (candidate genuine dynamic receiver)';
}

interface ParsedArgs {
  ids: number[];
  all: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const ids = new Set<number>();
  let all = false;
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
    }
  }
  return { ids: [...ids], all };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.ids.length === 0 && !args.all) {
    throw new Error('Usage: postfix-call-provenance-analysis.ts --definition-ids <ids> | --ids-file <path> | --all');
  }

  const db = openSnapshotDatabase();
  const ids = args.all ? listSnapshotDefinitionIds(db) : args.ids;

  const allRows: Row[] = [];
  let processed = 0;

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
        if (!(d.predicted.binding === 'dynamic' && d.actualBindingEligible)) {
          continue; // only cases where the legacy encoder enables binding ChainSemantics predicts against
        }
        const sourceBefore = definition.sourceText.slice(0, d.sourceOffset);
        const family = classifyFamily(sourceBefore);
        if (family === 'out-of-scope') {
          continue; // rowset-selector-shorthand or similar -- Cycle 6's separate mechanism, not Phase 7C's target
        }
        const resolved = family === 'get-call' ? findGetCallReceiver(sourceBefore) : { receiver: undefined, note: undefined };
        allRows.push({
          definitionId: id,
          displayName: definition.displayName,
          diagnostic: d,
          receiver: resolved.receiver,
          provenance: classifyReceiverProvenance(definition.sourceText, resolved.receiver, family === 'bare-chain-start', resolved.note)
        });
      }
      processed++;
    } catch {
      // ignore encode errors -- same policy as chain-semantics-diagnostics.ts
    }
  }

  db.close();

  console.log(`Processed ${processed}/${ids.length} definitions.`);
  console.log(`Total bare-intrinsic-derived-receiver discrepancies: ${allRows.length}\n`);

  const count = <T,>(items: T[], key: (t: T) => string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const item of items) {
      const k = key(item);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };

  console.log('--- By receiver provenance (source-declaration evidence) ---');
  for (const [k, v] of [...count(allRows, r => r.provenance).entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }

  const defs = new Map<string, Set<number>>();
  for (const r of allRows) {
    if (!defs.has(r.provenance)) defs.set(r.provenance, new Set());
    defs.get(r.provenance)!.add(r.definitionId);
  }
  console.log('\n--- Distinct definitions by receiver provenance ---');
  for (const [k, v] of [...defs.entries()].sort((a, b) => b[1].size - a[1].size)) {
    console.log(`  ${k}: ${v.size}`);
  }

  console.log('\n--- definition_id,provenance (CSV for cross-referencing against classification) ---');
  for (const r of allRows) {
    console.log(`${r.definitionId},${JSON.stringify(r.provenance)},${r.receiver ?? ''}`);
  }
}

main();
