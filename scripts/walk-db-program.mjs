import oracledb from 'oracledb';
import { decodeProgram } from '../dist-test/peoplecode/decoder.js';
import { NameTable } from '../dist-test/peoplecode/progtext.js';

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsBuffer = [oracledb.BLOB];

const key = process.argv[2]; // dot-separated key
const parts = key.split('.');
const conn = await oracledb.getConnection({
  user: process.env.PS_USER, password: process.env.PS_PASSWORD, connectString: process.env.PS_CONNECT_STRING
});
const where = parts.map((_, i) => `OBJECTVALUE${i + 1}=:v${i + 1}`).join(' AND ');
const binds = {}; parts.forEach((p, i) => (binds[`v${i + 1}`] = p));
const prog = await conn.execute(`SELECT PROGSEQ, PROGTXT FROM SYSADM.PSPCMPROG WHERE ${where} ORDER BY PROGSEQ`, binds);
const bytes = Buffer.concat(prog.rows.map((r) => r.PROGTXT));
const namesR = await conn.execute(`SELECT NAMENUM, RECNAME, REFNAME FROM SYSADM.PSPCMNAME WHERE ${where} ORDER BY NAMENUM`, binds);
const names = new NameTable();
for (const n of namesR.rows) {
  const q = (n.RECNAME ?? '').trim(); const r = (n.REFNAME ?? '').trim();
  names.add(n.NAMENUM, q ? `${q}.${r}` : r);
}
const nonBlank = parts.map(p => p.trim()).filter(p => p.length > 0);
const hasDate = nonBlank.some(p => /^\d{4}-\d{2}-\d{2}$/.test(p));
const isApplicationClass = nonBlank[nonBlank.length - 1] === 'OnExecute' && !hasDate;
const result = decodeProgram(bytes, names, { mode: 'auto', isApplicationClass });
console.log('===', key, 'isApplicationClass=' + isApplicationClass, 'unmapped:', result.unknownOpcodes.length, 'bytes:', bytes.length);
console.log(result.text.slice(0, 1500));
console.log('--- unmapped context ---');
for (const u of result.unknownOpcodes) {
  const idx = result.tokens.findIndex((t) => t.offset === u.offset);
  for (let i = Math.max(0, idx - 6); i <= idx + 6; i++) {
    const t = result.tokens[i]; if (!t) continue;
    console.log((i === idx ? '  >> ' : '     ') + 'off=' + t.offset, 'op=0x' + t.opcode.toString(16), t.kind, JSON.stringify(t.text));
  }
  console.log();
}
await conn.close();
