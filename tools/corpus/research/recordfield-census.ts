/*
 * Compiler-completion goal: full census of the REFERENCE_ACTIVE_RECORD_FIELD
 * population (currently the single largest NONEXACT category, 1,245
 * definitions) -- the first structural PSPCMNAME divergence, for these
 * definitions, is a `record-field` kind reference (RECNAME.REFNAME both
 * populated, e.g. an ordinary `RECORD.FIELD` dotted reference or an
 * `HTML.name` reference).
 *
 * Reuses validateDefinition (no parallel pass/fail logic) and replicates
 * ONLY the reference-stream comparator already proven correct in
 * cycle73-nonexact-taxonomy.ts (gKeyOf/sKeyOf/ownerContextOf), so this
 * script's own classification cannot drift from the authoritative
 * taxonomy's own category boundaries.
 *
 * Decomposes by:
 *   - source form (HTML.name vs ordinary RECORD.FIELD)
 *   - App Class vs ordinary
 *   - stored/generated count delta sign (missing vs extra vs reordered)
 *   - one-blocker-away (does the record-field kind explain the ENTIRE
 *     divergence, i.e. is referenceSetExact true once this one kind is
 *     accounted for?)
 *
 * Usage: npx tsx tools/corpus/research/recordfield-census.ts
 */
import fs from 'node:fs';
import path from 'node:path';

import { openSnapshotDatabase } from '../snapshot/store';
import { getSnapshotDefinition, snapshotToCorpusDefinition } from '../snapshot/reader';
import { validateDefinition } from '../validator';
import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';

const TAXONOMY_PATH = path.join(__dirname, '../../../.claude/nonexact-taxonomy.json');
const OUT_PATH = path.join(__dirname, '../../../.claude/recordfield-census.json');

function ownerContextOf(snap: any) {
  const values = [snap.objectvalue1, snap.objectvalue2, snap.objectvalue3, snap.objectvalue4, snap.objectvalue5, snap.objectvalue6, snap.objectvalue7].map((v: string) => (v ?? '').trim());
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  const packagePath = values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean);
  return { recordName: values[0], fieldName: values[1], packagePath };
}

function gKeyOf(g: any): string {
  switch (g.kind) {
    case 'owner':
      return (g.recordName || g.fieldName) ? `${(g.recordName ?? '').toUpperCase()}.${(g.fieldName ?? '').toUpperCase()}` : '.';
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

function sKeyOf(row: any): string {
  return `${row.recname.trim().toUpperCase()}.${row.refname.trim().toUpperCase()}`;
}

async function main() {
  const taxonomy = JSON.parse(fs.readFileSync(TAXONOMY_PATH, 'utf8'));
  const ids: number[] = taxonomy.rows
    .filter((r: any) => r.primaryCategory === 'REFERENCE_ACTIVE_RECORD_FIELD')
    .map((r: any) => r.definitionId);

  console.log(`REFERENCE_ACTIVE_RECORD_FIELD population: ${ids.length}`);

  const db = openSnapshotDatabase();
  const rows: any[] = [];

  for (const id of ids) {
    const snap = getSnapshotDefinition(db, id);
    const owner = ownerContextOf(snap);

    let artifacts;
    let encodeThrew = false;
    try {
      artifacts = encodeProgramArtifacts(snap.sourceText, { owner } as any);
    } catch {
      encodeThrew = true;
    }

    const capture = {
      definition: snapshotToCorpusDefinition(snap, 0),
      sourceRows: 1, source: snap.sourceText,
      programRows: 1, program: snap.storedProgram,
      names: snap.names.map((row: any) => ({ NAMENUM: row.namenum, RECNAME: row.recname, REFNAME: row.refname, PACKAGEROOT: row.packageroot, QUALIFYPATH: row.qualifypath, APPCLASSMETHOD: row.appclassmethod }))
    };
    const result: any = await validateDefinition(capture as any);

    if (encodeThrew || !artifacts) {
      rows.push({ definitionId: id, appClass: snap.objectid1 === 104, encodeThrew: true });
      continue;
    }

    const generatedNoOwner = artifacts.references.filter((r: any) => r.kind !== 'owner');
    const stored = snap.names.slice(1).map(sKeyOf);
    const generated = generatedNoOwner.map(gKeyOf);

    let firstDivergenceIndex = -1;
    const n = Math.max(stored.length, generated.length);
    for (let i = 0; i < n; i++) {
      if (stored[i] !== generated[i]) { firstDivergenceIndex = i; break; }
    }
    const firstDivGen = generatedNoOwner[firstDivergenceIndex];
    const firstDivStoredKey = stored[firstDivergenceIndex];
    const firstDivGeneratedKey = generated[firstDivergenceIndex];

    const isHtml = firstDivGen?.kind === 'record-field' && firstDivGen?.recordName === 'HTML';

    rows.push({
      definitionId: id,
      appClass: snap.objectid1 === 104,
      objectid1: snap.objectid1,
      storedCount: stored.length,
      generatedCount: generated.length,
      countDelta: generated.length - stored.length,
      firstDivergenceIndex,
      firstDivStoredKey,
      firstDivGeneratedKey,
      firstDivGenKind: firstDivGen?.kind,
      isHtmlForm: isHtml,
      classification: result.classification,
      roundtripExact: result.roundtripExact,
      sourceEncodeExact: result.sourceEncodeExact
    });
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), count: rows.length, rows }, null, 2));
  console.log(`Wrote ${OUT_PATH}`);

  const appClassCount = rows.filter(r => r.appClass).length;
  console.log(`App Class: ${appClassCount} / Ordinary: ${rows.length - appClassCount}`);

  const htmlCount = rows.filter(r => r.isHtmlForm).length;
  console.log(`HTML.name form: ${htmlCount} / Ordinary RECORD.FIELD form: ${rows.length - htmlCount - rows.filter(r=>r.encodeThrew).length} / encodeThrew: ${rows.filter(r=>r.encodeThrew).length}`);

  const deltaHist: Record<string, number> = {};
  for (const r of rows) {
    if (r.encodeThrew) continue;
    const key = r.countDelta === 0 ? 'same' : r.countDelta < 0 ? 'generated-fewer' : 'generated-more';
    deltaHist[key] = (deltaHist[key] ?? 0) + 1;
  }
  console.log('Count delta direction:', deltaHist);

  const deltaMagnitude: Record<string, number> = {};
  for (const r of rows) {
    if (r.encodeThrew) continue;
    deltaMagnitude[r.countDelta] = (deltaMagnitude[r.countDelta] ?? 0) + 1;
  }
  console.log('Count delta histogram (top 20):', Object.entries(deltaMagnitude).sort((a,b)=>b[1]-a[1]).slice(0,20));

  // sample some concrete first-divergence stored/generated key pairs
  console.log('\nSample first divergences (first 20):');
  for (const r of rows.slice(0, 20)) {
    console.log(' ', r.definitionId, 'stored=' + r.firstDivStoredKey, 'generated=' + r.firstDivGeneratedKey, 'kind=' + r.firstDivGenKind, 'appClass=' + r.appClass);
  }
}

main();
