/*
 * Cycle 183 (research only, LOCAL SNAPSHOT): PSPCMNAME exactness across the
 * whole corpus. The harness's EXACT compares program bytes only; this
 * compares the encoder's reference rows (in NAMENUM order, RECNAME.REFNAME)
 * with the stored PSPCMNAME rows for every definition. The 71 lossy-source
 * programs are encoded from their recovered historical source
 * (historicalSource.ts).
 *
 * Output: .claude/cycle183-pspcmname-audit.json -- every definition whose
 * bytes or names differ, with the first differing NAMENUM; summary on stdout.
 *
 * Usage: npx tsx tools/corpus/research/cycle183-pspcmname-audit.ts
 */
import fs from 'node:fs';
import path from 'node:path';

import { recoverHistoricalSource } from '../../../src/peoplecode/corpus/historicalSource';
import { decodeAsHarness, encodeAsHarness, generatedReferenceKey, openHarnessContext, storedNameTable, storedReferenceKeys } from './lib/harnessContext';

const OUT = path.join(__dirname, '../../../.claude/cycle183-pspcmname-audit.json');

function main(): void {
  const ctx = openHarnessContext();
  const rows: any[] = [];
  let bytesExact = 0, namesExact = 0, both = 0, recovered = 0;
  for (const def of ctx.definitions) {
    let source = def.sourceText, provenance = 'PSPCMTXT';
    let enc = encodeAsHarness(ctx, def);
    if (enc.artifacts === undefined || Buffer.compare(enc.artifacts.program, def.storedProgram) !== 0) {
      try {
        const decoded = decodeAsHarness(def, def.storedProgram, storedNameTable(def));
        const recovery = recoverHistoricalSource(def.sourceText, decoded.text);
        if (recovery !== undefined) {
          source = recovery.text; provenance = 'RECOVERED';
          enc = encodeAsHarness(ctx, { ...(def as any), sourceText: source });
          recovered++;
        }
      } catch { /* undecodable: keep the stored-source result */ }
    }
    const stored = storedReferenceKeys(def);
    const generated = enc.artifacts === undefined ? undefined : [...enc.artifacts.references].sort((a: any, b: any) => a.sequence - b.sequence).map(generatedReferenceKey);
    const b = enc.artifacts !== undefined && Buffer.compare(enc.artifacts.program, def.storedProgram) === 0;
    const n = generated !== undefined && JSON.stringify(generated) === JSON.stringify(stored);
    if (b) bytesExact++;
    if (n) namesExact++;
    if (b && n) both++;
    if (!b || !n) {
      let first: number | undefined;
      if (generated !== undefined) for (let i = 0; i < Math.max(generated.length, stored.length); i++) if (generated[i] !== stored[i]) { first = i + 1; break; }
      rows.push({
        definitionId: def.definitionId,
        displayName: def.displayName,
        provenance,
        bytesExact: b,
        namesExact: n,
        storedNameRows: stored.length,
        generatedNameRows: generated?.length,
        firstNameDifference: first === undefined ? undefined : { nameNum: first, stored: stored[first - 1], generated: generated?.[first - 1] },
        error: enc.error
      });
    }
  }
  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), total: ctx.definitions.length, bytesExact, namesExact, bothExact: both, recoveredSourcePrograms: recovered, rows }, null, 1));
  console.log(`total ${ctx.definitions.length}; bytes exact ${bytesExact}; PSPCMNAME exact ${namesExact}; both ${both}; recovered-source programs ${recovered}`);
  console.log(`bytes exact but PSPCMNAME different: ${rows.filter(r => r.bytesExact && !r.namesExact).map(r => r.definitionId).join(' ') || 'none'}`);
  console.log(`PSPCMNAME exact but bytes different: ${rows.filter(r => !r.bytesExact && r.namesExact).map(r => r.definitionId).join(' ') || 'none'}`);
  console.log(`neither: ${rows.filter(r => !r.bytesExact && !r.namesExact).map(r => r.definitionId).join(' ') || 'none'}`);
}

main();
