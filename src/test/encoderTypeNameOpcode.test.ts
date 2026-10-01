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
