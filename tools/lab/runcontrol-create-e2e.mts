/*
 * The MCP's run control path on HRDMO, as psft_page_create and psft_component_create run it: a classic run control
 * page (Static Text plus the PRCSRUNCNTL_SBP subpage, record substitution PRCSRUNCNTL) built from page operations on
 * a blank page and created with createPage, then a component on it with search record PRCSRUNCNTL and the usual run
 * control actions, created with saveComponent; both read back.
 *
 * WRITES. HRDMO only; ZZ_RC_E2E_PNL / ZZ_RC_E2E_CMP only. Leaves them for App Designer to open. Refuses to run if
 * either already exists (delete them in App Designer to rerun).
 *
 *   npx tsx tools/lab/runcontrol-create-e2e.mts
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DatabaseProvider } from '../../src/providers/database';
import { setWriteNamePrefix } from '../../src/providers/writeScope';
import { NEW_PAGE } from '../../src/providers/pageWriter';
import { buildPageLayout } from '../../src/model/pageLayout';
import { applyPageOperations, type PageOperation } from '../../src/model/pageOperations';
import { DefinitionType } from '../../src/model/definitions';

const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
if (!/hrdmo/i.test(connectString)) throw new Error('HRDMO lab only.');
const operatorId = process.env.PSLAB_OPERATOR ?? 'JARED';
setWriteNamePrefix('ZZ_RC_E2E');
const require = createRequire(join(process.cwd(), 'package.json'));
const oracledb = require('oracledb');
const p = new DatabaseProvider({ name: 'LAB', platform: 'oracle', connectString, user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : `\n     ${detail}`}`); };
const PAGE = 'ZZ_RC_E2E_PNL', COMP = 'ZZ_RC_E2E_CMP';
if (await p.pageInfo(PAGE) || await p.componentExists(COMP, 'GBL')) throw new Error(`${PAGE} or ${COMP} exists already; delete them to rerun.`);

const operations: PageOperation[] = [
  { op: 'add', kind: 'staticText', left: 12, top: 8, label: 'Studio run control E2E' } as PageOperation,
  { op: 'add', kind: 'subpage', left: 0, top: 0, page: 'PRCSRUNCNTL_SBP', record: 'PRCSRUNCNTL' } as PageOperation
];
const blank = buildPageLayout(PAGE, { page: { PNLNAME: PAGE, VERSION: 0, ...NEW_PAGE }, fields: [], components: [] });
const { controls, properties } = applyPageOperations(blank, operations);
const created = await p.createPage({ pnlName: PAGE, operatorId, controls, properties });
check('page created', created.version > 0 && created.fieldCount === 2, JSON.stringify(created));
const { layout } = await p.readPageLayout({ type: DefinitionType.Page, parts: [PAGE] });
const sub = layout.controls.find((c) => /PRCSRUNCNTL_SBP/.test(JSON.stringify(c)));
check('page reads back with the run control subpage', !!sub && layout.controls.length === 2, JSON.stringify(layout.controls.map((c) => c.label)));

const comp = await p.saveComponent({ name: COMP, market: 'GBL', operatorId,
  items: [{ pageName: PAGE, itemName: PAGE, itemLabel: 'Run Control', folderTabLabel: '', hidden: false }],
  properties: { description: 'Studio run control E2E', comments: '', searchRecord: 'PRCSRUNCNTL', addSearchRecord: '', detailPage: '', forceSearch: false,
    actions: { add: false, updateDisplay: true, updateDisplayAll: true, correction: true }, disableSave: false, includeInNavigation: true } });
check('component created', comp.created && comp.version > 0, JSON.stringify(comp));
const d = await p.readComponentDefinition({ type: DefinitionType.Component, parts: [COMP, 'GBL'] });
check('component reads back', d.items.length === 1 && d.items[0].pageName === PAGE && d.properties.use.searchRecord === 'PRCSRUNCNTL'
  && d.properties.use.actions.updateDisplay && d.properties.use.actions.updateDisplayAll && d.properties.use.actions.correction && !d.properties.use.actions.add,
  JSON.stringify({ items: d.items, use: d.properties.use }));
await p.dispose?.();
void oracledb;
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exit(failed ? 1 : 0);
