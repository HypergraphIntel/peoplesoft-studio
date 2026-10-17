import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DefinitionType } from '../model/definitions.js';
import { INCLUDE_ALL, projectExclusion } from '../model/projectInclusion.js';
import { SETTING_DESCRIPTORS } from '../settings/settingsModel.js';

test('by default every type goes into projects', () => {
  for (const t of [DefinitionType.Menu, DefinitionType.PortalRegistry, DefinitionType.PermissionList, DefinitionType.Role, DefinitionType.Record]) {
    assert.equal(projectExclusion(t, INCLUDE_ALL), undefined);
  }
});

test('each Project Contents setting leaves out its own types and only those, naming the setting', () => {
  const noMenus = { ...INCLUDE_ALL, menus: false };
  assert.match(projectExclusion(DefinitionType.Menu, noMenus)!, /Include menus in projects.*peoplesoft\.projects\.includeMenus/);
  assert.equal(projectExclusion(DefinitionType.PortalRegistry, noMenus), undefined);

  const noPortal = { ...INCLUDE_ALL, portalRegistry: false };
  assert.match(projectExclusion(DefinitionType.PortalRegistry, noPortal)!, /includePortalRegistry/);
  assert.equal(projectExclusion(DefinitionType.Menu, noPortal), undefined);

  const noSecurity = { ...INCLUDE_ALL, security: false };
  assert.match(projectExclusion(DefinitionType.PermissionList, noSecurity)!, /includeSecurity/);
  assert.match(projectExclusion(DefinitionType.Role, noSecurity)!, /includeSecurity/);
  // Everything else a build makes still goes in.
  for (const t of [DefinitionType.Record, DefinitionType.Page, DefinitionType.Component, DefinitionType.AppEngineProgram, DefinitionType.MessageCatalog]) {
    assert.equal(projectExclusion(t, { menus: false, portalRegistry: false, security: false }), undefined);
  }
});

test('the three settings are in the Project Contents panel and package.json, on by default', () => {
  const keys = ['projects.includeMenus', 'projects.includePortalRegistry', 'projects.includeSecurity'];
  const config = JSON.parse(readFileSync('package.json', 'utf8')).contributes.configuration;
  const props = Object.assign({}, ...(Array.isArray(config) ? config : [config]).map((c: { properties: object }) => c.properties));
  for (const key of keys) {
    const d = SETTING_DESCRIPTORS.find((x) => x.key === key);
    assert.ok(d, key);
    assert.equal(d!.section, 'projects');
    assert.equal(d!.defaultValue, true);
    assert.equal(props[`peoplesoft.${key}`]?.default, true, `package.json peoplesoft.${key}`);
  }
  assert.match(readFileSync('media/settings.js', 'utf8'), /id: 'projects', title: 'Project Contents'/);
});
