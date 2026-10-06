/*
 * Cycle 183 (research only, local files): direct PeopleTools 8.61.15
 * evidence from the delivered upgrade project in the exact-patch PS_HOME
 * (`projects/PPLTLS84CUR/PPLTLS84CUR.XML`, PeopleTools 8.61.15 media).
 *
 * Streams the project XML, takes the PCM instance of each requested HCDEV
 * definition (by its 7-part key), and compares:
 * - its `peoplecode_text` with the HCDEV source (line endings normalized);
 * - its PcmPnt rows (Oracle's PSPCMNAME as delivered) with HCDEV's stored
 *   PSPCMNAME rows and with the encoder's rows for the delivered source.
 * Writes hashes, counts and verdicts only.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle183-ppltls-pcm-compare.ts <project.XML> --out <file.json> <definitionId> ...
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';

import { encodeAsHarness, generatedReferenceKey, openHarnessContext, storedReferenceKeys } from './lib/harnessContext';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const norm = (s: string) => s.replace(/\r\n/g, '\n');
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
  const [file, ...rest] = process.argv.slice(2);
  const outIndex = rest.indexOf('--out');
  const out = rest[outIndex + 1];
  const ids = rest.filter((_, i) => i !== outIndex && i !== outIndex + 1).map(Number);
  const ctx = openHarnessContext();
  const wanted = new Map<string, any>();
  for (const id of ids) {
    const d = ctx.definitions.find(x => x.definitionId === id) as any;
    const key = [1, 2, 3, 4, 5, 6, 7].map(i => `${d[`objectid${i}`]}=${String(d[`objectvalue${i}`]).trim()}`).join('|');
    wanted.set(key, d);
  }
  const results: any[] = [];
  for await (const block of instances(file)) {
    const key = [0, 1, 2, 3, 4, 5, 6].map(i => `${tag(block, `eObjectID_${i}`)}=${tag(block, `szObjectValue_${i}`).trim()}`).join('|');
    const def = wanted.get(key);
    if (def === undefined) continue;
    const text = unescape(/<peoplecode_text>([\s\S]*?)<\/peoplecode_text>/.exec(block)?.[1] ?? '');
    const pnt = [...block.matchAll(/<row>\s*<szRecName>([^<]*)<\/szRecName>\s*<szFieldName>([^<]*)<\/szFieldName>/g)].map(m => `${unescape(m[1]).trim().toUpperCase()}.${unescape(m[2]).trim().toUpperCase()}`);
    const hcdev = storedReferenceKeys(def);
    const enc = encodeAsHarness(ctx, { ...def, sourceText: text });
    const generated = enc.artifacts === undefined ? undefined : [...enc.artifacts.references].sort((a: any, b: any) => a.sequence - b.sequence).map(generatedReferenceKey);
    const same = (a: string[] | undefined, b: string[]) => a !== undefined && JSON.stringify(a) === JSON.stringify(b);
    results.push({
      definitionId: def.definitionId,
      displayName: def.displayName,
      deliveredNameCount: Number(tag(block, 'nNameCount')),
      deliveredPcmPntRows: pnt.length,
      sameSource: norm(text) === norm(def.sourceText),
      deliveredSourceSha256: sha(norm(text)),
      hcdevStoredNameRows: hcdev.length,
      hcdevStoredEqualsDelivered: same(hcdev, pnt),
      encoderDeliveredSourceEqualsDelivered: same(generated, pnt),
      encoderNameRows: generated?.length ?? null,
      ...(enc.error ? { encoderError: enc.error } : {})
    });
    wanted.delete(key);
    if (wanted.size === 0) break;
  }
  for (const d of wanted.values()) results.push({ definitionId: d.definitionId, displayName: d.displayName, delivered: 'absent' });
  fs.writeFileSync(out, `${JSON.stringify({ file, capturedAt: new Date().toISOString(), results }, null, 2)}\n`);
  for (const r of results) console.log(JSON.stringify(r));
}

main().catch(error => { console.error(error); process.exit(1); });
