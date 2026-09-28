/*
 * Cycle 74 Phase 1-8 (mandatory full-population census): Cycle 73's
 * taxonomy found `REFERENCE_ACTIVE_PACKAGE` (1,508 definitions, 21.7% of
 * NONEXACT) as the single largest NONEXACT category, with a
 * 40-definition sample showing a ~100% one-directional "missing
 * allocation" pattern across several built-in object types.
 *
 * Direct code inspection found the likely root causes BEFORE this
 * census (confirmed/refined by it, not replacing it):
 *
 * 1. The "Local <Type> &x;" declaration dispatch (~encoder.ts line 1150)
 *    recognizes exactly 11 built-in types (Record, Field, Rowset, Row,
 *    SQL, File, XmlDoc, XmlNode, ApiObject, Grid, ProcessRequest) --
 *    Message, ObjectManager, Page, GridColumn are entirely absent from
 *    this dispatch (Model A: type coverage omission).
 * 2. Function/method PARAMETER typing (`&x As Type`, ~encoder.ts line
 *    5543) only recognizes Record/Row (via `registerTypedParameter`) --
 *    every OTHER built-in type used as a parameter (including the other
 *    9 types the Local-declaration dispatch DOES cover) allocates NO
 *    PACKAGE row as a parameter (Model B: source-form coverage
 *    omission).
 *
 * This census rebuilds the full 1,508-definition population fresh,
 * extracts the EXACT missing PACKAGE identity's declared type name via
 * structural reference comparison (not REFNAME text alone), classifies
 * each by (a) whether stored/generated counts show a pure one-directional
 * missing-allocation shape vs. something else (wrong identity/order/
 * duplicate), and (b) a best-effort source-form classification (Local
 * declaration vs parameter vs other) via targeted regex search near the
 * missing type's own declaration context.
 *
 * Read-only, no encoder changes.
 *
 * Usage: npx tsx tools/corpus/research/cycle74-package-missing-allocation-census.ts
 */
import fs from 'node:fs';
import path from 'node:path';

import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';

const APPLICATION_CLASS_OBJECT_ID = 104;

/*
 * Phase 1 correction: an earlier version of this script re-derived
 * REFERENCE_ACTIVE_PACKAGE membership independently (by running
 * encodeProgramArtifacts directly against ALL 30,209 definitions and
 * checking whether the first structural divergence happened to be
 * package-kind), rather than reusing Cycle 73's own taxonomy result.
 * This produced 1,936 candidates, not the expected 1,508 -- because it
 * skipped the authoritative classification priority `validateDefinition`/
 * `classifyResult` apply (decode success, source match, etc. checked
 * FIRST): a definition that is ALSO independently blocked by a decoder
 * issue can still show a package-kind first reference divergence, but
 * Cycle 73's own taxonomy correctly excludes it from
 * `REFERENCE_ACTIVE_PACKAGE` (it belongs to `DECODER_BARE_IDENTIFIER`/
 * `DECODE_SOURCE_MISMATCH` instead, whichever the classifier reaches
 * first). Loading Cycle 73's own precomputed, validator-cross-checked
 * list directly (rather than re-deriving it) avoids this drift entirely.
 */
function loadPackageActiveDefinitionIds(): Set<number> {
  const taxonomyPath = path.join(__dirname, '../../../.claude/nonexact-taxonomy.json');
  const data = JSON.parse(fs.readFileSync(taxonomyPath, 'utf8'));
  const ids = data.rows
    .filter((r: any) => r.primaryCategory === 'REFERENCE_ACTIVE_PACKAGE')
    .map((r: any) => r.definitionId);
  return new Set(ids);
}

function ownerContextOf(def: any) {
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7].map((v: string) => (v ?? '').trim());
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  return { recordName: values[0], fieldName: values[1], packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean) };
}

function sKeyOf(row: any): string {
  return `${row.recname.trim().toUpperCase()}.${row.refname.trim().toUpperCase()}`;
}

function gKeyOf(g: any): string {
  switch (g.kind) {
    case 'package': return `PACKAGE.${(g.packageName ?? '').toUpperCase()}`;
    case 'scroll': return `SCROLL.${(g.recordName ?? '').toUpperCase()}`;
    case 'record': return `RECORD.${(g.recordName ?? '').toUpperCase()}`;
    case 'field': return `FIELD.${(g.fieldName ?? '').toUpperCase()}`;
    case 'record-field': return `${(g.recordName ?? '').toUpperCase()}.${(g.fieldName ?? '').toUpperCase()}`;
    case 'component': return `COMPONENT.${(g.objectName ?? '').toUpperCase()}`;
    case 'declare-function': return `${(g.recordName ?? '').toUpperCase()}.${(g.fieldName ?? '').toUpperCase()}`;
    case 'quoted-reference': return `${(g.recordName ?? '').toUpperCase()}.${(g.fieldName ?? '').toUpperCase()}`;
    default: return JSON.stringify(g);
  }
}

function main(): void {
  const packageActiveIds = loadPackageActiveDefinitionIds();
  console.log(`Loaded ${packageActiveIds.size} REFERENCE_ACTIVE_PACKAGE definition IDs from Cycle 73's own taxonomy.`);

  const db = openSnapshotDatabase();
  const allDefs = listSnapshotDefinitions(db).filter(def => packageActiveIds.has(def.definitionId));

  let processed = 0;
  let pureMissing = 0;
  let notPureMissing = 0;
  let encodeErrors = 0;

  const missingTypeCounts = new Map<string, number>();
  const missingTypeDefinitionIds = new Map<string, Set<number>>();
  const appClassCount = { total: 0, pureMissing: 0 };
  const ordinaryCount = { total: 0, pureMissing: 0 };

  // Source-form classification samples per type, for later manual review.
  const sourceFormByType = new Map<string, { local: number; parameter: number; other: number }>();

  for (const def of allDefs) {
    const owner = ownerContextOf(def);
    let artifacts;
    try {
      artifacts = encodeProgramArtifacts(def.sourceText, { owner } as any);
    } catch {
      continue;
    }

    const generatedNoOwner = artifacts.references.filter((r: any) => r.kind !== 'owner');
    const stored = def.names.slice(1).map(sKeyOf);
    const generated = generatedNoOwner.map(gKeyOf);

    let firstDivergenceIndex = -1;
    const n = Math.max(stored.length, generated.length);
    for (let i = 0; i < n; i++) {
      if (stored[i] !== generated[i]) {
        firstDivergenceIndex = i;
        break;
      }
    }
    if (firstDivergenceIndex === -1) continue; // reference-exact, not in this population
    const g = generatedNoOwner[firstDivergenceIndex];
    const kind = g?.kind ?? 'stored-only';
    if (kind !== 'package') continue; // not REFERENCE_ACTIVE_PACKAGE

    processed++;
    const isAppClass = def.objectid1 === APPLICATION_CLASS_OBJECT_ID;
    (isAppClass ? appClassCount : ordinaryCount).total++;

    // Determine if this is a "pure missing allocation": stored contains a
    // PACKAGE.X entry that never appears anywhere in generated, with
    // generated otherwise being a subsequence of stored (i.e. removing
    // the missing entries from stored recovers generated, or generated
    // has fewer PACKAGE rows overall for this X).
    const storedSet = new Set(stored);
    const generatedSet = new Set(generated);
    const missingInGenerated = [...storedSet].filter(k => k.startsWith('PACKAGE.') && !generatedSet.has(k));
    const extraInGenerated = [...generatedSet].filter(k => k.startsWith('PACKAGE.') && !storedSet.has(k));

    if (missingInGenerated.length > 0 && extraInGenerated.length === 0) {
      pureMissing++;
      (isAppClass ? appClassCount : ordinaryCount).pureMissing++;
      for (const missing of missingInGenerated) {
        const typeName = missing.replace('PACKAGE.', '');
        missingTypeCounts.set(typeName, (missingTypeCounts.get(typeName) ?? 0) + 1);
        if (!missingTypeDefinitionIds.has(typeName)) missingTypeDefinitionIds.set(typeName, new Set());
        missingTypeDefinitionIds.get(typeName)!.add(def.definitionId);

        // Best-effort source-form classification: search for the type
        // name near "Local <Type>" or "As <Type>" in the source text.
        const typeNameLower = typeName.toLowerCase();
        // Map common PACKAGE names back to their PeopleCode type keyword
        // where they differ (best-effort, not exhaustive).
        const keyword = typeNameLower;
        const localRegex = new RegExp(`\\bLocal\\s+${keyword}\\b`, 'i');
        const paramRegex = new RegExp(`\\bAs\\s+${keyword}\\b`, 'i');
        if (!sourceFormByType.has(typeName)) sourceFormByType.set(typeName, { local: 0, parameter: 0, other: 0 });
        const bucket = sourceFormByType.get(typeName)!;
        if (localRegex.test(def.sourceText)) bucket.local++;
        else if (paramRegex.test(def.sourceText)) bucket.parameter++;
        else bucket.other++;
      }
    } else {
      notPureMissing++;
    }
  }

  db.close();

  console.log(`REFERENCE_ACTIVE_PACKAGE population reconstructed: ${processed}`);
  console.log(`Pure missing-allocation (stored has PACKAGE.X, generated lacks it entirely, no extras): ${pureMissing}`);
  console.log(`NOT pure missing (wrong identity/order/duplicate/mixed): ${notPureMissing}`);
  console.log(`\nApplication Class: ${appClassCount.total} total, ${appClassCount.pureMissing} pure-missing`);
  console.log(`Ordinary PeopleCode: ${ordinaryCount.total} total, ${ordinaryCount.pureMissing} pure-missing`);

  console.log('\n=== Missing PACKAGE type breakdown (occurrence count / distinct definitions) ===');
  const sortedTypes = [...missingTypeCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sortedTypes) {
    const distinctDefs = missingTypeDefinitionIds.get(type)!.size;
    const form = sourceFormByType.get(type)!;
    console.log(`  ${type.padEnd(20)} occurrences=${count.toString().padEnd(6)} definitions=${distinctDefs.toString().padEnd(6)} local=${form.local} parameter=${form.parameter} other=${form.other}`);
  }
}

main();
