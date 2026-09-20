import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPackageTree, isPackageItem, PackageNode } from '../model/appPackages.js';
import { DefinitionType, makeKey } from '../model/definitions.js';

const pkg = (id: string, root: string, qualify: string) =>
  ({ key: makeKey(DefinitionType.ApplicationPackage, id, root, qualify) });
const cls = (root: string, qualify: string, classId: string) =>
  ({ key: makeKey(DefinitionType.ApplicationClassPeopleCode, root, qualify, classId) });

/** Renders the tree as indented lines, so shape is readable in assertions. */
function outline(nodes: readonly PackageNode[], depth = 0): string[] {
  return nodes.flatMap((n) => [
    `${'  '.repeat(depth)}${n.name}${n.kind === 'class' ? ' (class)' : ''}`,
    ...outline(n.children, depth + 1)
  ]);
}

test('classes nest under their subpackage, with packages before classes', () => {
  const tree = buildPackageTree([
    pkg('OU_JET_PACK', 'OU_JET_PACK', '.'),
    pkg('Layout', 'OU_JET_PACK', ':'),
    pkg('Model', 'OU_JET_PACK', ':'),
    cls('OU_JET_PACK', 'Layout', 'ComponentRegistry'),
    cls('OU_JET_PACK', 'Layout', 'LayoutEngine'),
    cls('OU_JET_PACK', 'Model', 'PageCol')
  ]);
  assert.deepEqual(outline(tree), [
    'OU_JET_PACK',
    '  Layout',
    '    ComponentRegistry (class)',
    '    LayoutEngine (class)',
    '  Model',
    '    PageCol (class)'
  ]);
});

test('a class with a blank class slot sits in the root package', () => {
  // [OU_JET_PACK, ROADMAP, ] is the class OU_JET_PACK:ROADMAP, not a subpackage.
  const tree = buildPackageTree([
    pkg('OU_JET_PACK', 'OU_JET_PACK', '.'),
    cls('OU_JET_PACK', 'ROADMAP', '')
  ]);
  assert.deepEqual(outline(tree), ['OU_JET_PACK', '  ROADMAP (class)']);
  assert.equal(tree[0].children[0].kind, 'class');
});

test('classes are always leaves', () => {
  const tree = buildPackageTree([
    cls('R', 'A', 'C1'),
    cls('R', 'A', 'C2'),
    cls('R', 'ROOTCLASS', '')
  ]);
  const walk = (nodes: readonly PackageNode[]): void => {
    for (const n of nodes) {
      if (n.kind === 'class') assert.equal(n.children.length, 0, `${n.name} has children`);
      walk(n.children);
    }
  };
  walk(tree);
});

test('a class whose package is not in the project still appears', () => {
  // The export includes referenced definitions selectively, so a class can
  // arrive without its package item. Dropping it would hide real code.
  const tree = buildPackageTree([cls('OU_LANDINGPAGE', 'LandingPage', 'OUBanner')]);
  assert.deepEqual(outline(tree), [
    'OU_LANDINGPAGE',
    '  LandingPage',
    '    OUBanner (class)'
  ]);
});

test('a deeper qualify path creates one node per segment', () => {
  const tree = buildPackageTree([cls('R', 'A:B:C', 'Leaf')]);
  assert.deepEqual(outline(tree), ['R', '  A', '    B', '      C', '        Leaf (class)']);
});

test('the root package carries its own key, inferred parents do not', () => {
  const tree = buildPackageTree([
    pkg('OU_JET_PACK', 'OU_JET_PACK', '.'),
    cls('OU_JET_PACK', 'Layout', 'ComponentRegistry')
  ]);
  assert.ok(tree[0].key, 'the root package item should be openable');
  // Layout was never an item; it exists only because a class referenced it.
  assert.equal(tree[0].children[0].key, undefined);
  assert.ok(tree[0].children[0].children[0].key, 'the class should be openable');
});

test('a subpackage that is an item of the project is openable', () => {
  const tree = buildPackageTree([pkg('Layout', 'OU_JET_PACK', ':')]);
  assert.equal(tree[0].name, 'OU_JET_PACK');
  assert.equal(tree[0].children[0].name, 'Layout');
  assert.ok(tree[0].children[0].key);
});

test('two roots stay separate and are sorted', () => {
  const tree = buildPackageTree([
    cls('ZPACK', 'A', 'C'),
    cls('APACK', 'A', 'C')
  ]);
  assert.deepEqual(tree.map((n) => n.name), ['APACK', 'ZPACK']);
});

test('names differing only in case are one node, since PeopleTools is case-insensitive', () => {
  const tree = buildPackageTree([
    cls('OU_JET_PACK', 'Layout', 'Engine'),
    cls('ou_jet_pack', 'layout', 'Helper')
  ]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].children.length, 1);
  assert.equal(tree[0].children[0].children.length, 2);
});

test('only package and class types are folded into the tree', () => {
  assert.ok(isPackageItem(DefinitionType.ApplicationPackage));
  assert.ok(isPackageItem(DefinitionType.ApplicationClassPeopleCode));
  assert.ok(!isPackageItem(DefinitionType.Record));
  assert.ok(!isPackageItem(DefinitionType.RecordPeopleCode));
});
