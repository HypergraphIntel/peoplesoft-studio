/*
 * Cycle 183 (research only, local files): when did Oracle's delivered
 * compile reopen Application Class reference rows per method?
 *
 * Streams a delivered PeopleTools upgrade project (PPLTLS84CUR, PeopleTools
 * 8.61.15 media). For every Application Class PCM instance: its
 * szLastUpdDttm (Oracle's compile time), its delivered PcmPnt rows
 * (PSPCMNAME), whether they repeat an identity (the per-method shape), and
 * whether the encoder's rows for the delivered source are the same.
 * Summarizes by compile month; writes per-instance verdicts (no source).
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle183-ppltls-repeat-census.ts <project.XML> --out <file.json>
 */
import fs from 'node:fs';

import { encodeAsHarness, generatedReferenceKey, openHarnessContext, storedReferenceKeys } from './lib/harnessContext';

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (block: string, name: string) => unescape(new RegExp(`<${name}>([^<]*)</${name}>`).exec(block)?.[1] ?? '');

async function* instances(file: string): AsyncGenerator<string> {
  let buffer = '';
  for await (const chunk of fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 22 })) {
    buffer += chunk;
    let start: number;
    while ((start = buffer.indexOf('<instance class="PCM">')) >= 0) {
      const end = buffer.indexOf('</instance>', start);
      if (end < 0) break;
      yield buffer.slice(start, end + '</instance>'.length);
      buffer = buffer.slice(end + '</instance>'.length);
    }
    if (buffer.indexOf('<instance class="PCM">') < 0) buffer = buffer.slice(Math.max(0, buffer.length - 64));
  }
}

async function main(): Promise<void> {
  const [file, flag, out] = process.argv.slice(2);
  if (flag !== '--out' || !out) throw new Error('usage: cycle183-ppltls-repeat-census.ts <project.XML> --out <file.json>');
  const ctx = openHarnessContext();
  const byKey = new Map(ctx.definitions.map((d: any) => [[1, 2, 3, 4, 5, 6, 7].map(i => `${d[`objectid${i}`]}=${String(d[`objectvalue${i}`]).trim()}`).join('|'), d]));
  const rows: any[] = [];
  for await (const block of instances(file)) {
    if (tag(block, 'eObjectID_0') !== '104') continue;
    const ids = [0, 1, 2, 3, 4, 5, 6].map(i => Number(tag(block, `eObjectID_${i}`)));
    const values = [0, 1, 2, 3, 4, 5, 6].map(i => tag(block, `szObjectValue_${i}`).trim());
    const key = ids.map((id, i) => `${id}=${values[i]}`).join('|');
    const text = unescape(/<peoplecode_text>([\s\S]*?)<\/peoplecode_text>/.exec(block)?.[1] ?? '');
    const delivered = [...block.matchAll(/<row>\s*<szRecName>([^<]*)<\/szRecName>\s*<szFieldName>([^<]*)<\/szFieldName>/g)].map(m => `${unescape(m[1]).trim().toUpperCase()}.${unescape(m[2]).trim().toUpperCase()}`);
    const identities = delivered.filter(k => k !== '.');
    const repeats = identities.length - new Set(identities).size;
    // A pseudo definition with the delivered key (metadata comes from the HCDEV snapshot).
    const hcdev = byKey.get(key) as any;
    const pseudo: any = { ...(hcdev ?? {}), definitionId: hcdev?.definitionId ?? -1, sourceText: text };
    for (let i = 0; i < 7; i++) { pseudo[`objectid${i + 1}`] = ids[i]; pseudo[`objectvalue${i + 1}`] = values[i] || ' '; }
    const enc = encodeAsHarness(ctx, pseudo);
    const generated = enc.artifacts === undefined ? undefined : [...enc.artifacts.references].sort((a: any, b: any) => a.sequence - b.sequence).map(generatedReferenceKey);
    const hcdevKeys = hcdev === undefined ? undefined : storedReferenceKeys(hcdev);
    rows.push({
      key,
      sameSourceAsHcdev: hcdev === undefined ? null : hcdev.sourceText.replace(/\r\n/g, '\n') === text.replace(/\r\n/g, '\n'),
      hcdevEqualsDelivered: hcdevKeys === undefined ? null : JSON.stringify(hcdevKeys) === JSON.stringify(delivered),
      hcdevEqualsEncoder: hcdevKeys === undefined || generated === undefined ? null : JSON.stringify(hcdevKeys) === JSON.stringify(generated),
      hcdevDefinitionId: hcdev?.definitionId ?? null,
      compiled: tag(block, 'szLastUpdDttm'),
      lVersion: Number(tag(block, 'lVersion')),
      deliveredRows: delivered.length,
      repeatedIdentities: repeats,
      encoderRows: generated?.length ?? null,
      encoderEqualsDelivered: generated !== undefined && JSON.stringify(generated) === JSON.stringify(delivered),
      ...(enc.error ? { encoderError: enc.error.slice(0, 160) } : {})
    });
  }
  fs.writeFileSync(out, `${JSON.stringify({ file, capturedAt: new Date().toISOString(), count: rows.length, rows }, null, 1)}\n`);
  const months = new Map<string, { n: number; repeat: number; equal: number; repeatEqual: number }>();
  for (const r of rows) {
    const m = r.compiled.slice(0, 7);
    const s = months.get(m) ?? { n: 0, repeat: 0, equal: 0, repeatEqual: 0 };
    s.n++; if (r.repeatedIdentities > 0) s.repeat++; if (r.encoderEqualsDelivered) s.equal++; if (r.repeatedIdentities > 0 && r.encoderEqualsDelivered) s.repeatEqual++;
    months.set(m, s);
  }
  console.log(`App Class PCM instances: ${rows.length}; encoder rows == delivered: ${rows.filter(r => r.encoderEqualsDelivered).length}; with repeated identities: ${rows.filter(r => r.repeatedIdentities > 0).length}`);
  console.log('month     n  repeat  encoder==delivered  (repeat & equal)');
  for (const [m, s] of [...months].sort()) console.log(`${m}  ${String(s.n).padStart(5)} ${String(s.repeat).padStart(6)} ${String(s.equal).padStart(8)} ${String(s.repeatEqual).padStart(8)}`);
  const inHcdev = rows.filter(r => r.hcdevDefinitionId !== null);
  const cell = (pred: (r: any) => boolean) => inHcdev.filter(pred).length;
  console.log(`in HCDEV: ${inHcdev.length}`);
  for (const rep of [true, false]) for (const same of [true, false]) {
    const g = inHcdev.filter(r => (r.repeatedIdentities > 0) === rep && r.sameSourceAsHcdev === same);
    console.log(`delivered repeats=${rep} sameSource=${same}: ${g.length}; HCDEV stored == delivered ${g.filter(r => r.hcdevEqualsDelivered).length}; HCDEV stored == encoder ${g.filter(r => r.hcdevEqualsEncoder).length}; neither ${g.filter(r => !r.hcdevEqualsDelivered && !r.hcdevEqualsEncoder).length}`);
  }
  console.log(`HCDEV stored == delivered with repeats: ${inHcdev.filter(r => r.repeatedIdentities > 0 && r.hcdevEqualsDelivered).map(r => r.hcdevDefinitionId).join(' ')}`);
  void cell;
}

main().catch(error => { console.error(error); process.exit(1); });
