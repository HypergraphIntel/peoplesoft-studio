import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPortalItem } from '../model/portalRegistry.js';
import { DefinitionType, displayName, makeKey } from '../model/definitions.js';

const T = new Map([['PORTAL_CREF_USGT', new Map([['LINK', 'Content Reference Link']])], ['PORTAL_CREF_URLT', new Map([['UPGE', 'PeopleSoft Component']])]]);

test('a content reference link: labelled by its target, its navigation path, URL, security', () => {
  const text = renderPortalItem({
    item: { PORTAL_NAME: 'EMPLOYEE', PORTAL_REFTYPE: 'C', PORTAL_OBJNAME: 'HC_S2004', PORTAL_LABEL: ' ', LINK_LABEL: 'Job Data', PORTAL_PRNTOBJNAME: 'HC_F2004',
      PORTAL_SEQ_NUM: 4, PORTAL_LINKOBJNAME: 'HC_JOB_DATA_GBL', PORTAL_LINK_PORTAL: 'EMPLOYEE', PORTAL_CREF_USGT: 'LINK', PORTAL_CREF_URLT: 'UPGE',
      PORTAL_URI_SEG1: 'ADMINISTER_WORKFORCE_(GBL)', PORTAL_URI_SEG2: 'JOB_DATA', PORTAL_URI_SEG3: 'GBL', PORTAL_URLTEXT: 'c/ADMINISTER_WORKFORCE_(GBL).JOB_DATA.GBL' },
    path: [{ PORTAL_LABEL: 'Seniority' }, { PORTAL_LABEL: 'Root' }],
    children: [], permissions: [{ PORTAL_PERMTYPE: 'P', PORTAL_PERMNAME: 'HCCPHD1000' }, { PORTAL_PERMTYPE: 'R', PORTAL_PERMNAME: 'Manager' }],
    attributes: [], translates: T
  });
  assert.match(text, /^Content Reference HC_S2004 -- Job Data\n/);
  assert.match(text, /Navigation: Root > Seniority > Job Data/);
  assert.match(text, /Links to: HC_JOB_DATA_GBL in EMPLOYEE \(Job Data\)/);
  assert.match(text, /Usage: Content Reference Link {3}URL type: PeopleSoft Component/);
  assert.match(text, /Menu \/ component \/ market: ADMINISTER_WORKFORCE_\(GBL\) \/ JOB_DATA \/ GBL/);
  assert.match(text, /Permission List +HCCPHD1000\n {4}Role +Manager/);
});

test('a folder lists its contents; portal entries are named "NAME (PORTAL)"', () => {
  const text = renderPortalItem({
    item: { PORTAL_NAME: 'EMPLOYEE', PORTAL_REFTYPE: 'F', PORTAL_OBJNAME: 'HC_F2016', PORTAL_LABEL: 'Job Information' },
    path: [], permissions: [], attributes: [], translates: T,
    children: [{ PORTAL_REFTYPE: 'C', PORTAL_OBJNAME: 'HC_S1', PORTAL_LABEL: ' ', LINK_LABEL: 'Job Data' }, { PORTAL_REFTYPE: 'F', PORTAL_OBJNAME: 'HC_F2', PORTAL_LABEL: 'More' }]
  });
  assert.match(text, /Contents \(2\)\n {4}Job Data +HC_S1\n {4}\[folder\] More +HC_F2/);
  assert.equal(displayName(makeKey(DefinitionType.PortalRegistry, 'EMPLOYEE', 'C', 'HC_JOB_DATA_GBL')), 'HC_JOB_DATA_GBL (EMPLOYEE)');
  assert.equal(displayName(makeKey(DefinitionType.PortalRegistry, 'EMPLOYEE', 'F', 'HC_F2016')), 'HC_F2016 (EMPLOYEE folder)');
});
