import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlPreviewPage } from '../editors/htmlPreview.js';

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";

test('a fragment becomes a page that runs nothing and fetches nothing', () => {
  const page = htmlPreviewPage("<div class='x'>a &amp; b</div><script>alert(1)</script><img src='https://example.com/x.png'>");
  assert.ok(page.startsWith('<!DOCTYPE html>'));
  assert.ok(page.includes(`content="${CSP}"`));
  assert.ok(page.includes("<div class='x'>a &amp; b</div>"), 'the definition is shown as written');
});

test("a full document keeps its own structure, with the policy first in its head; meta-HTML shows as written", () => {
  const page = htmlPreviewPage('<html><head lang="en"><title>T</title></head><body>%Bind(:1)</body></html>');
  assert.match(page, /^<html><head lang="en"><meta http-equiv="Content-Security-Policy"/);
  assert.ok(page.includes('%Bind(:1)'));
  assert.equal((page.match(/Content-Security-Policy/g) ?? []).length, 1);
});
