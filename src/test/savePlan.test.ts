import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  checkStoredProgram, compileForSave, diffPrograms, expectedProgram, fingerprint, planProgram,
  prepareSourceForSave, SaveRefusedError, splitProgramRows, splitSourceRows, targetForKey,
  validateOperatorId, type StoredProgram
} from '../peoplecode/writeback/savePlan.js';

/*
 * The writer's plan against App Designer itself: every program App Designer
 * saved in the Cycle 185 save matrix (tools/corpus/save-protocol/results)
 * is rebuilt from its stored source and must equal the stored rows, column
 * for column -- PSPCMTXT text / split / HASH_SIGNATURE, PSPCMPROG bytes /
 * split / NAMECOUNT / PROGLEN and defaults, PSPCMNAME rows -- given only the
 * VERSION, LASTUPDDTTM and operator the save stamped.
 */

const RESULTS = path.join('tools', 'corpus', 'save-protocol', 'results');
const TOOLS_RELEASE = '8.62';

type Row = Record<string, string | null>;
interface Snapshot { watch: Record<string, { columns: { name: string }[]; rows: (string | null)[][] }> }

const rowsOf = (s: Snapshot, table: string): Row[] =>
  s.watch[table].rows.map((r) => Object.fromEntries(s.watch[table].columns.map((c, i) => [c.name, r[i]])));
const keyString = (r: Row) => [1, 2, 3, 4, 5, 6, 7].map((n) => `${r[`OBJECTID${n}`]}:${r[`OBJECTVALUE${n}`]}`).join('|');

/** Every scratch program in a snapshot, as the writer reads one. */
function programsIn(s: Snapshot): StoredProgram[] {
  const byKey = new Map<string, StoredProgram>();
  const get = (r: Row) => {
    const k = keyString(r);
    let p = byKey.get(k);
    if (!p) {
      p = {
        key: {
          objectIds: [1, 2, 3, 4, 5, 6, 7].map((n) => Number(r[`OBJECTID${n}`])),
          objectValues: [1, 2, 3, 4, 5, 6, 7].map((n) => String(r[`OBJECTVALUE${n}`]))
        },
        text: [], program: [], names: []
      };
      byKey.set(k, p);
    }
    return p;
  };
  for (const r of rowsOf(s, 'PSPCMTXT')) get(r).text.push({ progseq: Number(r.PROGSEQ), text: r.PCTEXT ?? '', hashSignature: String(r.HASH_SIGNATURE) });
  for (const r of rowsOf(s, 'PSPCMPROG')) {
    get(r).program.push({
      progseq: Number(r.PROGSEQ), version: Number(r.VERSION), namecount: Number(r.NAMECOUNT), proglen: Number(r.PROGLEN),
      progrunloc: Number(r.PROGRUNLOC), progflags: Number(r.PROGFLAGS), licenseCode: String(r.LICENSE_CODE),
      lastupddttm: String(r.LASTUPDDTTM), lastupdoprid: String(r.LASTUPDOPRID), progextends: String(r.PROGEXTENDS),
      pttoolsrel: String(r.PTTOOLSREL), bytes: Buffer.from(r.PROGTXT ?? '', 'hex')
    });
  }
  for (const r of rowsOf(s, 'PSPCMNAME')) {
    get(r).names.push({
      namenum: Number(r.NAMENUM), recname: String(r.RECNAME), refname: String(r.REFNAME),
      packageroot: String(r.PACKAGEROOT), qualifypath: String(r.QUALIFYPATH), appclassmethod: String(r.APPCLASSMETHOD)
    });
  }
  return [...byKey.values()];
}

/** The definitions each case's App Designer save changed, as they stood after it. */
function savedByCase(): { name: string; program: StoredProgram }[] {
  if (!existsSync(RESULTS)) return [];
  const out: { name: string; program: StoredProgram }[] = [];
  for (const dir of readdirSync(RESULTS).sort()) {
    // App Designer's saves only: d* / e* / f* / r* cases were written by
    // this writer (or refused), so they cannot be its reference.
    if (/^[defr]\d/.test(dir)) continue;
    const deltaFile = path.join(RESULTS, dir, 'delta.json');
    if (!existsSync(deltaFile)) continue;
    const delta = JSON.parse(readFileSync(deltaFile, 'utf8'));
    const changed = new Set<string>((delta.summary.transitions.definitions ?? []).map((d: { definition: string }) => d.definition));
    if (changed.size === 0) continue;
    const after = JSON.parse(readFileSync(path.join(RESULTS, dir, 'after.json'), 'utf8')) as Snapshot;
    for (const program of programsIn(after)) {
      const def = program.key.objectIds.map((id, i) => [id, program.key.objectValues[i].trim()] as const)
        .filter(([id]) => id !== 0).map(([id, v]) => `${id}:${v}`).join(' / ');
      if (changed.has(def) && program.program.length > 0) out.push({ name: `${dir} ${def}`, program });
    }
  }
  return out;
}

const saves = savedByCase();

test('the save matrix results are present', () => {
  assert.ok(saves.length >= 12, `expected the Cycle 185 save results, found ${saves.length}`);
});

for (const { name, program } of saves) {
  test(`the writer's rows equal App Designer's: ${name}`, () => {
    const target = targetForKey(program.key);
    const text = program.text.sort((a, b) => a.progseq - b.progseq).map((r) => r.text).join('');
    const plan = planProgram(text, compileForSave(text, target, TOOLS_RELEASE));
    const first = program.program[0];
    const expected = expectedProgram(program.key, plan, {
      version: first.version, lastupddttm: first.lastupddttm, operatorId: first.lastupdoprid
    });
    assert.deepEqual(diffPrograms(expected, program), []);
    assert.equal(fingerprint(expected), fingerprint(program));
    // And the stored program passes the writer's pre-edit gate.
    checkStoredProgram(program, target, TOOLS_RELEASE);
  });
}

test('every scratch program App Designer left on HRDMO passes the gate or is refused for a stated reason', () => {
  const last = readdirSync(RESULTS).filter((d) => existsSync(path.join(RESULTS, d, 'after.json'))).sort().at(-1)!;
  const after = JSON.parse(readFileSync(path.join(RESULTS, last, 'after.json'), 'utf8')) as Snapshot;
  let passed = 0;
  for (const program of programsIn(after)) {
    try {
      checkStoredProgram(program, targetForKey(program.key), TOOLS_RELEASE);
      passed++;
    } catch (error) {
      // Programs with Application Class / object-type references, or others
      // the writer does not model, must be refused -- never crash.
      assert.ok(error instanceof SaveRefusedError, String(error));
    }
  }
  assert.ok(passed >= 2, `expected at least the matrix's own programs to pass, got ${passed}`);
});

test('PSPCMTXT rows split greedily after line feeds, at most 14,000 characters', () => {
  const line = 'x'.repeat(99) + '\n'; // 100 characters
  const rows = splitSourceRows(line.repeat(300)); // 30,000 characters
  assert.deepEqual(rows.map((r) => r.length), [14000, 14000, 2000]);
  assert.ok(rows.every((r) => r.endsWith('\n')));
  // A line that would cross the limit starts the next row.
  const odd = splitSourceRows('a'.repeat(13990) + '\n' + 'b'.repeat(20) + '\n');
  assert.deepEqual(odd.map((r) => r.length), [13991, 21]);
  assert.throws(() => splitSourceRows('c'.repeat(14001) + '\n'), SaveRefusedError);
  assert.deepEqual(splitSourceRows(''), ['']);
});

test('PSPCMPROG rows are 28,000-byte slices', () => {
  assert.deepEqual(splitProgramRows(Buffer.alloc(60000)).map((b) => b.length), [28000, 28000, 4000]);
  assert.deepEqual(splitProgramRows(Buffer.alloc(28000)).map((b) => b.length), [28000]);
});

test('the source is saved with LF endings and a final newline', () => {
  assert.equal(prepareSourceForSave('Local number &n = 1;'), 'Local number &n = 1;\n');
  assert.equal(prepareSourceForSave('a\r\nb\r\n'), 'a\nb\n');
  assert.equal(prepareSourceForSave('  \n\n'), '');
});

test('Record Field PeopleCode and Application Class programs are in scope, any name unless a prefix is set', async () => {
  const { setWriteNamePrefix } = await import('../providers/writeScope.js');
  const ids = (...v: number[]) => [...v, ...Array(7 - v.length).fill(0)];
  const vals = (...v: string[]) => [...v, ...Array(7 - v.length).fill(' ')];
  assert.deepEqual(targetForKey({ objectIds: ids(1, 2, 12), objectValues: vals('ZZ_PCODE_LAB', 'ZZ_PCODE_LAB_C01', 'FieldChange') }),
    { applicationClass: false, recordName: 'ZZ_PCODE_LAB', fieldName: 'ZZ_PCODE_LAB_C01' });
  assert.deepEqual(targetForKey({ objectIds: ids(104, 105, 107, 12), objectValues: vals('ZZ_PCODE_LAB', 'SUPPORT', 'SmokeTest', 'OnExecute') }),
    { applicationClass: true, recordName: 'ZZ_PCODE_LAB', fieldName: 'SUPPORT', packagePath: ['ZZ_PCODE_LAB', 'SUPPORT', 'SmokeTest'] });
  assert.deepEqual(targetForKey({ objectIds: ids(1, 2, 12), objectValues: vals('JOB', 'EMPLID', 'FieldChange') }),
    { applicationClass: false, recordName: 'JOB', fieldName: 'EMPLID' });
  setWriteNamePrefix('ZZ_PCODE_LAB');
  try {
    assert.throws(() => targetForKey({ objectIds: ids(1, 2, 12), objectValues: vals('JOB', 'EMPLID', 'FieldChange') }), /does not start with ZZ_PCODE_LAB/);
  } finally {
    setWriteNamePrefix('');
  }
  assert.throws(() => targetForKey({ objectIds: ids(10, 39, 12), objectValues: vals('ZZ_PCODE_LAB', 'GBL', 'PreBuild') }), /not supported yet/);
});

test('PACKAGE rows are the compiler references, serialized as App Designer writes them', () => {
  const target = { applicationClass: false, recordName: 'ZZ_PCODE_LAB', fieldName: 'ZZ_PCODE_LAB_C01' };
  const { names } = compileForSave('Local Rowset &rs = GetLevel0();\n', target, TOOLS_RELEASE);
  assert.deepEqual(names.find((n) => n.recname === 'PACKAGE'),
    { namenum: names.find((n) => n.recname === 'PACKAGE')!.namenum, recname: 'PACKAGE', refname: 'ROWSET', packageroot: 'Rowset', qualifypath: 'Rowset', appclassmethod: ' ' });
  assert.throws(() => compileForSave('Local string &c = ;\n', target, TOOLS_RELEASE), /does not compile/);
});

test('every scratch program App Designer compiled on HRDMO is rebuilt to its stored rows exactly', () => {
  // The latest snapshot holds all ZZ_PCODE_LAB programs as App Designer
  // 8.62.09 last compiled them: Rowset / Row / Record object types,
  // Application Class references, wildcard imports, extends.
  const last = readdirSync(RESULTS).filter((d) => existsSync(path.join(RESULTS, d, 'after.json'))).sort().at(-1)!;
  const after = JSON.parse(readFileSync(path.join(RESULTS, last, 'after.json'), 'utf8')) as Snapshot;
  const programs = programsIn(after).filter((p) => p.program.length > 0);
  let rebuilt = 0;
  for (const program of programs) {
    const target = targetForKey(program.key);
    const text = [...program.text].sort((a, b) => a.progseq - b.progseq).map((r) => r.text).join('');
    const plan = planProgram(text, compileForSave(text, target, TOOLS_RELEASE));
    const first = program.program[0];
    const expected = expectedProgram(program.key, plan, { version: first.version, lastupddttm: first.lastupddttm, operatorId: first.lastupdoprid });
    assert.deepEqual(diffPrograms(expected, program), [], program.key.objectValues.join('.'));
    checkStoredProgram(program, target, TOOLS_RELEASE);
    rebuilt++;
  }
  assert.ok(rebuilt >= 27, `rebuilt ${rebuilt} programs`);
});

test('operator ids are required and well formed', () => {
  assert.equal(validateOperatorId('JARED'), undefined);
  assert.match(validateOperatorId('')!, /required/);
  assert.match(validateOperatorId('JA RED')!, /spaces/);
  assert.match(validateOperatorId('X'.repeat(31))!, /30/);
  assert.match(validateOperatorId(undefined)!, /required/);
});
