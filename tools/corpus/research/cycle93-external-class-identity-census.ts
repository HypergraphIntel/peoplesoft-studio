/*
 * Cycle 93: PACKAGE rows whose class identity is not in the program's own
 * source (research only, stored evidence).
 *
 * An ordinary program's Application Class rows normally name classes the
 * source itself spells: imports, declarations, creates. A method call
 * through a property or a method result (`&obj.PROP.Method(...)`) can make
 * PeopleTools allocate a row for the class of that property -- a class
 * declared in the RECEIVER's class definition and spelled nowhere in the
 * calling program. That identity is external metadata.
 *
 * For every ordinary definition this lists the stored PACKAGE rows whose
 * REFNAME does not occur as an identifier anywhere in the source (with the
 * stored APPCLASSMETHOD, which names the call that used the row), whether
 * the source contains a `&var.Member.Method(` / `&var.Method(...).Method(`
 * chain, and whether the snapshot holds any Application Class with that
 * name (whose property declarations could supply the identity).
 *
 * Usage: npx tsx tools/corpus/research/cycle93-external-class-identity-census.ts
 */
import { openSnapshotDatabase } from '../snapshot/store';
import { listSnapshotDefinitions } from '../snapshot/reader';

const definitions = listSnapshotDefinitions(openSnapshotDatabase()) as any[];

const snapshotClasses = new Set<string>();
for (const def of definitions) {
  if (def.objectid1 !== 104) continue;
  const values = [def.objectvalue1, def.objectvalue2, def.objectvalue3, def.objectvalue4, def.objectvalue5, def.objectvalue6, def.objectvalue7]
    .map((v: string) => (v ?? '').trim())
    .filter(Boolean);
  const eventIndex = values.findIndex((v: string) => v.toLowerCase() === 'onexecute');
  const className = values[(eventIndex < 0 ? values.length : eventIndex) - 1];
  if (className) snapshotClasses.add(className.toUpperCase());
}

const CHAIN = /&[A-Za-z0-9_]+\s*\.\s*[A-Za-z_][A-Za-z0-9_]*\s*(?:\([^()]*\)\s*)?\.\s*[A-Za-z_][A-Za-z0-9_]*\s*\(/;

let population = 0;
let withChain = 0;
let classInSnapshot = 0;
let rowCount = 0;
for (const def of definitions) {
  if (def.objectid1 === 104) continue;
  const source = String(def.sourceText ?? '');
  const upper = source.toUpperCase();
  const external: string[] = [];
  for (const row of def.names) {
    if (String(row.recname ?? '').trim().toUpperCase() !== 'PACKAGE') continue;
    const name = String(row.refname ?? '').trim().toUpperCase();
    if (name === '') continue;
    if (new RegExp(`(^|[^A-Z0-9_])${name.replace(/[^A-Z0-9_]/g, '.')}([^A-Z0-9_]|$)`).test(upper)) continue;
    const method = String(row.appclassmethod ?? '').trim();
    external.push(`${row.namenum}:${name}${method ? '.' + method : ''}${snapshotClasses.has(name) ? ' [class in snapshot]' : ''}`);
    rowCount++;
    if (snapshotClasses.has(name)) classInSnapshot++;
  }
  if (external.length === 0) continue;
  population++;
  const chain = CHAIN.test(source);
  if (chain) withChain++;
  console.log(String(def.definitionId).padStart(6), chain ? 'chain   ' : 'no-chain', external.join(', '));
}
console.log(`\n${population} ordinary definitions store ${rowCount} PACKAGE rows whose class name is absent from their source;`);
console.log(`${withChain} contain a property / method-result method-call chain;`);
console.log(`${classInSnapshot} of the rows name a class that exists in the snapshot (the class that DECLARES the property usually does not).`);
