import { DefinitionKey, DefinitionType } from './definitions.js';

/**
 * The application package hierarchy.
 *
 * App Designer presents application packages as a tree — root package,
 * subpackages, then classes as leaves — and the flat key list has to be folded
 * back into that shape.
 *
 * Two item types contribute, keyed differently:
 *
 * - A package (type 57) is keyed `[PackageId, PackageRoot, QualifyPath]`. A
 *   QualifyPath of `.` marks the root package itself, where the id repeats the
 *   root. Otherwise the path names the parent chain and the id is the
 *   subpackage, so `[Layout, OU_JET_PACK, :]` is `OU_JET_PACK:Layout`.
 *
 * - A class (type 58) is keyed `[PackageRoot, QualifyPath, ClassId]`, where
 *   QualifyPath is the colon-separated chain of subpackages below the root.
 *   When ClassId is blank the class sits directly in the root package and its
 *   name is in the QualifyPath slot instead — `[OU_JET_PACK, ROADMAP, ]` is
 *   the class `OU_JET_PACK:ROADMAP`.
 *
 * Interior nodes are created for any path segment referenced by a class even
 * when the package itself is not an item of the project, so a class is never
 * hidden because its package was not included in the export.
 */
export interface PackageNode {
  name: string;
  kind: 'package' | 'class';
  /** Set for classes, and for packages that are items in their own right. */
  key?: DefinitionKey;
  children: PackageNode[];
}

export interface PackageItem {
  key: DefinitionKey;
}

export function buildPackageTree(items: readonly PackageItem[]): PackageNode[] {
  const roots = new Map<string, PackageNode>();

  const rootNode = (name: string): PackageNode => {
    const existing = roots.get(name.toUpperCase());
    if (existing) return existing;
    const created: PackageNode = { name, kind: 'package', children: [] };
    roots.set(name.toUpperCase(), created);
    return created;
  };

  const childNode = (
    parent: PackageNode, name: string, kind: PackageNode['kind']
  ): PackageNode => {
    const existing = parent.children.find(
      (c) => c.name.toUpperCase() === name.toUpperCase() && c.kind === kind);
    if (existing) return existing;
    const created: PackageNode = { name, kind, children: [] };
    parent.children.push(created);
    return created;
  };

  const descend = (root: PackageNode, path: readonly string[]): PackageNode =>
    path.reduce((node, segment) => childNode(node, segment, 'package'), root);

  for (const item of items) {
    const parts = item.key.parts;

    if (item.key.type === DefinitionType.ApplicationPackage) {
      const [id, root, qualify] = [parts[0] ?? '', parts[1] ?? '', parts[2] ?? ''];
      if (!root) continue;
      const node = rootNode(root);
      // "." marks the root package itself; the id just repeats the root name.
      if (qualify === '.' || id.toUpperCase() === root.toUpperCase()) {
        node.key = item.key;
      } else {
        descend(node, splitPath(qualify).concat(id)).key = item.key;
      }
      continue;
    }

    if (item.key.type === DefinitionType.ApplicationClassPeopleCode) {
      const [root, qualify, classId] = [parts[0] ?? '', parts[1] ?? '', parts[2] ?? ''];
      if (!root) continue;
      const node = rootNode(root);
      // A blank class slot means the class sits in the root package and its
      // name is in the qualify slot.
      const className = classId || qualify;
      const path = classId ? splitPath(qualify) : [];
      if (!className) continue;
      childNode(descend(node, path), className, 'class').key = item.key;
    }
  }

  const sorted = [...roots.values()];
  for (const root of sorted) sortNode(root);
  return sorted.sort(byName);
}

/** Splits a qualify path on colons, dropping the empty segments that mark "no path". */
function splitPath(qualify: string): string[] {
  if (qualify === '' || qualify === ':' || qualify === '.') return [];
  return qualify.split(':').filter((s) => s.length > 0);
}

/** Packages before classes, then alphabetical — the order App Designer uses. */
function byName(a: PackageNode, b: PackageNode): number {
  if (a.kind !== b.kind) return a.kind === 'package' ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

function sortNode(node: PackageNode): void {
  node.children.sort(byName);
  for (const child of node.children) sortNode(child);
}

/** True for the item types that belong in the package tree rather than a flat list. */
export function isPackageItem(type: DefinitionType): boolean {
  return type === DefinitionType.ApplicationPackage
    || type === DefinitionType.ApplicationClassPeopleCode;
}
