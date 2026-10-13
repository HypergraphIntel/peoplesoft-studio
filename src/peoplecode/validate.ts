import { DefinitionType, type DefinitionKey } from '../model/definitions.js';
import { pcmProgKeyParts, PEOPLECODE_OBJECTIDS } from '../model/peopleCodeKeys.js';
import { compilerProfileForToolsRelease } from './compilerProfile.js';
import { encodeProgramArtifacts, UnsupportedPeopleCodeError } from './encoder.js';
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
}

export interface Validation {
  problems: PeopleCodeProblem[];
  /** The compiler profile used, e.g. PT862. */
  profile: string;
}

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

/** Compiles `source` (any line endings) for `key` on PeopleTools `toolsRelease` (e.g. "8.62"). */
export function validatePeopleCode(source: string, key: DefinitionKey, toolsRelease: string): Validation {
  const profile = compilerProfileForToolsRelease(toolsRelease);
  const text = source.replace(/\r\n/g, '\n');
  const pcmKey = pcmKeyFor(key);
  if (!pcmKey) return { profile: profile.id, problems: [{ offset: 0, message: "PeopleSoft Studio's compiler does not compile this kind of PeopleCode yet." }] };
  let target;
  try {
    target = compileTargetFor(pcmKey);
  } catch (error) {
    return { profile: profile.id, problems: [{ offset: 0, message: error instanceof Error ? error.message : String(error) }] };
  }
  try {
    encodeProgramArtifacts(text, {
      owner: { recordName: target.recordName, fieldName: target.fieldName, ...(target.packagePath ? { packagePath: target.packagePath } : {}) },
      applicationClassDefinition: target.applicationClass,
      profile
    });
    return { profile: profile.id, problems: [] };
  } catch (error) {
    if (error instanceof UnsupportedPeopleCodeError) {
      return { profile: profile.id, problems: [{ offset: Math.max(0, Math.min(error.offset, text.length)), message: error.message.replace(/^Cannot encode PeopleCode at source offset \d+: /, '') }] };
    }
    return { profile: profile.id, problems: [{ offset: 0, message: error instanceof Error ? error.message : String(error) }] };
  }
}

/** A 0-based line and column for an offset in text with line feeds. */
export function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset).split('\n');
  return { line: before.length - 1, column: before[before.length - 1].length };
}
