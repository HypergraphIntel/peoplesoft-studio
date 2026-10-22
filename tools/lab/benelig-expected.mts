/**
 * Read-only, HRDMO: the file the benefits-eligibility Build Request (docs/build-requests/samples/benefits-eligibility)
 * should produce, computed independently of whatever the agent builds, for comparing a native run's output.
 *
 * npx tsx tools/lab/benelig-expected.mts AS_OF_DATE [COMPANY] [--out FILE] [--compare FILE]
 *
 * Readings it encodes (change them if the approved spec decides otherwise): jobs current on the as-of date (latest
 * EFFDT on or before it, then latest EFFSEQ) with EMPL_STATUS A/L/P/S; the non-COBRA (COBRA_EVENT_ID 0) benefit program
 * row current on the date, people without one left out; the primary (PRI) name current on the date; hire date
 * JOB.LAST_HIRE_DT; sorted by EMPLID, EMPL_RCD. CSV per the specification: header, every text column double-quoted
 * (quotes doubled), dates YYYY-MM-DD with an empty field when missing, UTF-8 without BOM. Line endings are compared
 * normalized (the specification accepts CRLF or LF).
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseProvider } from '../../src/providers/database.js';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const out = flag('--out'), compare = flag('--compare');
const [asOf, company] = args;
assert.match(asOf ?? '', /^\d{4}-\d{2}-\d{2}$/, 'usage: benelig-expected.mts AS_OF_DATE [COMPANY] [--out FILE] [--compare FILE]');
assert.ok(!company || /^[A-Z0-9]{1,3}$/.test(company), 'COMPANY is a company code');

const p = new DatabaseProvider({ name: 'HRDMO', platform: 'oracle', connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo',
  user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! } as never);
const d = `TO_DATE('${asOf}','YYYY-MM-DD')`;
const sql = `SELECT J.EMPLID, J.EMPL_RCD, N.FIRST_NAME, N.LAST_NAME, TO_CHAR(P.BIRTHDATE,'YYYY-MM-DD') AS BIRTHDATE,
  TO_CHAR(J.LAST_HIRE_DT,'YYYY-MM-DD') AS HIRE_DT, J.COMPANY, J.DEPTID, J.EMPL_STATUS, J.FULL_PART_TIME, B.BENEFIT_PROGRAM
FROM PS_JOB J
JOIN PS_BEN_PROG_PARTIC B ON B.EMPLID = J.EMPLID AND B.EMPL_RCD = J.EMPL_RCD AND B.COBRA_EVENT_ID = 0
  AND B.EFFDT = (SELECT MAX(B1.EFFDT) FROM PS_BEN_PROG_PARTIC B1 WHERE B1.EMPLID = B.EMPLID AND B1.EMPL_RCD = B.EMPL_RCD AND B1.COBRA_EVENT_ID = 0 AND B1.EFFDT <= ${d})
JOIN PS_PERSON P ON P.EMPLID = J.EMPLID
LEFT JOIN PS_NAMES N ON N.EMPLID = J.EMPLID AND N.NAME_TYPE = 'PRI'
  AND N.EFFDT = (SELECT MAX(N1.EFFDT) FROM PS_NAMES N1 WHERE N1.EMPLID = N.EMPLID AND N1.NAME_TYPE = 'PRI' AND N1.EFFDT <= ${d})
WHERE J.EFFDT = (SELECT MAX(J1.EFFDT) FROM PS_JOB J1 WHERE J1.EMPLID = J.EMPLID AND J1.EMPL_RCD = J.EMPL_RCD AND J1.EFFDT <= ${d})
  AND J.EFFSEQ = (SELECT MAX(J2.EFFSEQ) FROM PS_JOB J2 WHERE J2.EMPLID = J.EMPLID AND J2.EMPL_RCD = J.EMPL_RCD AND J2.EFFDT = J.EFFDT)
  AND J.EMPL_STATUS IN ('A','L','P','S')${company ? ` AND J.COMPANY = '${company}'` : ''}
ORDER BY J.EMPLID, J.EMPL_RCD`;
try {
  await p.connect();
  const { rows } = await p.runReadOnlyQuery(sql, 100000);
  const q = (v: unknown) => `"${String(v ?? '').trim().replace(/"/g, '""')}"`;
  const date = (v: unknown) => String(v ?? '').trim();
  const header = 'EmployeeId,RecordNumber,FirstName,LastName,BirthDate,HireDate,Company,Department,EmployeeStatus,FullPartTime,BenefitProgram,AsOfDate';
  const lines = rows.map((r: Record<string, unknown>) => [q(r.EMPLID), String(r.EMPL_RCD), q(r.FIRST_NAME), q(r.LAST_NAME), date(r.BIRTHDATE), date(r.HIRE_DT),
    q(r.COMPANY), q(r.DEPTID), q(r.EMPL_STATUS), q(r.FULL_PART_TIME), q(r.BENEFIT_PROGRAM), asOf].join(','));
  const csv = [header, ...lines].join('\n') + '\n';
  const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
  console.log(JSON.stringify({ asOf, company: company ?? null, fileName: `ZZ_BENELIG_${asOf.replace(/-/g, '')}.csv`, rows: lines.length, bytesLf: Buffer.byteLength(csv), sha256Lf: sha(csv) }));
  if (out) writeFileSync(out, csv);
  if (compare) {
    const actual = readFileSync(compare);
    assert.ok(!(actual[0] === 0xef && actual[1] === 0xbb && actual[2] === 0xbf), 'the file starts with a byte order mark');
    const normalized = actual.toString('utf8').replace(/\r\n/g, '\n');
    const a = normalized.split('\n'), e = csv.split('\n');
    const first = e.findIndex((line, i) => line !== a[i]);
    console.log(first < 0 && a.length === e.length ? 'MATCH (line endings normalized)' : `DIFFERS at line ${first + 1}:\n  expected ${e[first]}\n  actual   ${a[first]}`);
  }
} finally { await p.dispose(); }
process.exit(0);
