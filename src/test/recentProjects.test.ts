import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addRecentProject, deserializeRecentProjects, removeRecentProject, serializeRecentProjects
} from '../model/recentProjects.js';

const a = { connectionId: 'HCDEV', project: 'A' };
const b = { connectionId: 'HCDEV', project: 'B' };
const other = { connectionId: 'HCTEST', project: 'A' };

test('opening moves a project to the front without changing the input or merging connections', () => {
  const entries = [b, other, a];
  assert.deepEqual(addRecentProject(entries, a), [a, b, other]);
  assert.deepEqual(entries, [b, other, a]);
});

test('only the ten most recent unique projects survive', () => {
  let entries = [a];
  for (let i = 0; i < 12; i++) entries = addRecentProject(entries, { ...a, project: String(i) });
  assert.equal(entries.length, 10);
  assert.deepEqual(entries.map((e) => e.project), ['11', '10', '9', '8', '7', '6', '5', '4', '3', '2']);
});

test('removing a project uses both connection and project', () => {
  assert.deepEqual(removeRecentProject([a, b, other], a), [b, other]);
});

test('global state roundtrips as plain JSON and preserves order', () => {
  const stored = serializeRecentProjects([a, b, other, a]);
  assert.deepEqual(deserializeRecentProjects(JSON.parse(JSON.stringify(stored))), [a, b, other]);
  assert.notEqual(stored[0], a);
  assert.deepEqual(deserializeRecentProjects([]), []);
});

test('malformed global state is ignored without losing valid entries', () => {
  for (const value of [null, undefined, {}, 'old state', 42]) assert.deepEqual(deserializeRecentProjects(value), []);
  assert.deepEqual(deserializeRecentProjects([null, {}, { ...a, project: 1 }, { ...a, connectionId: '' },
    { ...a, project: '  ' }, a, a, b]), [a, b]);
});
