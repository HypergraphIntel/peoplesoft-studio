/*
 * Cycle 123: what stored opcode 0x51 is (research only).
 *
 * The decoder renders 0x51 as `PanelGroup` only before a `number` /
 * `string` / `boolean` type and as nothing otherwise -- on the assumption
 * that 0x51 is also a zero-width marker before an introducer-less object
 * type (`Field &MYFLD;`). This census counts, per program, the stored 0x51
 * tokens against the `PanelGroup` declarations in its source.
 *
 * Finding (LOCAL SNAPSHOT, 1a606d0): 167 / 167 programs have exactly as
 * many 0x51 tokens as source PanelGroup declarations -- 0x51 is always
 * `PanelGroup` (849's source is `PanelGroup field &MYFLD;`).
 *
 * Usage: npx tsx tools/corpus/research/cycle123-panelgroup-opcode-census.ts
 */
import { openHarnessContext, storedNameTable, decodeAsHarness } from './lib/harnessContext';

const ctx = openHarnessContext();
const tally = new Map<string, number[]>();
for (const def of ctx.definitions) {
  let tokens: any[];
  try { tokens = decodeAsHarness(def, def.storedProgram, storedNameTable(def)).tokens; } catch { continue; }
  const stored = tokens.filter(t => t.opcode === 0x51).length;
  if (stored === 0) continue;
  const declared = (String(def.sourceText).match(/^\s*PanelGroup\s+/gim) ?? []).length;
  const key = stored === declared ? 'stored 0x51 count = source PanelGroup declarations' : `stored 0x51 ${stored} vs source PanelGroup ${declared}`;
  tally.set(key, [...(tally.get(key) ?? []), def.definitionId]);
}
for (const [k, ids] of tally) console.log(`${ids.length} ${k}: ${ids.slice(0, 12).join(' ')}`);
