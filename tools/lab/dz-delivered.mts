/*
 * Drop Zones on a DELIVERED drop zone (they are Oracle's to place): a ZZ_ classic custom subpage made as the
 * PeopleTools guide describes (one container group box, a static text, no database record), configured into
 * JOB_CODE_TBL's "DZ-Bottom of Job Code And Profile" by the writer; --clear removes the configuration.
 * HRDMO only; no Oracle definition is changed.
 */
import { DatabaseProvider } from '../../src/providers/database';
import { setWriteNamePrefix } from '../../src/providers/writeScope';
import { applyPageOperations, type PageOperation } from '../../src/model/pageOperations';
import { DefinitionType } from '../../src/model/definitions';
const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
if (!/hrdmo/i.test(connectString)) throw new Error('HRDMO lab only.');
const p = new DatabaseProvider({ name: 'HRDMO', platform: 'oracle', connectString, user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();
setWriteNamePrefix('ZZ_');
const SUBPAGE = 'ZZ_PCODE_LAB_DZS', COMPONENT = 'JOB_CODE_TBL', LABEL = 'DZ-Bottom of Job Code And Profile';
const clear = process.argv.includes('--clear');

if (!clear) {
  const [exists] = (await p.runReadOnlyQuery(`SELECT PNLTYPE FROM PSPNLDEFN WHERE PNLNAME = '${SUBPAGE}'`, 1)).rows;
  if (!exists) {
    const empty = { name: SUBPAGE, controls: [], version: 0, properties: { description: '', comments: '' } } as unknown as Parameters<typeof applyPageOperations>[0];
    const ops: PageOperation[] = [
      { op: 'add', kind: 'groupBox', left: 0, top: 0, width: 600, height: 60, label: '' },
      { op: 'add', kind: 'staticText', left: 12, top: 20, width: 400, height: 20, label: 'ZZ Lab: custom subpage in a delivered drop zone' }
    ];
    const { controls } = applyPageOperations(empty, ops);
    const r = await p.createPage({ pnlName: SUBPAGE, operatorId: 'JARED', controls, properties: { pageType: 1, adjustLayout: true, description: 'ZZ Lab DZ subpage', comments: 'Custom subpage for a delivered drop zone (lab).' } });
    console.log('created subpage', SUBPAGE, JSON.stringify(r));
  } else console.log('subpage', SUBPAGE, 'exists, type', exists.PNLTYPE);
}

const read = await p.readDropZoneConfiguration(COMPONENT);
const zone = read.zones.find((z) => z.label === LABEL);
if (!zone) throw new Error(`no drop zone "${LABEL}" on ${COMPONENT}`);
console.log(`zone: ${zone.page} key ${zone.fieldName} level ${zone.level} now ${zone.subpage ?? '(none)'}; owners ${read.owners.map((o) => `${o.portal}/${o.cref}`).join(', ')}`);
const r = await p.saveDropZoneConfiguration({ component: COMPONENT, assignments: [{ page: zone.page, fieldName: zone.fieldName, subpage: clear ? '' : SUBPAGE }], openedToken: read.token, operatorId: 'JARED' });
console.log('written:', r.written, '|', r.plan.changes.join('; '));
const after = await p.readDropZoneConfiguration(COMPONENT);
console.log('after:', after.zones.filter((z) => z.subpage).map((z) => `${z.label} -> ${z.subpage}`).join('; ') || '(none configured)');
await p.dispose();
