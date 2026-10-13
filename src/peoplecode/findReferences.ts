import { PEOPLECODE_TYPES, type DefinitionKey } from '../model/definitions.js';
import { DatabaseProvider } from '../providers/database.js';
import { UnsupportedOperationError, type DefinitionProvider } from '../providers/provider.js';

/*
 * Find References: where a text or identifier occurs in PeopleCode. On a
 * database the stored source (PSPCMTXT) is searched in one query and each
 * matching program is read as the editor opens it, so the line numbers are
 * the editor's; a project export, or a provider without that query, is
 * scanned program by program, bounded. An identifier matches as a whole
 * token (JOB matches neither JOB_DATA nor &JOB); any other text as a
 * substring. Case is ignored, as PeopleCode ignores it.
 */

export interface ReferenceHit {
  key: DefinitionKey;
  /** 0-based, as VS Code positions are. */
  line: number;
  column: number;
  /** The line, trimmed and bounded. */
  context: string;
}

export interface ReferenceSearch {
  hits: ReferenceHit[];
  /** Programs that contain the text. */
  programs: number;
  /** Programs read. */
  scanned: number;
  /** More programs may contain it than were read. */
  truncated: boolean;
}

const IDENTIFIER = /^[A-Za-z0-9_&%#$@]+(?:[.:][A-Za-z0-9_&%#$@]+)*$/;
// What continues a PeopleCode token: &JOB is a variable and %Date a system variable, not JOB or Date.
const WORD = /[A-Za-z0-9_&%#$@]/;

/** The occurrences of `needle` in a program's text. */
export function occurrences(text: string, needle: string): Array<{ line: number; column: number; context: string }> {
  const want = needle.trim().toUpperCase();
  if (!want) return [];
  const whole = IDENTIFIER.test(want);
  const out: Array<{ line: number; column: number; context: string }> = [];
  text.split(/\r?\n/).forEach((lineText, line) => {
    const upper = lineText.toUpperCase();
    for (let at = upper.indexOf(want); at !== -1; at = upper.indexOf(want, at + 1)) {
      if (whole && (WORD.test(upper[at - 1] ?? '') || WORD.test(upper[at + want.length] ?? ''))) continue;
      out.push({ line, column: at, context: lineText.trim().slice(0, 200) });
    }
  });
  return out;
}

export async function findPeopleCodeReferences(provider: DefinitionProvider, needle: string,
  options: { maxPrograms?: number; scanLimit?: number } = {}): Promise<ReferenceSearch> {
  const maxPrograms = options.maxPrograms ?? 200;
  const scanLimit = options.scanLimit ?? 2000;
  const hits: ReferenceHit[] = [];
  let programs = 0;
  let scanned = 0;
  let truncated = false;
  const read = async (key: DefinitionKey) => {
    scanned++;
    let text: string;
    try { text = await provider.readText(key); } catch { return; } // a program the provider cannot open is skipped
    const found = occurrences(text, needle);
    if (found.length) programs++;
    for (const o of found) hits.push({ key, ...o });
  };

  if (provider instanceof DatabaseProvider) {
    const candidates = await provider.findPeopleCodeContaining(needle, maxPrograms);
    truncated = candidates.truncated;
    for (const key of candidates.keys) await read(key);
    return { hits, programs, scanned, truncated };
  }

  for (const type of PEOPLECODE_TYPES) {
    if (scanned >= scanLimit) { truncated = true; break; }
    let summaries;
    try {
      summaries = await provider.search({ type, namePattern: '%', limit: scanLimit - scanned });
    } catch (error) {
      if (error instanceof UnsupportedOperationError) continue; // a kind of PeopleCode this provider cannot list
      throw error;
    }
    for (const s of summaries) {
      if (scanned >= scanLimit) { truncated = true; break; }
      await read(s.key);
    }
  }
  return { hits, programs, scanned, truncated };
}
