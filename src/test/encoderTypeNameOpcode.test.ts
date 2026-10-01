import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFragment } from '../peoplecode/encoder.js';

/*
 * Cycle 113: in a type position only the primitive types are keywords
 * (0x40); every other type name -- each built-in object type -- is an
 * inline identifier (0x0A). 2171: `Local Page &MYPAGE;` stores
 * `44 0A "Page"`.
 */
const typeOpcode = (declaration: string): number => {
  const bytes = encodeFragment(`${declaration};`);
  const local = bytes.indexOf(0x44);
  return bytes[local + 1];
};

for (const type of ['Page', 'JsonBuilder', 'JsonParser', 'Interlink', 'IntBroker', 'Document', 'Record', 'Rowset']) {
  test(`a built-in object type is an identifier: Local ${type}`, () => {
    assert.equal(typeOpcode(`Local ${type} &x`), 0x0a);
  });
}

for (const type of ['string', 'number', 'boolean', 'integer', 'date', 'datetime', 'time', 'any', 'object', 'float']) {
  test(`a primitive type is a keyword: Local ${type}`, () => {
    assert.equal(typeOpcode(`Local ${type} &x`), 0x40);
  });
}

/*
 * Cycle 113: a blank line between two leading Local declarations of a
 * Function body is a 0x4F marker (2116: `Local ... &fctHandler;` <blank>
 * `Local Record &record;` stores `15 4F 44`).
 */
test('a blank line between two leading Locals of a Function body is a 0x4F marker', () => {
  const marked = encodeFragment('Function F()\n   Local Record &a;\n\n   Local Rowset &b;\n   &a = Null;\nEnd-Function;\n');
  const plain = encodeFragment('Function F()\n   Local Record &a;\n   Local Rowset &b;\n   &a = Null;\nEnd-Function;\n');
  const between = (bytes: Buffer) => {
    const first = bytes.indexOf(0x44), second = bytes.indexOf(0x44, first + 1);
    return [...bytes.subarray(first, second)].filter(byte => byte === 0x4f).length;
  };
  assert.equal(between(marked), 1);
  assert.equal(between(plain), 0);
});

/*
 * Cycle 113: an array's Application Class element type is written in full
 * after `array of`, at every declaration site. 14888: `Component array of
 * PT_CUBQUERYCHUNK:QueryChunker &aQChunker;`; 17894: `Local array of array
 * of PT_PC_UTIL:StringMap &vmap_array;`.
 */
for (const declaration of [
  'Component array of PKG:Sub:Widget &w',
  'Global array of PKG:Widget &w',
  'Local array of array of PKG:Widget &w'
]) {
  test(`an array's class element type is encoded: ${declaration}`, () => {
    const bytes = encodeFragment(`${declaration};`);
    const of = bytes.indexOf(Buffer.from('of', 'utf16le'));
    const pkg = bytes.indexOf(Buffer.from('PKG', 'utf16le'), of);
    const variable = bytes.indexOf(Buffer.from('&w', 'utf16le'));
    assert.ok(of > 0 && pkg > of && variable > pkg, `${declaration}: class path between \`of\` and the variable`);
    assert.ok(bytes.indexOf(Buffer.from('Widget', 'utf16le'), pkg) < variable);
  });
}
