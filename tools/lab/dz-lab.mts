/* Lab setup for the Drop Zone captures: a drop zone (Related Content group box + PT_ERCSUBPAGE_STUB) on ZZ_PCODE_LAB_PG. ZZ_ objects only. */
import { DatabaseProvider } from '../../src/providers/database';
import { setWriteNamePrefix } from '../../src/providers/writeScope';
import { applyPageOperations } from '../../src/model/pageOperations';
import { DefinitionType } from '../../src/model/definitions';
const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
if (!/hrdmo/i.test(connectString)) throw new Error('HRDMO lab only.');
const p = new DatabaseProvider({ name: 'HRDMO', platform: 'oracle', connectString, user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();
setWriteNamePrefix('ZZ_');
const key = { type: DefinitionType.Page, parts: ['ZZ_PCODE_LAB_PG'] };
const { layout } = await p.readPageLayout(key);
const gb = layout.controls.find((c) => c.type === 2 && c.columns.lblText === 'ZZ Lab Drop Zone');
const stub = layout.controls.find((c) => c.type === 11 && c.target.includes('PT_ERCSUBPAGE_STUB'));
if (!gb || !stub) throw new Error(`lab controls not found: gb ${gb?.pnlFldId} stub ${stub?.pnlFldId}`);
// The group box immediately before the stub in tab order, the rest as stored.
const order = layout.controls.map((c) => c.pnlFldId).filter((id) => id !== gb.pnlFldId);
order.splice(order.indexOf(stub.pnlFldId), 0, gb.pnlFldId);
const { controls, properties } = applyPageOperations(layout, [{ op: 'set_order', order }]);
const g = controls.find((c) => c.pnlFldId === gb.pnlFldId)!;
(g as { groupBoxType?: number }).groupBoxType = 21;
const r = await p.savePage({ pnlName: 'ZZ_PCODE_LAB_PG', openedVersion: layout.version, operatorId: 'JARED', controls, properties, order });
console.log('saved:', JSON.stringify(r));
const after = await p.discoverCapabilities({ type: DefinitionType.Component, parts: ['ZZ_PCODE_LAB_CMP', 'GBL'] });
console.log('discovery:', after.dropZones?.state, '|', after.dropZones?.evidence.join(' '));
for (const z of after.dropZones?.dropZones ?? []) console.log(`  "${z.label}" page ${z.page} gb ${z.groupBoxId} tab ${z.tabOrder} key ${z.fieldName} id ${z.fieldId}`);
await p.dispose();
