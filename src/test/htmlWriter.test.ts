import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_CHUNK_BYTES, htmlChunks, prepareHtmlText } from '../providers/htmlWriter.js';

test('HTML text is stored CRLF, UTF-16LE, NUL-terminated, as App Designer stored h01-h03', () => {
  const text = '<div class="zz">Hello</div>\n<p>Modified Second line</p>';
  assert.equal(prepareHtmlText(text), '<div class="zz">Hello</div>\r\n<p>Modified Second line</p>');
  const chunks = htmlChunks(text);
  assert.equal(chunks.length, 1);
  // ZZ_PCODE_LAB_HTML after h03: 114 bytes, SEQNUM 0.
  assert.equal(chunks[0].length, 114);
  assert.equal(chunks[0].toString('utf16le'), '<div class="zz">Hello</div>\r\n<p>Modified Second line</p>\0');
  assert.equal(prepareHtmlText('a\r\nb'), 'a\r\nb');
});

test('long HTML is cut into 32,000-byte chunks, the terminator in the last', () => {
  const text = 'x'.repeat(20000);
  const chunks = htmlChunks(text);
  assert.deepEqual(chunks.map((c) => c.length), [HTML_CHUNK_BYTES, 40002 - HTML_CHUNK_BYTES]);
  assert.equal(Buffer.concat(chunks).toString('utf16le'), text + '\0');
  // Exactly 16,000 characters: the NUL alone spills into a second chunk.
  assert.deepEqual(htmlChunks('y'.repeat(16000)).map((c) => c.length), [HTML_CHUNK_BYTES, 2]);
  assert.deepEqual(htmlChunks('').map((c) => c.length), [2]);
});
