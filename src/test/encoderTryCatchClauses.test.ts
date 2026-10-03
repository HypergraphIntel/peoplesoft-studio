import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgram } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 153: a try statement may have several catch clauses (25111), and a
 * catch body's last statement may omit `;` before end-try (18280).
 */
const tokensOf = (program: Buffer) =>
  decodeProgram(program, new NameTable(), { mode: 'auto' }).tokens
    .map(t => `${t.opcode.toString(16)}${t.text !== undefined ? ':' + t.text : ''}`);

const roundtrips = (source: string) => {
  const program = encodeProgram(source);
  const decoded = decodeProgram(program, new NameTable(), { mode: 'auto' });
  assert.deepEqual(encodeProgram(decoded.text), program, 'roundtrip');
  return tokensOf(program);
};

test('two catch clauses each write a 0x66 catch header (25111)', () => {
  const tokens = roundtrips(`try
   &x = F();
catch PTPP_PORTAL:EXCEPTION:NotFoundException &e1
   Error "not found";
catch Exception &e
   &y = 1;
end-try;
`);
  assert.equal(tokens.filter(t => t === '66:catch').length, 2);
  assert.ok(tokens.includes('67:end-try'));
});

test('the last catch-body statement may omit ; before end-try -- no terminator is written (18280)', () => {
  const tokens = roundtrips(`try
   &x = F();
catch Exception &ex1
   &str = ""
end-try;
`);
  const at = tokens.indexOf('67:end-try');
  assert.deepEqual(tokens.slice(at - 3, at + 2), ['1:&str', '6:=', '16:""', '67:end-try', '15:;']);
});

test('a catch-body statement without ; elsewhere still fails', () => {
  assert.throws(() => encodeProgram(`try
   &x = F();
catch Exception &e
   &a = 1
   &b = 2;
end-try;
`), Error);
});
