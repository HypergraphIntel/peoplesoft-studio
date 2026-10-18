import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderGrants } from '../providers/portalWriter.js';

/*
 * PeopleTools 8.61.15 Content Ref Administration: saving a component reference granted its
 * permission lists to every folder above it until a public one, each folder saved once.
 */
const lists = (...names: string[]) => names.map((name) => ({ type: 'P' as const, name }));

test('each non-public folder above the reference gets the lists it lacks, not cascading', () => {
  const grants = folderGrants(lists('A', 'B'), [
    { folder: 'PARENT', public: false, held: [] },
    { folder: 'GRANDPARENT', public: false, held: lists('A') },
    { folder: 'PORTAL_BASE_DATA', public: true, held: [] },
    { folder: 'PORTAL_ROOT_OBJECT', public: false, held: [] }
  ]);
  assert.deepEqual(grants, [
    { folder: 'PARENT', grants: [{ type: 'P', name: 'A', cascade: false }, { type: 'P', name: 'B', cascade: false }] },
    { folder: 'GRANDPARENT', grants: [{ type: 'P', name: 'B', cascade: false }] }
  ]);
});

test('a public parent ends the walk; a folder holding every list is not saved', () => {
  assert.deepEqual(folderGrants(lists('A'), [{ folder: 'PUBLIC', public: true, held: [] }, { folder: 'ABOVE', public: false, held: [] }]), []);
  assert.deepEqual(folderGrants(lists('A'), [{ folder: 'PARENT', public: false, held: lists('A') }, { folder: 'ABOVE', public: false, held: [] }]),
    [{ folder: 'ABOVE', grants: [{ type: 'P', name: 'A', cascade: false }] }]);
});
