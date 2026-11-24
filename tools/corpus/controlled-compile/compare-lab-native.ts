/*
 * Compare the encoder with the lab database's OWN compiler output, for the
 * programs that a given PeopleTools release compiled there.
 *
 *   PSLAB_ACCESSID=... PSLAB_ACCESSPSWD=... \
 *     npx tsx tools/corpus/controlled-compile/compare-lab-native.ts --out <file.json> --since 2026-11-22 [--until 2026-11-23] [--release 8.62] [--sample N]
 *
 * Selects every PSPCMPROG program whose LASTUPDDTTM is in [since, until),
 * reads its PSPCMTXT source and PSPCMNAME rows, encodes the source under the
 * compiler profile of `--release` (default: the lab's own PSSTATUS.TOOLSREL)
 * with the lab's own Application Class metadata universe, and compares bytes
 * and reference rows with the stored ones.
 *
 * Use: when the lab is upgraded, the programs the upgrade rewrote are the new
 * release's native output (8.63.05: 2026-11-22). The older bulk compile
 * (8.62.09: 2026-05-08) is the control.
 *
 * SELECT only, in a READ ONLY transaction. The output holds keys, hashes,
 * lengths, verdicts and first-difference offsets only (no source text).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import oracledb from 'oracledb';

import { createApplicationClassTypeMetadataProvider, type ApplicationClassDefinition } from '../../../src/peoplecode/applicationClassTypeMetadata';
import { compilerProfileForToolsRelease } from '../../../src/peoplecode/compilerProfile';
import { isBuiltinObjectTypeName } from '../../../src/peoplecode/encoder';
import { encodeAsHarness, generatedReferenceKey, openHarnessContext } from '../research/lib/harnessContext';

oracledb.fetchAsString = [oracledb.CLOB];
oracledb.fetchAsBuffer = [oracledb.BLOB];

const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const firstDiff = (a: Buffer, b: Buffer): number | null => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? null : Math.min(a.length, b.length);
};
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};

async function main(): Promise<void> {
  const out = arg('--out'), since = arg('--since');
  if (!out || !since) throw new Error('usage: compare-lab-native.ts --out <file.json> --since YYYY-MM-DD [--until YYYY-MM-DD] [--release 8.6x] [--sample N]');
  const until = arg('--until') ?? '9999-12-31';
  const sample = arg('--sample') === undefined ? undefined : Number(arg('--sample'));
  const ctx = openHarnessContext();
  const connection = await oracledb.getConnection({
    user: process.env.PSLAB_ACCESSID,
    password: process.env.PSLAB_ACCESSPSWD,
    connectString: process.env.PSLAB_AUDIT_CONNECT ?? '127.0.0.1:15210/hrdmo'
  });
  const object = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const results: any[] = [];
  let labRelease = '', profileId = '';
  try {
    await connection.execute('SET TRANSACTION READ ONLY');
    const [toolsRelease, patch] = ((await connection.execute(`SELECT TOOLSREL, PTPATCHREL FROM SYSADM.PSSTATUS`)).rows as [string, number][])[0];
    labRelease = `${toolsRelease}.${String(patch).padStart(2, '0')}`;
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
    const profile = compilerProfileForToolsRelease(arg('--release') ?? toolsRelease, {
      patchLevel: Number(patch),
      applicationClassTypeMetadata: createApplicationClassTypeMetadataProvider(labClasses.values(), { isBuiltinType: isBuiltinObjectTypeName })
    });
    profileId = profile.id;
    console.error(`lab ${labRelease}; ${labClasses.size} Application Classes; encoding under ${profile.id}`);

    const cols = [1, 2, 3, 4, 5, 6, 7].flatMap(i => [`OBJECTID${i}`, `OBJECTVALUE${i}`]).join(', ');
    let keys = (await connection.execute(
      `SELECT ${cols}, TO_CHAR(MAX(LASTUPDDTTM), 'YYYY-MM-DD HH24:MI:SS') T, MAX(LASTUPDOPRID) O FROM SYSADM.PSPCMPROG
        WHERE LASTUPDDTTM >= TO_DATE(:since, 'YYYY-MM-DD') AND LASTUPDDTTM < TO_DATE(:until, 'YYYY-MM-DD')
        GROUP BY ${cols} ORDER BY ${cols}`, { since, until }, object)).rows as any[];
    if (sample !== undefined && keys.length > sample) {
      const step = keys.length / sample;
      keys = Array.from({ length: sample }, (_, i) => keys[Math.floor(i * step)]);
    }
    console.error(`${keys.length} programs`);
    let n = 0;
    for (const k of keys) {
      if (++n % 250 === 0) console.error(`${n} / ${keys.length}`);
      const binds: Record<string, unknown> = {};
      const where = [1, 2, 3, 4, 5, 6, 7].map(i => {
        binds[`i${i}`] = k[`OBJECTID${i}`];
        binds[`v${i}`] = k[`OBJECTVALUE${i}`];
        return `OBJECTID${i} = :i${i} AND OBJECTVALUE${i} = :v${i}`;
      }).join(' AND ');
      const def: any = { names: [] };
      for (let i = 1; i <= 7; i++) { def[`objectid${i}`] = k[`OBJECTID${i}`]; def[`objectvalue${i}`] = k[`OBJECTVALUE${i}`]; }
      const key = [1, 2, 3, 4, 5, 6, 7].map(i => `${k[`OBJECTID${i}`]}:${String(k[`OBJECTVALUE${i}`] ?? '').trim()}`).filter(s => !s.startsWith('0:')).join('|');
      const prog = (await connection.execute(`SELECT PROGTXT FROM SYSADM.PSPCMPROG WHERE ${where} ORDER BY PROGSEQ`, binds, object)).rows as any[];
      const text = (await connection.execute(`SELECT PCTEXT FROM SYSADM.PSPCMTXT WHERE ${where} ORDER BY PROGSEQ`, binds, object)).rows as any[];
      const names = (await connection.execute(`SELECT RECNAME, REFNAME FROM SYSADM.PSPCMNAME WHERE ${where} ORDER BY NAMENUM`, binds, object)).rows as any[];
      const stored = Buffer.concat(prog.map(r => r.PROGTXT as Buffer));
      const storedNames = names.map(r => `${String(r.RECNAME ?? '').trim().toUpperCase()}.${String(r.REFNAME ?? '').trim().toUpperCase()}`);
      if (text.length === 0) { results.push({ key, lastUpdated: k.T, noSource: true }); continue; }
      def.sourceText = text.map(r => r.PCTEXT as string).join('');
      const encoded = encodeAsHarness(ctx, def, { profile });
      const program = encoded.artifacts?.program;
      const generated = encoded.artifacts && [...(encoded.artifacts as any).references].sort((x: any, y: any) => x.sequence - y.sequence).map(generatedReferenceKey);
      const bytesExact = program !== undefined && Buffer.compare(program, stored) === 0;
      const namesExact = generated !== undefined && JSON.stringify(generated) === JSON.stringify(storedNames);
      results.push({
        key, lastUpdated: k.T, lastUpdatedBy: k.O,
        toolsRelDirective: /#ToolsRel/i.test(def.sourceText),
        sourceSha256: sha(def.sourceText.replace(/\r\n/g, '\n')),
        storedBytes: stored.length, storedSha256: sha(stored), generatedBytes: program?.length ?? null,
        bytesExact, namesExact, firstByteDifference: program === undefined ? null : firstDiff(program, stored),
        headerExact: program !== undefined && Buffer.compare(program.subarray(0, 37), stored.subarray(0, 37)) === 0,
        nameRows: [generated?.length ?? null, storedNames.length],
        ...(encoded.error ? { error: encoded.error } : {})
      });
    }
  } finally {
    await connection.close();
  }
  const compiled = results.filter(r => !r.noSource);
  const exact = compiled.filter(r => r.bytesExact && r.namesExact);
  const notExact = compiled.filter(r => !(r.bytesExact && r.namesExact));
  const summary = {
    labRelease, profile: profileId, since, until,
    programs: results.length, withoutSource: results.length - compiled.length,
    exact: exact.length, notExact: notExact.length,
    encodeErrors: notExact.filter(r => r.error).length,
    bytesOnlyDiffer: notExact.filter(r => !r.error && !r.bytesExact && r.namesExact).length,
    namesOnlyDiffer: notExact.filter(r => !r.error && r.bytesExact && !r.namesExact).length,
    bothDiffer: notExact.filter(r => !r.error && !r.bytesExact && !r.namesExact).length,
    headerDiffers: notExact.filter(r => !r.error && !r.headerExact).length,
    toolsRelDirectivePrograms: compiled.filter(r => r.toolsRelDirective).length,
    toolsRelDirectiveExact: exact.filter(r => r.toolsRelDirective).length
  };
  fs.writeFileSync(out, `${JSON.stringify({ format: 'pcode-lab-native-comparison/1', capturedAt: new Date().toISOString(), summary, notExact, exactKeys: exact.map(r => r.key) }, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
