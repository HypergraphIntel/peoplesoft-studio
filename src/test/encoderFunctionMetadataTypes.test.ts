import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgram } from '../peoplecode/encoder.js';

/*
 * Cycle 113: Function metadata's Application Class type names are one
 * entry per use -- return types (directory order), then parameter types
 * (slot order) -- never deduplicated. 15800 stores
 * `PTIB_PACKAGE:MobileURLParams` once per parameter; 14327 its return
 * types before its parameter types.
 */
const typeNames = (program: Buffer): string[] => {
  const functions = program.readUInt32LE(29);
  const names: string[] = [];
  let at = 37 + program.readUInt32LE(5);
  while (names.length < functions + 16) {
    let end = at;
    while (end + 1 < program.length && (program[end] | program[end + 1])) end += 2;
    const name = program.subarray(at, end).toString('utf16le');
    if (!/^[%\w:]+$/.test(name)) break;
    names.push(name);
    at = end + 2;
  }
  return names.slice(functions).filter(name => name.includes(':'));
};

test('a class type used by two parameters is written twice (15800)', () => {
  const source = 'Function First(&a As PKG:Widget, &b As PKG:Widget)\n   F();\nEnd-Function;\n';
  assert.deepEqual(typeNames(encodeProgram(source)), ['PKG:Widget', 'PKG:Widget']);
});

test('return types are written before parameter types (14327)', () => {
  const source = 'Function First(&a As PKG:Param) Returns PKG:Result\n   Return Null;\nEnd-Function;\n';
  assert.deepEqual(typeNames(encodeProgram(source)), ['PKG:Result', 'PKG:Param']);
});

/*
 * Cycle 132: an Application Class type descriptor is 0x80000 + (0x100 +
 * the class name's character offset in the name run) -- a sum. 2116's
 * `Returns CAFNUI_CORE:OBJECT:CompareSession` at offset 284 stores
 * `8021C`; `0x100 | offset` gave `8011C`.
 */
const classDescriptors = (program: Buffer): { offset: number; returnKind: number; slots: number[] } => {
  const runStart = 37 + program.readUInt32LE(5);
  const nameBytes = program.readUInt32LE(13), records = program.readUInt32LE(29);
  const run = program.subarray(runStart, runStart + nameBytes).toString('utf16le');
  const tableStart = runStart + nameBytes, slotsStart = tableStart + records * 16;
  const slots: number[] = [];
  for (let at = slotsStart; at + 4 <= program.length; at += 4) slots.push(program.readUInt32LE(at));
  return { offset: run.indexOf('PKG:Result'), returnKind: program.readUInt32LE(tableStart + 12), slots };
};

for (const [label, length] of [['below 256', 20], ['with bit 8 set (2116)', 300]] as const) {
  test(`a class return type at a name-run offset ${label} is 0x80000 + 0x100 + offset`, () => {
    const name = 'F'.repeat(length);
    const source = `Function ${name}() Returns PKG:Result\n   Return Null;\nEnd-Function;\n`;
    const { offset, returnKind } = classDescriptors(encodeProgram(source));
    assert.equal(offset, length + 1);
    assert.equal(returnKind, 0x80000 + 0x100 + offset);
  });
}

test('a class parameter type at a name-run offset with bit 8 set is 0x80000 + 0x100 + offset (5525)', () => {
  const source = `Function ${'G'.repeat(300)}(&a As PKG:Result)\n   F();\nEnd-Function;\n`;
  const { offset, slots } = classDescriptors(encodeProgram(source));
  assert.equal(offset, 301);
  assert.equal(slots[0] & ~0xc0000000, 0x80000 + 0x100 + offset);
});
