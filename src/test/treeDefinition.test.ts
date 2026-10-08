import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTree } from '../model/treeDefinition.js';
import { DefinitionType, displayName, makeKey } from '../model/definitions.js';

const TRANSLATES = new Map([
  ['EFF_STATUS', new Map([['A', 'Active']])], ['VALID_TREE', new Map([['Y', 'Valid Tree']])],
  ['USE_LEVELS', new Map([['S', 'Strictly Enforced']])], ['TREE_STRCT_TYPE', new Map([['D', 'Detail']])],
  ['TREE_ACC_SELECTOR', new Map([['S', 'Static Selector']])]
]);

test('a tree: settings in PSXLATITEM\'s words, levels, nodes as an outline with their ranges', () => {
  const text = renderTree({
    tree: { SETID: 'SHARE', SETCNTRLVALUE: ' ', TREE_NAME: 'DEPT_SECURITY', DESCR: 'Departments', EFFDT_TEXT: '1990-01-01', EFF_STATUS: 'A',
      VALID_TREE: 'Y', TREE_STRCT_ID: 'DEPARTMENT', USE_LEVELS: 'S', NODE_COUNT: 3, LEAF_COUNT: 2, TREE_ACC_METHOD: ' ', TREE_ACC_SELECTOR: 'S' },
    structure: { TREE_STRCT_TYPE: 'D', NODE_RECNAME: 'TREE_NODE_TBL', NODE_FIELDNAME: 'TREE_NODE', DTL_RECNAME: 'DEPT_TBL', DTL_FIELDNAME: 'DEPTID' },
    levels: [{ TREE_LEVEL_NUM: 2, TREE_LEVEL: 'DIVISION' }, { TREE_LEVEL_NUM: 1, TREE_LEVEL: 'COMPANY' }],
    nodes: [
      { TREE_NODE_NUM: 1, TREE_NODE: 'ALL', TREE_LEVEL_NUM: 1, PARENT_NODE_NUM: 0 },
      { TREE_NODE_NUM: 3, TREE_NODE: 'SALES', TREE_LEVEL_NUM: 2, PARENT_NODE_NUM: 1 },
      { TREE_NODE_NUM: 2, TREE_NODE: 'ADMIN', TREE_LEVEL_NUM: 2, PARENT_NODE_NUM: 1 }
    ],
    leaves: [
      { TREE_NODE_NUM: 2, RANGE_FROM: '10000', RANGE_TO: '19999', DYNAMIC_RANGE: 'N' },
      { TREE_NODE_NUM: 3, RANGE_FROM: ' ', RANGE_TO: ' ', DYNAMIC_RANGE: 'Y' }
    ],
    translates: TRANSLATES
  });
  assert.match(text, /SetID SHARE {3}Effective 1990-01-01 \(Active\) {3}Valid Tree/);
  assert.match(text, /Structure: DEPARTMENT \(Detail; nodes TREE_NODE_TBL\.TREE_NODE, details DEPT_TBL\.DEPTID\)/);
  assert.match(text, /Access: Static Selector/);
  assert.match(text, /Levels: 1 COMPANY, 2 DIVISION/);
  assert.match(text, / {4}ALL {2}\[COMPANY\]\n {6}ADMIN {2}\[DIVISION\]\n {8}- 10000 \.\. 19999\n {6}SALES {2}\[DIVISION\]\n {8}- \(dynamic range\)/);
});

test('a tree is named by its name, SetID and effective date', () => {
  assert.equal(displayName(makeKey(DefinitionType.Tree, 'SHARE', ' ', 'DEPT_SECURITY', '1990-01-01')), 'DEPT_SECURITY (SHARE, 1990-01-01)');
  assert.equal(displayName(makeKey(DefinitionType.Tree, ' ', ' ', 'QUERY_TREE_HR', '1900-01-01')), 'QUERY_TREE_HR (1900-01-01)');
});
