/*
 * A local fixture of lab-database programs, so encoder work on lab-only
 * programs runs offline like snapshot work (no Oracle per iteration).
 *
 *   capture (SELECT only, READ ONLY transaction):
 *     PSLAB_ACCESSID=... PSLAB_ACCESSPSWD=... npx tsx tools/corpus/controlled-compile/lab-fixture.ts capture \
 *       --from <compare-lab-native report.json> --out tools/corpus/reports/<name>.fixture.json
 *     captures every notExact program of the report, plus the lab's Application
 *     Class sources (the metadata universe).
 *
 *   replay:
 *     npx tsx tools/corpus/controlled-compile/lab-fixture.ts replay --fixture <file> [--key <substring>] [--verbose]
 *     encodes each program under the fixture's release profile and lab metadata,
 *     reports bytes / PSPCMNAME verdicts; --verbose adds the decoded-text and
 *     name-list differences.
 *
 * The fixture holds delivered source and program bytes: keep it under the
 * gitignored tools/corpus/reports/, never commit it.
 */
import fs from 'node:fs';

import { createApplicationClassTypeMetadataProvider, type ApplicationClassDefinition } from '../../../src/peoplecode/applicationClassTypeMetadata';
import { compilerProfileForToolsRelease } from '../../../src/peoplecode/compilerProfile';
import { isBuiltinObjectTypeName } from '../../../src/peoplecode/encoder';
import { decodeAsHarness, encodeAsHarness, generatedNameTable, generatedReferenceKey, openHarnessContext, storedNameTable } from '../research/lib/harnessContext';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};

interface FixtureProgram {
  key: string;
  ids: number[];
  values: string[];
  source: string;
  program: string; // base64
  names: Array<{ namenum: number; recname: string; refname: string }>;
}
interface Fixture { format: 'pcode-lab-fixture/1'; labRelease: string; toolsRelease: string; patch: number; classes: ApplicationClassDefinition[]; programs: FixtureProgram[] }

async function capture(): Promise<void> {
  const { default: oracledb } = await import('oracledb');
  oracledb.fetchAsString = [oracledb.CLOB];
  oracledb.fetchAsBuffer = [oracledb.BLOB];
  const from = arg('--from'), out = arg('--out');
  if (!from || !out) throw new Error('capture needs --from <report.json> --out <fixture.json>');
  const report = JSON.parse(fs.readFileSync(from, 'utf8'));
  const c = await oracledb.getConnection({ user: process.env.PSLAB_ACCESSID, password: process.env.PSLAB_ACCESSPSWD, connectString: process.env.PSLAB_AUDIT_CONNECT ?? '127.0.0.1:15210/hrdmo' });
  const O = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  try {
    await c.execute('SET TRANSACTION READ ONLY');
    const [toolsRelease, patch] = ((await c.execute(`SELECT TOOLSREL, PTPATCHREL FROM SYSADM.PSSTATUS`)).rows as [string, number][])[0];
    const classes = new Map<string, ApplicationClassDefinition>();
    for (const row of (await c.execute(`SELECT OBJECTVALUE1 A, OBJECTVALUE2 B, OBJECTVALUE3 C, OBJECTVALUE4 D, OBJECTVALUE5 E, OBJECTVALUE6 F, OBJECTVALUE7 G, PCTEXT T FROM SYSADM.PSPCMTXT WHERE OBJECTID1 = 104 ORDER BY 1, 2, 3, 4, 5, 6, 7, PROGSEQ`, {}, O)).rows as any[]) {
      const values = [row.A, row.B, row.C, row.D, row.E, row.F, row.G].map((v: unknown) => String(v ?? '').trim());
      const event = values.findIndex(v => v.toLowerCase() === 'onexecute');
      const path = values.slice(0, event < 0 ? values.length : event).filter(Boolean);
      const key = path.join(':');
      const entry = classes.get(key) ?? { path, source: '' };
      entry.source += String(row.T ?? '');
      classes.set(key, entry);
    }
    const programs: FixtureProgram[] = [];
    for (const r of report.notExact) {
      const parts: Array<[number, string]> = r.key.split('|').map((p: string) => { const i = p.indexOf(':'); return [Number(p.slice(0, i)), p.slice(i + 1)]; });
      const ids: number[] = [], values: string[] = [];
      const binds: Record<string, unknown> = {};
      const where = [0, 1, 2, 3, 4, 5, 6].map(i => {
        const [id, v] = parts[i] ?? [0, ' '];
        ids.push(id); values.push(v);
        binds[`i${i}`] = id; binds[`v${i}`] = v;
        return `OBJECTID${i + 1} = :i${i} AND NVL(RTRIM(OBJECTVALUE${i + 1}), ' ') = NVL(RTRIM(:v${i}), ' ')`;
      }).join(' AND ');
      const prog = Buffer.concat(((await c.execute(`SELECT PROGTXT P FROM SYSADM.PSPCMPROG WHERE ${where} ORDER BY PROGSEQ`, binds, O)).rows as any[]).map(x => x.P));
      const source = ((await c.execute(`SELECT PCTEXT T FROM SYSADM.PSPCMTXT WHERE ${where} ORDER BY PROGSEQ`, binds, O)).rows as any[]).map(x => x.T).join('');
      const names = ((await c.execute(`SELECT NAMENUM, RECNAME, REFNAME FROM SYSADM.PSPCMNAME WHERE ${where} ORDER BY NAMENUM`, binds, O)).rows as any[])
        .map(x => ({ namenum: Number(x.NAMENUM), recname: String(x.RECNAME ?? ''), refname: String(x.REFNAME ?? '') }));
      programs.push({ key: r.key, ids, values, source, program: prog.toString('base64'), names });
    }
    const fixture: Fixture = { format: 'pcode-lab-fixture/1', labRelease: `${toolsRelease}.${String(patch).padStart(2, '0')}`, toolsRelease, patch: Number(patch), classes: [...classes.values()], programs };
    fs.writeFileSync(out, JSON.stringify(fixture));
    console.log(`${programs.length} programs, ${classes.size} classes -> ${out}`);
  } finally {
    await c.close();
  }
}

function replay(): void {
  const file = arg('--fixture');
  if (!file) throw new Error('replay needs --fixture <file>');
  const only = arg('--key');
  const verbose = process.argv.includes('--verbose');
  const fixture = JSON.parse(fs.readFileSync(file, 'utf8')) as Fixture;
  const ctx = openHarnessContext();
  const profile = compilerProfileForToolsRelease(fixture.toolsRelease, {
    patchLevel: fixture.patch,
    applicationClassTypeMetadata: createApplicationClassTypeMetadataProvider(fixture.classes, { isBuiltinType: isBuiltinObjectTypeName })
  });
  let exact = 0, total = 0;
  for (const p of fixture.programs) {
    if (only && !p.key.includes(only)) continue;
    total++;
    const def: any = { sourceText: p.source, names: p.names };
    for (let i = 0; i < 7; i++) { def[`objectid${i + 1}`] = p.ids[i]; def[`objectvalue${i + 1}`] = p.values[i]; }
    const stored = Buffer.from(p.program, 'base64');
    const storedNames = [...p.names].sort((a, b) => a.namenum - b.namenum).map(n => `${n.recname.trim().toUpperCase()}.${n.refname.trim().toUpperCase()}`);
    const tokensAround = arg('--tokens');
    if (tokensAround) {
      const toks = decodeAsHarness(def, stored, storedNameTable(def)).tokens as any[];
      const at = toks.findIndex(t => String(t.text ?? '').includes(tokensAround));
      console.log(`stored tokens around ${JSON.stringify(tokensAround)} (#${at}):`);
      console.log(toks.slice(Math.max(0, at - 12), at + 12).map(t => `${t.opcode.toString(16)}:${JSON.stringify(t.text)}`).join(' '));
    }
    const enc = encodeAsHarness(ctx, def, { profile });
    if (enc.error || !enc.artifacts) {
      console.log(`ERROR  ${p.key}  ${enc.error}`);
      if (verbose) {
        const m = /offset (\d+)/.exec(enc.error ?? '');
        const text = enc.fragmentSource ?? p.source;
        if (m) { const o = Number(m[1]); console.log(`  at: ${JSON.stringify(text.slice(Math.max(0, o - 200), o) + '⟦HERE⟧' + text.slice(o, o + 100))}`); }
      }
      continue;
    }
    const a: any = enc.artifacts;
    const gen = [...a.references].sort((x: any, y: any) => x.sequence - y.sequence).map(generatedReferenceKey);
    const bytesExact = Buffer.compare(a.program, stored) === 0;
    const namesExact = JSON.stringify(gen) === JSON.stringify(storedNames);
    if (bytesExact && namesExact) { exact++; console.log(`EXACT  ${p.key}`); continue; }
    let fd = 0;
    while (fd < Math.min(a.program.length, stored.length) && a.program[fd] === stored[fd]) fd++;
    console.log(`DIFF   ${p.key}  bytes ${bytesExact ? 'ok' : `${a.program.length}/${stored.length} first@${fd}`}  names ${namesExact ? 'ok' : `${gen.length}/${storedNames.length}`}`);
    if (!verbose) continue;
    if (!namesExact) {
      const width = Math.max(gen.length, storedNames.length);
      for (let i = 0; i < width; i++) if (gen[i] !== storedNames[i]) console.log(`  name[${i + 1}] gen=${gen[i]} stored=${storedNames[i]}`);
    }
    try {
      const ts = decodeAsHarness(def, stored, storedNameTable(def)).text;
      const tg = decodeAsHarness(def, a.program, generatedNameTable(a.references)).text;
      let i = 0;
      while (i < Math.min(ts.length, tg.length) && ts[i] === tg[i]) i++;
      if (ts !== tg) console.log(`  decoded diff @${i}\n  STORED: ${JSON.stringify(ts.slice(Math.max(0, i - 140), i + 100))}\n  GENER.: ${JSON.stringify(tg.slice(Math.max(0, i - 140), i + 100))}`);
      else {
        const dt = decodeAsHarness(def, stored, storedNameTable(def)).tokens as any[];
        const gt = decodeAsHarness(def, a.program, generatedNameTable(a.references)).tokens as any[];
        let j = 0;
        while (j < Math.min(dt.length, gt.length) && dt[j].opcode === gt[j].opcode && dt[j].text === gt[j].text) j++;
        const show = (ts: any[]) => ts.slice(Math.max(0, j - 6), j + 6).map(t => `${t.opcode.toString(16)}:${JSON.stringify(t.text)}`).join(' ');
        console.log(`  decoded text equal; first token diff #${j}\n  STORED: ${show(dt)}\n  GENER.: ${show(gt)}`);
      }
    } catch (e: any) { console.log(`  decode failed: ${String(e?.message ?? e).slice(0, 160)}`); }
  }
  console.log(`${exact}/${total} EXACT`);
}

const mode = process.argv[2];
if (mode === 'capture') capture().then(() => process.exit(0), e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
else if (mode === 'replay') { replay(); process.exit(0); }
else { console.error('usage: lab-fixture.ts capture|replay ...'); process.exit(1); }
