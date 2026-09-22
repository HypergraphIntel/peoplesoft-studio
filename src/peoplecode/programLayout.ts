/** Section layout measured against real PSPCMPROG bytes; see docs/PEOPLECODE_HEADER.md. */
export const PROGRAM_HEADER_LENGTH = 37;
export const PROGRAM_DIRECTORY_RECORD_SIZE = 16;
export const PROGRAM_DISPATCH_SLOT_SIZE = 4;
export const PROGRAM_DIRECTORY_SEPARATOR = 0x07;

export interface ProgramSection {
  offset: number;
  byteLength: number;
}

export interface ProgramLayout {
  /** Observed format word; the semantic distinction between 0x84 and 0x85 is unknown. */
  format: 0x84 | 0x85;
  /** Includes the final 0x07 directory separator. */
  statements: ProgramSection;
  names: ProgramSection;
  records: ProgramSection;
  slots: ProgramSection;
  recordCount: number;
  slotCount: number;
}

export class UnsupportedProgramLayoutError extends Error {
  constructor(detail: string) {
    super(`Unsupported PeopleCode program layout: ${detail}`);
    this.name = 'UnsupportedProgramLayoutError';
  }
}

/**
 * Read section boundaries from the header, without token scanning or guessing
 * trailer markers. Does not imply the contents of any section are understood.
 * Unknown format words, nonzero unassigned words, and inconsistent lengths
 * fail explicitly. ProgramImage remains available for opaque preservation.
 */
export function readProgramLayout(bytes: Buffer): ProgramLayout {
  const fail = (detail: string): never => { throw new UnsupportedProgramLayoutError(detail); };
  if (bytes.length < PROGRAM_HEADER_LENGTH) fail('truncated 37-byte header');
  if (bytes[0] !== 0xa0) fail('expected leading 0xa0');
  for (const offset of [1, 9, 17, 25]) {
    if (bytes.readUInt32LE(offset) !== 0) fail(`unassigned header word at byte ${offset} is nonzero`);
  }
  const format = bytes.readUInt32LE(33);
  if (format !== 0x84 && format !== 0x85) return fail(`unrecognized format word 0x${format.toString(16)}`);
  const statementBytes = bytes.readUInt32LE(5);
  const nameBytes = bytes.readUInt32LE(13);
  const slotCount = bytes.readUInt32LE(21);
  const recordCount = bytes.readUInt32LE(29);
  if (statementBytes === 0) fail('statement section must contain a directory separator');
  if (nameBytes % 2 !== 0) fail('UTF-16LE name-directory byte length is odd');
  const statements = { offset: PROGRAM_HEADER_LENGTH, byteLength: statementBytes };
  const names = { offset: statements.offset + statements.byteLength, byteLength: nameBytes };
  const records = { offset: names.offset + names.byteLength, byteLength: recordCount * PROGRAM_DIRECTORY_RECORD_SIZE };
  const slots = { offset: records.offset + records.byteLength, byteLength: slotCount * PROGRAM_DISPATCH_SLOT_SIZE };
  const expected = slots.offset + slots.byteLength;
  if (expected !== bytes.length) fail(`header describes ${expected} bytes, received ${bytes.length}`);
  if (bytes[names.offset - 1] !== PROGRAM_DIRECTORY_SEPARATOR) fail('statement section does not end in 0x07');
  return { format, statements, names, records, slots, recordCount, slotCount };
}

/**
 * Build the observed 0xa0/0x85 header for a program with no directory records,
 * name run or dispatch slots. statementByteLength includes the final 0x07.
 * This does not support declarations, functions or Application Classes.
 * Generation is capped at 24 bits to stay within the legacy decoder header
 * recognizer; the layout reader accepts the full uint32 field.
 */
export function encodeSimpleProgramHeader(statementByteLength: number): Buffer {
  if (!Number.isInteger(statementByteLength) || statementByteLength < 1 || statementByteLength > 0xffffff) {
    throw new UnsupportedProgramLayoutError('simple-program statement byte length must be in 1..0xffffff');
  }
  const header = Buffer.alloc(PROGRAM_HEADER_LENGTH);
  header[0] = 0xa0;
  header.writeUInt32LE(statementByteLength, 5);
  header.writeUInt32LE(0x85, 33);
  return header;
}
