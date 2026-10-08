import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_FIELD_TYPES, renderComponent, renderMenu, renderPage } from '../model/uiDefinitions.js';
import { PAGE_CONTROL_NAMES } from '../model/recordLayout.js';

test('page field types App Designer named as Default Page Controls carry the same names', () => {
  // DEFGUICONTROL shares PSPNLFIELD.FIELDTYPE's numbers: 4, 5, 7, 8, 9 were named by App Designer.
  for (const code of [4, 7, 8, 9]) assert.equal(PAGE_FIELD_TYPES[code], PAGE_CONTROL_NAMES[code]);
  assert.equal(PAGE_CONTROL_NAMES[5], 'Dropdown List');
  assert.equal(PAGE_FIELD_TYPES[5], 'Drop Down List');
});

test('a component: actions from the ACTIONS bits, pages in order, menus (JOB_DATA on HRDMO)', () => {
  const text = renderComponent('JOB_DATA', 'GBL', {
    component: {
      DESCR: 'Job Data', SEARCHRECNAME: 'EMPLMT_SRCH_ALL', ADDSRCHRECNAME: 'EMPLMT_SRCH_ALL', SEARCHPNLNAME: 'PERSONAL_DATA1', ACTIONS: 14,
      DISABLESAVE: 0, FORCESEARCH: 0, INCLNAVIGATION: 1, ALLOWACTMODESEL: 1, FLUIDMODE: 0, OBJECTOWNERID: 'HCR', VERSION: 246,
      LASTUPD: '2021-03-05 09:27:17', LASTUPDOPRID: 'PPLSOFT'
    },
    pages: [
      { PNLNAME: 'JOB_DATA_JOBCODE', ITEMNAME: 'JOB_DATA_JOBCODE', ITEMLABEL: '&Job Information', SUBITEMNUM: 2, HIDDEN: 0 },
      { PNLNAME: 'JOB_DATA1', ITEMNAME: 'JOB_DATA1', ITEMLABEL: '&Work Location', SUBITEMNUM: 1, HIDDEN: 0 },
      { PNLNAME: 'ENCUMB_TRIGGER', ITEMNAME: 'ENCUMB_TRIGGER', ITEMLABEL: 'Encumb &Trigger', SUBITEMNUM: 3, HIDDEN: 1 }
    ],
    menus: [{ MENUNAME: 'ADMINISTER_WORKFORCE_(GBL)', BARNAME: 'USE', ITEMNAME: 'JOB_DATA' }]
  });
  assert.match(text, /Actions: Update\/Display, Update\/Display All, Correction\n/);
  assert.match(text, /Search page: PERSONAL_DATA1/);
  assert.match(text, /On menus: ADMINISTER_WORKFORCE_\(GBL\)\.USE\.JOB_DATA/);
  assert.ok(text.indexOf('JOB_DATA1 ') < text.indexOf('JOB_DATA_JOBCODE'));
  assert.match(text, /ENCUMB_TRIGGER.*\[hidden\]/);
});

test('a page in Order view: by FIELDNUM, level, type, label and target', () => {
  const text = renderPage('JOB_DATA1', {
    page: { DESCR: 'Job Data1', PNLTYPE: 0, VERSION: 1, OBJECTOWNERID: 'HCR', LASTUPD: '2021-08-16 04:44:09', LASTUPDOPRID: 'PPLSOFT' },
    fields: [
      { FIELDNUM: 7, OCCURSLEVEL: 1, FIELDTYPE: 4, LBLTYPE: 3, LBLTEXT: 'Effective Date', RECNAME: 'JOB', FIELDNAME: 'EFFDT' },
      { FIELDNUM: 1, OCCURSLEVEL: 0, FIELDTYPE: 11, LBLTYPE: 1, LBLTEXT: ' ', RECNAME: 'PER_ORG_ASGN', FIELDNAME: ' ', SUBPNLNAME: 'EMPL_SRCH1_SBP' },
      { FIELDNUM: 5, OCCURSLEVEL: 1, FIELDTYPE: 27, LBLTYPE: 7, LBLTEXT: ' ', OCCURSCOUNT1: 1 },
      { FIELDNUM: 16, OCCURSLEVEL: 1, FIELDTYPE: 15, LBLTYPE: 1, LBLTEXT: 'Help', RECNAME: 'DERIVED', FIELDNAME: 'LINK', URL_ID: 'PS_HELP' }
    ],
    components: [{ PNLGRPNAME: 'JOB_DATA', MARKET: 'GBL', ITEMLABEL: '&Work Location' }]
  });
  const lines = text.split('\n');
  const body = lines.slice(lines.findIndex((l) => l.includes('Num  Lvl')) + 1).filter(Boolean);
  assert.deepEqual(body.map((l) => l.trim().split(/\s{2,}/)[0]), ['1', '5', '7', '16']);
  assert.match(text, /Subpage\s+PER_ORG_ASGN {2}-> EMPL_SRCH1_SBP/);
  assert.match(text, /Scroll Area\s+\(label type 7\)\s+occurs 1/);
  assert.match(text, /Push Button \(External Link\)\s+Help\s+DERIVED\.LINK {2}URL PS_HELP/);
  assert.match(text, /In components: JOB_DATA\.GBL \("&Work Location"\)/);
});

test('a menu by bar: components, separators, search record overrides', () => {
  const text = renderMenu('ADMINISTER_WORKFORCE_(GBL)', {
    menu: { DESCR: 'Administer Workforce', MENUTYPE: 0, MENULABEL: 'Administer Workforce (&GBL)', MENUGROUP: '&Administer Workforce', VERSION: 1 },
    items: [
      { BARNAME: 'USE', BARLABEL: '&Use', ITEMNAME: 'JOB_DATA', ITEMNUM: 3, ITEMTYPE: 5, PNLGRPNAME: 'JOB_DATA', MARKET: 'GBL', ITEMLABEL: 'Job Data', SEARCHRECNAME: 'EMPLMT_SRCH_COR' },
      { BARNAME: 'USE', ITEMNAME: 'SEP1', ITEMNUM: 2, ITEMTYPE: 8 },
      { BARNAME: 'USE', ITEMNAME: 'ADD_PERSON', ITEMNUM: 1, ITEMTYPE: 5, PNLGRPNAME: 'PERSONAL_DATA_ADD', MARKET: 'GBL', ITEMLABEL: 'Add a Person' }
    ]
  });
  assert.match(text, /Bar USE "&Use"\n {4}ADD_PERSON .*-> PERSONAL_DATA_ADD\.GBL\n {4}----\n {4}JOB_DATA .*-> JOB_DATA\.GBL {2}\(search record EMPLMT_SRCH_COR\)/);
  assert.match(text, /Type: Standard/);
});
