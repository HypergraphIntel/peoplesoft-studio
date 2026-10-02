/*
 * Cycle 73 (forensic/analytical only, no semantic encoder/decoder changes):
 * a full corpus-wide taxonomy of every NONEXACT definition's CURRENT
 * (fresh, HEAD-derived) primary failure category, to determine which
 * category offers the highest expected top-level EXACT payoff for a
 * future cycle.
 *
 * Reuses the authoritative validator (`validateDefinition`, the SAME
 * function `npm run corpus:harness` calls) for classification,
 * `sourceEncodeExact` (forward byte-identical) and `roundtripExact` --
 * no parallel classification logic. Adds ONE new, cheap signal this
 * project did not previously compute project-wide: whether the forward
 * REFERENCE STREAM (PSPCMNAME) is structurally exact, independent of
 * whether the rest of the program bytes match -- this is what
 * distinguishes `REFERENCE_ACTIVE` (a genuine, still-unproven reference
 * gap) from `REFERENCE_COMPLETE_DOWNSTREAM` (references are already
 * correct; something else in the body blocks full EXACT).
 *
 * Primary category is mutually exclusive per definition (Phase 34);
 * secondary signals (e.g. errorMessage, construct) are preserved
 * alongside for later sampling.
 *
 * This is a deliberately PRAGMATIC taxonomy: the finer categories the
 * Cycle 73 brief lists (NAMES_MEMBER_ORDER, MARKER_LAYOUT,
 * PARKED_SELF_METADATA, PARKED_EXTERNAL_METADATA, QUOTED_COMPONENT_ORDER)
 * are NOT separately, structurally detected here at full-corpus scale --
 * they would require per-definition source-specific research (as Cycles
 * 43-72 each did for ONE construct at a time). Instead, `REFERENCE_ACTIVE`
 * and `REFERENCE_COMPLETE_DOWNSTREAM` are broken down by the KIND of the
 * first structural reference divergence (record/field/scroll/package/
 * other), which is the cheapest reliable proxy available at this scale,
 * and a representative sample of each large bucket is written out for
 * manual/future-cycle drill-down.
 *
 * Output:
 *   .claude/nonexact-taxonomy.json  -- one row per NONEXACT definition
 *   stdout -- aggregate summary tables
 *
 * Usage: npx tsx tools/corpus/research/cycle73-nonexact-taxonomy.ts
 */
import fs from 'node:fs';
import path from 'node:path';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { validateDefinition } from '../validator';
import { snapshotApplicationClassTypeMetadata } from '../snapshot/applicationClassTypeMetadata';
import { snapshotConditionalCompilation } from '../snapshot/toolsRelease';
import type { ConditionalCompilationOptions } from '../../../src/peoplecode/conditionalCompilation';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';
import type { ApplicationClassTypeMetadataProvider } from '../../../src/peoplecode/applicationClassTypeMetadata';
import type { CorpusDefinition } from '../classifications';

function ownerContextOf(def: any) {
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7].map((v: string) => (v ?? '').trim());
  const ids = [def.objectid1, def.objectid2, def.objectid3, def.objectid4, def.objectid5, def.objectid6, def.objectid7];
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  const packagePath = values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean);
  // Match validator.ts's OBJECTID-based owner derivation (RECNAME=1,
  // FIELDNAME=2) rather than fixed array position -- Component-scoped
  // Record Field PeopleCode places a Component/Market pair first,
  // displacing RECNAME/FIELDNAME to a later physical slot.
  const recordIndex = ids.findIndex(id => id === 1);
  const fieldIndex = ids.findIndex(id => id === 2);
  return {
    recordName: recordIndex >= 0 ? values[recordIndex] : values[0],
    fieldName: fieldIndex >= 0 ? values[fieldIndex] : values[1],
    packagePath
  };
}

function gKeyOf(g: any): string {
  switch (g.kind) {
    case 'owner':
      // Ordinary Record.Field PeopleCode's owner row carries the actual
      // owning record/field name (NAMENUM 1); only Application Class
      // owner rows are genuinely blank. An earlier version of this
      // comparator hardcoded '.' unconditionally, which spuriously
      // flagged the OWNER row itself as the "first divergence" for
      // nearly every ordinary-PeopleCode NONEXACT definition (a tooling
      // bug, not a real encoder defect -- caught by sampling
      // REFERENCE_ACTIVE_OTHER and finding storedCount/generatedCount
      // already differed while both owner rows were semantically
      // identical).
      return (g.recordName || g.fieldName)
        ? `${(g.recordName ?? '').toUpperCase()}.${(g.fieldName ?? '').toUpperCase()}`
        : '.';
    case 'package': return `PACKAGE.${(g.packageName ?? '').toUpperCase()}`;
    case 'scroll': return `SCROLL.${(g.recordName ?? '').toUpperCase()}`;
    case 'record': return `RECORD.${(g.recordName ?? '').toUpperCase()}`;
    case 'field': return `FIELD.${(g.fieldName ?? '').toUpperCase()}`;
    case 'record-field': return `${(g.recordName ?? '').toUpperCase()}.${(g.fieldName ?? '').toUpperCase()}`;
    // Verified against the encoder's own allocation sites (not guessed):
    // componentReference() allocates `{ kind: 'component', objectName }`
    // (RECNAME literally 'COMPONENT', REFNAME the component name -- see
    // that function's own comment, "PSPCMNAME contains multiple
    // COMPONENT/ABS_SHP_LEAVE_GBR rows"). An earlier version of this
    // comparator wrongly read `recordName`/`fieldName` here (always
    // undefined for this kind), producing a spurious divergence for
    // every component reference regardless of correctness.
    case 'component': return `COMPONENT.${(g.objectName ?? '').toUpperCase()}`;
    // declareFunctionReference-style allocation uses
    // `{ kind: 'declare-function', recordName, fieldName, eventName }`
    // where RECNAME/REFNAME are the declared function's own owning
    // record/field (e.g. stored `AE_WRK.FUNCLIB`) -- an earlier version
    // of this comparator hardcoded a 'DECLARE.' prefix that never
    // matched stored data at all, misclassifying ~1,900 definitions.
    case 'declare-function': return `${(g.recordName ?? '').toUpperCase()}.${(g.fieldName ?? '').toUpperCase()}`;
    // Quoted-reference allocation uses
    // `{ kind: 'quoted-reference', recordName: storedQualifier, fieldName: refName }`
    // where RECNAME is the quoting keyword (e.g. 'OPERATION', 'PAGE') and
    // REFNAME is the quoted text itself -- an earlier version of this
    // comparator hardcoded a 'QUOTED.' prefix and dropped the qualifier
    // entirely.
    case 'quoted-reference': return `${(g.recordName ?? '').toUpperCase()}.${(g.fieldName ?? '').toUpperCase()}`;
    default: return JSON.stringify(g);
  }
}

function sKeyOf(row: any): string {
  return `${row.recname.trim().toUpperCase()}.${row.refname.trim().toUpperCase()}`;
}

interface ReferenceComparison {
  referenceExact: boolean;
  referenceSetExact: boolean; // same multiset, order may differ
  storedCount: number;
  generatedCount: number;
  firstDivergenceIndex: number;
  firstDivergenceKind: string | undefined;
  encodeThrew: boolean;
}

function compareReferences(
  sourceText: string,
  owner: ReturnType<typeof ownerContextOf>,
  storedNames: any[],
  applicationClassTypeMetadata?: ApplicationClassTypeMetadataProvider,
  conditionalCompilation?: ConditionalCompilationOptions
): ReferenceComparison {
  let artifacts;
  try {
    // Cycle 110: with the same type metadata the EXACT decision uses (Cycle
    // 107); Cycle 115: and the same Tools release.
    artifacts = encodeProgramArtifacts(sourceText, { owner, applicationClassTypeMetadata, conditionalCompilation } as any);
  } catch {
    return {
      referenceExact: false,
      referenceSetExact: false,
      storedCount: storedNames.length,
      generatedCount: -1,
      firstDivergenceIndex: -1,
      firstDivergenceKind: undefined,
      encodeThrew: true
    };
  }

  /*
   * The OWNER row's own binding semantics differ by definition type in
   * ways this cheap, generic comparator cannot reliably reconstruct:
   * Record Field PeopleCode's owner row carries the actual owning
   * record/field name, Application Class and Component/Page/Menu-level
   * programs' owner rows stay blank, and the reference object's own
   * `recordName`/`fieldName` fields reflect the SUPPLIED `owner` context
   * bookkeeping value, not necessarily what gets emitted at NAMENUM 1 for
   * every definition type (confirmed by sampling: definition 18190, a
   * Component Activate program, shows a blank stored owner row while the
   * reference object still carries the supplied component/event name).
   * `validateDefinition`'s own `sourceEncodeExact` already captures true
   * byte-level correctness for the owner row as part of the overall
   * program; excluding it here avoids a systematic false-positive
   * "first divergence" at index 0 for thousands of definitions whose
   * REAL (non-owner) reference stream is actually exact.
   */
  const generatedNoOwner = artifacts.references.filter(r => r.kind !== 'owner');
  const stored = storedNames.slice(1).map(sKeyOf);
  const generated = generatedNoOwner.map(gKeyOf);

  let firstDivergenceIndex = -1;
  const n = Math.max(stored.length, generated.length);
  for (let i = 0; i < n; i++) {
    if (stored[i] !== generated[i]) {
      firstDivergenceIndex = i;
      break;
    }
  }
  const referenceExact = firstDivergenceIndex === -1;

  const sortedStored = [...stored].sort();
  const sortedGenerated = [...generated].sort();
  const referenceSetExact = !referenceExact &&
    sortedStored.length === sortedGenerated.length &&
    sortedStored.every((v, i) => v === sortedGenerated[i]);

  let firstDivergenceKind: string | undefined;
  if (!referenceExact) {
    const g = generatedNoOwner[firstDivergenceIndex];
    firstDivergenceKind = g?.kind ?? 'stored-only';
  }

  return {
    referenceExact,
    referenceSetExact,
    storedCount: stored.length,
    generatedCount: generated.length,
    firstDivergenceIndex,
    firstDivergenceKind,
    encodeThrew: false
  };
}

type PrimaryCategory =
  | 'DECODER_BARE_IDENTIFIER'
  | 'DECODER_OTHER'
  | 'DECODE_SOURCE_MISMATCH'
  | 'UNSUPPORTED_SYNTAX'
  | 'UNKNOWN_OPCODE'
  | 'ENCODE_ERROR'
  | 'ROUNDTRIP_ONLY'
  | 'REFERENCE_COMPLETE_DOWNSTREAM'
  | 'REFERENCE_ACTIVE_RECORD'
  | 'REFERENCE_ACTIVE_FIELD'
  | 'REFERENCE_ACTIVE_SCROLL'
  | 'REFERENCE_ACTIVE_PACKAGE'
  | 'REFERENCE_ACTIVE_RECORD_FIELD'
  | 'REFERENCE_ACTIVE_QUOTED_COMPONENT'
  | 'REFERENCE_ACTIVE_DECLARE_FUNCTION'
  | 'REFERENCE_ACTIVE_OTHER'
  | 'STRUCTURAL_ORDERING'
  | 'UNKNOWN';

interface TaxonomyRow {
  definitionId: number;
  displayName: string;
  classification: string;
  sourceEncodeExact: boolean;
  roundtripExact: boolean;
  errorMessage?: string;
  construct?: string;
  firstDiffOffset?: number;
  primaryCategory: PrimaryCategory;
  referenceComparison?: {
    referenceExact: boolean;
    referenceSetExact: boolean;
    storedCount: number;
    generatedCount: number;
    firstDivergenceKind?: string;
  };
}

function classifyPrimary(
  result: any,
  refCompute: () => ReferenceComparison
): { category: PrimaryCategory; ref?: ReferenceComparison } {
  const errLower = (result.errorMessage ?? '').toLowerCase();

  if (result.classification === 'DECODE_ERROR') {
    return { category: 'DECODER_OTHER' };
  }
  if (result.classification === 'UNSUPPORTED_SYNTAX') {
    return { category: 'UNSUPPORTED_SYNTAX' };
  }
  if (result.classification === 'UNKNOWN_OPCODE') {
    return { category: 'UNKNOWN_OPCODE' };
  }
  if (result.classification === 'ENCODE_ERROR') {
    return { category: 'ENCODE_ERROR' };
  }
  if (result.classification === 'DECODE_SOURCE_MISMATCH') {
    if (errLower.includes('bare identifiers')) {
      return { category: 'DECODER_BARE_IDENTIFIER' };
    }
    return { category: 'DECODE_SOURCE_MISMATCH' };
  }
  // UNKNOWN_MISMATCH (decode ok, source matched, but not fully exact)
  if (result.sourceEncodeExact === true && result.roundtripExact === false) {
    return { category: 'ROUNDTRIP_ONLY' };
  }
  // Forward encode is NOT exact -- determine whether references are exact.
  const ref = refCompute();
  if (ref.encodeThrew) {
    return { category: 'UNKNOWN', ref };
  }
  if (ref.referenceExact) {
    return { category: 'REFERENCE_COMPLETE_DOWNSTREAM', ref };
  }
  if (ref.referenceSetExact) {
    return { category: 'STRUCTURAL_ORDERING', ref };
  }
  switch (ref.firstDivergenceKind) {
    case 'record': return { category: 'REFERENCE_ACTIVE_RECORD', ref };
    case 'field': return { category: 'REFERENCE_ACTIVE_FIELD', ref };
    case 'scroll': return { category: 'REFERENCE_ACTIVE_SCROLL', ref };
    case 'package': return { category: 'REFERENCE_ACTIVE_PACKAGE', ref };
    case 'record-field': return { category: 'REFERENCE_ACTIVE_RECORD_FIELD', ref };
    case 'component':
    case 'quoted-reference':
      return { category: 'REFERENCE_ACTIVE_QUOTED_COMPONENT', ref };
    case 'declare-function':
      return { category: 'REFERENCE_ACTIVE_DECLARE_FUNCTION', ref };
    default: return { category: 'REFERENCE_ACTIVE_OTHER', ref };
  }
}

async function main(): Promise<void> {
  const db = openSnapshotDatabase();
  const allDefs = listSnapshotDefinitions(db);
  // Cycle 107: the same snapshot class metadata `corpus:verify` gives the encoder.
  const applicationClassTypeMetadata = snapshotApplicationClassTypeMetadata(db);
  const conditionalCompilation = snapshotConditionalCompilation(db);
  console.log(`Total definitions: ${allDefs.length}`);

  const rows: TaxonomyRow[] = [];
  let exactCount = 0;
  let processed = 0;

  for (const def of allDefs) {
    processed++;
    if (processed % 3000 === 0) {
      console.log(`  ...processed ${processed}/${allDefs.length}`);
    }

    const definitionKey: CorpusDefinition = {
      offset: 0,
      key: {
        objectId1: def.objectid1, objectValue1: def.objectvalue1,
        objectId2: def.objectid2 ?? 0, objectValue2: def.objectvalue2 ?? '',
        objectId3: def.objectid3 ?? 0, objectValue3: def.objectvalue3 ?? '',
        objectId4: def.objectid4 ?? 0, objectValue4: def.objectvalue4 ?? '',
        objectId5: def.objectid5 ?? 0, objectValue5: def.objectvalue5 ?? '',
        objectId6: def.objectid6 ?? 0, objectValue6: def.objectvalue6 ?? '',
        objectId7: def.objectid7 ?? 0, objectValue7: def.objectvalue7 ?? ''
      },
      displayName: def.displayName
    };

    const capture = {
      definition: definitionKey,
      sourceRows: 1,
      source: def.sourceText,
      programRows: 1,
      program: def.storedProgram,
      names: def.names.map((row: any) => ({
        NAMENUM: row.namenum,
        RECNAME: row.recname,
        REFNAME: row.refname,
        PACKAGEROOT: row.packageroot,
        QUALIFYPATH: row.qualifypath,
        APPCLASSMETHOD: row.appclassmethod
      }))
    };

    let result;
    try {
      result = await validateDefinition(capture as any, { applicationClassTypeMetadata, conditionalCompilation });
    } catch (e) {
      rows.push({
        definitionId: def.definitionId,
        displayName: def.displayName,
        classification: 'HARNESS_ERROR',
        sourceEncodeExact: false,
        roundtripExact: false,
        errorMessage: String(e),
        primaryCategory: 'UNKNOWN'
      });
      continue;
    }

    if (result.classification === 'EXACT') {
      exactCount++;
      continue;
    }

    const owner = ownerContextOf(def);
    const { category, ref } = classifyPrimary(result, () => compareReferences(def.sourceText, owner, def.names, applicationClassTypeMetadata, conditionalCompilation));

    rows.push({
      definitionId: def.definitionId,
      displayName: def.displayName,
      classification: result.classification,
      sourceEncodeExact: result.sourceEncodeExact,
      roundtripExact: result.roundtripExact,
      errorMessage: result.errorMessage,
      construct: result.construct,
      firstDiffOffset: result.firstDiffOffset,
      primaryCategory: category,
      referenceComparison: ref
        ? {
            referenceExact: ref.referenceExact,
            referenceSetExact: ref.referenceSetExact,
            storedCount: ref.storedCount,
            generatedCount: ref.generatedCount,
            firstDivergenceKind: ref.firstDivergenceKind
          }
        : undefined
    });
  }

  db.close();

  console.log(`\nEXACT: ${exactCount}`);
  console.log(`NONEXACT: ${rows.length}`);
  console.log(`Total accounted: ${exactCount + rows.length} (should equal ${allDefs.length})`);

  // Aggregate by primary category.
  const byCategory = new Map<string, TaxonomyRow[]>();
  for (const row of rows) {
    const list = byCategory.get(row.primaryCategory) ?? [];
    list.push(row);
    byCategory.set(row.primaryCategory, list);
  }

  console.log('\n=== Primary category breakdown ===');
  const sorted = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [category, list] of sorted) {
    console.log(`  ${category.padEnd(32)} ${list.length}`);
  }

  // Forward byte-identical / roundtrip-exact baselines among NONEXACT.
  const forwardExactCount = rows.filter(r => r.sourceEncodeExact).length;
  const referenceExactCount = rows.filter(r => r.referenceComparison?.referenceExact === true).length;
  console.log(`\nAmong NONEXACT: forward-byte-identical (sourceEncodeExact) = ${forwardExactCount}`);
  console.log(`Among NONEXACT: reference-stream-exact = ${referenceExactCount}`);

  const outPath = path.join(__dirname, '../../../.claude/nonexact-taxonomy.json');
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), totalDefinitions: allDefs.length, exactCount, nonexactCount: rows.length, rows }, null, 1));
  console.log(`\nWrote ${outPath}`);
}

main();
