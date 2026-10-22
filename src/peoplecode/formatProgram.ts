import type { DefinitionKey } from '../model/definitions.js';
import { compilerProfileForToolsRelease } from './compilerProfile.js';
import { decodeProgram } from './decoder.js';
import { encodeProgramArtifacts } from './encoder.js';
import { NameTable } from './progtext.js';
import { pcmKeyFor } from './validate.js';
import { compileTargetFor, prepareSourceForSave, referencesToNameRows, type NameRow, type PcmKey } from './writeback/savePlan.js';

/*
 * Format PeopleCode as Application Designer lays it out. App Designer keeps
 * no layout of its own: it shows the program its compiler stored, reformatted
 * (Validate Syntax rewrites the editor's text the same way), and Studio's
 * decoder reproduces that text for 99.5% of the HCDEV corpus. So formatting
 * is compile, then decode. The result is offered only when it compiles to the
 * very same program and name table as the text it replaces: a format can
 * change spacing, line breaks and keyword case, never what runs.
 */

export type FormatResult = { text: string } | { refused: string };

function nameTable(rows: readonly NameRow[]): NameTable {
  const names = new NameTable();
  for (const row of rows) {
    const rec = row.recname.trim(), ref = row.refname.trim();
    names.add(row.namenum, rec && ref ? `${rec}.${ref}` : ref || rec);
  }
  return names;
}

/**
 * A quoted definition name (`BusProcess."Administer Workforce"`) is stored upper case in the name table; keep the
 * source's own spelling of it, as App Designer shows it. String literals are stored as written and need nothing.
 */
function keepQuotedNameCase(formatted: string, source: string): string {
  const spelled = new Map<string, string>();
  for (const m of source.matchAll(/\.\s*("(?:[^"\n]|"")*")/g)) if (!spelled.has(m[1].toUpperCase())) spelled.set(m[1].toUpperCase(), m[1]);
  return formatted.replace(/(\.\s*)("(?:[^"\n]|"")*")/g, (all, dot: string, quoted: string) => {
    const own = spelled.get(quoted.toUpperCase());
    return own && own !== quoted ? dot + own : all;
  });
}

/** `source` laid out as App Designer shows it, with the source's own line endings; refused when that cannot be proven safe. */
export function formatPeopleCode(source: string, key: DefinitionKey, toolsRelease: string): FormatResult {
  const pcmKey = pcmKeyFor(key);
  if (!pcmKey) return { refused: "PeopleSoft Studio's compiler does not compile this kind of PeopleCode yet." };
  return formatProgramSource(source, pcmKey, toolsRelease);
}

/** {@link formatPeopleCode} for a PSPCMPROG key. */
export function formatProgramSource(source: string, pcmKey: PcmKey, toolsRelease: string): FormatResult {
  const lf = prepareSourceForSave(source);
  if (lf === '') return { text: source };
  let target;
  try { target = compileTargetFor(pcmKey); } catch (error) { return { refused: error instanceof Error ? error.message : String(error) }; }
  const compile = (text: string) => encodeProgramArtifacts(text, {
    owner: { recordName: target.recordName, fieldName: target.fieldName, ...(target.packagePath ? { packagePath: target.packagePath } : {}) },
    applicationClassDefinition: target.applicationClass,
    profile: compilerProfileForToolsRelease(toolsRelease)
  });
  let original;
  try { original = compile(lf); } catch (error) {
    return { refused: `The PeopleCode does not compile, so it cannot be formatted: ${error instanceof Error ? error.message : String(error)}` };
  }
  const names = referencesToNameRows(original.references);
  const decoded = decodeProgram(original.program, nameTable(names), { mode: 'strict', isApplicationClass: target.applicationClass, layout: 'appDesigner' });
  if (decoded.unknownOpcodes.length) return { refused: 'The compiled program has constructs the decoder cannot lay out yet.' };
  const formatted = keepQuotedNameCase(prepareSourceForSave(decoded.text), lf);
  let again;
  try { again = compile(formatted); } catch { return { refused: 'The formatted text would not compile to the same program; leaving the text as it is.' }; }
  if (!again.program.equals(original.program) || JSON.stringify(referencesToNameRows(again.references)) !== JSON.stringify(names)) {
    return { refused: 'The formatted text would not compile to the same program; leaving the text as it is.' };
  }
  // Blank lines after the last statement are not in the program; keep the source's own.
  const trailing = /\n*$/.exec(lf)![0].length;
  const crlf = /\r\n/.test(source);
  const ended = formatted.replace(/\n*$/, '') + '\n'.repeat(trailing);
  const body = source.replace(/\r\n/g, '\n').endsWith('\n') ? ended : ended.replace(/\n$/, '');
  return { text: crlf ? body.replace(/\n/g, '\r\n') : body };
}
