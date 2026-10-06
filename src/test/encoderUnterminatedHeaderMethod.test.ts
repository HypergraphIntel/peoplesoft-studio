import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * 8.62 track (28943): a class-header method declaration without its `;`,
 * followed by another section or member, is written as typed -- no 0x15.
 * PeopleTools 8.62.09 (HRDMO's own compile of BNE_OPEN_ENROLL_FL:
 * Controller:XPlanController:Plan2XController, the newer revision of
 * HCDEV 28943): `method InfoPageViewBySFF()` then `protected` stores
 * `63 0A <name> 0B 14 73`; a terminated one stores `0B 14 15 63`. The
 * encoder reproduces that program exactly (bytes and PSPCMNAME).
 */
const owner = { recordName: 'PKG', fieldName: 'Thing', packagePath: ['PKG', 'Thing'] };
const encode = (header: string) => encodeProgramArtifacts(
  `class Thing\n   method First();\n${header}protected\n   method Hidden();\nend-class;\n\nmethod First\nend-method;\n\nmethod Second\nend-method;\n\nmethod Hidden\nend-method;\n`,
  { owner, applicationClassDefinition: true }
).program;

test('an unterminated header method declaration before a section keyword has no 0x15', () => {
  const unterminated = encode('   method Second()\n');
  const terminated = encode('   method Second();\n');
  const name = Buffer.from('Second\0', 'utf16le');
  const after = (program: Buffer) => program.subarray(program.indexOf(name) + name.length, program.indexOf(name) + name.length + 3).toString('hex');
  assert.equal(after(unterminated), '0b1473');
  assert.equal(after(terminated), '0b1415');
  assert.equal(unterminated.length, terminated.length - 1);
});
