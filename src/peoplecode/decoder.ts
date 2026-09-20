import { NameTable } from './progtext.js';

/**
 * Decoder for the tokenized form PeopleCode is stored in.
 *
 * ## What is known and what is not
 *
 * Oracle does not document this format. Chunk assembly and the PSPCMNAME
 * indirection (see progtext.ts) are certain. The token stream itself is only
 * partly mapped here: the opcode table below covers the constructs confirmed
 * against real programs, and everything else decodes to an explicit
 * `UnknownToken` rather than being guessed at.
 *
 * That choice is deliberate. A decoder that quietly invents plausible source
 * for an opcode it does not recognise produces code that compiles and means
 * something different, which is far worse than a visible gap. Unknown opcodes
 * surface in the rendered output as a marker comment carrying the byte value
 * and offset, so the table can be extended from real data.
 *
 * Until the table is calibrated against your environment, the project-export
 * provider is the accurate source for PeopleCode text: App Designer writes
 * plain source into the XML, so nothing needs decoding.
 */

export enum TokenKind {
  EndOfProgram = 'eop',
  Name = 'name',
  StringLiteral = 'string',
  NumberLiteral = 'number',
  Keyword = 'keyword',
  Punctuation = 'punct',
  Newline = 'newline',
  Comment = 'comment',
  Unknown = 'unknown'
}

export interface Token {
  kind: TokenKind;
  /** Rendered text for the token, already resolved through the name table. */
  text: string;
  /** Byte offset the token started at, for diagnostics. */
  offset: number;
  /** Raw opcode byte, present for every token read from the stream. */
  opcode: number;
}

/**
 * Opcode values confirmed against decoded programs.
 *
 * Entries are added only when a program round-trips: decode, recompile in App
 * Designer, and compare the stored bytes. Speculative entries do not belong
 * here — an unmapped opcode is reported, not approximated.
 */
export const OPCODES = new Map<number, { kind: TokenKind; text?: string }>([
  [0x00, { kind: TokenKind.EndOfProgram, text: '' }],
  [0x0a, { kind: TokenKind.Newline, text: '\n' }]
]);

export interface DecodeOptions {
  /** 'raw' emits a byte/opcode listing instead of source, for extending OPCODES. */
  mode: 'auto' | 'strict' | 'raw';
}

export interface DecodeResult {
  text: string;
  tokens: Token[];
  /** Offsets of opcodes with no entry in {@link OPCODES}. */
  unknownOpcodes: { offset: number; opcode: number }[];
}

export function decodeProgram(
  bytes: Buffer,
  names: NameTable,
  options: DecodeOptions = { mode: 'auto' }
): DecodeResult {
  if (options.mode === 'raw') {
    return { text: rawDump(bytes, names), tokens: [], unknownOpcodes: [] };
  }

  const tokens: Token[] = [];
  const unknownOpcodes: { offset: number; opcode: number }[] = [];
  let i = 0;

  while (i < bytes.length) {
    const offset = i;
    const opcode = bytes[i++];
    const mapped = OPCODES.get(opcode);

    if (mapped === undefined) {
      unknownOpcodes.push({ offset, opcode });
      if (options.mode === 'strict') {
        throw new UndecodableProgramError(offset, opcode, unknownOpcodes.length);
      }
      tokens.push({ kind: TokenKind.Unknown, text: '', offset, opcode });
      continue;
    }

    if (mapped.kind === TokenKind.EndOfProgram) break;
    tokens.push({ kind: mapped.kind, text: mapped.text ?? '', offset, opcode });
  }

  return { text: render(tokens, unknownOpcodes), tokens, unknownOpcodes };
}

function render(tokens: readonly Token[], unknown: readonly { offset: number; opcode: number }[]): string {
  const body = tokens.map((t) => t.text).join('');
  if (unknown.length === 0) return body;

  // Lead with the gap report so nobody edits and saves source that is missing
  // constructs the decoder could not read.
  const sample = unknown.slice(0, 8)
    .map((u) => `0x${u.opcode.toString(16).padStart(2, '0')}@${u.offset}`)
    .join(', ');
  return [
    '/* PeopleSoft Studio: this program could not be fully decoded.',
    ` * ${unknown.length} unmapped opcode(s): ${sample}${unknown.length > 8 ? ', ...' : ''}`,
    ' * The text below is incomplete. Editing and saving it would lose code.',
    ' * Use a project export for this program, or run the decoder in raw mode',
    ' * (peoplesoft.peoplecode.decoder = "raw") to extend the opcode table.',
    ' */',
    body
  ].join('\n');
}

function rawDump(bytes: Buffer, names: NameTable): string {
  const lines: string[] = [
    `# PeopleCode raw token dump — ${bytes.length} bytes, ${names.size} names`,
    '#',
    '# Name table:'
  ];
  for (const [num, name] of names.entries()) lines.push(`#   ${num}\t${name}`);
  lines.push('#', '# offset  hex   dec  mapped');

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    const mapped = OPCODES.get(b);
    lines.push(
      `${i.toString().padStart(7)}  0x${b.toString(16).padStart(2, '0')}  ${b.toString().padStart(3)}  ` +
      (mapped ? mapped.kind : '?')
    );
  }
  return lines.join('\n');
}

export class UndecodableProgramError extends Error {
  constructor(readonly offset: number, readonly opcode: number, readonly count: number) {
    super(
      `Unmapped PeopleCode opcode 0x${opcode.toString(16).padStart(2, '0')} at byte ${offset}. ` +
      `Decoding stopped in strict mode after ${count} unmapped opcode(s).`
    );
    this.name = 'UndecodableProgramError';
  }
}

/**
 * Encoding is intentionally absent.
 *
 * Writing PeopleCode back into PSPCMPROG means producing bytes PeopleTools will
 * execute. Until the decoder round-trips every construct in a program, encoding
 * risks writing a program that differs from what was on screen. Saves through
 * the database provider are therefore refused for PeopleCode; see
 * OracleProvider.writeText.
 */
export function encodeProgram(): never {
  throw new Error(
    'Writing PeopleCode to the database is not implemented. ' +
    'The stored format is not yet mapped well enough to guarantee a faithful round-trip.'
  );
}
