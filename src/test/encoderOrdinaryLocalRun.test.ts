import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 145: after a Function definition, consecutive declaration-only
 * top-level Locals -- before any top-level executable statement -- share
 * one allocation unit, like the leading section: 17893 `Local
 * PT_PC_UTIL:StringMap ...;` `Local array of PT_PC_UTIL:StringMap &vmap;`
 * stores one STRINGMAP row. A run in a Function body, or after executable
 * code, does not (each Local is its own unit).
 */
const owner = { recordName: 'R', fieldName: 'F' };
const keys = (source: string) => encodeProgramArtifacts(source, { owner }).references
  .filter(r => r.kind === 'package').map(r => (r as { packageName?: string }).packageName);

test('a post-Function run of declaration-only Locals shares one row (17893)', () => {
  assert.deepEqual(keys('Function F()\nEnd-Function;\n\nLocal PKG:Map &a;\nLocal array of PKG:Map &as;\n\n&a = create PKG:Map();\n'), ['MAP', 'MAP']);
});

test('a Function-body Local run does not share (5088 / 15070 controls)', () => {
  assert.deepEqual(keys('Function F()\n   Local PKG:Map &a;\n   Local array of PKG:Map &as;\n   &a = create PKG:Map();\nEnd-Function;\n'), ['MAP', 'MAP', 'MAP']);
});

test('Locals after executable code do not share (26713 control)', () => {
  assert.deepEqual(keys('Function F()\nEnd-Function;\n\n&x = 1;\nLocal PKG:Map &a;\nLocal array of PKG:Map &as;\n'), ['MAP', 'MAP']);
});
