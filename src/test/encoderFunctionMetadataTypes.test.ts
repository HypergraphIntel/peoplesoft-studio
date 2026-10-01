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
