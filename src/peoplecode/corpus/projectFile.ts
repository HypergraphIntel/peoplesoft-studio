/*
 * Cycle 175: read and edit the PeopleCode programs of an Application
 * Designer project file (`-PJTF` "copy project to file" output).
 *
 * The format was measured from real PeopleTools project exports (PUM
 * change packages, Cycle 175). A PeopleCode program is one
 * `<instance class="PCM">` holding:
 * - a `PcmProg` row with `<eObjectID_0..6>` and `<szObjectValue_0..6>`
 *   (the PSPCMPROG key, zero-based here);
 * - a `PcmPnt` rowset: the PSPCMNAME rows;
 * - `<peoplecode_text>`: the source, XML-escaped;
 * - `<peoplecode_blob>`: base64 of the compiled program.
 *
 * The controlled-compile loader swaps only the source of one program,
 * inside a project file exported from the lab itself. It never writes a
 * compiled program: the blob it leaves in place is the lab compiler's own
 * output for the pristine source, and serves as a sentinel. A capture
 * still equal to that blob after `-CMPPRJPC` means the compiler did not
 * run.
 */

export interface ProjectProgramKey {
  objectIds: number[];
  objectValues: string[];
}

export interface ProjectProgram {
  key: ProjectProgramKey;
  /** Unescaped source. */
  source: string;
  /** Base64 blob as stored (may be empty). */
  blob: string;
  /** Offsets of the PCM instance within the file. */
  start: number;
  end: number;
}

const unescapeXml = (text: string): string =>
  text.replace(/&(lt|gt|quot|apos|amp|#(\d+)|#x([0-9a-fA-F]+));/g, (_, name: string, dec?: string, hex?: string) => {
    if (dec !== undefined) return String.fromCodePoint(Number(dec));
    if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
    return ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' } as Record<string, string>)[name];
  });

/** Escaping as the exports do it: & < > and ". */
export const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function firstTag(block: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block);
  return match === null ? undefined : match[1];
}

function programKey(block: string): ProjectProgramKey {
  const objectIds: number[] = [];
  const objectValues: string[] = [];
  for (let i = 0; i < 7; i++) {
    objectIds.push(Number(firstTag(block, `eObjectID_${i}`) ?? 0));
    objectValues.push(unescapeXml(firstTag(block, `szObjectValue_${i}`) ?? ''));
  }
  return { objectIds, objectValues };
}

/** Every PeopleCode program in a project file. */
export function listProjectPrograms(xml: string): ProjectProgram[] {
  const programs: ProjectProgram[] = [];
  const opener = /<instance class="PCM">/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(xml)) !== null) {
    const start = match.index;
    const close = xml.indexOf('</instance>', start);
    if (close < 0) throw new Error(`Unterminated PCM instance at offset ${start}.`);
    const end = close + '</instance>'.length;
    const block = xml.slice(start, end);
    programs.push({
      key: programKey(block),
      source: unescapeXml(firstTag(block, 'peoplecode_text') ?? ''),
      blob: (firstTag(block, 'peoplecode_blob') ?? '').trim(),
      start,
      end
    });
  }
  return programs;
}

const sameKey = (a: ProjectProgramKey, b: ProjectProgramKey): boolean =>
  a.objectIds.every((id, i) => Number(id) === Number(b.objectIds[i] ?? 0)) &&
  a.objectValues.every((value, i) => value.trim().toUpperCase() === String(b.objectValues[i] ?? '').trim().toUpperCase());

/**
 * Replace one program's source. The key must match exactly one PCM
 * instance. Line breaks follow the original text's convention (CRLF when
 * it has any). The blob is left unchanged.
 */
export function replaceProgramSource(xml: string, key: ProjectProgramKey, source: string): string {
  const matches = listProjectPrograms(xml).filter(program => sameKey(program.key, key));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one program for ${key.objectValues.filter(v => v.trim()).join('.')}, found ${matches.length}.`);
  }
  const [program] = matches;
  const block = xml.slice(program.start, program.end);
  const original = firstTag(block, 'peoplecode_text');
  if (original === undefined) throw new Error('The program has no <peoplecode_text>.');
  const crlf = /\r\n/.test(original);
  const normalized = source.replace(/\r\n/g, '\n');
  const text = escapeXml(crlf ? normalized.replace(/\n/g, '\r\n') : normalized);
  const edited = block.replace(/<peoplecode_text>[\s\S]*?<\/peoplecode_text>/, () => `<peoplecode_text>${text}</peoplecode_text>`);
  return xml.slice(0, program.start) + edited + xml.slice(program.end);
}
