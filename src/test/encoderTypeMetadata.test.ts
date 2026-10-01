import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts, isBuiltinObjectTypeName, type EncodeProgramContext } from '../peoplecode/encoder.js';
import { createApplicationClassTypeMetadataProvider } from '../peoplecode/applicationClassTypeMetadata.js';

/*
 * Cycle 107: Application Class type metadata in ORDINARY programs. The
 * provider types a chain step the source cannot (`&w.Partner`,
 * `&w.GetOther()`); the existing Cycle 94 allocator then opens the method
 * row of the resolved class. Synthetic classes; corpus shapes (2134
 * `&cmpSession.Manager.CAFTrace(...)`, 17668 `&coRptDefn.GetTemplate(...)
 * .GetTemplateFile(...)`).
 */
const provider = createApplicationClassTypeMetadataProvider([
  {
    path: ['PKG', 'Widget'],
    source: 'class Widget\n   method GetOther() Returns PKG:Other;\n   property PKG:Other Partner;\n   property Rowset Rows;\n   property MISSING:Gone Lost;\nend-class;\n'
  },
  { path: ['PKG', 'Other'], source: 'class Other\nend-class;\n' }
], { isBuiltinType: isBuiltinObjectTypeName });

const head = 'Local PKG:Widget &w = create PKG:Widget();\n';
const encode = (source: string, extra: Partial<EncodeProgramContext> = {}) =>
  encodeProgramArtifacts(source, { owner: { recordName: 'REC', fieldName: 'FLD' }, ...extra });
const classRows = (source: string, extra: Partial<EncodeProgramContext> = {}) =>
  encode(source, extra).references
    .filter(reference => reference.kind === 'package')
    .map(reference => `${reference.packageName}${reference.methodName ? `.${reference.methodName.toUpperCase()}` : ''}`);

test('a property of a known class is typed through the provider: its class opens the method row', () => {
  const source = `${head}&w.Partner.Ping();\n`;
  assert.deepEqual(classRows(source), ['WIDGET']);
  assert.deepEqual(classRows(source, { applicationClassTypeMetadata: provider }), ['WIDGET', 'OTHER.PING']);
});

test('a method result of a known class is typed through the provider', () => {
  assert.deepEqual(
    classRows(`${head}&w.GetOther().Ping();\n`, { applicationClassTypeMetadata: provider }),
    ['WIDGET', 'WIDGET.GETOTHER', 'OTHER.PING']
  );
});

test('a built-in or unavailable member type allocates nothing', () => {
  for (const body of ['&w.Rows.Flush();\n', '&w.Lost.Ping();\n']) {
    assert.deepEqual(classRows(head + body, { applicationClassTypeMetadata: provider }), classRows(head + body));
  }
});

test('diagnostics-only mode consults the provider but encodes as if it were absent', () => {
  const source = `${head}&w.Partner.Ping();\n&w.GetOther().Ping();\n`;
  const events: string[] = [];
  const diagnostics = encode(source, {
    applicationClassTypeMetadata: provider,
    applicationClassTypeMetadataDiagnosticsOnly: true,
    applicationClassTypeMetadataTrace: event => events.push(`${event.kind}:${event.member}`)
  });
  assert.deepEqual(diagnostics.program, encode(source).program);
  assert.deepEqual(diagnostics.references, encode(source).references);
  // Each step is consulted once (the trace follows the one pass whose bytes are returned);
  // the unused answers type nothing further, so `.Ping` is never a typed call.
  assert.deepEqual(events.sort(), ['member:Partner', 'method-result:GetOther']);
});

test('Application Class programs type a property of a typed receiver too (Cycle 109)', () => {
  const source = 'import PKG:Widget;\nclass Thing\n   method Run();\nend-class;\n\nmethod Run\n   Local PKG:Widget &w = create PKG:Widget();\n   &w.Partner.Ping();\n   &w.Partner.Ping();\nend-method;\n';
  const context = { owner: { recordName: 'X', fieldName: 'Y', packagePath: ['APP', 'Thing'] } };
  const rows = (extra: Partial<EncodeProgramContext>) => encodeProgramArtifacts(source, { ...context, ...extra }).references
    .filter(reference => reference.kind === 'package' && reference.packageName)
    .map(reference => `${reference.packageName}${reference.methodName ? `.${reference.methodName}` : ''}`);
  // one OTHER row for the program (Cycle 108 lifetime), opened by the first call
  assert.deepEqual(rows({ applicationClassTypeMetadata: provider }), ['WIDGET', 'OTHER.PING']);
  assert.deepEqual(rows({}), ['WIDGET']);
});
