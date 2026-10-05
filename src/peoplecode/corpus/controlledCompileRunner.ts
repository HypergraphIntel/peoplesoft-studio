/*
 * Cycle 175: the pure half of the unattended controlled-compile runner.
 *
 * The runner starts one fresh Application Designer process (pside.exe,
 * PeopleTools 8.61.15) per action, headless. This module builds that
 * process's arguments and its parameter file, and reads its log. It
 * starts nothing itself: tools/corpus/controlled-compile/run-compiler.ts
 * does.
 *
 * Facts measured on the 8.61.15 client (Cycle 175, Wine 11.17, no
 * database):
 * - Signon switches are parsed by pstls.dll (pstlsexe.cpp): HELP, QUIET,
 *   SR, LF, CC, CT, CS, CD, CO, CP, CX, CA, CI, CW, SS, SN, SUBSEQUENT,
 *   GUID, ST, SF. `-HIDE` / `-QUIET` are read by pside.exe.
 * - pstls.dll mentions a parameter file (`@`), but no tested form was
 *   honored under Wine: `@file` / `@@file`, one token per line or the
 *   whole command line. Every such run wrote an empty log and signed on
 *   to nothing. The lab's disposable credentials therefore go on the
 *   command line; never use institutional credentials here.
 * - Oracle errors are specific (ORA-12541 no listener, ORA-12154
 *   unresolved alias) only with ORACLE_HOME set; without it every
 *   connection failure reads `Return: -1`.
 * - Project switches are parsed by psprj.dll (prjcmdline.cpp): PJC PJTF
 *   PJFF PJM PJFC PJB PJMG CMPALLPC CMPPRJPC CMPDIRPC CMPPRJDIRPC, `-FP
 *   <dir>` for copy to / from file, and -TD / -TO / -TP for a target
 *   database.
 * - The `-LF` log is UTF-16LE with no BOM and CRLF line ends.
 * - The process exit code is 0 even when signon fails. Success is
 *   therefore never read from the exit code: it is the log and, above
 *   all, the database rows the compiler wrote.
 *
 * Not yet measured (it needs the lab database): whether `-CMPPRJPC` takes
 * the project name as its own argument or from another switch. The
 * builder supports both, and the smoke step decides.
 */

/** Never a lab: the institutional databases (Cycle 172 inventory). */
export const PROTECTED_DATABASE_PATTERN = /^(HCDEV|HCTST|HCUAT|HCPRD\w*|HCPAY|HCPPY|HCTRN|FS\w*)$/i;

export function assertLabDatabase(name: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,29}$/.test(name)) throw new Error(`Invalid database name ${JSON.stringify(name)}.`);
  if (PROTECTED_DATABASE_PATTERN.test(name)) throw new Error(`${name} is an institutional database, not a lab.`);
}

export interface PsideSignon {
  /** Database type for -CT, e.g. ORACLE. */
  databaseType: string;
  /** The lab database (TNS alias) for -CD. */
  database: string;
  operatorId: string;
  operatorPassword: string;
  /** Optional connect id / password (-CI / -CW). */
  connectId?: string;
  connectPassword?: string;
}

export type PsideAction =
  /**
   * Signon with no batch action. Under Wine this wrote an empty log even
   * when signon failed, so it proves nothing; preflight uses a project
   * action instead.
   */
  | { kind: 'signon-only' }
  /**
   * `projectArgument`: `inline` passes `-CMPPRJPC <project>`;
   * `pjm` passes `-PJM <project> -CMPPRJPC`.
   */
  | { kind: 'compile-project'; project: string; projectArgument: 'inline' | 'pjm' }
  | { kind: 'compile-all' }
  | { kind: 'copy-to-file'; project: string; directory: string }
  | { kind: 'copy-from-file'; project: string; directory: string };

const PROJECT_NAME = /^[A-Z][A-Z0-9_]{0,29}$/;

/** The signon switches. Values may not contain line breaks or quotes. */
export function signonArguments(signon: PsideSignon): string[] {
  assertLabDatabase(signon.database);
  const args = [
    '-CT', signon.databaseType,
    '-CD', signon.database,
    '-CO', signon.operatorId,
    '-CP', signon.operatorPassword
  ];
  if (signon.connectId !== undefined) args.push('-CI', signon.connectId);
  if (signon.connectPassword !== undefined) args.push('-CW', signon.connectPassword);
  for (const value of args) {
    if (/[\r\n"]/.test(value)) throw new Error('A signon value contains a line break or quote.');
  }
  return args;
}

/** pside.exe arguments for one headless action. */
export function buildPsideArguments(action: PsideAction, signon: PsideSignon, logFile: string): string[] {
  const args = ['-HIDE', '-QUIET', '-SS', 'NO', '-SN', 'NO', ...signonArguments(signon)];
  switch (action.kind) {
    case 'signon-only':
      break;
    case 'compile-all':
      args.push('-CMPALLPC');
      break;
    case 'compile-project':
      if (!PROJECT_NAME.test(action.project)) throw new Error(`Invalid project name ${action.project}.`);
      if (action.projectArgument === 'inline') args.push('-CMPPRJPC', action.project);
      else args.push('-PJM', action.project, '-CMPPRJPC');
      break;
    case 'copy-to-file':
    case 'copy-from-file':
      if (!PROJECT_NAME.test(action.project)) throw new Error(`Invalid project name ${action.project}.`);
      args.push(action.kind === 'copy-to-file' ? '-PJTF' : '-PJFF', action.project, '-FP', action.directory);
      break;
  }
  args.push('-LF', logFile);
  return args;
}

/** Decode a pside log: UTF-16LE (with or without BOM), else UTF-8. */
export function decodePsideLog(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le');
  const sample = bytes.subarray(0, Math.min(bytes.length, 64));
  let oddZeros = 0;
  for (let i = 1; i < sample.length; i += 2) if (sample[i] === 0) oddZeros++;
  return sample.length >= 2 && oddZeros * 2 >= sample.length / 2 ? bytes.toString('utf16le') : bytes.toString('utf8');
}

export interface PsideLogReport {
  lines: string[];
  /** The SQL library (PSORA64) could not load: the Oracle client is missing from the path. */
  sqlLibraryMissing: boolean;
  /** Signon was refused (any cause: bad credentials, unreachable database). */
  signonFailed: boolean;
  /** ORA-nnnnn codes in order. */
  oracleErrors: string[];
  /** Lines that report an error. */
  errorLines: string[];
  /** `Total N items processed.` (project processing), if present. */
  itemsProcessed?: number;
}

export function readPsideLog(bytes: Buffer): PsideLogReport {
  const text = decodePsideLog(bytes);
  const lines = text.split(/\r?\n/).map(line => line.trimEnd()).filter(line => line !== '');
  const oracleErrors = [...text.matchAll(/ORA-(\d{5})/g)].map(m => `ORA-${m[1]}`);
  const processed = /Total (\d+) items processed\./.exec(text);
  return {
    lines,
    sqlLibraryMissing: /Missing or invalid version of SQL library/i.test(text),
    signonFailed: /Invalid User ID and password for signon/i.test(text),
    oracleErrors,
    errorLines: lines.filter(line => /\berror\b/i.test(line)),
    ...(processed !== null ? { itemsProcessed: Number(processed[1]) } : {})
  };
}
