import { createTableScript, tableName, type DdlModel, type DdlRecord } from './recordDdl.js';

/*
 * App Designer's Build for a record: the script, and the statements Build and
 * Execute runs. Create Tables follows Build Settings' table option:
 *
 *   Recreate table if it already exists: DROP TABLE <table> first when the
 *     table exists (App Designer's script for ZZ_PCODE_LAB_R1 once
 *     PS_ZZ_PCODE_LAB_R1 had been built), else the create script alone
 *     (its scripts for R1 and R6 before they were built).
 *   Skip table if it already exists: nothing for an existing table.
 *
 * Create Indexes on its own, Create Views and Alter Tables are not built
 * yet: App Designer's output for them has not been captured.
 */

export type TableOption = 'recreate' | 'skip';

export interface BuildPlan {
  /** The script, as App Designer writes it; '' when there is nothing to build. */
  script: string;
  /** The statements Build and Execute runs, in order. */
  statements: string[];
  /** The table the build drops, when it drops one. */
  drops?: string;
  /** What the build left out, and why. */
  notes: string[];
}

/** The statements of a script: each ends at a "/" line. */
export function scriptStatements(script: string): string[] {
  const out: string[] = [];
  let current: string[] = [];
  for (const line of script.split('\n')) {
    if (line.trim() === '/') {
      const text = current.join('\n').trim();
      if (text) out.push(text);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.join('').trim()) throw new Error('The script ends without "/" after its last statement.');
  return out;
}

export function planCreateTables(r: DdlRecord, model: DdlModel, option: TableOption, tableExists: boolean): BuildPlan {
  const table = tableName(r);
  if (tableExists && option === 'skip') {
    return { script: '', statements: [], notes: [`${table} exists: skipped (Build Settings: Skip table if it already exists).`] };
  }
  const create = createTableScript(r, model);
  const script = (tableExists ? `DROP TABLE ${table}\n/\n` : '') + create;
  return { script, statements: scriptStatements(script), ...(tableExists ? { drops: table } : {}), notes: [] };
}
