import { createHash } from 'node:crypto';
import { encodeProgramArtifacts, type PeopleCodeReference } from '../encoder.js';
import { decodeProgram } from '../decoder.js';
import { NameTable } from '../progtext.js';
import { predictSourceSignature } from '../sourceSignature.js';
import { sourcesMatch } from '../corpus/sourceNormalize.js';
import { writeScopeRefusal } from '../../providers/writeScope.js';
import { compilerProfileForToolsRelease } from '../compilerProfile.js';
import { parseApplicationClassSource } from '../applicationClassProgram.js';

/*
 * What a native PeopleCode save writes, as data: the rows App Designer
 * produces for a program, derived from its source. No database access --
 * src/providers/oracle.ts performs the transaction with these plans.
 *
 * Every rule here is evidence from docs/CONTROLLED_COMPILE_LAB.md, Cycle 185
 * (the save transition model): PSPCMTXT split greedily after LF into rows of
 * at most 14,000 characters, one HASH_SIGNATURE over the whole text on every
 * row; PSPCMPROG in 28,000-byte rows repeating VERSION / NAMECOUNT / PROGLEN /
 * LASTUPDDTTM / LASTUPDOPRID; PSPCMNAME NAMENUM 1..n.
 *
 * PSPCMNAME rows are the compiler's references, serialized: which rows
 * exist and in what order is the encoder's model (proven corpus-wide); the
 * descriptive columns of PACKAGE and Declare Function rows are mapped from
 * the same references (referencesToNameRows).
 *
 * Scope: ZZ_PCODE_LAB definitions only, Record PeopleCode and Application
 * Class programs that already exist. Anything else is refused with
 * SaveRefusedError, never approximated.
 */

export const SOURCE_ROW_CHARS = 14000;
export const PROGRAM_ROW_BYTES = 28000;

/** A save that must not happen; the message says why. */
export class SaveRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveRefusedError';
  }
}

/** PeopleTools stores an empty optional character value as a single space. */
const BLANK = ' ';
const stored = (value: string) => (value.trim() === '' ? BLANK : value);

/** A program's seven-part identity, as its stored rows carry it. */
export interface PcmKey {
  objectIds: readonly number[];
  objectValues: readonly string[];
}

export interface NameRow {
  namenum: number;
  recname: string;
  refname: string;
  packageroot: string;
  qualifypath: string;
  appclassmethod: string;
}

export interface StoredTextRow { progseq: number; text: string; hashSignature: string }
export interface StoredProgramRow {
  progseq: number;
  version: number;
  namecount: number;
  proglen: number;
  progrunloc: number;
  progflags: number;
  licenseCode: string;
  lastupddttm: string;
  lastupdoprid: string;
  progextends: string;
  pttoolsrel: string;
  bytes: Buffer;
}

/** A program as read from PSPCMTXT, PSPCMPROG and PSPCMNAME. */
export interface StoredProgram {
  key: PcmKey;
  text: StoredTextRow[];
  program: StoredProgramRow[];
  names: NameRow[];
}

// ---------------------------------------------------------------------------
// Scope

/** What the encoder needs to know about the program's owner. */
export interface CompileTarget {
  applicationClass: boolean;
  recordName: string;
  fieldName: string;
  packagePath?: string[];
}

const RECORD_ID = 1;
const FIELD_ID = 2;
const EVENT_ID = 12;
const APPLICATION_PACKAGE_ID = 104;
const COMPONENT_ID = 10;
const PAGE_ID = 9;
const MARKET_ID = 39;
const APPLICATION_CLASS_IDS = new Set([105, 106, 107]);

/** The owner, from the stored key; refuses anything outside the first writer's scope. */
export function targetForKey(key: PcmKey): CompileTarget {
  const ids = key.objectIds.map(Number);
  const values = key.objectValues.map((v) => v.trim());
  const scope = writeScopeRefusal(values[0]);
  if (scope) throw new SaveRefusedError(scope);
  if (ids[0] === RECORD_ID && ids[1] === FIELD_ID && ids[2] === EVENT_ID && ids.slice(3).every((id) => id === 0)) {
    return { applicationClass: false, recordName: values[0], fieldName: values[1] };
  }
  // Component (10 / 39 / 12), component record (10 / 39 / 1 / 12) and component record field (10 / 39 / 1 / 2 / 12)
  // PeopleCode compile against the record and field the key names, none for the component's own -- as the corpus
  // harness does, where 5,602 of 5,613 HCDEV component programs encode exactly.
  if (ids[0] === COMPONENT_ID && ids[1] === MARKET_ID) {
    const shape = ids.slice(2, ids.indexOf(EVENT_ID) + 1).join(',');
    if (['12', '1,12', '1,2,12'].includes(shape) && ids.slice(ids.indexOf(EVENT_ID) + 1).every((id) => id === 0)) {
      const record = ids.indexOf(RECORD_ID), field = ids.indexOf(FIELD_ID);
      return { applicationClass: false, recordName: record >= 0 ? values[record] : '', fieldName: field >= 0 ? values[field] : '' };
    }
  }
  // Page PeopleCode (9 / 12: page, Activate) compiles with no record or field, as the corpus harness does
  // (1,327 of HCDEV's 1,329 page programs encode exactly).
  if (ids[0] === PAGE_ID && ids[1] === EVENT_ID && ids.slice(2).every((id) => id === 0)) {
    return { applicationClass: false, recordName: '', fieldName: '' };
  }
  if (ids[0] === APPLICATION_PACKAGE_ID) {
    const last = ids.findIndex((id) => id === EVENT_ID);
    if (last > 1 && ids.slice(1, last).every((id) => APPLICATION_CLASS_IDS.has(id)) && values[last] === 'OnExecute') {
      return { applicationClass: true, recordName: values[0], fieldName: values[1], packagePath: values.slice(0, last) };
    }
  }
  throw new SaveRefusedError(
    `Saving this kind of PeopleCode (OBJECTIDs ${ids.join(', ')}) is not supported yet; ` +
    'only Record Field, Component, Page and Application Class programs are.');
}

// ---------------------------------------------------------------------------
// Rows

/**
 * The source as a save stores it: LF line endings, ending in a newline as
 * App Designer's saves do. An empty program stays empty.
 */
export function prepareSourceForSave(text: string): string {
  const lf = text.replace(/\r\n?/g, '\n');
  if (lf.trim() === '') return '';
  return lf.endsWith('\n') ? lf : `${lf}\n`;
}

/** PSPCMTXT rows: greedily, whole lines into rows of at most 14,000 characters. */
export function splitSourceRows(text: string): string[] {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const rows: string[] = [];
  let current = '';
  for (const line of lines) {
    if (line.length > SOURCE_ROW_CHARS) {
      throw new SaveRefusedError(
        `A line is ${line.length} characters long; PeopleTools' split of a line over ${SOURCE_ROW_CHARS} has not been observed.`);
    }
    if (current.length + line.length > SOURCE_ROW_CHARS) {
      rows.push(current);
      current = '';
    }
    current += line;
  }
  if (current !== '' || rows.length === 0) rows.push(current);
  return rows;
}

/** PSPCMPROG rows: 28,000-byte slices. */
export function splitProgramRows(program: Buffer): Buffer[] {
  const rows: Buffer[] = [];
  for (let offset = 0; offset < program.length || rows.length === 0; offset += PROGRAM_ROW_BYTES) {
    rows.push(program.subarray(offset, offset + PROGRAM_ROW_BYTES));
  }
  return rows;
}

/**
 * PSPCMNAME rows for the encoder's references: RECNAME / REFNAME as the
 * corpus harness validated them, and the descriptive columns as App
 * Designer 8.62.09 writes them on a fresh compile (every scratch program on
 * HRDMO; HRDMO-wide censuses for the case of APPCLASSMETHOD):
 *
 *   built-in object type   PACKAGE | TYPE  | Type name | Type name |
 *   Application Class      PACKAGE | CLASS | root      | sub:path  | METHOD (upper case), if any;
 *                                                                   a %This self row: its method
 *   wildcard import        PACKAGE | ' '   | root      | sub:path  |
 *   Declare Function       REC     | FIELD |           |           | event (FieldFormula, ...)
 *   anything else          its RECNAME / REFNAME, the rest blank
 */
export function referencesToNameRows(references: readonly PeopleCodeReference[]): NameRow[] {
  const up = (v: unknown) => String(v ?? '').toUpperCase();
  return [...references].sort((a, b) => a.sequence - b.sequence).map((r) => {
    let recname: string;
    let refname: string;
    let packageroot = '';
    let qualifypath = '';
    let appclassmethod = '';
    switch (r.kind) {
      case 'package': {
        recname = 'PACKAGE';
        refname = up(r.packageName);
        if (r.packagePath && r.packagePath.length > 0) {
          packageroot = r.packagePath[0];
          qualifypath = r.packagePath.slice(1).join(':');
          appclassmethod = up(r.appClassMethod ?? r.methodName);
        } else {
          // A built-in object type: its display name in both columns.
          if (!r.objectName) {
            throw new SaveRefusedError(`The compiler gave no type name for PACKAGE.${refname}; refusing to write that reference row.`);
          }
          packageroot = r.objectName;
          qualifypath = r.objectName;
        }
        break;
      }
      case 'declare-function':
        recname = up(r.recordName);
        refname = up(r.fieldName);
        if (!r.eventName) throw new SaveRefusedError(`The compiler gave no event for the Declare Function reference ${recname}.${refname}.`);
        appclassmethod = r.eventName;
        break;
      case 'owner': recname = up(r.recordName); refname = up(r.fieldName); break;
      case 'scroll': recname = 'SCROLL'; refname = up(r.recordName); break;
      case 'record': recname = 'RECORD'; refname = up(r.recordName); break;
      case 'field': recname = 'FIELD'; refname = up(r.fieldName); break;
      case 'component': recname = 'COMPONENT'; refname = up(r.objectName); break;
      default: recname = up(r.recordName); refname = up(r.fieldName); break;
    }
    return {
      namenum: r.sequence, recname: stored(recname), refname: stored(refname),
      packageroot: stored(packageroot), qualifypath: stored(qualifypath), appclassmethod: stored(appclassmethod)
    };
  });
}

/** PSPCMPROG.PROGEXTENDS: an Application Class's superclass, as its header names it; blank otherwise. */
export function progExtendsFor(source: string, target: CompileTarget): string {
  if (!target.applicationClass) return BLANK;
  return stored(parseApplicationClassSource(source)?.extendsType ?? '');
}

function nameTable(rows: readonly NameRow[]): NameTable {
  const names = new NameTable();
  for (const row of rows) {
    const rec = row.recname.trim();
    const ref = row.refname.trim();
    names.add(row.namenum, rec && ref ? `${rec}.${ref}` : ref || rec);
  }
  return names;
}

export interface Compiled { program: Buffer; names: NameRow[]; progextends: string }

/**
 * Encodes `source` for `target` under the PeopleTools release, and proves
 * the result decodes back to it. Refuses rather than returning a program
 * the decoder reads differently.
 */
export function compileForSave(source: string, target: CompileTarget, toolsRelease: string): Compiled {
  let artifacts;
  try {
    artifacts = encodeProgramArtifacts(source, {
      owner: { recordName: target.recordName, fieldName: target.fieldName, ...(target.packagePath ? { packagePath: target.packagePath } : {}) },
      applicationClassDefinition: target.applicationClass,
      profile: compilerProfileForToolsRelease(toolsRelease)
    });
  } catch (error) {
    throw new SaveRefusedError(`The PeopleCode does not compile: ${error instanceof Error ? error.message : String(error)}`);
  }
  const names = referencesToNameRows(artifacts.references);
  const decoded = decodeProgram(artifacts.program, nameTable(names), { mode: 'strict', isApplicationClass: target.applicationClass });
  if (decoded.unknownOpcodes.length > 0 || !sourcesMatch(source, decoded.text)) {
    throw new SaveRefusedError('The compiled program does not decode back to the source being saved; refusing to write it.');
  }
  return { program: artifacts.program, names, progextends: progExtendsFor(source, target) };
}

// ---------------------------------------------------------------------------
// Plans

export interface ProgramPlan {
  source: string;
  textRows: string[];
  hashSignature: string;
  programRows: Buffer[];
  proglen: number;
  names: NameRow[];
  progextends: string;
}

export function planProgram(source: string, compiled: Compiled): ProgramPlan {
  return {
    source,
    textRows: splitSourceRows(source),
    hashSignature: predictSourceSignature(source),
    programRows: splitProgramRows(compiled.program),
    proglen: compiled.program.length,
    names: compiled.names,
    progextends: compiled.progextends
  };
}

/** The columns every observed native save wrote with these values; a stored program with others is refused. */
export const PROGRAM_DEFAULTS = { progrunloc: 0, progflags: 0, licenseCode: BLANK, pttoolsrel: BLANK } as const;

export function storedText(program: StoredProgram): string {
  return [...program.text].sort((a, b) => a.progseq - b.progseq).map((r) => r.text).join('');
}

function storedBytes(program: StoredProgram): Buffer {
  return Buffer.concat([...program.program].sort((a, b) => a.progseq - b.progseq).map((r) => r.bytes));
}

/**
 * The rows the compiler models: NAMENUM, RECNAME, REFNAME. The descriptive
 * columns are compile history in older stored programs (an earlier
 * compile's format); a save rewrites them as a fresh compile does.
 */
const sameNames = (a: readonly NameRow[], b: readonly NameRow[]) =>
  a.length === b.length && a.every((x, i) =>
    x.namenum === b[i].namenum && x.recname.trim() === b[i].recname.trim() && x.refname.trim() === b[i].refname.trim());

/**
 * The pre-edit gate: the stored program must be one this writer reproduces
 * exactly -- its source re-encodes to the stored PSPCMPROG and PSPCMNAME,
 * its PSPCMTXT rows are split and signed as this writer would, and its
 * PSPCMPROG columns hold the values native saves were observed to write.
 * Anything else means the program is outside proven territory.
 */
export function checkStoredProgram(program: StoredProgram, target: CompileTarget, toolsRelease: string): void {
  const refuse = (why: string) => {
    throw new SaveRefusedError(`The stored program is outside what this writer reproduces: ${why.replace(/\.$/, '')}.`);
  };
  const seqs = (rows: { progseq: number }[]) => rows.map((r) => r.progseq).sort((a, b) => a - b);
  if (program.program.length === 0 || program.text.length === 0) refuse('it has no PSPCMPROG or PSPCMTXT rows (creating programs is not supported)');
  if (seqs(program.program).some((s, i) => s !== i) || seqs(program.text).some((s, i) => s !== i)) refuse('its PROGSEQ values are not contiguous from 0');

  const text = storedText(program);
  const signature = predictSourceSignature(text);
  if (program.text.some((r) => r.hashSignature !== signature)) refuse('a HASH_SIGNATURE does not match its text');
  const split = splitSourceRows(text);
  const ordered = [...program.text].sort((a, b) => a.progseq - b.progseq);
  if (split.length !== ordered.length || split.some((t, i) => t !== ordered[i].text)) refuse('its PSPCMTXT rows are split differently');

  const first = program.program[0];
  for (const row of program.program) {
    if (row.version !== first.version || row.namecount !== first.namecount || row.proglen !== first.proglen ||
        row.lastupddttm !== first.lastupddttm || row.lastupdoprid !== first.lastupdoprid) refuse('its PSPCMPROG rows disagree');
    if (row.progrunloc !== PROGRAM_DEFAULTS.progrunloc || row.progflags !== PROGRAM_DEFAULTS.progflags ||
        row.licenseCode !== PROGRAM_DEFAULTS.licenseCode || row.pttoolsrel !== PROGRAM_DEFAULTS.pttoolsrel) {
      refuse('PROGRUNLOC, PROGFLAGS, LICENSE_CODE or PTTOOLSREL holds a value native saves were not observed to write');
    }
    if (row.progextends.trim() !== progExtendsFor(text, target).trim()) refuse('PROGEXTENDS does not match the class header');
  }
  const bytes = storedBytes(program);
  if (first.proglen !== bytes.length) refuse('PROGLEN does not match the program length');
  if (first.namecount !== program.names.length) refuse('NAMECOUNT does not match its PSPCMNAME rows');
  const programRows = splitProgramRows(bytes);
  const orderedProgram = [...program.program].sort((a, b) => a.progseq - b.progseq);
  if (programRows.length !== orderedProgram.length || programRows.some((b, i) => !b.equals(orderedProgram[i].bytes))) {
    refuse('its PSPCMPROG rows are split differently');
  }

  let compiled: Compiled;
  try {
    compiled = compileForSave(text, target, toolsRelease);
  } catch (error) {
    refuse(error instanceof Error ? error.message : String(error));
    return;
  }
  if (!compiled.program.equals(bytes)) refuse('its source does not re-encode to the stored PSPCMPROG');
  const names = [...program.names].sort((a, b) => a.namenum - b.namenum);
  if (!sameNames(compiled.names, names)) refuse('its source does not re-encode to the stored PSPCMNAME rows');
}

/** Every stored value of a program, in a fixed order: the basis of fingerprints and diffs. */
function canonical(program: StoredProgram) {
  return {
    key: [...program.key.objectIds.map(Number), ...program.key.objectValues],
    text: [...program.text].sort((a, b) => a.progseq - b.progseq)
      .map((r) => ({ progseq: r.progseq, text: r.text, hashSignature: r.hashSignature })),
    program: [...program.program].sort((a, b) => a.progseq - b.progseq).map((r) => ({
      progseq: r.progseq, version: r.version, namecount: r.namecount, proglen: r.proglen,
      progrunloc: r.progrunloc, progflags: r.progflags, licenseCode: r.licenseCode,
      lastupddttm: r.lastupddttm, lastupdoprid: r.lastupdoprid, progextends: r.progextends,
      pttoolsrel: r.pttoolsrel, bytes: r.bytes.toString('hex')
    })),
    names: [...program.names].sort((a, b) => a.namenum - b.namenum).map((r) => ({
      namenum: r.namenum, recname: r.recname, refname: r.refname,
      packageroot: r.packageroot, qualifypath: r.qualifypath, appclassmethod: r.appclassmethod
    }))
  };
}

/**
 * The concurrency token: everything a save would replace. A save is refused
 * when the stored program no longer matches the token taken when it was
 * opened (someone saved it since, in App Designer or elsewhere).
 */
export function fingerprint(program: StoredProgram | undefined): string {
  if (!program || (program.program.length === 0 && program.text.length === 0 && program.names.length === 0)) return 'absent';
  return createHash('sha256').update(JSON.stringify(canonical(program))).digest('hex');
}

/** The rows a save writes, fully determined, for writing and for verifying what was written. */
export function expectedProgram(
  key: PcmKey, plan: ProgramPlan,
  stamp: { version: number; lastupddttm: string; operatorId: string }
): StoredProgram {
  return {
    key,
    text: plan.textRows.map((text, progseq) => ({ progseq, text, hashSignature: plan.hashSignature })),
    program: plan.programRows.map((bytes, progseq) => ({
      progseq,
      version: stamp.version,
      namecount: plan.names.length,
      proglen: plan.proglen,
      ...PROGRAM_DEFAULTS,
      progextends: plan.progextends,
      lastupddttm: stamp.lastupddttm,
      lastupdoprid: stamp.operatorId,
      bytes
    })),
    names: plan.names
  };
}

/** Differences between what should be stored and what is, column by column; empty when identical. */
export function diffPrograms(expected: StoredProgram, actual: StoredProgram): string[] {
  const e = canonical(expected);
  const a = canonical(actual);
  const out: string[] = [];
  if (JSON.stringify(e.key) !== JSON.stringify(a.key)) out.push(`key ${JSON.stringify(e.key)} != ${JSON.stringify(a.key)}`);
  for (const table of ['text', 'program', 'names'] as const) {
    const x = e[table] as Record<string, unknown>[];
    const y = a[table] as Record<string, unknown>[];
    if (x.length !== y.length) { out.push(`${table}: ${x.length} rows expected, ${y.length} stored`); continue; }
    x.forEach((row, i) => {
      for (const column of Object.keys(row)) {
        if (row[column] !== y[i][column]) {
          const show = (v: unknown) => { const t = JSON.stringify(v); return t.length > 60 ? `${t.slice(0, 57)}...` : t; };
          out.push(`${table}[${i}].${column}: ${show(row[column])} expected, ${show(y[i][column])} stored`);
        }
      }
    });
  }
  return out;
}

/** A PeopleSoft operator id, as configured on a writable connection. */
export function validateOperatorId(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return 'PeopleSoft Operator ID is required.';
  if (/\s/.test(value.trim())) return 'PeopleSoft Operator ID cannot contain spaces.';
  if (value.trim().length > 30) return 'PeopleSoft Operator ID is at most 30 characters.';
  return undefined;
}
