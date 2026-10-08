import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSecretProperty, renderNode, renderUrl } from '../model/miscDefinitions.js';

test('a node\'s secret connector properties are never shown (FT_UCM\'s Password on HRDMO)', () => {
  for (const name of ['Password', 'MCF_Password', 'PROXYPASSWORD', 'IBPASSWORD', 'clientSecret', 'accessToken', 'KEYSTOREPASS']) assert.ok(isSecretProperty(name), name);
  for (const name of ['URL', 'Userid', 'PingServiceName', 'sendUncompressed']) assert.ok(!isSecretProperty(name), name);
  const text = renderNode('FT_UCM', {
    node: { DESCR: 'UCM Node', NODE_TYPE: 'PIA', ACTIVE_NODE: 'Y', AUTHOPTN: 'P', CONNGATEWAYID: 'LOCAL', CONNID: 'RIDCTARGET', IBPASSWORD: 'enc-secret' },
    connectorProperties: [
      { PROPID: 'RIDCTARGET', PROPNAME: 'Password', SEQNUM: 1, PROPVALUE: 'hunter2' },
      { PROPID: 'RIDCTARGET', PROPNAME: 'URL', SEQNUM: 2, PROPVALUE: 'http://host/cs/idcplg' }
    ],
    translates: new Map([['ACTIVE_NODE', new Map([['Y', 'Yes']])]])
  });
  assert.ok(!text.includes('hunter2') && !text.includes('enc-secret'));
  assert.match(text, /RIDCTARGET +Password +\(not shown\)/);
  assert.match(text, /RIDCTARGET +URL +http:\/\/host\/cs\/idcplg/);
  assert.match(text, /Connector: LOCAL \/ RIDCTARGET/);
});

test('a URL definition', () => {
  assert.match(renderUrl('ACA_1095C_DATA', { DESCR: 'ACA 1095C Consent status', URL: 'record://ACA_1095C_DATA', VERSION: 1 }),
    /^URL Definition ACA_1095C_DATA -- ACA 1095C Consent status\n {2}URL: record:\/\/ACA_1095C_DATA\n/);
});
