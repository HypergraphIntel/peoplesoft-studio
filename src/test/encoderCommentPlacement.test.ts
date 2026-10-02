import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFragment, encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 113: a block comment's opcode is its placement -- 0x24 when it
 * starts its own source line, 0x4E when anything precedes it on that line
 * -- at every call site. Corpus shapes 523 (after a comment), 5065 (after
 * `try`), 14452 (after a For header), 2809 (own line after an expression).
 */
const commentOpcodes = (source: string): number[] => {
  const bytes = encodeFragment(source);
  const opcodes: number[] = [];
  for (const text of [...source.matchAll(/\/\*[\s\S]*?\*\//g)].map(m => m[0])) {
    const at = bytes.indexOf(Buffer.from(text, 'utf16le'));
    assert.ok(at >= 3, `comment ${text} not encoded`);
    opcodes.push(bytes[at - 3]);
  }
  return opcodes;
};

test('a comment after another comment on the same line is inline (523)', () => {
  assert.deepEqual(commentOpcodes('F();\n/* a */ /* b */\nG();\n'), [0x24, 0x4e]);
});

test('a comment after try on the same line is inline (5065)', () => {
  assert.deepEqual(commentOpcodes('try /* guarded */\n   F();\ncatch Exception &e\nend-try;\n'), [0x4e]);
});

test('a comment that starts its own line is standalone', () => {
  assert.deepEqual(commentOpcodes('F();\n   /* own line */\nG();\n'), [0x24]);
});

/*
 * Cycle 113: comments on the same source line as a header or closer
 * precede its 0x2D boundary -- stored never writes 0x2D before an inline
 * comment. Corpus shapes 14452 (For), 15115 (While), 17596 (Function),
 * 17243 (When with two comments), 28736 / 28743 (end-class / end-method).
 */
const boundaryOrder = (bytes: Buffer, text: string): string => {
  const at = bytes.indexOf(Buffer.from(text, 'utf16le'));
  assert.ok(at >= 3, `comment ${text} not encoded`);
  const before = bytes[at - 4] === 0x2d ? '2d ' : '';
  const after = bytes[at + Buffer.byteLength(text, 'utf16le')] === 0x2d ? ' 2d' : '';
  return `${before}${bytes[at - 3].toString(16)}${after}`;
};

for (const [label, source, comment] of [
  ['For', 'For &i = 1 To 3 /* loop */\n   F();\nEnd-For;\n', '/* loop */'],
  ['While', 'While &n > 0 /* drain */\n   &n = &n - 1;\nEnd-While;\n', '/* drain */'],
  ['Function', 'Function Go() /* entry */\n   F();\nEnd-Function;\n', '/* entry */']
] as const) {
  test(`a comment trailing a ${label} header precedes its boundary`, () => {
    assert.equal(boundaryOrder(encodeFragment(source), comment), '4e 2d');
  });
}

test('every comment trailing a When precedes its boundary (17243)', () => {
  const bytes = encodeFragment('Evaluate &x\nWhen = 1 /* one */ /* two */\n   F();\nEnd-Evaluate;\n');
  assert.equal(boundaryOrder(bytes, '/* one */'), '4e');
  assert.equal(boundaryOrder(bytes, '/* two */'), '4e 2d');
});

test('a comment trailing end-method; precedes its boundary (28743)', () => {
  const source = [
    'class Child',
    '   method Go();',
    'end-class; /* Child */',
    '',
    'method Go',
    '   F();',
    'end-method; /* Go */',
    ''
  ].join('\n');
  const bytes = encodeProgramArtifacts(source, { owner: { recordName: 'PKG', fieldName: 'Child', packagePath: ['PKG', 'Child'] } }).program;
  assert.equal(boundaryOrder(bytes, '/* Child */'), '4e 2d');
  assert.equal(boundaryOrder(bytes, '/* Go */'), '4e 2d');
});

/*
 * Cycle 133: a comment between a statement's last token and its `;` is
 * written before the 0x15 (`4E 15`); one after the `;` after it (`15 4E`)
 * -- in ordinary code and in an Application Class header member alike
 * (28910 `property string TypeDesc /* e.g. Website *\/;`, `Type; /* e.g.
 * url *\/`; 28920's last member with no `;` before `end-class`).
 */
{
  const around = (bytes: Buffer, comment: string): string => {
    const text = Buffer.from(comment, 'utf16le');
    const at = bytes.indexOf(text);
    return `${bytes[at - 4].toString(16).padStart(2, '0')} ${bytes[at - 3].toString(16)} .. ${bytes[at + text.length].toString(16).padStart(2, '0')}`;
  };
  const appClass = (header: string[]): Buffer => encodeProgramArtifacts(
    ['class Widget', ...header, 'end-class;', ''].join('\n'),
    { owner: { recordName: 'PKG', fieldName: 'Widget', packagePath: ['PKG', 'Widget'] } }
  ).program;

  test('an ordinary comment before a statement\'s ; precedes its 0x15', () => {
    assert.match(around(encodeFragment('&a = F() /* c */;\n'), '/* c */'), /^14 4e \.\. 15$/);
  });

  test('a class member\'s comment before its ; precedes its 0x15 (28910)', () => {
    assert.match(around(appClass(['   property string TypeDesc /* e.g. Website */;']), '/* e.g. Website */'), /^00 4e \.\. 15$/);
  });

  test('a class member\'s comment after its ; follows its 0x15 (28910)', () => {
    assert.match(around(appClass(['   property string Type; /* e.g. url */', '   property string URL;']), '/* e.g. url */'), /^15 4e \.\. /);
  });

  test('a method declaration\'s comment before its ; precedes its 0x15 (28954)', () => {
    assert.match(around(appClass(['   method Fetch(&rs As Rowset) /* BUG 32195582 */;']), '/* BUG 32195582 */'), /^14 4e \.\. 15$/);
  });

  test('the last member\'s comment with no ; precedes end-class (28920)', () => {
    assert.match(around(appClass(['   instance Rowset &m_rs /* DEPENDENT_BENEF */']), '/* DEPENDENT_BENEF */'), /^00 4e \.\. 5b$/);
  });
}
