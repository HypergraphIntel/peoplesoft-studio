import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 113: an Application Class directory's type-path names write the
 * package root in the package definition's case -- uppercase, or
 * `%Metadata` -- whatever the source spelling; the rest of the path keeps
 * its source spelling. Corpus shapes 29341 (`GPS_car_REPORT_MANAGER:` ->
 * `GPS_CAR_REPORT_MANAGER:`), 28722 (`%metadata:` -> `%Metadata:`).
 */
const program = (type: string) => encodeProgramArtifacts([
  'class Child',
  `   method Go(&w As ${type});`,
  'end-class;',
  '',
  'method Go',
  '   Local number &n = 1;',
  'end-method;',
  ''
].join('\n'), { owner: { recordName: 'PKG', fieldName: 'Child', packagePath: ['PKG', 'Child'] } }).program;
const directoryNames = (bytes: Buffer): string[] => {
  const start = 37 + bytes.readUInt32LE(5);
  return bytes.subarray(start, start + bytes.readUInt32LE(13) * 2).toString('utf16le').split('\0');
};

test('a type-path root is written uppercase (29341)', () => {
  assert.ok(directoryNames(program('pkg_Lower:Sub:Widget')).includes('PKG_LOWER:Sub:Widget'));
});

test('the %metadata root is written %Metadata (28722)', () => {
  assert.ok(directoryNames(program('%metadata:AppDataSetMgr:AppDataSet')).includes('%Metadata:AppDataSetMgr:AppDataSet'));
});
