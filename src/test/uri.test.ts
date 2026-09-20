import { test } from 'node:test';
import assert from 'node:assert/strict';
import { URI } from 'vscode-uri';
import { connectionHandle } from '../util/handle.js';
import {
  DefinitionType, displayName, fileExtension, keyFromString, makeKey
} from '../model/definitions.js';

/**
 * These tests use vscode-uri, which is the same implementation VS Code's
 * `vscode.Uri` is built on. That matters: a hand-written stub round-trips URIs
 * that the real one mangles, which is exactly how an earlier encoding shipped
 * broken. Every definition opened as a document depends on surviving
 * `toString()` and `parse()`, because that is how resources cross the extension
 * host boundary and how documents are compared.
 */

/** Mirrors toUri(), which cannot be imported here because it needs the vscode module. */
function buildUri(connectionId: string, key: ReturnType<typeof makeKey>): string {
  const keyPart = encodeURIComponent(`${key.type}:${key.parts.join('.')}`);
  const label = `${displayName(key)}${fileExtension(key.type)}`;
  return `psft://${connectionHandle(connectionId)}/${keyPart}/${encodeURIComponent(label)}`;
}

function parseBack(uriString: string) {
  const uri = URI.parse(uriString);
  const segments = uri.path.split('/').filter((s) => s.length > 0);
  return {
    handle: uri.authority.toLowerCase(),
    key: keyFromString(decodeURIComponent(segments[0]))
  };
}

const CONNECTIONS = [
  'project:/home/Someone/Documents/OU/OU_CUSTOM_LANDINGPAGE_JN/OU_CUSTOM_LANDINGPAGE_JN.XML',
  'oracle:DEV',
  'project:C:\\Users\\Someone\\My Projects\\Export.XML'
];

const KEYS = [
  makeKey(DefinitionType.Record, 'OU_JET_PG_COL'),
  makeKey(DefinitionType.RecordPeopleCode, 'WEBLIB_OU_LP', 'ISCRIPT1', 'FieldFormula'),
  makeKey(DefinitionType.ApplicationClassPeopleCode, 'OU_JET_PACK', 'Layout', 'ComponentRegistry'),
  makeKey(DefinitionType.HtmlDefinition, 'OU_FL_BOOTSTRAP_JS', '4'),
  makeKey(DefinitionType.Component, 'OU_OJ_LAYOUT', 'GBL'),
  makeKey(DefinitionType.ApplicationPackage, 'LandingPage', 'OU_LANDINGPAGE', ':')
];

test('a definition URI survives serialization and reparsing', () => {
  // VS Code serializes resources with toString() and reparses them. An
  // authority holding a path does not survive: it is lowercased, and its
  // slashes are not re-encoded, so it spills into the path component.
  for (const connection of CONNECTIONS) {
    for (const key of KEYS) {
      const first = URI.parse(buildUri(connection, key));
      const second = URI.parse(first.toString());
      assert.equal(second.authority, first.authority,
        `authority changed for ${connection} / ${key.parts.join('.')}`);
      assert.equal(second.path, first.path,
        `path changed for ${connection} / ${key.parts.join('.')}`);
    }
  }
});

test('the definition key survives the same round-trip', () => {
  for (const connection of CONNECTIONS) {
    for (const key of KEYS) {
      const serialized = URI.parse(buildUri(connection, key)).toString();
      const parsed = parseBack(serialized);
      assert.equal(parsed.key.type, key.type);
      assert.deepEqual(parsed.key.parts, key.parts,
        `key parts changed for ${key.parts.join('.')}`);
    }
  }
});

test('the connection handle survives the authority being lowercased', () => {
  // The authority is case-insensitive per RFC 3986 and VS Code lowercases it,
  // so the handle must already be lowercase.
  for (const connection of CONNECTIONS) {
    const handle = connectionHandle(connection);
    assert.equal(handle, handle.toLowerCase());
    assert.match(handle, /^[0-9a-f]{16}$/);
    assert.equal(parseBack(URI.parse(buildUri(connection, KEYS[0])).toString()).handle, handle);
  }
});

test('connections differing only in case get different handles', () => {
  // Paths are case-sensitive on Linux, so two exports whose names differ only
  // in case are different files and must not collide.
  assert.notEqual(
    connectionHandle('project:/home/a/Export.XML'),
    connectionHandle('project:/home/a/export.xml'));
});

test('the handle is stable, so URIs restored after a reload still resolve', () => {
  assert.equal(connectionHandle('oracle:DEV'), connectionHandle('oracle:DEV'));
});
