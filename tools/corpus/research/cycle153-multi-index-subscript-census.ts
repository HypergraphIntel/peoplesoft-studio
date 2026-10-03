/*
 * Cycle 153: multi-index array subscripts `&a [i, j]` (research only).
 *
 * Every subscript whose top level holds a comma, per program: the
 * container text, the index count, whether an index nests a call /
 * subscript / string with a comma, the container's declared type (when a
 * declaration names it), what follows the `]` (member, call, assignment,
 * other) and the program's taxonomy category. Also: whether the stored
 * program's decoded text keeps the comma form.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle153-multi-index-subscript-census.ts --taxonomy t.json
 */
import fs from 'node:fs';

import { maskNonCode } from '../../../src/peoplecode/applicationClassProgram';
import { openHarnessContext, isApplicationClass, storedNameTable, decodeAsHarness } from './lib/harnessContext';

const args = process.argv.slice(2);
const rows: any[] = args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows : [];
const category = new Map<number, string>(rows.map(r => [r.definitionId, r.primaryCategory]));
const ctx = openHarnessContext();
const histogram = new Map<number, number>();
for (const def of ctx.definitions as any[]) {
  if (!/\[[^\]\n]*,/.test(def.sourceText)) continue;
  const code = maskNonCode(def.sourceText);
  const sites: string[] = [];
  for (let i = code.indexOf('['); i >= 0; i = code.indexOf('[', i + 1)) {
    let depth = 0, paren = 0, commas = 0, j = i, nested = false;
    for (; j < code.length; j++) {
      const c = code[j];
      if (c === '[') { depth++; if (depth > 1) nested = true; }
      else if (c === ']') { if (--depth === 0) break; }
      else if (c === '(') { paren++; }
      else if (c === ')') paren--;
      else if (c === ',' && depth === 1 && paren === 0) commas++;
      else if (c === ',' && (depth > 1 || paren > 0)) nested = true;
    }
    if (commas === 0 || depth !== 0) continue;
    const container = /(&\w+|\))\s*$/.exec(code.slice(Math.max(0, i - 60), i))?.[1] ?? '?';
    const declared = container.startsWith('&')
      ? new RegExp(`\\b(?:Local|Global|Component|PanelGroup|instance|property)\\s+((?:array\\s+of\\s+)+[\\w:]+)\\s+[^;\\n]*${container.replace('$', '\\$')}\\b`, 'i').exec(code)?.[1] ?? 'undeclared / parameter'
      : 'expression';
    const after = code.slice(j + 1, j + 40);
    const follow = /^\s*\.\s*\w+\s*\(/.test(after) ? 'method call' : /^\s*\.\s*\w+/.test(after) ? 'member' : /^\s*=(?!=)/.test(after) ? 'assigned' : /^\s*\[/.test(after) ? 'subscript' : 'other';
    histogram.set(commas + 1, (histogram.get(commas + 1) ?? 0) + 1);
    sites.push(`${container}[${commas + 1} idx${nested ? ', nested comma' : ''}] ${declared.replace(/\s+/g, ' ')} -> ${follow}`);
  }
  if (sites.length === 0) continue;
  let decodedComma = '?';
  try { decodedComma = /\[[^\]\n]*,/.test(decodeAsHarness(def, def.storedProgram, storedNameTable(def)).text) ? 'decoded keeps [i, j]' : 'decoded has no [i, j]'; } catch { decodedComma = 'decode error'; }
  console.log(`${def.definitionId} ${isApplicationClass(def) ? 'App Class' : 'ordinary '} ${(category.get(def.definitionId) ?? 'EXACT').padEnd(30)} ${decodedComma} | ${[...new Set(sites)].join(' ; ')}`);
}
console.log('index-count histogram (sites):', JSON.stringify(Object.fromEntries(histogram)));
