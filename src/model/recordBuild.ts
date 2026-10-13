import { createTableScript, tableName, type DdlModel, type DdlPlatform, type DdlRecord } from './recordDdl.js';
import { RecordType } from './record.js';
import type { RecordLayout } from './recordLayout.js';

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

/**
 * The statements of a script: each ends at a "/" line (Oracle), a "go" line
 * (SQL Server), or a ";" ending its last line (DB2).
 */
export function scriptStatements(script: string, platform: DdlPlatform = 'oracle'): string[] {
  const out: string[] = [];
  let current: string[] = [];
  const end = platform === 'oracle' ? '/' : platform === 'mssql' ? 'go' : undefined;
  for (const line of script.split('\n')) {
    if (end !== undefined ? line.trim().toLowerCase() === end : /;\s*$/.test(line)) {
      if (end === undefined) current.push(line.replace(/;\s*$/, ''));
      const text = current.join('\n').trim();
      if (text) out.push(text);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.join('').trim()) throw new Error(`The script ends without "${end ?? ';'}" after its last statement.`);
  return out;
}

export function planCreateTables(r: DdlRecord, model: DdlModel, option: TableOption, tableExists: boolean): BuildPlan {
  const table = tableName(r);
  if (tableExists && option === 'skip') {
    return { script: '', statements: [], notes: [`${table} exists: skipped (Build Settings: Skip table if it already exists).`] };
  }
  const platform = model.platform ?? 'oracle';
  const create = createTableScript(r, model);
  const drop = platform === 'oracle' ? `DROP TABLE ${table}\n/\n` : platform === 'mssql' ? `DROP TABLE ${table}\ngo\n` : `DROP TABLE ${table};\n`;
  const script = (tableExists ? drop : '') + create;
  return { script, statements: scriptStatements(script, platform), ...(tableExists ? { drops: table } : {}), notes: [] };
}

/** A record's DDL shape, from its layout (the record editor and Build Project). */
export function ddlRecordFromLayout(r: RecordLayout): DdlRecord {
  return {
    name: r.name, recordType: r.recordType, sqlTableName: r.sqlTableName,
    ...(r.tablespace ? { tablespace: r.tablespace } : {}),
    fields: r.fields.map((f) => ({
      name: f.name, type: f.type!, length: f.length ?? 0, decimalPositions: f.decimalPositions ?? 0,
      ...(f.format !== undefined ? { format: f.format } : {}), useEdit: f.useEdit
    }))
  };
}

/** Why a record is not built here, or undefined when it is (an SQL Table with no subrecords). */
export function unbuildableReason(r: RecordLayout): string | undefined {
  if (r.recordType !== RecordType.Table) return 'not an SQL Table (only Create Tables is built here)';
  if (r.fields.some((f) => f.isSubrecord)) return 'has subrecords (not built here yet)';
  return undefined;
}

export interface ProjectBuildRecord {
  layout: RecordLayout;
  model: DdlModel;
  tableExists: boolean;
}

/** Build Project's Create Tables: each buildable record's script, in project order, and a note for every record left out. */
export function planProjectCreateTables(records: readonly ProjectBuildRecord[], option: TableOption): BuildPlan {
  const scripts: string[] = [];
  const notes: string[] = [];
  let drops = 0;
  for (const { layout, model, tableExists } of records) {
    const reason = unbuildableReason(layout);
    if (reason) { notes.push(`${layout.name}: ${reason}.`); continue; }
    const plan = planCreateTables(ddlRecordFromLayout(layout), model, option, tableExists);
    notes.push(...plan.notes);
    if (plan.drops) drops++;
    if (plan.script) scripts.push(plan.script);
  }
  const script = scripts.join('\n');
  const platform = records[0]?.model.platform ?? 'oracle';
  return { script, statements: script ? scriptStatements(script, platform) : [], ...(drops ? { drops: `${drops} table${drops === 1 ? '' : 's'}` } : {}), notes };
}
