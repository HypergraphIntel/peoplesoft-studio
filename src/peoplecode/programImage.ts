import { decodeProgram, DecodeResult } from './decoder.js';
import { NameTable } from './progtext.js';

/**
 * Uneditable binary snapshot. All bytes, including unknown operands and
 * metadata, stay opaque. Decoded views are advisory and never drive replay.
 * Preserves the supplied logical NameTable, not original PSPCMNAME SQL rows.
 */
export class ProgramImage {
  readonly #bytes: Buffer;
  readonly #names: NameTable;
  readonly #isApplicationClass: boolean;

  constructor(bytes: Buffer, names: NameTable, isApplicationClass = false) {
    this.#bytes = Buffer.from(bytes);
    this.#names = new NameTable();
    for (const [num, name] of names.entries()) this.#names.add(num, name);
    this.#isApplicationClass = isApplicationClass;
  }

  decode(): DecodeResult {
    return decodeProgram(this.#bytes, this.#names, { mode: 'auto', isApplicationClass: this.#isApplicationClass });
  }

  replay(): { bytes: Buffer; names: NameTable; isApplicationClass: boolean } {
    const names = new NameTable();
    for (const [num, name] of this.#names.entries()) names.add(num, name);
    return { bytes: Buffer.from(this.#bytes), names, isApplicationClass: this.#isApplicationClass };
  }
}

/** Byte comparison is diagnostic; callers choose whether equality is required. */
export function compareBytes(original: Uint8Array, regenerated: Uint8Array): {
  equal: boolean;
  originalLength: number;
  regeneratedLength: number;
  differenceCount: number;
  firstDifference?: number;
} {
  let differenceCount = 0;
  let firstDifference: number | undefined;
  for (let i = 0; i < Math.max(original.length, regenerated.length); i++) {
    if (original[i] !== regenerated[i]) {
      firstDifference ??= i;
      differenceCount++;
    }
  }
  return { equal: differenceCount === 0, originalLength: original.length,
    regeneratedLength: regenerated.length, differenceCount, firstDifference };
}
