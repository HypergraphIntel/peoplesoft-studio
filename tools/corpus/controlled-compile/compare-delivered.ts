/*
 * Cycle 183: compare HCDEV definitions with the SAME delivered definition
 * in the lab database, compiled by PeopleTools 8.62.09 itself (HRDMO: every
 * delivered program was compiled in one run on 2026-05-08).
 *
 *   PSLAB_ACCESSID=... PSLAB_ACCESSPSWD=... \
 *     npx tsx tools/corpus/controlled-compile/compare-delivered.ts --out <file.json> <definitionId> ...
 *     npx tsx tools/corpus/controlled-compile/compare-delivered.ts --out <file.json> --all
 *
 * For each HCDEV definition (LOCAL SNAPSHOT) it reads the lab's
 * PSPCMPROG / PSPCMNAME / PSPCMTXT for the same 7-part key -- SELECT only,
 * in a READ ONLY transaction, never a write -- and compares:
 * - the source (line endings normalized), and for a lossy HCDEV source the
 *   recovered historical source (historicalSource.ts);
 * - HCDEV stored vs lab stored (bytes, PSPCMNAME rows);
 * - encoder(lab source, under the lab's compiler profile: its release and
 *   its own App Class metadata) vs lab stored;
 * - encoder(HCDEV source) vs HCDEV stored.
 * The output holds hashes, lengths, counts, verdicts and definition ids
 * only (no delivered source or program text).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import oracledb from 'oracledb';

import { createApplicationClassTypeMetadataProvider, type ApplicationClassDefinition } from '../../../src/peoplecode/applicationClassTypeMetadata';
import { compilerProfileForToolsRelease, type CompilerProfile } from '../../../src/peoplecode/compilerProfile';
import { recoverHistoricalSource } from '../../../src/peoplecode/corpus/historicalSource';
import { isBuiltinObjectTypeName } from '../../../src/peoplecode/encoder';
import { decodeAsHarness, encodeAsHarness, generatedReferenceKey, openHarnessContext, storedNameTable, storedReferenceKeys } from '../research/lib/harnessContext';

oracledb.fetchAsString = [oracledb.CLOB];
oracledb.fetchAsBuffer = [oracledb.BLOB];

const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const norm = (s: string) => s.replace(/\r\n/g, '\n');
const firstDiff = (a: Buffer, b: Buffer): number | null => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? null : Math.min(a.length, b.length);
};

interface Verdict { bytesExact: boolean; firstByteDifference: number | null; namesExact: boolean; nameRows: [number | null, number] }

function verdict(program: Buffer | undefined, generated: string[] | undefined, refProgram: Buffer, refNames: string[]): Verdict {
  return {
    bytesExact: program !== undefined && Buffer.compare(program, refProgram) === 0,
    firstByteDifference: program === undefined ? null : firstDiff(program, refProgram),
    namesExact: generated !== undefined && JSON.stringify(generated) === JSON.stringify(refNames),
    nameRows: [generated?.length ?? null, refNames.length]
  };
}
const exact = (v: Verdict) => v.bytesExact && v.namesExact;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  if (outIndex < 0) throw new Error('usage: compare-delivered.ts --out <file.json> (--all | <definitionId> ...)');
  const out = args[outIndex + 1];
  const all = args.includes('--all');
  const ids = args.filter((a, i) => i !== outIndex && i !== outIndex + 1 && a !== '--all').map(Number);
  if (!all && (ids.length === 0 || ids.some(id => !Number.isInteger(id)))) throw new Error('definition ids must be integers');
  const ctx = openHarnessContext();
  const definitions = all ? ctx.definitions : ids.map(id => {
    const def = ctx.definitions.find(d => d.definitionId === id);
    if (def === undefined) throw new Error(`definition ${id} is not in the snapshot`);
    return def;
  });
  const connection = await oracledb.getConnection({
    user: process.env.PSLAB_ACCESSID,
    password: process.env.PSLAB_ACCESSPSWD,
    connectString: process.env.PSLAB_AUDIT_CONNECT ?? '127.0.0.1:15210/hrdmo'
  });
  const results: any[] = [];
  let release = '', toolsRelease = '', patch = 0;
  try {
    await connection.execute('SET TRANSACTION READ ONLY');
    [toolsRelease, release, patch] = ((await connection.execute(`SELECT TOOLSREL, TOOLSREL || '.' || PTPATCHREL, PTPATCHREL FROM SYSADM.PSSTATUS`)).rows as [string, string, number][])[0];
    const object = { outFormat: oracledb.OUT_FORMAT_OBJECT };
    /*
     * 8.62 track: the lab's source is typed against the LAB's own
     * Application Classes (23497's newer revision calls BDG_FUNCTIONS:
     * GiveBadge, a class HCDEV does not have).
     */
    const labClasses = new Map<string, ApplicationClassDefinition>();
    for (const row of (await connection.execute(`SELECT OBJECTVALUE1 A, OBJECTVALUE2 B, OBJECTVALUE3 C, OBJECTVALUE4 D, OBJECTVALUE5 E, OBJECTVALUE6 F, OBJECTVALUE7 G, PCTEXT T FROM SYSADM.PSPCMTXT WHERE OBJECTID1 = 104 ORDER BY 1, 2, 3, 4, 5, 6, 7, PROGSEQ`, {}, object)).rows as any[]) {
      const values = [row.A, row.B, row.C, row.D, row.E, row.F, row.G].map((v: unknown) => String(v ?? '').trim());
      const event = values.findIndex(v => v.toLowerCase() === 'onexecute');
      const path = values.slice(0, event < 0 ? values.length : event).filter(Boolean);
      const key = path.join(':');
      const entry = labClasses.get(key) ?? { path, source: '' };
      entry.source += String(row.T ?? '');
      labClasses.set(key, entry);
    }
    /*
     * Cycle 184: the lab's source is encoded under the lab's compiler profile:
     * its own release (TOOLSREL -> PT862 for 8.62; an unsupported release
     * throws) with the lab's metadata universe.
     */
    const labProfile: CompilerProfile = compilerProfileForToolsRelease(toolsRelease, {
      patchLevel: Number(patch),
      applicationClassTypeMetadata: createApplicationClassTypeMetadataProvider(labClasses.values(), { isBuiltinType: isBuiltinObjectTypeName })
    });
    console.error(`lab Application Classes: ${labClasses.size}; compiler profile ${labProfile.id} (PeopleTools ${labProfile.toolsRelease}, patch ${labProfile.patchLevel})`);
    let n = 0;
    for (const d of definitions) {
      const def = d as any;
      if (++n % 1000 === 0) console.error(`${n} / ${definitions.length}`);
      const binds: Record<string, unknown> = {};
      const where = [1, 2, 3, 4, 5, 6, 7].map(i => {
        binds[`i${i}`] = def[`objectid${i}`];
        binds[`v${i}`] = def[`objectvalue${i}`];
        return `OBJECTID${i} = :i${i} AND OBJECTVALUE${i} = :v${i}`;
      }).join(' AND ');
      const prog = (await connection.execute(`SELECT PROGTXT, TO_CHAR(LASTUPDDTTM, 'YYYY-MM-DD HH24:MI:SS') T, LASTUPDOPRID O FROM SYSADM.PSPCMPROG WHERE ${where} ORDER BY PROGSEQ`, binds, object)).rows as any[];
      if (prog.length === 0) { results.push({ definitionId: def.definitionId, lab: 'absent' }); continue; }
      const text = (await connection.execute(`SELECT PCTEXT FROM SYSADM.PSPCMTXT WHERE ${where} ORDER BY PROGSEQ`, binds, object)).rows as any[];
      const names = (await connection.execute(`SELECT RECNAME, REFNAME FROM SYSADM.PSPCMNAME WHERE ${where} ORDER BY NAMENUM`, binds, object)).rows as any[];
      const labProgram = Buffer.concat(prog.map(r => r.PROGTXT as Buffer));
      const labSource = text.map(r => r.PCTEXT as string).join('');
      const labNames = names.map(r => `${String(r.RECNAME ?? '').trim().toUpperCase()}.${String(r.REFNAME ?? '').trim().toUpperCase()}`);
      const hcdevNames = storedReferenceKeys(def);
      const keys = (a: any) => [...a.references].sort((x: any, y: any) => x.sequence - y.sequence).map(generatedReferenceKey);
      // The lab's source compiles under the lab's profile: `#If #ToolsRel` blocks
      // (8.62 track: 4601 4602 18249 18256) take the 8.62 branch there.
      const fromLab = encodeAsHarness(ctx, { ...def, sourceText: labSource }, { profile: labProfile });
      const fromHcdev = encodeAsHarness(ctx, def);
      let recoveredMatchesLab: boolean | undefined;
      if (norm(labSource) !== norm(def.sourceText)) {
        try {
          const recovery = recoverHistoricalSource(def.sourceText, decodeAsHarness(def, def.storedProgram, storedNameTable(def)).text);
          if (recovery !== undefined) recoveredMatchesLab = norm(recovery.text) === norm(labSource);
        } catch { /* undecodable */ }
      }
      results.push({
        definitionId: def.definitionId,
        displayName: def.displayName,
        lab: { lastUpdated: prog[0].T, lastUpdatedBy: prog[0].O, programBytes: labProgram.length, programSha256: sha(labProgram), sourceSha256: sha(norm(labSource)), nameRows: labNames.length },
        hcdev: { programBytes: def.storedProgram.length, programSha256: sha(def.storedProgram), sourceSha256: sha(norm(def.sourceText)), nameRows: hcdevNames.length },
        sameSource: norm(labSource) === norm(def.sourceText),
        ...(recoveredMatchesLab !== undefined ? { recoveredSourceMatchesLabSource: recoveredMatchesLab } : {}),
        hcdevStoredVsLabStored: verdict(def.storedProgram, hcdevNames, labProgram, labNames),
        encoderLabSourceVsLabStored: verdict(fromLab.artifacts?.program, fromLab.artifacts && keys(fromLab.artifacts), labProgram, labNames),
        encoderHcdevSourceVsHcdevStored: verdict(fromHcdev.artifacts?.program, fromHcdev.artifacts && keys(fromHcdev.artifacts), def.storedProgram, hcdevNames),
        ...(fromLab.error ? { encoderLabSourceError: fromLab.error } : {})
      });
    }
  } finally {
    await connection.close();
  }

  const present = results.filter(r => r.lab !== 'absent');
  const same = present.filter(r => r.sameSource), recovered = present.filter(r => r.recoveredSourceMatchesLabSource === true);
  const ids_ = (rows: any[]) => rows.map(r => r.definitionId);
  const summary = {
    definitions: results.length,
    presentInLab: present.length,
    encoderLabSourceVsLabStored: { exact: present.filter(r => exact(r.encoderLabSourceVsLabStored)).length, notExact: ids_(present.filter(r => !exact(r.encoderLabSourceVsLabStored))) },
    sameSource: {
      count: same.length,
      hcdevStoredEqualsLabStored: same.filter(r => exact(r.hcdevStoredVsLabStored)).length,
      hcdevStoredDiffersFromLabStored: ids_(same.filter(r => !exact(r.hcdevStoredVsLabStored))),
      encoderEqualsLabStored: same.filter(r => exact(r.encoderLabSourceVsLabStored)).length,
      encoderDiffersFromLabStored: ids_(same.filter(r => !exact(r.encoderLabSourceVsLabStored)))
    },
    recoveredSourceEqualsLabSource: { count: recovered.length, ids: ids_(recovered), mismatched: ids_(present.filter(r => r.recoveredSourceMatchesLabSource === false)) }
  };
  const report = { format: 'pcode-lab-delivered-comparison/1', labRelease: release, capturedAt: new Date().toISOString(), summary, ...(all ? { differences: present.filter(r => !r.sameSource || !exact(r.hcdevStoredVsLabStored) || !exact(r.encoderLabSourceVsLabStored)) } : { results }) };
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(summary, (k, v) => (Array.isArray(v) && v.length > 40 ? `${v.length} ids` : v), 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
