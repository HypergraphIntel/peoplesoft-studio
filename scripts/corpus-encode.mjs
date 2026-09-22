// Offline encoder diagnostics; never writes to a database.
// npm test, then: node scripts/corpus-encode.mjs corpus.json
// Uses corpus-build.mjs entries with their real PSPCMNAME tables. Missing
// name tables can cause undecodable entries and must not be counted as passes.
import { readFileSync } from 'node:fs';
import { decodeProgram, INLINE_IDENTIFIER_OPCODE } from '../dist-test/peoplecode/decoder.js';
import { encodeFragment, encodeProgram, UnsupportedPeopleCodeError } from '../dist-test/peoplecode/encoder.js';
import { compareBytes } from '../dist-test/peoplecode/programImage.js';
import { NameTable } from '../dist-test/peoplecode/progtext.js';
import { UNSIGNED_NUMBER_FORMAT } from '../dist-test/peoplecode/numberFormats.js';

const corpus = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const result = {
  programs: corpus.length,
  integerOperands: 0,
  integerDifferences: 0,
  otherNumberOperands: 0,
  undecodablePrograms: 0,
  unsupportedPrograms: 0,
  regeneratedPrograms: 0,
  exactPrograms: 0,
  semanticDifferences: 0,
  regeneratedCallStatements: 0,
  exactCallStatements: 0,
  statementSemanticDifferences: 0,
  statementBinaryDifferences: [],
  binaryDifferences: [],
  unsupportedSamples: []
};
// Ignore formatting/header tokens; do not erase whitespace within literals.
const significant = (tokens) => tokens.filter(t => t.text !== '').map(t => [t.kind, t.text]);
const sameTokens = (a, b) => JSON.stringify(significant(a)) === JSON.stringify(significant(b));

function auditCallStatements(entry, bytes, names, tokens) {
  // Bounded diagnostic slices: assignments and bare call statements that
  // contain parentheses. These are NOT counted as complete program encodes.
  for (let i = 0; i + 2 < tokens.length; i++) {
    const assignment = tokens[i].opcode === 0x01 && tokens[i + 1].text === '=';
    const call = tokens[i].opcode === INLINE_IDENTIFIER_OPCODE && tokens[i + 1].text === '(' &&
      [0x15, 0x2d, 0x4f, 0x1f].includes(tokens[i - 1]?.opcode);
    if (!assignment && !call) continue;
    let end = i + 1;
    while (end < tokens.length && end < i + 150 && tokens[end].opcode !== 0x15) end++;
    if (end >= tokens.length || end >= i + 150) continue;
    if (!tokens.slice(i, end + 1).some(t => t.text === '(')) continue;
    const original = bytes.subarray(tokens[i].offset, tokens[end].offset + 1);
    const decoded = decodeProgram(original, names);
    if (decoded.unknownOpcodes.length) continue;
    let generated;
    try {
      generated = encodeFragment(decoded.text);
    } catch (error) {
      if (!(error instanceof UnsupportedPeopleCodeError)) throw error;
      continue;
    }
    result.regeneratedCallStatements++;
    const comparison = compareBytes(original, generated);
    if (comparison.equal) result.exactCallStatements++;
    else result.statementBinaryDifferences.push({ key: entry.key, offset: tokens[i].offset, ...comparison });
    const regenerated = decodeProgram(generated, new NameTable(), { mode: 'strict' });
    if (!sameTokens(decoded.tokens, regenerated.tokens)) result.statementSemanticDifferences++;
  }
}
for (const entry of corpus) {
  const bytes = Buffer.from(entry.bytes, 'base64');
  const names = new NameTable();
  for (const [num, name] of entry.names ?? []) names.add(num, name);
  const decoded = decodeProgram(bytes, names, { mode: 'auto', isApplicationClass: entry.key.type === 58 });
  if (decoded.unknownOpcodes.length) { result.undecodablePrograms++; continue; }
  for (const token of decoded.tokens) {
    if (token.kind !== 'number') continue;
    if (token.opcode !== UNSIGNED_NUMBER_FORMAT.opcode || !/^\d+$/.test(token.text)) {
      result.otherNumberOperands++;
      continue;
    }
    result.integerOperands++;
    const original = bytes.subarray(token.offset, token.offset + 1 + UNSIGNED_NUMBER_FORMAT.operandLength);
    const generated = encodeFragment(`Return ${token.text};`).subarray(1, -1);
    if (!generated.equals(original)) result.integerDifferences++;
  }
  auditCallStatements(entry, bytes, names, decoded.tokens);
  let generated;
  try {
    generated = encodeProgram(decoded.text);
  } catch (error) {
    if (!(error instanceof UnsupportedPeopleCodeError)) throw error;
    result.unsupportedPrograms++;
    if (result.unsupportedSamples.length < 5) result.unsupportedSamples.push({ key: entry.key, diagnostic: error.message });
    continue;
  }
  result.regeneratedPrograms++;
  const comparison = compareBytes(bytes, generated);
  if (comparison.equal) result.exactPrograms++;
  else result.binaryDifferences.push({ key: entry.key, ...comparison });
  const regenerated = decodeProgram(generated, new NameTable(), { mode: 'strict' });
  if (!sameTokens(decoded.tokens, regenerated.tokens)) {
    result.semanticDifferences++;
  }
}
console.log(JSON.stringify(result, null, 2));
// Full-program alternative encodings remain diagnostic, not automatic failures.
// The canonical zero-scale 0x50 operand itself should be byte-identical.
if (result.integerDifferences || result.semanticDifferences || result.statementSemanticDifferences) process.exitCode = 1;
