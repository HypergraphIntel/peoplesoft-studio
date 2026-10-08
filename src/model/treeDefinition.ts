/*
 * Trees (PSTREEDEFN and its node, leaf and level tables; HRDMO, PeopleTools
 * 8.62; docs/TREES.md), as a read-only text view: the tree's settings in
 * PSXLATITEM's words, its levels, then its nodes as an outline with their
 * detail ranges.
 */

export type Row = Record<string, unknown>;

const str = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => Number(v ?? 0);
const stamp = (r: Row) => str(r.LASTUPD) || str(r.LASTUPDDTTM);

/** The coded PSTREEDEFN / PSTREESTRCT columns, each a PSXLATITEM field. */
export const TREE_TRANSLATE_FIELDS = ['EFF_STATUS', 'USE_LEVELS', 'VALID_TREE', 'TREE_ACC_METHOD', 'TREE_ACC_SELECTOR', 'TREE_ACC_SEL_OPT', 'TREE_STRCT_TYPE'];

export interface TreeView {
  tree: Row;
  structure: Row | undefined;
  levels: Row[];
  nodes: Row[];
  leaves: Row[];
  translates: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

export function renderTree(view: TreeView): string {
  const t = view.tree;
  const xlat = (row: Row | undefined, field: string) => {
    const value = str(row?.[field]);
    return view.translates.get(field)?.get(value) ?? value;
  };
  const out: string[] = [];
  const setid = str(t.SETID);
  out.push(`Tree ${str(t.TREE_NAME)}${str(t.DESCR) ? ` -- ${str(t.DESCR)}` : ''}`);
  out.push(`  ${setid ? `SetID ${setid}   ` : ''}${str(t.SETCNTRLVALUE) ? `Set control ${str(t.SETCNTRLVALUE)}   ` : ''}Effective ${str(t.EFFDT_TEXT) || str(t.EFFDT)} (${xlat(t, 'EFF_STATUS')})` +
    `   ${xlat(t, 'VALID_TREE')}${str(t.TREE_CATEGORY) ? `   Category: ${str(t.TREE_CATEGORY)}` : ''}`);
  const s = view.structure;
  out.push(`  Structure: ${str(t.TREE_STRCT_ID)}${s ? ` (${xlat(s, 'TREE_STRCT_TYPE')}; nodes ${str(s.NODE_RECNAME)}.${str(s.NODE_FIELDNAME)}` +
    `${str(s.DTL_RECNAME) ? `, details ${str(s.DTL_RECNAME)}.${str(s.DTL_FIELDNAME)}` : ''})` : ''}`);
  out.push(`  Levels: ${xlat(t, 'USE_LEVELS')}   Nodes: ${num(t.NODE_COUNT)}   Leaves: ${num(t.LEAF_COUNT)}` +
    `   Access: ${['TREE_ACC_METHOD', 'TREE_ACC_SELECTOR', 'TREE_ACC_SEL_OPT'].filter((f) => str(t[f])).map((f) => xlat(t, f)).join(', ') || '(none)'}`);
  out.push(`  Version: ${num(t.VERSION)}   Last updated: ${stamp(t)} by ${str(t.LASTUPDOPRID)}`);
  if (view.levels.length) {
    out.push('', `  Levels: ${[...view.levels].sort((a, b) => num(a.TREE_LEVEL_NUM) - num(b.TREE_LEVEL_NUM))
      .map((l) => `${num(l.TREE_LEVEL_NUM)} ${str(l.TREE_LEVEL)}`).join(', ')}`);
  }
  const levelName = new Map(view.levels.map((l) => [num(l.TREE_LEVEL_NUM), str(l.TREE_LEVEL)]));
  const children = new Map<number, Row[]>();
  for (const n of view.nodes) children.set(num(n.PARENT_NODE_NUM), [...(children.get(num(n.PARENT_NODE_NUM)) ?? []), n]);
  for (const list of children.values()) list.sort((a, b) => num(a.TREE_NODE_NUM) - num(b.TREE_NODE_NUM));
  const leavesOf = new Map<number, Row[]>();
  for (const l of view.leaves) leavesOf.set(num(l.TREE_NODE_NUM), [...(leavesOf.get(num(l.TREE_NODE_NUM)) ?? []), l]);
  const nodeNums = new Set(view.nodes.map((n) => num(n.TREE_NODE_NUM)));
  // Roots: nodes whose parent is not a node of the tree (PARENT_NODE_NUM 0 for the top).
  const roots = view.nodes.filter((n) => !nodeNums.has(num(n.PARENT_NODE_NUM))).sort((a, b) => num(a.TREE_NODE_NUM) - num(b.TREE_NODE_NUM));
  out.push('', '  Nodes');
  const seen = new Set<number>();
  const walk = (n: Row, depth: number) => {
    const id = num(n.TREE_NODE_NUM);
    if (seen.has(id)) return;
    seen.add(id);
    const pad = '  '.repeat(depth + 2);
    const level = levelName.get(num(n.TREE_LEVEL_NUM));
    out.push(`${pad}${str(n.TREE_NODE)}${level ? `  [${level}]` : ''}`);
    for (const l of (leavesOf.get(id) ?? []).sort((a, b) => str(a.RANGE_FROM).localeCompare(str(b.RANGE_FROM)))) {
      const from = str(l.RANGE_FROM);
      const to = str(l.RANGE_TO);
      const range = from === to || !to ? from : `${from} .. ${to}`;
      out.push(`${pad}  - ${str(l.DYNAMIC_RANGE) === 'Y' ? (range ? `${range}  (dynamic)` : '(dynamic range)') : range}`);
    }
    for (const c of children.get(id) ?? []) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return out.join('\n') + '\n';
}
