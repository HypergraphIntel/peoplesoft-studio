// Builds a calibration corpus: every PeopleCode program that appears in a
// project export (which carries plain-text source) paired with its real
// PSPCMPROG bytes and PSPCMNAME table from the database. Writes JSON to the
// path given as the first argument.
import { writeFileSync } from 'node:fs';
import oracledb from 'oracledb';
import { ProjectFileProvider } from '../dist-test/providers/projectFile.js';
import { isPeopleCode } from '../dist-test/model/definitions.js';

const OUT = process.argv[2];
const EXPORTS = [
  'scripts/OU_WEBLIBS_JN/OU_WEBLIBS_JN.XML',
  'scripts/OU_CUSTOM_LANDINGPAGE_JN/OU_CUSTOM_LANDINGPAGE_JN.XML'
];

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsBuffer = [oracledb.BLOB];
const conn = await oracledb.getConnection({
  user: process.env.PS_USER, password: process.env.PS_PASSWORD, connectString: process.env.PS_CONNECT_STRING
});

const KEY_COLS = [1, 2, 3, 4, 5, 6, 7];
const where = KEY_COLS.map((n) => `OBJECTVALUE${n} = :v${n}`).join(' AND ');

function binds(parts) {
  const b = {};
  for (let i = 0; i < 7; i++) b[`v${i + 1}`] = parts[i] ?? ' ';
  return b;
}

const corpus = [];
try {
  for (const path of EXPORTS) {
    const p = new ProjectFileProvider(path, 'calib');
    await p.connect();
    const project = (await p.listProjects())[0].name;
    const items = (await p.listProjectItems(project)).filter((i) => isPeopleCode(i.key.type));

    for (const item of items) {
      let source;
      try {
        source = await p.readText(item.key);
      } catch {
        continue; // export doesn't carry this one's text
      }

      // Application class programs are keyed with a trailing OnExecute in
      // PSPCMPROG but not in the project item; see pcmProgKeyParts.
      const parts = [...item.key.parts];
      if (item.key.type === 58 && parts[parts.length - 1] !== 'OnExecute') parts.push('OnExecute');

      const prog = await conn.execute(
        `SELECT PROGSEQ, PROGTXT FROM SYSADM.PSPCMPROG WHERE ${where} ORDER BY PROGSEQ`, binds(parts));
      if ((prog.rows ?? []).length === 0) continue;
      const bytes = Buffer.concat(prog.rows.map((r) => r.PROGTXT));

      const names = await conn.execute(
        `SELECT NAMENUM, RECNAME, REFNAME FROM SYSADM.PSPCMNAME WHERE ${where} ORDER BY NAMENUM`, binds(parts));

      corpus.push({
        key: { type: item.key.type, parts: item.key.parts },
        source,
        bytes: bytes.toString('base64'),
        names: (names.rows ?? []).map((n) => {
          const q = (n.RECNAME ?? '').trim();
          const r = (n.REFNAME ?? '').trim();
          return [n.NAMENUM, q ? `${q}.${r}` : r];
        })
      });
    }
  }
} finally {
  await conn.close();
}

writeFileSync(OUT, JSON.stringify(corpus));
console.log(`corpus: ${corpus.length} programs paired (source + bytes), written to ${OUT}`);
