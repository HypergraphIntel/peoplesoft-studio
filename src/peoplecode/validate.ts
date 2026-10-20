import { DefinitionType, type DefinitionKey } from '../model/definitions.js';
import { pcmProgKeyParts, PEOPLECODE_OBJECTIDS } from '../model/peopleCodeKeys.js';
import { compilerProfileForToolsRelease } from './compilerProfile.js';
import { checkPeopleCodeSemantics } from './semanticCheck.js';
import { encodeProgramArtifacts, UnsupportedPeopleCodeError, type PeopleCodeReference } from './encoder.js';
import { unknownFunctions } from './functionCheck.js';
import { compileTargetFor, type PcmKey } from './writeback/savePlan.js';

/*
 * Validate PeopleCode: compile the editor's text with PeopleSoft Studio's
 * compiler, the one saves use, against the program's own record and field
 * (or class), for the connection's PeopleTools release. A problem is where
 * the compiler stopped and why. It is Studio's compiler, not PeopleTools':
 * it reproduces PeopleTools' bytes for 30,205 of 30,209 programs of a full
 * HCM database, but a construct it does not know yet is reported too, so
 * Application Designer has the last word.
 */

export interface PeopleCodeProblem {
  /** Offset into the validated text (line feeds only). */
  offset: number;
  message: string;
  /** 'warning' (default) for what App Designer would refuse; 'info' for a note. */
  severity?: 'warning' | 'info';
  /** 'qualify': a field App Designer stores qualified (see qualifications); 'unknown-function'; 'field-not-defined'. */
  code?: string;
  /** Characters the problem spans (default 1). */
  length?: number;
}

/** A bare field name App Designer stores qualified: `text` replaces `length` characters at `offset` (the validated text). */
export interface Qualification {
  offset: number;
  length: number;
  text: string;
}

export interface Validation {
  problems: PeopleCodeProblem[];
  /** The compiler profile used, e.g. PT862. */
  profile: string;
  /** Bare field names of the program's record, written as App Designer stores them. */
  qualifications?: Qualification[];
  /** The RECORD.FIELD references the program compiled with (for checking against the database). */
  fieldReferences?: Array<{ record: string; field: string; offset: number }>;
}

export interface ValidateOptions {
  /** The fields of the program's record (subrecords expanded): bare names among them are qualified as App Designer qualifies them. */
  ownerFields?: readonly string[];
}

/** The PeopleCode kinds whose bare field names App Designer qualifies with the program's own record. */
const OWNER_RECORD_TYPES = new Set<number>([DefinitionType.RecordPeopleCode, DefinitionType.ComponentRecordPeopleCode, DefinitionType.ComponentRecordFieldPeopleCode]);
const BARE = 'bare identifiers are only supported as calls';

const APPLICATION_SUBPACKAGE_IDS = [105, 106];

/** A PeopleCode definition's PSPCMPROG key, as the compiler's target needs it; undefined for a kind it does not compile. */
export function pcmKeyFor(key: DefinitionKey): PcmKey | undefined {
  const values = [...pcmProgKeyParts(key)];
  let ids: number[] | undefined;
  if (key.type === DefinitionType.ApplicationClassPeopleCode) {
    // package, its subpackages (105, 106), the class (107), OnExecute (12)
    const subpackages = values.length - 3;
    if (subpackages < 0 || subpackages > APPLICATION_SUBPACKAGE_IDS.length) return undefined;
    ids = [104, ...APPLICATION_SUBPACKAGE_IDS.slice(0, subpackages), 107, 12];
  } else {
    ids = PEOPLECODE_OBJECTIDS[key.type] ? [...PEOPLECODE_OBJECTIDS[key.type]!] : undefined;
  }
  if (!ids || ids.length !== values.length) return undefined;
  return { objectIds: [...ids, ...Array(7 - ids.length).fill(0)], objectValues: [...values, ...Array(7 - values.length).fill(' ')] };
}

/**
 * Compiles `source` (any line endings) for `key` on PeopleTools `toolsRelease` (e.g. "8.62").
 *
 * App Designer stores a bare field name of the program's record qualified --
 * `zz_pcode_lab_val = "A"` becomes `ZZ_PCODE_LAB_R2.ZZ_PCODE_LAB_VAL = "A"`
 * (native Validate Syntax, 2026-10-19) -- and refuses one that is not a field:
 * "Field ZZ_PCODE_LAB_R2.ZZ_NO_SUCH_FLD not defined. (2,17)". Studio's compiler
 * takes qualified names only, so with the record's fields (options) each bare
 * name the compiler stops at is qualified and the compile retried; the
 * qualifications are returned for the editor's quick fix.
 */
export function validatePeopleCode(source: string, key: DefinitionKey, toolsRelease: string, options: ValidateOptions = {}): Validation {
  const profile = compilerProfileForToolsRelease(toolsRelease);
  const text = source.replace(/\r\n/g, '\n');
  const pcmKey = pcmKeyFor(key);
  // App Designer's compiler checks the encoder does not make (semanticCheck.ts).
  const semantic = checkPeopleCodeSemantics(text, { applicationClass: key.type === DefinitionType.ApplicationClassPeopleCode })
    .map((p) => ({ offset: p.offset, message: `${p.message} (${p.code})` }));
  if (semantic.length) return { profile: profile.id, problems: semantic };
  if (!pcmKey) return { profile: profile.id, problems: [{ offset: 0, message: "PeopleSoft Studio's compiler does not compile this kind of PeopleCode yet." }] };
  let target;
  try {
    target = compileTargetFor(pcmKey);
  } catch (error) {
    return { profile: profile.id, problems: [{ offset: 0, message: error instanceof Error ? error.message : String(error) }] };
  }
  const owner = OWNER_RECORD_TYPES.has(key.type) ? target.recordName : undefined;
  const fields = new Set((options.ownerFields ?? []).map((f) => f.toUpperCase()));
  const qualifications: Qualification[] = [];
  // Inserted characters so far, in compiled-text order: map a compiled offset back to the editor's text.
  const shifts: Array<{ at: number; by: number }> = [];
  const original = (offset: number) => offset - shifts.filter((x) => x.at <= offset).reduce((n, x) => n + x.by, 0);
  let compiled = text;
  for (let attempt = 0; attempt < 500; attempt++) {
    try {
      const encoded = encodeProgramArtifacts(compiled, {
        owner: { recordName: target.recordName, fieldName: target.fieldName, ...(target.packagePath ? { packagePath: target.packagePath } : {}) },
        applicationClassDefinition: target.applicationClass,
        profile
      });
      const problems: PeopleCodeProblem[] = qualifications.map((q) => ({ offset: q.offset, length: q.length, severity: 'info', code: 'qualify',
        message: `Application Designer stores this as ${q.text}.` }));
      for (const u of unknownFunctions(text)) problems.push({ offset: u.offset, length: u.name.length, code: 'unknown-function', message: u.message });
      return { profile: profile.id, problems: problems.sort((a, b) => a.offset - b.offset), qualifications, fieldReferences: fieldReferences(text, encoded.references, qualifications) };
    } catch (error) {
      if (!(error instanceof UnsupportedPeopleCodeError)) {
        return { profile: profile.id, problems: [{ offset: 0, message: error instanceof Error ? error.message : String(error) }], qualifications };
      }
      const at = Math.max(0, Math.min(error.offset, compiled.length));
      const reason = error.message.replace(/^Cannot encode PeopleCode at source offset \d+: /, '');
      const bare = reason === BARE ? /([A-Za-z_][\w#$@]*)\s*$/.exec(compiled.slice(0, at)) : null;
      if (!bare || !owner) {
        return { profile: profile.id, problems: [{ offset: original(at), message: bare ? `${bare[1]}: ${reason}. Write it qualified (RECORD.FIELD), as App Designer stores it.` : reason }], qualifications };
      }
      const start = bare.index, name = bare[1];
      if (!options.ownerFields || !fields.has(name.toUpperCase())) {
        const known = options.ownerFields ? `Field ${owner}.${name.toUpperCase()} not defined. (2,17)` : `${name}: a bare name Studio can qualify only with ${owner}'s fields (connect to the database), or write it ${owner}.${name.toUpperCase()}.`;
        return { profile: profile.id, problems: [{ offset: original(start), length: name.length, code: options.ownerFields ? 'field-not-defined' : undefined, message: known }], qualifications };
      }
      const replacement = `${owner}.${name.toUpperCase()}`;
      qualifications.push({ offset: original(start), length: name.length, text: replacement });
      compiled = compiled.slice(0, start) + replacement + compiled.slice(start + name.length);
      shifts.push({ at: start + name.length, by: replacement.length - name.length });
    }
  }
  return { profile: profile.id, problems: [{ offset: 0, message: 'Too many bare field names to qualify.' }], qualifications };
}

/** The program's RECORD.FIELD references, each at its first place in the text (for the database check). */
function fieldReferences(text: string, references: readonly PeopleCodeReference[], qualified: readonly Qualification[]): Array<{ record: string; field: string; offset: number }> {
  const out = new Map<string, { record: string; field: string; offset: number }>();
  const upper = text.toUpperCase();
  for (const r of references) {
    if (r.kind !== 'record-field' || !r.recordName || !r.fieldName) continue;
    const id = `${r.recordName}.${r.fieldName}`.toUpperCase();
    if (out.has(id)) continue;
    const at = upper.indexOf(id);
    const offset = at >= 0 ? at : qualified.find((q) => q.text === id)?.offset ?? 0;
    out.set(id, { record: r.recordName.toUpperCase(), field: r.fieldName.toUpperCase(), offset });
  }
  return [...out.values()];
}

/** A 0-based line and column for an offset in text with line feeds. */
export function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset).split('\n');
  return { line: before.length - 1, column: before[before.length - 1].length };
}
