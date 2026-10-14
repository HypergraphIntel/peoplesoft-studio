/* Drop Zone writer on the lab: set (or clear, with --clear) the lab drop zone's subpage. HRDMO, ZZ_ objects only. */
import { DatabaseProvider } from '../../src/providers/database';
import { setWriteNamePrefix } from '../../src/providers/writeScope';
const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
if (!/hrdmo/i.test(connectString)) throw new Error('HRDMO lab only.');
const p = new DatabaseProvider({ name: 'HRDMO', platform: 'oracle', connectString, user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();
setWriteNamePrefix('ZZ_');
const subpage = process.argv.includes('--clear') ? '' : 'ZZ_PCODE_LAB_SUB';
const before = await p.readDropZoneConfiguration('ZZ_PCODE_LAB_CMP');
const zone = before.zones.find((z) => z.label === 'ZZ Lab Drop Zone')!;
console.log('before:', zone.page, zone.fieldName, '->', zone.subpage ?? '(none)', '| owners', before.owners.map((o) => `${o.portal}/${o.cref}`).join(','));
const r = await p.saveDropZoneConfiguration({ component: 'ZZ_PCODE_LAB_CMP', assignments: [{ page: zone.page, fieldName: zone.fieldName, subpage }], openedToken: before.token, operatorId: 'JARED' });
console.log('written:', r.written, '|', r.plan.changes.join('; '));
const after = await p.readDropZoneConfiguration('ZZ_PCODE_LAB_CMP');
console.log('after:', after.zones.map((z) => `${z.label} -> ${z.subpage ?? '(none)'}`).join('; '));
await p.dispose();
