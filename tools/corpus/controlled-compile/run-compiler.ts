/*
 * Cycle 175: run one fresh, headless PeopleTools Application Designer
 * process against the LAB database and report what it did. The release
 * is PSLAB_RELEASE (default 8.61.15); see PEOPLETOOLS_RELEASES.
 *
 *   PSLAB_DB=PCLAB PSLAB_OPRID=... PSLAB_OPRPSWD=... \
 *     npx tsx tools/corpus/controlled-compile/run-compiler.ts --signon-only
 *     npx tsx tools/corpus/controlled-compile/run-compiler.ts --compile-project ZZ_PCODE_LAB [--project-arg inline|pjm]
 *     npx tsx tools/corpus/controlled-compile/run-compiler.ts --copy-to-file ZZ_PCODE_LAB --dir <dir>
 *     npx tsx tools/corpus/controlled-compile/run-compiler.ts --copy-from-file ZZ_PCODE_LAB --dir <dir>
 *
 * Environment:
 * - PSLAB_RELEASE: the PeopleTools release profile (default 8.61.15).
 * - PSLAB_HOME: the lab root, holding ps_home/, oracle_client/, tns/ and
 *   logs/. Default ~/peoplesoft-lab/<profile labDirectory>.
 * - PSLAB_ORACLE_CLIENT: the Oracle client directory. Default
 *   <PSLAB_HOME>/oracle_client.
 * - PSLAB_WINEPREFIX: the release's separate prefix. Default
 *   ~/<profile winePrefix>. Never the 8.61.07 bottle.
 * - PSLAB_DB, PSLAB_OPRID, PSLAB_OPRPSWD; optional PSLAB_CONNECTID /
 *   PSLAB_CONNECTPSWD. These are disposable lab credentials. They go on
 *   pside's command line, because its parameter file was not honored
 *   (Cycle 175), so they are visible to local process listings while it
 *   runs. Never pass institutional credentials.
 *
 * Safety:
 * - It refuses institutional database names, and a TNS directory that
 *   names any institutional alias.
 * - It refuses a pside.exe / pspcm.dll that is not the profile's exact
 *   build.
 *
 * It prints one JSON result. The exit code says only whether this tool
 * ran: pside's own exit code is 0 even on failure, so callers judge the
 * compile from the log report and the database rows.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  PROTECTED_DATABASE_PATTERN,
  buildPsideArguments,
  readPsideLog,
  releaseProfile,
  type PsideAction
} from '../../../src/peoplecode/corpus/controlledCompileRunner';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(name);

const toWinePath = (unixPath: string): string => `Z:${path.resolve(unixPath).replace(/\//g, '\\')}`;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing environment variable ${name}.`);
  return value;
}

function action(): PsideAction {
  if (flag('--signon-only')) return { kind: 'signon-only' };
  if (flag('--compile-all')) return { kind: 'compile-all' };
  const compile = argument('--compile-project');
  if (compile !== undefined) {
    const projectArgument = argument('--project-arg') ?? 'inline';
    if (projectArgument !== 'inline' && projectArgument !== 'pjm') throw new Error('--project-arg must be inline or pjm.');
    return { kind: 'compile-project', project: compile, projectArgument };
  }
  const toFile = argument('--copy-to-file');
  const fromFile = argument('--copy-from-file');
  const dir = argument('--dir');
  if ((toFile ?? fromFile) !== undefined) {
    if (dir === undefined) throw new Error('--dir is required for copy to / from file.');
    return toFile !== undefined
      ? { kind: 'copy-to-file', project: toFile, directory: toWinePath(dir) }
      : { kind: 'copy-from-file', project: fromFile!, directory: toWinePath(dir) };
  }
  throw new Error('usage: run-compiler.ts --signon-only | --compile-all | --compile-project <P> [--project-arg inline|pjm] | --copy-to-file <P> --dir <d> | --copy-from-file <P> --dir <d> [--timeout <s>]');
}

function main(): void {
  const profile = releaseProfile(process.env.PSLAB_RELEASE);
  const labHome = process.env.PSLAB_HOME ?? path.join(os.homedir(), 'peoplesoft-lab', profile.labDirectory);
  const winePrefix = process.env.PSLAB_WINEPREFIX ?? path.join(os.homedir(), profile.winePrefix);
  const oracleClient = process.env.PSLAB_ORACLE_CLIENT ?? path.join(labHome, 'oracle_client');
  if (/wine-bottles\/peopletools/.test(winePrefix)) throw new Error('Refusing the 8.61.07 Wine bottle.');
  const clientDir = path.join(labHome, 'ps_home', 'bin', 'client', 'winx86');
  for (const [file, expected] of Object.entries(profile.clientSha256)) {
    const actual = createHash('sha256').update(fs.readFileSync(path.join(clientDir, file))).digest('hex');
    if (actual !== expected) throw new Error(`${file} is not the ${profile.release} build (sha256 ${actual}).`);
  }
  const tnsDir = path.join(labHome, 'tns');
  const tns = fs.readFileSync(path.join(tnsDir, 'tnsnames.ora'), 'utf8');
  for (const alias of tns.matchAll(/^\s*([A-Za-z][A-Za-z0-9_.]*)\s*=/gm)) {
    if (PROTECTED_DATABASE_PATTERN.test(alias[1])) throw new Error(`The lab TNS file names ${alias[1]}: refusing.`);
  }

  const selected = action();
  const signon = {
    databaseType: process.env.PSLAB_DBTYPE ?? 'ORACLE',
    database: required('PSLAB_DB'),
    operatorId: required('PSLAB_OPRID'),
    operatorPassword: required('PSLAB_OPRPSWD'),
    ...(process.env.PSLAB_CONNECTID ? { connectId: process.env.PSLAB_CONNECTID } : {}),
    ...(process.env.PSLAB_CONNECTPSWD ? { connectPassword: process.env.PSLAB_CONNECTPSWD } : {})
  };

  const logDir = path.join(labHome, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(logDir, `pside-${selected.kind}-${stamp}.log`);
  const timeoutSeconds = Number(argument('--timeout') ?? 600);
  const started = Date.now();
  const result = spawnSync('wine', ['pside.exe', ...buildPsideArguments(selected, signon, toWinePath(logFile))], {
    cwd: clientDir,
    timeout: timeoutSeconds * 1000,
    env: {
      ...process.env,
      WINEPREFIX: winePrefix,
      WINEDEBUG: '-all',
      WINEDLLOVERRIDES: 'mscoree,mshtml=',
      WINEPATH: toWinePath(path.join(oracleClient, 'bin')),
      ORACLE_HOME: toWinePath(oracleClient),
      TNS_ADMIN: toWinePath(tnsDir)
    },
    encoding: 'buffer'
  });
  const log = fs.existsSync(logFile) ? readPsideLog(fs.readFileSync(logFile)) : undefined;
  console.log(JSON.stringify({
    action: selected,
    release: profile.release,
    database: signon.database,
    exitCode: result.status,
    timedOut: result.error !== undefined && /ETIMEDOUT/.test(String(result.error)),
    durationMs: Date.now() - started,
    logFile,
    log: log ?? null
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
