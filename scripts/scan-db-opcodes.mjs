// Full-database opcode sweep: decodes every PeopleCode program in
// SYSADM.PSPCMPROG (not just the 204 in the source-paired calibration
// corpus -- the whole live database, ~121k programs) and reports any
// opcode the decoder does not recognise.
//
// PSPCMNAME is joined in, not skipped: a failed 0x21/0x4a/0x48 reference
// resolution does not consume its 2-byte operand, so decoding without
// real names cascades every such reference into a flood of unrelated
// spurious "unmapped" opcodes (confirmed the hard way -- an earlier,
// unjoined version of this script reported ~200 opcodes wrong, most of
// them already-mapped ones cascading off failed reference lookups). To
// avoid 121k separate PSPCMNAME round trips, both tables are streamed in
// a single pass each, ordered identically by the same 7-part key, and
// merge-joined client-side.
//
// Usage: node scripts/scan-db-opcodes.mjs [output.json]
import { writeFileSync } from 'node:fs';
import oracledb from 'oracledb';
import { decodeProgram } from '../dist-test/peoplecode/decoder.js';
import { NameTable, assembleProgram } from '../dist-test/peoplecode/progtext.js';

const OUT = process.argv[2];

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsBuffer = [oracledb.BLOB];

const conn = await oracledb.getConnection({
  user: process.env.PS_USER, password: process.env.PS_PASSWORD, connectString: process.env.PS_CONNECT_STRING
});

const KEY_COLS = 'OBJECTVALUE1, OBJECTVALUE2, OBJECTVALUE3, OBJECTVALUE4, OBJECTVALUE5, OBJECTVALUE6, OBJECTVALUE7';

const progStream = conn.queryStream(
  `SELECT ${KEY_COLS}, PROGSEQ, PROGTXT FROM SYSADM.PSPCMPROG ORDER BY ${KEY_COLS}, PROGSEQ`,
  [], { fetchArraySize: 500 });
const nameStream = conn.queryStream(
  `SELECT ${KEY_COLS}, NAMENUM, RECNAME, REFNAME FROM SYSADM.PSPCMNAME ORDER BY ${KEY_COLS}, NAMENUM`,
  [], { fetchArraySize: 2000 });

function rawKey(row) {
  return [row.OBJECTVALUE1, row.OBJECTVALUE2, row.OBJECTVALUE3, row.OBJECTVALUE4,
    row.OBJECTVALUE5, row.OBJECTVALUE6, row.OBJECTVALUE7].join('\u0001');
}
function displayKey(row) {
  return [row.OBJECTVALUE1, row.OBJECTVALUE2, row.OBJECTVALUE3, row.OBJECTVALUE4,
    row.OBJECTVALUE5, row.OBJECTVALUE6, row.OBJECTVALUE7]
    .map((p) => p.trim()).filter((p) => p.length > 0).join('.');
}

const progIter = progStream[Symbol.asyncIterator]();
const nameIter = nameStream[Symbol.asyncIterator]();
let nameLookahead = await nameIter.next();

let programCount = 0;
let cleanCount = 0;
let brokenCount = 0;
let totalBytes = 0;
let totalUnmapped = 0;
const byOpcode = new Map();
const brokenSamples = [];

// Both queries are ordered by the identical 7-part key, so pulling every
// PSPCMNAME row up to (and including) the program's own key always lands
// on exactly the rows that belong to it -- or none, for a program with no
// names at all.
async function advanceNamesTo(target, names) {
  while (!nameLookahead.done && rawKey(nameLookahead.value) === target) {
    const n = nameLookahead.value;
    const q = (n.RECNAME ?? '').trim();
    const r = (n.REFNAME ?? '').trim();
    names.add(n.NAMENUM, q ? `${q}.${r}` : r);
    nameLookahead = await nameIter.next();
  }
}

async function flushProgram(row0, chunks) {
  if (chunks.length === 0) return;
  programCount++;
  const parts = [row0.OBJECTVALUE1, row0.OBJECTVALUE2, row0.OBJECTVALUE3, row0.OBJECTVALUE4,
    row0.OBJECTVALUE5, row0.OBJECTVALUE6, row0.OBJECTVALUE7];
  // Application Class keys are often only 3 parts long (Package.Class.
  // OnExecute); the other OBJECTVALUE slots stay blank rather than
  // shifting OnExecute down into OBJECTVALUE7. Checking the literal last
  // array slot instead of the last non-blank one silently treated most
  // Application Class programs as plain Function programs, which showed
  // up as a flood of false "unmapped" hits on the class/method family
  // (0x5a-0x64) -- fixed by finding the last non-blank part instead.
  //
  // App Engine step/action PeopleCode keys also end in a literal
  // "OnExecute" (Program.Section.Market.EffDate.Step.OnExecute), so that
  // alone is ambiguous. Those always carry a YYYY-MM-DD effective-date
  // part (e.g. "1900-01-01"); Application Class package/class names never
  // do, so excluding any key with a date-shaped part tells them apart.
  // Getting this wrong in the *other* direction (a Function program
  // wrongly flagged as a class) would silently misrender real bytecode as
  // class/method keywords instead of just flagging it, which is worse
  // than the bug this replaces -- worth the extra check.
  const nonBlankParts = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  const hasDatePart = nonBlankParts.some((p) => /^\d{4}-\d{2}-\d{2}$/.test(p));
  const isApplicationClass = nonBlankParts[nonBlankParts.length - 1] === 'OnExecute' && !hasDatePart;
  const key = displayKey(row0);

  let bytes;
  try {
    bytes = assembleProgram(chunks);
  } catch (err) {
    brokenCount++;
    if (brokenSamples.length < 20) brokenSamples.push({ key, error: String(err.message ?? err) });
    return;
  }
  totalBytes += bytes.length;

  const names = new NameTable();
  await advanceNamesTo(rawKey(row0), names);

  const result = decodeProgram(bytes, names, { mode: 'auto', isApplicationClass });
  totalUnmapped += result.unknownOpcodes.length;
  if (result.unknownOpcodes.length === 0) cleanCount++;

  for (const u of result.unknownOpcodes) {
    let entry = byOpcode.get(u.opcode);
    if (!entry) byOpcode.set(u.opcode, (entry = { count: 0, samples: [] }));
    entry.count++;
    if (entry.samples.length < 8) {
      entry.samples.push({ key, offset: u.offset, totalUnmapped: result.unknownOpcodes.length, bytes: bytes.length });
    }
  }
}

let currentKey = null;
let currentRow0 = null;
let currentChunks = [];

for await (const row of progIter) {
  const key = rawKey(row);
  if (key !== currentKey) {
    await flushProgram(currentRow0, currentChunks);
    currentKey = key;
    currentRow0 = row;
    currentChunks = [];
    if (programCount % 5000 === 0 && programCount > 0) {
      console.error(`... ${programCount} programs scanned, ${totalUnmapped} unmapped occurrences so far`);
    }
  }
  currentChunks.push({ seq: row.PROGSEQ, data: row.PROGTXT });
}
await flushProgram(currentRow0, currentChunks);

await conn.close();

const report = {
  programCount, cleanCount, brokenCount, totalBytes, totalUnmapped,
  opcodes: [...byOpcode.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([opcode, e]) => ({ opcode: `0x${opcode.toString(16)}`, count: e.count, samples: e.samples })),
  brokenSamples
};

if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));

console.log(`programs scanned: ${programCount} (${cleanCount} clean, ${brokenCount} broken/incomplete)`);
console.log(`total bytes: ${totalBytes}, unmapped occurrences: ${totalUnmapped}`);
console.log(`distinct never-seen opcodes: ${byOpcode.size}`);
for (const o of report.opcodes) {
  console.log(`  ${o.opcode}: ${o.count} occurrences, e.g. ${o.samples[0]?.key}`);
}
if (OUT) console.log(`full report written to ${OUT}`);
