/* Lab: save JOB_CODE_TBL's Standard configuration through the Page and Field Configurator writer.
 *   npx tsx tools/lab/pfc-save.mts [--write] add-field | hide-short-title | remove-field | inactive
 * Without --write it is a dry run (written, derived, rolled back). */
import { DatabaseProvider } from '../../src/providers/database';
import { pfcToken, readPfcColumns, readPfcConfiguration, savePfcConfiguration } from '../../src/providers/pfcWriter';
const write = process.argv.includes('--write');
const action = process.argv.filter((a) => !a.startsWith('--')).at(-1) ?? 'add-field';
const p = new DatabaseProvider({ name: 'HRDMO', platform: 'oracle', connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo', user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();
await (p as any).withConnection(async (c: any) => {
  const columns = await readPfcColumns(c);
  const stored = await readPfcConfiguration(c, columns, 'JOB_CODE_TBL', 'GBL', 'STD');
  if (!stored.header) throw new Error('JOB_CODE_TBL has no STD configuration');
  const header = { ...stored.header, ...(action === 'inactive' ? { EFF_STATUS: 'I' } : {}) };
  const keyField = { SEQUENCE_NBR: 1, EOCC_SEQUENCE_NBR: 1, RECNAME: 'JOBCODE_TBL', FIELDNAME: 'KEY_JOBCODE', OCCURSLEVEL: 1, LBLTEXT: 'Key Job Code',
    PNLNAME: 'JOBCODE_TBL1_GBL', STDPNLNAME: 'JOBCODE_TBL1_GBL', PTCS_PNLFLDNAME: '1.JOBCODE_TBL.KEY_JOBCODE.180.1.P', EOCC_IS_REQUIRED: 'Y', FIELDTYPE: 7, EOCC_SBP_LEVEL: 1, EOCC_PROF_STATUS: ' ' };
  // Short Job Title hidden: a visible effect at run time (Key Job Code is a check box; required shows nothing on it).
  const shortTitle = { SEQUENCE_NBR: 1, EOCC_SEQUENCE_NBR: 1, RECNAME: 'JOBCODE_TBL', FIELDNAME: 'DESCRSHORT', OCCURSLEVEL: 1, LBLTEXT: 'Short Job Title',
    PNLNAME: 'JOBCODE_TBL1_GBL', STDPNLNAME: 'JOBCODE_TBL1_GBL', PTCS_PNLFLDNAME: '1.JOBCODE_TBL.DESCRSHORT.14.1.P', EOCC_VISIBLE_FLAG: 'N', FIELDTYPE: 4, EOCC_SBP_LEVEL: 1, EOCC_PROF_STATUS: ' ' };
  const fields = action === 'hide-short-title' ? [shortTitle] : action === 'add-field' ? [keyField] : action === 'remove-field' ? [{ SEQUENCE_NBR: 1, EOCC_SEQUENCE_NBR: 1 }] : stored.fields;
  const sequences = stored.sequences.map((r) => ({ ...r, DESCR: action === 'add-field' ? 'ZZ lab sequence' : r.DESCR }));
  const r = await savePfcConfiguration(c, { component: 'JOB_CODE_TBL', market: 'GBL', type: 'STD', configuration: { header, sequences, criteria: stored.criteria, pages: stored.pages, fields },
    openedToken: pfcToken(stored), operatorId: 'JARED', dryRun: !write });
  console.log(JSON.stringify({ written: r.written, rows: r.rows.changes, derived: r.derived.map((m) => `${m.serviceId} ${m.level} ${m.record ?? ''}`), mappings: r.mappings?.changes,
    counters: r.mappings?.counters.version, warnings: r.warnings, statements: (r.rows.statements.length + (r.mappings?.statements.length ?? 0)) }, null, 1));
});
await p.dispose();
