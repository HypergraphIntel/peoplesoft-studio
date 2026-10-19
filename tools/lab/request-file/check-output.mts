/** Compare an actual native output file. Never generate or simulate the result. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const path = process.argv[2];
assert.ok(path, 'Pass the actual native ZZ_RF_EXPORT.csv path.');
const actual = await readFile(path), expected = await readFile(fileURLToPath(new URL('./expected.csv', import.meta.url)));
assert.ok(!actual.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), 'Output must not contain a UTF-8 BOM.');
const text = new TextDecoder('utf-8', { fatal: true }).decode(actual);
assert.ok(!/\r(?!\n)/.test(text), 'Only LF or CRLF line endings are accepted.');
assert.equal(text.replace(/\r\n/g, '\n'), expected.toString('utf8'), 'Native output differs from the reviewed acceptance fixture.');
console.log(JSON.stringify({ path, bytes: actual.length, sha256: createHash('sha256').update(actual).digest('hex'), matches: true, accepted: 3, rejected: 1, total: '30.75' }));
