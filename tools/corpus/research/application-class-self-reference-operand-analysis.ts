/**
 * Cycle 39: determines whether Application Class method-bearing
 * self-reference rows (`PACKAGE|<class>|<package>||<METHOD>`, the
 * subject of Cycles 37-38's `%This.method()` firing investigation) are
 * ever referenced by an executable PSPCMPROG operand (opcodes 0x21,
 * 0x4A, 0x48 -- the only three opcodes `decodeProgram` resolves through
 * PSPCMNAME, per `Token.nameNum`'s own declaration comment).
 *
 * Decisive finding this script exists to confirm at population scale:
 * `%This.method()` call sites always compile to the SAME opcode shape
 * (`0x12 "%This" 0x5 "." 0xa "<method name>" ...`) regardless of
 * whether a method-bearing row exists for that method -- the call's
 * own name resolves through the class's internal method-directory
 * name table (opcode 0xa), never through a PSPCMNAME reference
 * operand. If the method-bearing row is never used by any operand
 * anywhere in the program, its allocation cannot be driven by how the
 * call itself is compiled -- it must be a declaration-phase/metadata
 * phenomenon, the same general mechanism Cycles 26/32 already
 * established governs other Application Class PACKAGE dependencies.
 *
 * Read-only, no encoder changes.
 *
 * Usage:
 *   npx tsx tools/corpus/research/application-class-self-reference-operand-analysis.ts
 */

import { parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';
import { decodeProgram } from '../../../src/peoplecode/decoder';
import { NameTable } from '../../../src/peoplecode/progtext';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { openSnapshotDatabase } from '../snapshot/store';

const APPLICATION_CLASS_OBJECT_ID = 104;

function main(): void {
  const db = openSnapshotDatabase();
  const definitions = listSnapshotDefinitions(db).filter(d => d.objectid1 === APPLICATION_CLASS_OBJECT_ID);
  db.close();

  let checked = 0;
  let operandUsed = 0;
  let operandNotUsed = 0;
  let decodeErrors = 0;
  const usedExamples: number[] = [];
  const errorExamples: Array<{ definitionId: number; error: string }> = [];

  for (const definition of definitions) {
    const parsed = parseApplicationClassSource(definition.sourceText);
    if (parsed === undefined) continue;
    const className = parsed.className.toLowerCase();
    const selfRow = definition.names.find(row =>
      row.recname.trim() === 'PACKAGE' &&
      row.refname.trim().toLowerCase() === className &&
      row.appclassmethod.trim() !== ''
    );
    if (selfRow === undefined) continue;
    checked++;

    const names = new NameTable();
    for (const row of definition.names) {
      const name = row.recname.trim() && row.refname.trim()
        ? `${row.recname.trim()}.${row.refname.trim()}`
        : (row.refname.trim() || row.recname.trim());
      names.add(row.namenum, name);
    }
    try {
      const decoded = decodeProgram(definition.storedProgram, names, { mode: 'auto' });
      const used = decoded.tokens.some(t => t.nameNum === selfRow.namenum);
      if (used) { operandUsed++; usedExamples.push(definition.definitionId); }
      else operandNotUsed++;
    } catch (error) {
      decodeErrors++;
      if (errorExamples.length < 10) {
        errorExamples.push({ definitionId: definition.definitionId, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  console.log(JSON.stringify({
    definitionsWithMethodBearingSelfRow: checked,
    operandUsesRow: operandUsed,
    operandNeverUsesRow: operandNotUsed,
    decodeErrors,
    usedExamples,
    errorExamples,
    conclusion: operandUsed === 0
      ? 'ZERO exceptions: the method-bearing self-reference row is never referenced by an executable operand anywhere in the program. Firing is a declaration-phase/metadata phenomenon, not driven by how the %This.method() call itself compiles.'
      : `${operandUsed} definitions DO use the row as an operand -- the "never used" finding is not universal; investigate those specifically.`
  }, null, 2));
}

main();
