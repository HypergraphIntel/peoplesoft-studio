/*
 * Cycle 147: Application Class method fragments that bind a symbolic
 * reference into the fragment's (suppressed) owner slot (research only).
 *
 * For every Application Class program the encode is traced
 * (`referenceTrace`); a USE of an `owner`-kind reference after the class
 * header is a method fragment's first record/field-shaped reference bound
 * to the owner slot -- a row that is never written. Per program: such
 * events, whether the program calls an inherited `%This` method (the
 * condition that forced `bindOwnerReference`), and the rows the stored
 * list has beyond the generated one. Run against the encoder before the
 * Cycle 147 fix with `RESEARCH_ENCODER_MODULE`; with it, no event remains.
 *
 * Usage:
 *   npx tsx tools/corpus/research/cycle147-fragment-owner-binding-census.ts --taxonomy t.json
 */
import fs from 'node:fs';

import { openHarnessContext, encodeAsHarness, generatedReferenceKey, storedReferenceKeys, isApplicationClass } from './lib/harnessContext';

const args = process.argv.slice(2);
const taxonomy = new Set<number>(args[0] === '--taxonomy' ? JSON.parse(fs.readFileSync(args[1], 'utf8')).rows.map((r: any) => r.definitionId) : []);
const ctx = openHarnessContext();
let programs = 0, events = 0;
const kinds = new Map<string, number>();
for (const def of ctx.definitions) {
  if (!isApplicationClass(def)) continue;
  const headerEnd = def.sourceText.search(/^\s*end-(?:class|interface)/im);
  const bound: string[] = [];
  const encoded = encodeAsHarness(ctx, def, {
    referenceTrace: (event: any) => {
      if (event.action === 'USE' && event.reference.kind === 'owner' && event.sourceOffset > headerEnd) {
        bound.push(`${event.reference.recordName}.${event.reference.fieldName}`);
      }
    }
  });
  if (bound.length === 0) continue;
  programs++; events += bound.length;
  const ownMethods = new Set([...def.sourceText.matchAll(/^\s*method\s+(\w+)/gim)].map(m => m[1].toLowerCase()));
  const inherited = [...def.sourceText.matchAll(/%This\s*\.\s*(\w+)\s*\(/gi)].some(m => !ownMethods.has(m[1].toLowerCase()));
  const stored = storedReferenceKeys(def);
  const generated = (encoded.artifacts?.references ?? []).map(generatedReferenceKey);
  for (const key of bound) {
    const kind = /^(PAGE|IMAGE|MENUNAME|SQL|OPERATION|COMPONENT|BARNAME|ITEMNAME|HTML)\./i.test(key) ? key.split('.')[0].toUpperCase() : 'REC.FIELD';
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  console.log(`  ${taxonomy.has(def.definitionId) ? '-' : ' '}${def.definitionId}  inherited %This call: ${inherited ? 'yes' : 'no '}  stored ${stored.length} / generated ${generated.length}  bound: ${bound.join(' ')}`);
}
console.log(`${programs} programs, ${events} owner-slot bindings in method fragments; by kind ${JSON.stringify(Object.fromEntries(kinds))}`);
