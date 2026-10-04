import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts, isBuiltinObjectTypeName } from '../peoplecode/encoder.js';
import { createApplicationClassTypeMetadataProvider } from '../peoplecode/applicationClassTypeMetadata.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 167: an ordinary program whose class rows depend on metadata the
 * provider lacks (a call on a property of an unknown type -- the Cycle 93
 * fallback detection) still claims ONE blank wildcard PACKAGE row, at the
 * first wildcard import, like every other program: stored writes one per
 * program (1,117 EXACT programs with one wildcard, 332 with two or more).
 * The every-wildcard claim had compensated 13525's missing rows, now
 * typed from the captured WCS classes.
 */
const provider = createApplicationClassTypeMetadataProvider([
  { path: ['PKG', 'Mgr'], source: 'class Mgr\n   property PKG:Unknown Tree;\nend-class;\n' }
], { isBuiltinType: isBuiltinObjectTypeName });
const owner = { recordName: 'REC', fieldName: 'FLD' };
const encode = (imports: string[]) => {
  let fallback = false;
  const source = `${imports.join('\n')}\n\nComponent PKG:Mgr &m;\n\n&m.Tree.Draw();\n`;
  const { program, references } = encodeProgramArtifacts(source, { owner, applicationClassTypeMetadata: provider, onExternalMetadataFallback: () => { fallback = true; } });
  const names = new NameTable();
  for (const r of references) names.add(r.index + 1, r.kind === 'package' ? `PACKAGE.${r.packageName}` : `${r.recordName ?? ''}.${r.fieldName ?? ''}`);
  const decoded = decodeProgram(program, names, { mode: 'auto' });
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { owner, applicationClassTypeMetadata: provider }).program, program, 'roundtrip');
  return { fallback, blank: references.filter(r => r.kind === 'package' && r.packageName === '').map(r => r.index + 1) };
};

test('a fallback program with two wildcard imports claims one blank row (13525)', () => {
  const { fallback, blank } = encode(['import PKG:*;', 'import OTHER:*;']);
  assert.equal(fallback, true);
  assert.deepEqual(blank, [2]);
});

test('a fallback program with one wildcard import claims its blank row (control)', () => {
  const { fallback, blank } = encode(['import PKG:*;']);
  assert.equal(fallback, true);
  assert.deepEqual(blank, [2]);
});
