import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 171: a blank line after a Function header is a 0x4F marker whatever
 * the return type -- also `Returns <App Class>` (14352 `Returns
 * ADSM:ADSMTreeNode` <blank> `Local ...` stores `2D 4F 44`).
 */
const owner = { recordName: 'REC', fieldName: 'FLD' };
const afterHeader = (returns: string, blank: boolean) => {
  const program = encodeProgramArtifacts(
    `Function F(&a As string)${returns}\n${blank ? '   \n' : ''}   Local string &s;\n   &s = &a;\nEnd-Function;\n`,
    { owner }
  ).program;
  const at = program.indexOf(Buffer.from([0x2d]), 37);
  return program.subarray(at, at + 2).toString('hex');
};

test('Returns <App Class> then a blank line writes the 0x4F marker (14352)', () => {
  assert.equal(afterHeader(' Returns PKG:Node', true), '2d4f');
});

test('Returns string then a blank line writes the same marker (control)', () => {
  assert.equal(afterHeader(' Returns string', true), '2d4f');
});

test('no blank line, no marker (control)', () => {
  assert.equal(afterHeader(' Returns PKG:Node', false), '2d44');
});
