/* Lab: configure a field of JOB_CODE_TBL's Standard configuration through the field catalog and the editing rules, as the
 * Customization Strategy view does.
 *   npx tsx tools/lab/pfc-edit.mts [--write] PAGE FIELD [hidden] [displayOnly] [required] [label=TEXT] | remove PAGE FIELD
 * Without --write it is a dry run (written, derived, rolled back). */
import { DatabaseProvider } from '../../src/providers/database';
import { catalogFieldRow } from '../../src/providers/pfcCatalog';
import { describeFieldSettings, fieldRowKey, fieldSettingsOf, withFieldRow, withFieldSettings, withoutFieldRow } from '../../src/model/pfcFieldEdits';
const args = process.argv.slice(2).filter((a) => a !== '--write');
const write = process.argv.includes('--write');
const remove = args[0] === 'remove';
const [page, fieldName, ...flags] = remove ? args.slice(1) : args;
const p = new DatabaseProvider({ name: 'HRDMO', platform: 'oracle', connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo', user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();
const read = await p.readPageFieldConfiguration('JOB_CODE_TBL', 'GBL', 'STD');
const config = read.configuration!;
const seq = config.sequences[0];
const f = (await p.readPageFieldCatalogFields(page, 'P')).find((x) => x.field === fieldName);
if (!f) throw new Error(`${page} offers no ${fieldName}`);
const row = catalogFieldRow(f, { SEQUENCE_NBR: Number(seq.SEQUENCE_NBR), EOCC_SEQUENCE_NBR: Number(seq.EOCC_SEQUENCE_NBR) });
const label = flags.find((x) => x.startsWith('label='))?.slice(6);
const settings = { hidden: flags.includes('hidden'), displayOnly: flags.includes('displayOnly'), required: flags.includes('required'), ...(label ? { label } : {}) };
const fields = remove ? withoutFieldRow(config.fields, seq, fieldRowKey(row)) : withFieldRow(config.fields, withFieldSettings(row, settings, f.label));
const r = await p.savePageFieldConfiguration({ component: 'JOB_CODE_TBL', market: 'GBL', type: 'STD', configuration: { ...config, fields } as any, openedToken: read.token, operatorId: 'JARED', dryRun: !write });
console.log(JSON.stringify({ written: r.written, field: `${f.record}.${f.field} "${f.label}" ${f.pageField}`, settings: remove ? 'removed' : describeFieldSettings(settings),
  rows: r.rows.changes, derived: r.derived.map((m) => `${m.serviceId} ${m.level} ${m.record ?? m.page ?? ''}`), mappings: r.mappings?.changes }, null, 1));
await p.dispose();
