import { createHash } from 'node:crypto';

/*
 * PSPCMTXT.HASH_SIGNATURE: the algorithm (Cycle 185).
 *
 * PREDICTION ONLY. Nothing writes a value computed here. The write-back
 * rule (docs/PEOPLECODE_WRITEBACK.md) is that no generated signature is
 * written until this algorithm predicts every row of a broad native-save
 * corpus with zero mismatches (tools/corpus/source-signature/validate.ts)
 * and the rest of the native save protocol has been reproduced.
 *
 * Algorithm: the base64 of SHA-1 over the stored source text as UTF-16LE,
 * followed by one 0x00 byte (a C string terminator, which is why every
 * value is 28 characters ending in "A"). The text is hashed exactly as
 * stored -- LF line endings, App Designer's trailing blank line included,
 * no terminator.
 *
 * A program stored in several PSPCMTXT rows carries the same signature on
 * every row, computed over the whole text (the rows' PCTEXT concatenated in
 * PROGSEQ order). Pass that whole text.
 *
 * Evidence: every PSPCMTXT row on HRDMO 8.62.09 -- 114,790 programs, of
 * which 3,291 multi-row and 470 non-ASCII -- with zero mismatches
 * (tools/corpus/source-signature/results/HRDMO-2026-10-06.json), plus the
 * five delivered HCDEV rows in the test fixture. The algorithm is
 * established; writing it remains gated on reproducing the rest of the
 * native save transaction (docs/PEOPLECODE_WRITEBACK.md).
 */
export function predictSourceSignature(storedText: string): string {
  const digest = createHash('sha1').update(Buffer.from(storedText, 'utf16le')).digest();
  return Buffer.concat([digest, Buffer.from([0])]).toString('base64');
}
