import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFragment, encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 113: where a top-level declaration run that reaches the end of
 * the program, or a disabled-code block, writes its 0x2D close. Corpus
 * shapes 16461, 17992 (an initialized Local: no close), 11257 (a run of
 * uninitialized Locals: close), 20860 (close before `<*`), 24926 (an
 * import section closed by `<*`).
 */
const ending = (source: string): string => {
  const bytes = encodeFragment(source);
  return bytes.subarray(Math.max(0, bytes.length - 2)).toString('hex');
};

test('an end-of-program run holding an initialized Local does not close (16461)', () => {
  assert.equal(ending('Declare Function F PeopleCode REC.FLD FieldFormula;\n\nLocal boolean &ok = F();\n'), '1415');
});

test('a run of uninitialized Locals closes at the end of the program (11257)', () => {
  assert.equal(ending('Local integer &a;\n\n'), '152d');
});

test('a Local run closes before a following disabled-code block (20860)', () => {
  const bytes = encodeFragment('Local SQL &s;\n\n<* &s = Null; *>\nF(Record.REC);\n');
  const disabled = bytes.indexOf(Buffer.from('<*', 'utf16le'));
  assert.equal(bytes.subarray(disabled - 6, disabled - 3).toString('hex'), '152d4f');
});

test('a disabled-code block closes an import section (24926)', () => {
  const bytes = encodeFragment('import PKG:*;\n\n<*import OTHER:Thing; *>\n');
  const disabled = bytes.indexOf(Buffer.from('<*', 'utf16le'));
  assert.equal(bytes.subarray(disabled - 6, disabled - 3).toString('hex'), '152d4f');
});

test('an Application Class method body never closes its Local run before a comment (28801)', () => {
  const source = [
    'class Child',
    '   method Go();',
    'end-class;',
    '',
    'method Go',
    '   Local PKG:Widget &w;',
    '',
    '   /* use it */',
    '   F();',
    'end-method;',
    ''
  ].join('\n');
  const bytes = encodeProgramArtifacts(source, { owner: { recordName: 'PKG', fieldName: 'Child', packagePath: ['PKG', 'Child'] } }).program;
  const comment = bytes.indexOf(Buffer.from('/* use it */', 'utf16le'));
  assert.equal(bytes.subarray(comment - 6, comment - 3).toString('hex'), '00154f');
});
