import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 114: the last implementation's closer may omit its `;` at the end
 * of the source. The implementation is kept, and its closer is written as
 * the bare opcode -- no 0x15, no 0x2D (29494 `end-method` + EOF stores
 * `... 64 07`; 1,414 terminated programs end `64 15 2D 07`).
 */
const program = (lastCloser: string) => encodeProgramArtifacts([
  'class Child',
  '   method First();',
  '   method Last();',
  'end-class;',
  '',
  'method First',
  '   F();',
  'end-method;',
  '',
  'method Last',
  '   LastBody();',
  lastCloser,
  ''
].join('\n'), { owner: { recordName: 'PKG', fieldName: 'Child', packagePath: ['PKG', 'Child'] } }).program;

test('an unterminated last end-method is kept and written bare (29494)', () => {
  const bytes = program('end-method');
  const statementsEnd = 37 + bytes.readUInt32LE(5) - 1;
  assert.ok(bytes.includes(Buffer.from('LastBody\0', 'utf16le')));
  assert.equal(bytes[statementsEnd - 1], 0x64);
  assert.equal(bytes[statementsEnd], 0x07);
});

test('a terminated last end-method keeps 0x15 0x2D', () => {
  const bytes = program('end-method;');
  const statementsEnd = 37 + bytes.readUInt32LE(5) - 1;
  assert.equal(bytes.subarray(statementsEnd - 3, statementsEnd + 1).toString('hex'), '64152d07');
});
