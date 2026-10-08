import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeActions, renderMessage, renderPermissionList, renderRole } from '../model/adminDefinitions.js';

test('authorized actions are the component action bits; other bits are shown as stored', () => {
  assert.equal(describeActions(3), 'Add, Update/Display');
  assert.equal(describeActions(14), 'Update/Display, Update/Display All, Correction');
  assert.equal(describeActions(139), 'Add, Update/Display, Correction, bits 0x80');
  assert.equal(describeActions(0), '(none)');
});

test('a permission list: pages by menu and component, Web Libraries and PeopleTools apart, sign-on times', () => {
  const text = renderPermissionList('PTPT1200', {
    list: { CLASSDEFNDESC: 'PeopleTools', TIMEOUTMINUTES: 0, DEFAULTBPM: 'NAVIGATOR', VERSION: 1, LASTUPD: '2025-07-14 00:56:48', LASTUPDOPRID: 'PPLSOFT' },
    items: [
      { MENUNAME: 'APPLICATION_ENGINE', BARNAME: 'INQUIRE', BARITEMNAME: 'AE_ONLINEINST', PNLITEMNAME: ' ', AUTHORIZEDACTIONS: 0 },
      { MENUNAME: 'APPLICATION_ENGINE', BARNAME: 'INQUIRE', BARITEMNAME: 'AE_ONLINEINST', PNLITEMNAME: 'AE_ONLINEINST', AUTHORIZEDACTIONS: 2, DISPLAYONLY: 1 },
      { MENUNAME: 'WEBLIB_PORTAL', BARNAME: 'PORTAL_HOMEPAGE', BARITEMNAME: 'FieldFormula', PNLITEMNAME: 'IScript_HPDefault', AUTHORIZEDACTIONS: 4 },
      { MENUNAME: 'APPLICATION_DESIGNER', BARNAME: 'APPLICATION_DESIGNER', BARITEMNAME: 'RECORD', PNLITEMNAME: ' ', AUTHORIZEDACTIONS: 4 }
    ],
    realMenus: new Set(['APPLICATION_ENGINE']),
    roles: [{ ROLENAME: 'PeopleTools' }],
    signon: [{ DAYOFWEEK: 1, STARTTIME: 480, ENDTIME: 1079 }, { DAYOFWEEK: 0, STARTTIME: 0, ENDTIME: 1439 }],
    componentInterfaces: [{ BCNAME: 'USER_PROFILE', BCMETHOD: 'Save' }, { BCNAME: 'USER_PROFILE', BCMETHOD: 'Get' }],
    webServices: [], processGroups: [{ PRCSGRP: 'TLSALL' }], queryAccess: []
  });
  assert.match(text, /In roles: PeopleTools\n {2}Sign-on times: day 0 00:00-23:59, day 1 08:00-17:59\n/);
  assert.match(text, / {4}APPLICATION_ENGINE\n {6}INQUIRE\.AE_ONLINEINST\n {8}AE_ONLINEINST +Update\/Display {2}\[display only\]/);
  assert.match(text, /Web Libraries \(1\)\n {4}WEBLIB_PORTAL\.PORTAL_HOMEPAGE\.FieldFormula {3}access 4/);
  assert.match(text, /PeopleTools \(1\)\n {4}APPLICATION_DESIGNER\.APPLICATION_DESIGNER\.RECORD {3}access 4/);
  assert.match(text, /USER_PROFILE +Get, Save/);
  assert.match(text, /Process Groups: TLSALL/);
});

test('a role and a Message Catalog entry', () => {
  const role = renderRole('PeopleSoft Administrator', {
    role: { DESCR: 'PeopleSoft Admin Privileges', ROLETYPE: 'U', ROLESTATUS: 'A', VERSION: 1, QRYNAME: ' ' },
    permissionLists: [{ CLASSID: 'PSADMIN', CLASSDEFNDESC: 'PeopleSoft Administrator' }], userCount: 8, canGrant: []
  });
  assert.match(role, /Type: User List {3}Status: Active {3}Users: 8/);
  assert.match(role, /PSADMIN +PeopleSoft Administrator/);
  const message = renderMessage({
    set: { DESCR: 'Time & Labor - Setup Process' },
    message: { MESSAGE_SET_NBR: 13500, MESSAGE_NBR: 219, MSG_SEVERITY: 'M', MESSAGE_TEXT: 'Completed building calendar %1 at %2', DESCRLONG: 'Progress report item' }
  });
  assert.match(message, /^Message 13500, 219 {2}\(set: Time & Labor - Setup Process\)\n {2}Severity: Message/);
  assert.match(message, /Explanation\n {4}Progress report item/);
});
