import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageMimeType, renderImageHtml } from '../editors/imageHtml.js';

test('every CONTFMT on HRDMO maps to an image type; SVG is image/svg+xml', () => {
  for (const [fmt, mime] of [['gif', 'image/gif'], ['GIF', 'image/gif'], ['png', 'image/png'], ['JPG', 'image/jpeg'], ['svg', 'image/svg+xml'],
    ['BMP', 'image/bmp'], ['DIB', 'image/bmp'], ['cur', 'image/x-icon'], ['web', 'image/webp']]) {
    assert.equal(imageMimeType(fmt), mime, fmt);
  }
  assert.equal(imageMimeType(' '), 'application/octet-stream');
});

test('an image is shown from a data URL under a policy allowing only data images, each alternate apart', () => {
  const gif = Buffer.from('GIF89a', 'latin1');
  const html = renderImageHtml({
    name: 'PS_CLEAR_ALL_BOXES_ICN', format: 'gif', description: 'Clear <all>',
    alternates: [{ altContNum: 1, format: 'gif', bytes: gif }, { altContNum: 2, format: 'JPG', bytes: Buffer.from([0xff, 0xd8]) }]
  }, 'HRDMO', 'N0NCE');
  assert.match(html, /default-src 'none'; img-src data:;/);
  assert.ok(html.includes(`src="data:image/gif;base64,${gif.toString('base64')}"`));
  assert.ok(html.includes('src="data:image/jpeg;base64,/9g="'));
  assert.match(html, /Alternate 2: JPG/);
  assert.ok(html.includes('Clear &lt;all&gt;'));
});

test('the bytes decide the type: a JPEG stored as gif is shown as JPEG (NEW_PORTAL_HDR_POPUP on HRDMO)', async () => {
  const { sniffImageMimeType } = await import('../editors/imageHtml.js');
  assert.equal(sniffImageMimeType(Buffer.from('ffd8ffe000104a46', 'hex')), 'image/jpeg');
  assert.equal(sniffImageMimeType(Buffer.from('89504e470d0a1a0a', 'hex')), 'image/png');
  assert.equal(sniffImageMimeType(Buffer.from('<?xml version="1.0"?><svg/>')), 'image/svg+xml');
  assert.equal(sniffImageMimeType(Buffer.from([1, 2, 3, 4])), undefined);
  const html = renderImageHtml({ name: 'X', format: 'gif', description: '', alternates: [{ altContNum: 1, format: 'gif', bytes: Buffer.from('ffd8ffe0', 'hex') }] }, 'HRDMO', 'n');
  assert.ok(html.includes('data:image/jpeg;base64,'));
});
