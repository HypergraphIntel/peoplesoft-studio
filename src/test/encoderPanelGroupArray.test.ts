import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 152: `PanelGroup array of <type>` is the Component array form
 * (6438 `PanelGroup array of string &BOLD_NODE;`, an encode error before).
 */
test('PanelGroup array of string encodes as 51 array of string &var and roundtrips (6438)', () => {
  const source = 'PanelGroup array of string &BOLD_NODE;\nPanelGroup array of Record &RECS;\n';
  const { program, references } = encodeProgramArtifacts(source);
  const names = new NameTable();
  references.forEach(r => names.add(r.index + 1, r.kind === 'package' ? `PACKAGE.${r.packageName}` : ''));
  const decoded = decodeProgram(program, names, { mode: 'auto' });
  const tokens = decoded.tokens.map(t => `${t.opcode.toString(16)}${t.text !== undefined && t.nameNum === undefined ? ':' + t.text : ''}`);
  assert.deepEqual(tokens.slice(1, 6), ['51:PanelGroup', '40:array', '40:of', '40:string', '1:&BOLD_NODE']);
  // the element type's built-in row, as for a Component array (string has none)
  assert.deepEqual(references.filter(r => r.kind === 'package').map(r => r.packageName), ['RECORD']);
  assert.deepEqual(encodeProgramArtifacts(decoded.text).program, program);
});
