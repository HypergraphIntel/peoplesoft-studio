import { createHash } from 'node:crypto';

/*
 * PSPCMTXT.HASH_SIGNATURE: the candidate algorithm (Cycle 185).
 *
 * PREDICTION ONLY. Nothing writes a value computed here. The write-back
 * rule (docs/PEOPLECODE_WRITEBACK.md) is that no generated signature is
 * written until this algorithm predicts every row of a broad native-save
 * corpus with zero mismatches (tools/corpus/source-signature/validate.ts)
 * and the rest of the native save protocol has been reproduced.
 *
 * Candidate: the base64 of SHA-1 over the stored source text as UTF-16LE,
 * followed by one 0x00 byte (a C string terminator, which is why every
 * value is 28 characters ending in "A"). The text is hashed exactly as
 * stored -- LF line endings, App Designer's trailing blank line included,
 * no terminator.
 *
 * Evidence so far: 7 / 7 native saves, all single-row ASCII programs (five
 * delivered HCDEV rows in src/test/fixtures/entryBoundaryPeopleCode.ts and
 * the SMOKE A / B saves on HRDMO 8.62.09, docs/CONTROLLED_COMPILE_LAB.md).
 * Open: programs stored in more than one PSPCMTXT row, and non-ASCII
 * source.
 */
export function predictSourceSignature(storedText: string): string {
  const digest = createHash('sha1').update(Buffer.from(storedText, 'utf16le')).digest();
  return Buffer.concat([digest, Buffer.from([0])]).toString('base64');
}
