import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts, isBuiltinObjectTypeName, resolveCompileContext, type EncodeProgramContext } from '../peoplecode/encoder.js';
import { createApplicationClassTypeMetadataProvider } from '../peoplecode/applicationClassTypeMetadata.js';
import {
  COMPILER_PROFILES,
  CompilerProfileConflictError,
  UnsupportedCompilerProfileError,
  compilerProfileForToolsRelease,
  compilerProfileIdForToolsRelease,
  createPt861CompilerProfile,
  createPt862CompilerProfile
} from '../peoplecode/compilerProfile.js';
import { PEOPLETOOLS_RELEASES, compilerProfileForLabRelease, releaseProfile } from '../peoplecode/corpus/controlledCompileRunner.js';

/*
 * Cycle 184: compiler profiles. A refactor -- PT861 and PT862 share the
 * modeled behavior; a profile owns the release (`#If #ToolsRel`) and the
 * metadata universe, and the old options keep their meaning without one.
 */

test('PT861 and PT862: release families with no behavior deltas', () => {
  const pt861 = createPt861CompilerProfile(), pt862 = createPt862CompilerProfile({ patchLevel: 9 });
  assert.equal(pt861.id, 'PT861');
  assert.equal(pt861.toolsRelease, '8.61');
  assert.equal(pt862.id, 'PT862');
  assert.equal(pt862.toolsRelease, '8.62');
  assert.equal(pt862.patchLevel, 9);
  for (const profile of [pt861, pt862]) {
    assert.deepEqual([profile.syntax.deltas, profile.byteLayout.deltas, profile.referenceAllocation.deltas], [[], [], []]);
    assert.ok(Object.isFrozen(profile));
  }
  assert.deepEqual(Object.keys(COMPILER_PROFILES), ['PT861', 'PT862']);
});

test('profiles are selected by an explicit release table; anything else fails', () => {
  assert.equal(compilerProfileIdForToolsRelease('8.61'), 'PT861');
  assert.equal(compilerProfileIdForToolsRelease(' 8.62 '), 'PT862');
  for (const release of ['8.60', '8.63', '8.6', '8.61.15', '8.62.09', '9.0', '']) {
    assert.throws(() => compilerProfileIdForToolsRelease(release), UnsupportedCompilerProfileError, release);
  }
  assert.equal(compilerProfileForToolsRelease('8.62').id, 'PT862');
});

test('lab releases map to compiler profiles: 8.61.15 -> PT861, 8.62.09 -> PT862', () => {
  assert.equal(compilerProfileForLabRelease(releaseProfile('8.61.15')).id, 'PT861');
  const pt862 = compilerProfileForLabRelease(releaseProfile('8.62.09'));
  assert.equal(pt862.id, 'PT862');
  assert.equal(pt862.patchLevel, 9);
  assert.throws(() => releaseProfile('8.63.01'), /No lab profile/);
  // A misconfigured lab table cannot name a profile its TOOLSREL does not select.
  assert.throws(() => compilerProfileForLabRelease({ ...PEOPLETOOLS_RELEASES['8.62.09'], compilerProfileId: 'PT861' }), CompilerProfileConflictError);
});

test('a profile is the one owner of release and metadata: contradictions throw', () => {
  const metadata = createApplicationClassTypeMetadataProvider([], { isBuiltinType: isBuiltinObjectTypeName });
  const other = createApplicationClassTypeMetadataProvider([], { isBuiltinType: isBuiltinObjectTypeName });
  const profile = createPt862CompilerProfile({ applicationClassTypeMetadata: metadata });
  const source = 'Local number &n;\n&n = 1;\n';
  assert.throws(() => encodeProgramArtifacts(source, { profile, conditionalCompilation: { toolsRelease: '8.61' } }), CompilerProfileConflictError);
  assert.throws(() => encodeProgramArtifacts(source, { profile, applicationClassTypeMetadata: other }), CompilerProfileConflictError);
  // Agreeing values are accepted, and resolution is idempotent.
  const resolved = resolveCompileContext({ profile, conditionalCompilation: { toolsRelease: '8.62' }, applicationClassTypeMetadata: metadata })!;
  assert.deepEqual(resolved.conditionalCompilation, { toolsRelease: '8.62' });
  assert.equal(resolved.applicationClassTypeMetadata, metadata);
  assert.deepEqual(resolveCompileContext(resolved), resolved);
});

/* PT861 equivalence: the legacy options and an explicit PT861 profile encode identically. */
const metadata861 = createApplicationClassTypeMetadataProvider([
  { path: ['PKG', 'Widget'], source: 'class Widget\n   method GetOther() Returns PKG:Other;\n   property PKG:Other Partner;\nend-class;\n' },
  { path: ['PKG', 'Other'], source: 'class Other\nend-class;\n' }
], { isBuiltinType: isBuiltinObjectTypeName });
const ordinaryOwner = { owner: { recordName: 'REC', fieldName: 'FLD' } };
const classOwner = { owner: { recordName: 'PKG', fieldName: 'Kid', packagePath: ['PKG', 'Kid'] }, applicationClassDefinition: true };
const families: Array<[string, string, Partial<EncodeProgramContext>]> = [
  ['ordinary', 'Local number &n;\n&n = REC.FLD.Value + 1;\nIf &n > 2 Then\n   WinMessage("x");\nEnd-If;\n', ordinaryOwner],
  ['Declare Function', 'Declare Function Helper PeopleCode REC.FLD FieldFormula;\n\nHelper();\n', ordinaryOwner],
  ['Function-local declared-name scope', 'Function Load()\n   Local Rowset &r2 = GetLevel0()(1).GetRowset(Scroll.T_REC);\n   &v = &r2.GetRow(1).T_REC.VAL.Value;\nEnd-Function;\n\nFunction Read()\n   &v = &r2.GetRow(1).T_REC.VAL.Value;\nEnd-Function;\n', ordinaryOwner],
  ['conditional compilation', '#If #ToolsRel >= "8.60" #Then\n   &x = 1;\n#Else\n   &x = 2;\n#End-If\n', ordinaryOwner],
  ['metadata-driven class typing', 'Local PKG:Widget &w = create PKG:Widget();\n&w.Partner.Ping();\n&w.GetOther().Ping();\n', ordinaryOwner],
  ['Application Class, wildcard import', 'import PKG:*;\n\nclass Kid\n   method Run();\nend-class;\n\nmethod Run\n   Local PKG:Widget &x = create PKG:Other();\n   &x.Partner.Ping();\nend-method;\n', classOwner]
];

test('PT861 equivalence: an explicit PT861 profile encodes exactly as the legacy options', () => {
  for (const [label, source, base] of families) {
    const legacy = encodeProgramArtifacts(source, { ...base, conditionalCompilation: { toolsRelease: '8.61' }, applicationClassTypeMetadata: metadata861 });
    const profiled = encodeProgramArtifacts(source, { ...base, profile: createPt861CompilerProfile({ applicationClassTypeMetadata: metadata861 }) });
    assert.deepEqual(profiled.program, legacy.program, `${label} bytes`);
    assert.deepEqual(profiled.references, legacy.references, `${label} references`);
  }
});

test('no profile is the old default: no release is assumed', () => {
  const plain = 'Local number &n;\n&n = 1;\n';
  assert.deepEqual(encodeProgramArtifacts(plain, ordinaryOwner).program, encodeProgramArtifacts(plain, { ...ordinaryOwner, profile: createPt861CompilerProfile() }).program);
  // A directive still needs a release: without one it does not encode, as before Cycle 184.
  assert.throws(() => encodeProgramArtifacts(families[3][1], ordinaryOwner));
});

test('PT862 context: #If #ToolsRel selects the 8.62 branch; PT861 the other', () => {
  const source = '#If #ToolsRel >= "8.62" #Then\n   REC.FLD.Value = "new";\n#Else\n   REC.FLD.Value = "old";\n#End-If\n';
  const pt861 = encodeProgramArtifacts(source, { ...ordinaryOwner, profile: createPt861CompilerProfile() }).program;
  const pt862 = encodeProgramArtifacts(source, { ...ordinaryOwner, profile: createPt862CompilerProfile() }).program;
  // A compiled string literal: 0x16, then the UTF-16 text without its quotes.
  const literal = (program: Buffer, text: string) => program.includes(Buffer.concat([Buffer.from([0x16]), Buffer.from(`${text}\0`, 'utf16le')]));
  assert.notDeepEqual(pt861, pt862);
  // The taken branch compiles to a string literal; the other stays directive text.
  assert.deepEqual([literal(pt861, 'old'), literal(pt861, 'new'), literal(pt862, 'new'), literal(pt862, 'old')], [true, false, true, false]);
  assert.deepEqual(pt862, encodeProgramArtifacts(source, { ...ordinaryOwner, conditionalCompilation: { toolsRelease: '8.62' } }).program);
});

test('metadata universes stay with their profile instance', () => {
  // HCDEV-like: Widget.Partner is PKG:Other. HRDMO-like: the same property is a Record.
  const hrdmo = createApplicationClassTypeMetadataProvider([
    { path: ['PKG', 'Widget'], source: 'class Widget\n   property Record Partner;\nend-class;\n' }
  ], { isBuiltinType: isBuiltinObjectTypeName });
  const source = 'Local PKG:Widget &w = create PKG:Widget();\n&w.Partner.Ping();\n';
  const rows = (context: Partial<EncodeProgramContext>) => encodeProgramArtifacts(source, { ...ordinaryOwner, ...context }).references
    .filter(r => r.kind === 'package').map(r => `${r.packageName}${r.methodName ? `.${r.methodName.toUpperCase()}` : ''}`);
  const pt861 = createPt861CompilerProfile({ applicationClassTypeMetadata: metadata861 });
  const before = rows({ profile: pt861 });
  const pt862 = createPt862CompilerProfile({ applicationClassTypeMetadata: hrdmo });
  assert.deepEqual(before, ['WIDGET', 'OTHER.PING']);
  assert.deepEqual(rows({ profile: pt862 }), ['WIDGET']);
  assert.deepEqual(rows({ profile: pt861 }), before);
  assert.deepEqual(rows({ profile: createPt862CompilerProfile() }), ['WIDGET']);
  assert.notEqual(pt861.applicationClassTypeMetadata, pt862.applicationClassTypeMetadata);
});
