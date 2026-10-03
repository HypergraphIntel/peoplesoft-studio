import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgram, encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 155: Function directory type descriptors for built-in type names
 * the encoder rejected ("Unsupported function metadata type") -- read from
 * the stored parameter / return slots (parameter slots | 0xc0000000).
 */
const le = (value: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value >>> 0);
  return b;
};

const roundtrips = (source: string) => {
  const program = encodeProgram(source);
  const decoded = decodeProgram(program, new NameTable(), { mode: 'auto' });
  assert.deepEqual(encodeProgram(decoded.text), program, 'roundtrip');
  return program;
};

test('time is scalar descriptor 0x0a (1016 `Returns time`, 15290 `As time`)', () => {
  const program = roundtrips('Function F(&t As time) Returns time\n   Return &t;\nEnd-Function;\n');
  assert.ok(program.includes(le(0xc000000a)), 'parameter slot');
  assert.ok(program.includes(le(0x0000000a)), 'return slot');
});

test('object is the late-bound scalar descriptor 0x0d and opens no PACKAGE row (17998)', () => {
  const source = 'Function F(&o As object)\n   &o.Run();\nEnd-Function;\n';
  const program = roundtrips(source);
  assert.ok(program.includes(le(0xc000000d)));
  assert.equal(encodeProgramArtifacts(source).references.filter(r => r.kind === 'package').length, 0);
});

test('built-in object descriptors (13562, 17083, 17840, 15515, 15517, 15586, 14665)', () => {
  for (const [type, id] of [['Message', 0x8000e], ['CubeCollection', 0x80033], ['Document', 0x8003f],
    ['DocumentKey', 0x80040], ['Primitive', 0x80041], ['Compound', 0x80042], ['CompositeQuery', 0x80048]] as const) {
    const program = roundtrips(`Function F(&x As ${type})\nEnd-Function;\n`);
    assert.ok(program.includes(le(0xc0000000 | id)), type);
  }
});

test('Function-header object types open their PACKAGE row in the header unit (17840, 14665, 15586, 15528)', () => {
  const rows = (source: string) => encodeProgramArtifacts(source).references
    .filter(r => r.kind === 'package').map(r => r.packageName);
  // first Function: parameter and return share the header unit's one row
  assert.deepEqual(rows('Function F(&cc As CubeCollection) Returns CubeCollection\nEnd-Function;\n'), ['CUBECOLLECTION']);
  // a later Function's header opens its own
  assert.deepEqual(rows('Function A(&cc As CubeCollection)\nEnd-Function;\n\nFunction B() Returns CubeCollection\nEnd-Function;\n'),
    ['CUBECOLLECTION', 'CUBECOLLECTION']);
  assert.deepEqual(rows('Function F(&cq As CompositeQuery)\nEnd-Function;\n'), ['COMPOSITEQUERY']);
  assert.deepEqual(rows('Function F(&d As Document)\nEnd-Function;\n'), ['DOCUMENT']);
  assert.deepEqual(rows('Function F() Returns DocumentKey\nEnd-Function;\n'), ['DOCUMENTKEY']);
  // the scalar time opens none
  assert.deepEqual(rows('Function F(&t As time) Returns time\nEnd-Function;\n'), []);
});
