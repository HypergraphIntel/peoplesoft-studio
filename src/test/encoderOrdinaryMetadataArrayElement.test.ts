import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts, isBuiltinObjectTypeName } from '../peoplecode/encoder.js';
import { createApplicationClassTypeMetadataProvider } from '../peoplecode/applicationClassTypeMetadata.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 166: in an ordinary program a property the type metadata declares
 * `array of <Class>` is an array of that class -- its indexed element a
 * receiver of the class -- as in an Application Class program (Cycle 109).
 * 19433 / 24500 / 24503 `&ContentSearchGrid.GridColumns [&colnum].SelectAll()`
 * (GridColumns: array of ADS_DMW:UI:Widgets:DynamicGridColumn, inherited)
 * store PACKAGE.DYNAMICGRIDCOLUMN; 24458 the same on an indexed Component
 * array element. Before, the array type was dropped, the call counted as an
 * unresolved external receiver, and the program took the Cycle 93 fallback
 * pass. A property the metadata does not know still does (control).
 */
const provider = createApplicationClassTypeMetadataProvider([
  { path: ['PKG', 'Grid'], source: 'class Grid\n   property array of PKG:Column Columns;\nend-class;\n' },
  { path: ['PKG', 'Column'], source: 'class Column\n   method SelectAll();\nend-class;\n' }
], { isBuiltinType: isBuiltinObjectTypeName });
const owner = { recordName: 'REC', fieldName: 'FLD' };
const encode = (line: string) => {
  let fallback = false;
  const context = { owner, applicationClassTypeMetadata: provider, onExternalMetadataFallback: () => { fallback = true; } };
  const source = `import PKG:Grid;\n\nComponent PKG:Grid &g;\n\n${line}\n`;
  const { program, references } = encodeProgramArtifacts(source, context);
  const names = new NameTable();
  for (const r of references) names.add(r.index + 1, r.kind === 'package' ? `PACKAGE.${r.packageName}` : `${r.recordName ?? ''}.${r.fieldName ?? ''}`);
  const decoded = decodeProgram(program, names, { mode: 'auto' });
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { owner, applicationClassTypeMetadata: provider }).program, program, 'roundtrip');
  return { fallback, packages: references.filter(r => r.kind === 'package').map(r => `${r.index + 1}:${r.packageName}${r.methodName ? `.${r.methodName}` : ''}`) };
};

test('a method call on an indexed metadata array property element opens the element class row (19433)', () => {
  const { fallback, packages } = encode('&g.Columns [&c].SelectAll();');
  assert.equal(fallback, false);
  assert.deepEqual(packages, ['2:GRID', '3:COLUMN.SELECTALL']);
});

test('a property the metadata does not know still takes the fallback pass (control)', () => {
  const { fallback } = encode('&g.Unknown [&c].SelectAll();');
  assert.equal(fallback, true);
});
