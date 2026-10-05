/*
 * Cycle 179: run one guarded Data Mover (psdmtx.exe, bootstrap mode) script
 * against the LAB database.
 *
 *   npx tsx tools/corpus/controlled-compile/run-datamover.ts --cleanup <script.dms> --database HRDMO --audit-dir <dir>
 *
 * Environment: PSLAB_RELEASE (default 8.61.15), PSLAB_HOME,
 * PSLAB_ORACLE_CLIENT, PSLAB_WINEPREFIX (as run-compiler.ts),
 * PSLAB_ACCESSID / PSLAB_ACCESSPSWD (bootstrap sign-on and the audit).
 *
 * Interlocks:
 * 1. The script must pass validateScratchCleanupDms: only exact-name
 *    `DELETE FROM <allowed table> WHERE <col> = | IN (<scratch literals>)`.
 * 2. Audit snapshot (lab-audit.ts) before.
 * 3. psdmtx runs once, headless, from a private temporary directory. The
 *    log is printed with secrets redacted, and the directory is removed.
 * 4. Audit snapshot after; then compare. Any non-scratch or protected
 *    change prints STOP and exits 1.
 * Credentials appear on psdmtx's command line only for its short run.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { assertLabDatabase, releaseProfile } from '../../../src/peoplecode/corpus/controlledCompileRunner';
import { validateScratchCleanupDms } from '../../../src/peoplecode/corpus/labSafety';

const CLEANUP_TABLES = ['PSPACKAGEDEFN', 'PSAPPCLASSDEFN', 'PSPROJECTDEFN', 'PSPROJECTITEM', 'PSPROJECTMSG'];
const AUDIT = path.join(__dirname, 'lab-audit.ts');

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const toWinePath = (unixPath: string): string => `Z:${path.resolve(unixPath).replace(/\//g, '\\')}`;

function audit(args: string[]): { status: number | null; out: string } {
  const r = spawnSync('npx', ['tsx', AUDIT, ...args], { encoding: 'utf8', env: process.env, timeout: 30 * 60 * 1000 });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

function main(): void {
  const scriptFile = argument('--cleanup');
  const database = argument('--database');
  const auditDir = argument('--audit-dir');
  if (!scriptFile || !database || !auditDir) throw new Error('usage: run-datamover.ts --cleanup <script.dms> --database <DB> --audit-dir <dir>');
  assertLabDatabase(database);
  const accessId = process.env.PSLAB_ACCESSID, accessPassword = process.env.PSLAB_ACCESSPSWD;
  if (!accessId || !accessPassword) throw new Error('PSLAB_ACCESSID / PSLAB_ACCESSPSWD are required.');

  const script = fs.readFileSync(scriptFile, 'utf8');
  const validation = validateScratchCleanupDms(script, CLEANUP_TABLES);
  if (!validation.ok) throw new Error(`Refusing the script:\n  ${validation.violations.join('\n  ')}`);
  console.log(`script validated: ${validation.statements.length} scratch-only DELETE statements`);

  const profile = releaseProfile(process.env.PSLAB_RELEASE);
  const labHome = process.env.PSLAB_HOME ?? path.join(os.homedir(), 'peoplesoft-lab', profile.labDirectory);
  const oracleClient = process.env.PSLAB_ORACLE_CLIENT ?? path.join(labHome, 'oracle_client');
  const winePrefix = process.env.PSLAB_WINEPREFIX ?? path.join(os.homedir(), profile.winePrefix);
  const clientDir = path.join(labHome, 'ps_home', 'bin', 'client', 'winx86');

  fs.mkdirSync(auditDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const before = path.join(auditDir, `dms-${stamp}-before.json`);
  const after = path.join(auditDir, `dms-${stamp}-after.json`);
  const pre = audit(['snapshot', '--database', database, '--out', before]);
  if (pre.status !== 0) throw new Error(`pre-write audit failed: ${pre.out}`);
  console.log(pre.out.trim());

  const work = fs.mkdtempSync(path.join(labHome, 'dms-'));
  fs.chmodSync(work, 0o700);
  let logText = '';
  try {
    const dms = path.join(work, 'run.dms');
    fs.writeFileSync(dms, `SET LOG ${toWinePath(path.join(work, 'run.log'))};\nSET NO TRACE;\n${validation.statements.map(s => `${s};`).join('\n')}\n`, { mode: 0o600 });
    const result = spawnSync('wine', ['psdmtx.exe', '-CT', process.env.PSLAB_DBTYPE ?? 'ORACLE', '-CD', database, '-CO', accessId, '-CP', accessPassword, '-FP', toWinePath(dms)], {
      cwd: clientDir,
      timeout: 15 * 60 * 1000,
      env: {
        ...process.env,
        WINEPREFIX: winePrefix,
        WINEDEBUG: '-all',
        WINEDLLOVERRIDES: 'mscoree,mshtml=',
        WINEPATH: toWinePath(path.join(oracleClient, 'bin')),
        ORACLE_HOME: toWinePath(oracleClient),
        TNS_ADMIN: toWinePath(path.join(labHome, 'tns'))
      },
      encoding: 'buffer'
    });
    const logFile = path.join(work, 'run.log');
    const raw = fs.existsSync(logFile) ? fs.readFileSync(logFile) : Buffer.alloc(0);
    const text = raw.length >= 2 && raw[1] === 0 ? raw.toString('utf16le') : raw.toString('utf8');
    logText = `${text}\n${result.stdout?.toString('utf8') ?? ''}`.split(accessPassword).join('<redacted>');
    console.log(`psdmtx exit ${result.status}`);
    console.log(logText.split(/\r?\n/).filter(l => l.trim() !== '' && !/MESA|pci id|egl/i.test(l)).join('\n'));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  const post = audit(['snapshot', '--database', database, '--out', after]);
  if (post.status !== 0) throw new Error(`post-write audit failed: ${post.out}`);
  const verdict = audit(['compare', before, after]);
  console.log(verdict.out.trim());
  if (verdict.status !== 0) {
    console.error('STOP: the post-write audit found a non-scratch or protected change.');
    process.exit(1);
  }
  if (!/Successful completion/i.test(logText)) {
    console.error('Data Mover did not report successful completion.');
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
