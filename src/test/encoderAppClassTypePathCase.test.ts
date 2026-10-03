import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 142: a type-path name in the Application Class name table writes a
 * sub-package in the program's first spelling of it (as a rule its import),
 * while the statement bytes keep the declaration's own spelling and the
 * reference rows are unaffected. 28942 `import BNE_OPEN_ENROLL_FL:Page:
 * SubPage:*;` ... `instance BNE_OPEN_ENROLL_FL:page:SubPage:
 * PrimaryCareProvider &x;` stores the name `BNE_OPEN_ENROLL_FL:Page:SubPage:
 * PrimaryCareProvider`.
 */
const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const source = (declared: string) => `import PKG:Page:*;

class Demo
   method Run();
   instance ${declared} &widget;
end-class;

method Run
end-method;
`;
const utf16 = (text: string) => Buffer.from(text, 'utf16le');
const nameTable = (program: Buffer): string[] => {
  const nameLength = program.readUInt32LE(13), slotCount = program.readUInt32LE(21), recordCount = program.readUInt32LE(29);
  return program.subarray(program.length - (nameLength + recordCount * 16 + slotCount * 4)).subarray(0, nameLength).toString('utf16le').split('\0');
};

test('a sub-package is named in the program\'s first spelling; the declaration bytes keep their own (28942)', () => {
  const { program, references } = encodeProgramArtifacts(source('PKG:page:Widget'), { owner });
  assert.ok(nameTable(program).includes('PKG:Page:Widget'));
  assert.ok(!nameTable(program).includes('PKG:page:Widget'));
  // the instance declaration's own type path bytes: PKG : page : Widget
  assert.ok(program.includes(Buffer.concat([utf16('PKG\0'), Buffer.from([0x57, 0x0a]), utf16('page\0'), Buffer.from([0x57, 0x0a]), utf16('Widget\0')])));
  // reference identity is untouched by the spelling
  const canonical = encodeProgramArtifacts(source('PKG:Page:Widget'), { owner });
  assert.deepEqual(references.map(r => [r.kind, (r as { packageName?: string }).packageName]), canonical.references.map(r => [r.kind, (r as { packageName?: string }).packageName]));
  // decode / re-encode reproduces the bytes
  const names = new NameTable();
  references.forEach(reference => names.add(reference.index + 1, ''));
  const decoded = decodeProgram(program, names, { mode: 'auto', isApplicationClass: true });
  const commentOpcodes = decoded.tokens.map(token => token.opcode).filter(opcode => opcode === 0x24 || opcode === 0x4e);
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { owner, commentOpcodes }).program, program);
});
