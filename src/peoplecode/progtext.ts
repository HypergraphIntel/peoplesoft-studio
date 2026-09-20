/**
 * Reassembly of PeopleCode program text out of PSPCMPROG.
 *
 * A program is stored as N rows sharing the same seven-part key, distinguished
 * by PROGSEQ, each carrying a slice of the program in PROGTXT. Oracle caps the
 * slice; concatenating the slices in PROGSEQ order reproduces the byte stream
 * exactly. This part of the format is stable and well understood.
 */
export interface ProgramChunk {
  seq: number;
  data: Buffer;
}

export function assembleProgram(chunks: readonly ProgramChunk[]): Buffer {
  const ordered = [...chunks].sort((a, b) => a.seq - b.seq);
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].seq !== i) {
      throw new Error(
        `PeopleCode program has a gap at PROGSEQ ${i} (found ${ordered[i].seq}). ` +
        `The program is incomplete; refusing to decode a partial byte stream.`
      );
    }
  }
  return Buffer.concat(ordered.map((c) => c.data));
}

/**
 * The name table for a program.
 *
 * Identifiers in the token stream are not spelled out; they are indices into
 * PSPCMNAME, which holds one row per referenced name keyed by NAMENUM. Index 0
 * is unused by PeopleTools, so the table is 1-based.
 */
export class NameTable {
  private readonly names = new Map<number, string>();

  add(nameNum: number, name: string): void {
    this.names.set(nameNum, name.trimEnd());
  }

  get(nameNum: number): string {
    const n = this.names.get(nameNum);
    if (n === undefined) {
      // A missing name means our index arithmetic drifted, which would silently
      // produce plausible-looking but wrong source. Fail loudly instead.
      throw new NameResolutionError(nameNum, this.names.size);
    }
    return n;
  }

  get size(): number { return this.names.size; }

  entries(): IterableIterator<[number, string]> { return this.names.entries(); }
}

export class NameResolutionError extends Error {
  constructor(readonly nameNum: number, readonly tableSize: number) {
    super(`PeopleCode references name #${nameNum} but the name table holds ${tableSize} entries.`);
    this.name = 'NameResolutionError';
  }
}
