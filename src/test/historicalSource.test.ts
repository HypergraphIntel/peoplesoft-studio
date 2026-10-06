import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { recoverHistoricalSource, we8iso8859p15Image, WE8ISO8859P15_BEST_FIT } from '../peoplecode/corpus/historicalSource.js';
import { classifyResult } from '../peoplecode/corpus/classify.js';

/*
 * Cycle 183: HCDEV's PSPCMTXT is WE8ISO8859P15; a character with no byte
 * there was stored as Oracle's conversion image (0xBF, or a best-fit byte),
 * while PSPCMPROG kept it. The recovery restores exactly those characters.
 */

test('the conversion image follows Oracle\'s measured WE8ISO8859P15 table', () => {
  const table = JSON.parse(readFileSync(resolve(__dirname, '../../.claude/cycle183-we8iso8859p15-conversion.json'), 'utf8'));
  const listed = new Map(Object.entries(table.nonReplacementMappings as Record<string, string>).map(([k, v]) => [parseInt(k.slice(2), 16), parseInt(v.slice(2), 16)]));
  for (let cp = 0; cp <= 0xffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    assert.equal(we8iso8859p15Image(cp), listed.get(cp) ?? 0xbf, `U+${cp.toString(16)}`);
  }
  assert.equal(WE8ISO8859P15_BEST_FIT.get(0x2018), 0x60);
  assert.equal(we8iso8859p15Image(0x1f600), undefined);
});

test('lossy characters are restored per occurrence; genuine ones are kept', () => {
  const stored = 'Local string &s = "It¿s ¿real¿";\r\n/* `quoted¿ and a real `tick` */\r\n';
  const decoded = 'Local string &s = "It’s ¿real¿";\n/* ‘quoted’ and a real `tick` */\n';
  const recovery = recoverHistoricalSource(stored, decoded)!;
  assert.equal(recovery.text, 'Local string &s = "It’s ¿real¿";\r\n/* ‘quoted’ and a real `tick` */\r\n');
  assert.deepEqual(recovery.substitutions.map(s => [s.stored, s.recovered, s.byte]), [['¿', '’', 0xbf], ['`', '‘', 0x60], ['¿', '’', 0xbf]]);
});

test('anything other than a conversion image is not recovered', () => {
  // `?` is not the image of U+2019; a code difference; a length difference; identical sources.
  assert.equal(recoverHistoricalSource('/* it?s */\n', '/* it’s */\n'), undefined);
  assert.equal(recoverHistoricalSource('&a = 1;\n', '&a = 2;\n'), undefined);
  assert.equal(recoverHistoricalSource('/* ¿ */\n', '/* ’’ */\n'), undefined);
  assert.equal(recoverHistoricalSource('/* ¿ */\n', '/* ¿ */\n'), undefined);
  // A stored character that is not the image: U+00E9 has its own byte.
  assert.equal(recoverHistoricalSource('/* ¿ */\n', '/* é */\n'), undefined);
});

test('a recovered compile is its own class, never EXACT', () => {
  const ok = { success: true, exactProgramMatch: true };
  const decode = { success: true, normalizedSourceMatch: false };
  const sourceEncode = { success: true, exactProgramMatch: false };
  assert.equal(classifyResult({ decode, sourceEncode, semanticRoundTrip: ok, recoveredSourceEncode: ok }), 'EXACT_RECOVERED_SOURCE');
  assert.equal(classifyResult({ decode, sourceEncode, semanticRoundTrip: ok }), 'DECODE_SOURCE_MISMATCH');
  assert.equal(classifyResult({ decode, sourceEncode, semanticRoundTrip: ok, recoveredSourceEncode: { success: true, exactProgramMatch: false } }), 'DECODE_SOURCE_MISMATCH');
  assert.equal(classifyResult({ decode, sourceEncode, semanticRoundTrip: { success: true, exactProgramMatch: false }, recoveredSourceEncode: ok }), 'DECODE_SOURCE_MISMATCH');
});
