import { normalizePeopleCodeSource } from './sourceNormalize.js';

/*
 * Cycle 183: historical source recovery for HCDEV's lossy PSPCMTXT.
 *
 * HCDEV is a non-Unicode database (NLS_CHARACTERSET WE8ISO8859P15). When
 * a Unicode client saved PeopleCode, Oracle converted the source text into
 * that character set for PSPCMTXT, while PSPCMPROG kept the compiled text
 * (comments and string literals) in UTF-16. A character with no
 * WE8ISO8859P15 byte was stored as its conversion image: the replacement
 * byte 0xBF, or a best-fit byte (U+2018 -> 0x60).
 *
 * Evidence:
 * - Oracle's own table: CONVERT(cp, 'WE8ISO8859P15', 'AL32UTF8') over
 *   every BMP code point (Oracle 19.30, read-only on the lab HRDMO,
 *   .claude/cycle183-we8iso8859p15-conversion.json). 256 code points keep
 *   their Latin-9 byte, the 8 best-fit mappings below have their own byte,
 *   and every other code point becomes 0xBF.
 * - All 71 HCDEV DECODE_SOURCE_MISMATCH programs differ from their
 *   decoded program only by such images, inside comments / strings
 *   (.claude/cycle183-source-loss-inventory.json).
 *
 * The image is many-to-one (genuine U+00BF and U+0060 occur in HCDEV
 * source), so PSPCMTXT alone cannot restore the original character. The
 * compiled program can: this recovers the HISTORICALLY COMPILED source by
 * keeping the stored text and taking, at exactly the lossy positions, the
 * program's character -- only where the stored byte is that character's
 * conversion image. PSPCMTXT itself is never changed. This is a corpus /
 * provenance layer, never encoder input outside validation.
 */

/** Oracle's WE8ISO8859P15 best-fit mappings: the code points with a byte other than their own Latin-9 byte or 0xBF. */
export const WE8ISO8859P15_BEST_FIT: ReadonlyMap<number, number> = new Map([
  [0x2015, 0x2d],
  [0x2018, 0x60],
  [0x2038, 0x5e],
  [0x03b2, 0xdf],
  [0x20a4, 0x4c],
  [0x223c, 0x7e],
  [0xf8fd, 0x66],
  [0xf8fe, 0xb7]
]);

/* ISO-8859-15 replaces eight ISO-8859-1 positions. */
const LATIN9_ADDED = new Map<number, number>([[0x20ac, 0xa4], [0x0160, 0xa6], [0x0161, 0xa8], [0x017d, 0xb4], [0x017e, 0xb8], [0x0152, 0xbc], [0x0153, 0xbd], [0x0178, 0xbe]]);
const LATIN9_REMOVED = new Set([0xa4, 0xa6, 0xa8, 0xb4, 0xb8, 0xbc, 0xbd, 0xbe]);

/** The WE8ISO8859P15 byte that represents a code point exactly, or undefined. */
export function latin9Byte(codePoint: number): number | undefined {
  if (LATIN9_ADDED.has(codePoint)) return LATIN9_ADDED.get(codePoint);
  return codePoint <= 0xff && !LATIN9_REMOVED.has(codePoint) ? codePoint : undefined;
}

/** Oracle's AL32UTF8 -> WE8ISO8859P15 conversion byte for a BMP code point; undefined outside the measured domain. */
export function we8iso8859p15Image(codePoint: number): number | undefined {
  if (codePoint > 0xffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return undefined;
  return latin9Byte(codePoint) ?? WE8ISO8859P15_BEST_FIT.get(codePoint) ?? 0xbf;
}

export interface HistoricalSourceSubstitution {
  /** Offset in the stored source text. */
  offset: number;
  stored: string;
  recovered: string;
  /** The WE8ISO8859P15 byte both share. */
  byte: number;
}

export interface HistoricalSourceRecovery {
  /** The stored text with the lossy characters restored. */
  text: string;
  substitutions: HistoricalSourceSubstitution[];
}

/**
 * The historically compiled source, or undefined when the stored and
 * decoded sources differ by anything other than conversion images.
 *
 * Strict: after normalization (`sourcesMatch`'s), both texts must have the
 * same length, and every differing character must be a stored Latin-9
 * character whose byte is the decoded character's conversion image. Each
 * restored character is placed at the same occurrence of the stored
 * character in the raw text, and the result must normalize to exactly the
 * decoded source.
 */
export function recoverHistoricalSource(stored: string, decoded: string): HistoricalSourceRecovery | undefined {
  const ns = normalizePeopleCodeSource(stored), nd = normalizePeopleCodeSource(decoded);
  if (ns === nd || ns.length !== nd.length) return undefined;
  // For each stored character involved, its occurrences in order and the decoded character at each.
  const lossy = new Set<string>();
  for (let k = 0; k < ns.length; k++) {
    if (ns[k] === nd[k]) continue;
    const storedByte = latin9Byte(ns.charCodeAt(k));
    const image = we8iso8859p15Image(nd.charCodeAt(k));
    if (storedByte === undefined || image === undefined || storedByte !== image) return undefined;
    lossy.add(ns[k]);
  }
  const queues = new Map<string, string[]>();
  for (let k = 0; k < ns.length; k++) if (lossy.has(ns[k])) queues.set(ns[k], [...(queues.get(ns[k]) ?? []), nd[k]]);
  const substitutions: HistoricalSourceSubstitution[] = [];
  let text = '';
  for (let i = 0; i < stored.length; i++) {
    const c = stored[i];
    const queue = queues.get(c);
    if (queue === undefined) { text += c; continue; }
    const recovered = queue.shift();
    if (recovered === undefined) return undefined;
    if (recovered !== c) substitutions.push({ offset: i, stored: c, recovered, byte: latin9Byte(c.charCodeAt(0))! });
    text += recovered;
  }
  if ([...queues.values()].some(q => q.length > 0)) return undefined;
  if (normalizePeopleCodeSource(text) !== nd) return undefined;
  return { text, substitutions };
}
