import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 164: two App Class row-ORDER rules (same rows, earlier position).
 *   - Only the extends / implements entries themselves are the class
 *     relationship. A header member typed with the same class as `extends`
 *     is an ordinary declaration dependency in header order: 28721
 *     `extends PTWIDGETS:TreeGrid` (wildcard-imported) with `instance
 *     PTWIDGETS:TreeGrid &mTree;` stores TREEGRID between the header's other
 *     member types; 30047 the constructor parameter `As
 *     PTAF_CORE:ApprovalEventHandler`. A string comparison had treated the
 *     member type as the relationship.
 *   - A top-level `Global array of <Class>` opens its class row at the
 *     declaration, like a scalar Global (Cycle 82) and `Component array of
 *     <Class>`: 30068 `Global array of PTAF_EMC:LAYOUT_ELEMENTS:layoutElement`.
 */
const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const packages = (source: string) => {
  const { program, references } = encodeProgramArtifacts(source, { owner });
  const names = new NameTable();
  for (const r of references) names.add(r.index + 1, r.kind === 'package' ? `PACKAGE.${r.packageName}` : r.kind === 'owner' ? '' : `${r.recordName}.${r.fieldName}`);
  const decoded = decodeProgram(program, names, { mode: 'auto', isApplicationClass: true });
  const commentOpcodes = decoded.tokens.map(t => t.opcode).filter(o => o === 0x24 || o === 0x4e);
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { owner, commentOpcodes }).program, program, 'roundtrip');
  return references.filter(r => r.kind === 'package').map(r => `${r.index + 1}:${r.packageName}`);
};

test('a header member typed like the extends class is a dependency in header order (28721)', () => {
  const source = [
    'import PKG:*;',
    '',
    'class Demo extends PKG:Base',
    '   method Demo();',
    '   method Make() Returns PKG:Factory;',
    '   method Frame() Returns PKG:Frame;',
    'private',
    '   instance PKG:Base &mBase;',
    '   instance PKG:Spec &mSpec;',
    'end-class;',
    '',
    'method Demo',
    '   &mBase = create PKG:Base();',
    'end-method;',
    ''
  ].join('\n');
  // header order: Factory, Frame, Base (the instance), Spec -- before the body's create
  assert.deepEqual(packages(source), ['2:', '3:FACTORY', '4:FRAME', '5:BASE', '6:SPEC']);
});

test('extends alone, wildcard-imported, still opens no header row (control)', () => {
  const source = 'import PKG:*;\n\nclass Demo extends PKG:Base\n   method Demo();\nend-class;\n\nmethod Demo\n   &x = 1;\nend-method;\n';
  assert.deepEqual(packages(source), ['2:']);
});

test('a top-level Global array of a class opens its row at the declaration (30068)', () => {
  const source = [
    'class Demo',
    '   method Run();',
    'end-class;',
    '',
    'Global array of PKG:LayoutElement &layoutElements;',
    '',
    'method Run',
    '   Local PKG:Other &o = create PKG:Other();',
    '   Local PKG:LayoutElement &e = create PKG:LayoutElement();',
    'end-method;',
    ''
  ].join('\n');
  assert.deepEqual(packages(source), ['2:LAYOUTELEMENT', '3:OTHER']);
});
