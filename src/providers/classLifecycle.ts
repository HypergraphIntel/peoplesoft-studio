import type { DbConnection as Connection, DbTypes } from '../db/connection.js';
import { canonical, hash, privacy, type Json } from '../changeReview/model.js';
import { savePeopleCode, readStoredProgram } from './peopleCodeWriter.js';
import { fingerprint } from '../peoplecode/writeback/savePlan.js';
import { createPackage, createSubpackage, createSubpackages, deleteClass, deletePackage, deleteSubpackages, savePackageProperties } from './packageWriter.js';

/*
 * Application Package and class lifecycle under Change Review (V15-1). Two checkpoint scopes:
 *
 *   app-class/1    one class: its PSAPPCLASSDEFN row, its PeopleCode (PSPCMPROG / PSPCMTXT / PSPCMNAME under its
 *                  seven-part key) and the package rows on its path. Null when the class row is absent.
 *   app-package/1  one root: every PSPACKAGEDEFN row of the root and its PSAPPCLASSDEFN rows. Null when the root row
 *                  is absent.
 *
 * Content excludes VERSION / LASTUPDDTTM / LASTUPDOPRID. Deletion markers (PSPCMPROGDEL, PSPACKAGEDEL) and the
 * class's own stamps bind the token, not the content: a deleted class or package reads as null, and re-creating
 * it clears its marker as App Designer does (c04, dl11). The package rows' stamps are left out of a class token,
 * since saving a sibling class restamps every package row (c06) without changing this class.
 *
 * Writes are the calibrated typed writers only -- class creation / source save (c04-c06), class deletion (dl09),
 * package creation (c03), subpackages (c05), Package Properties (pk01) and package deletion (dl04, dl05, dl10) --
 * run on the connection the caller gives, so a preview runs them with commit suppressed and rolls back, and an
 * application commits them once.
 */

export type ClassParts = readonly string[];
export interface LifecycleScope { scope: 'app-class/1' | 'app-package/1'; tables: Record<string, Record<string, Json>[]> }
export interface LifecycleRead { value: LifecycleScope | null; token: string; hash: string }

const STAMPS = new Set(['VERSION', 'LASTUPDDTTM', 'LASTUPDOPRID']);
const ID = /^[A-Za-z][A-Za-z0-9_]{0,29}$/;
const ROOT = /^[A-Z0-9_]{1,30}$/;

function cell(value: unknown): Json {
  if (Buffer.isBuffer(value)) return { nativeBinaryHex: value.toString('hex') };
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return value;
  throw new Error('Unsupported native value in a package checkpoint.');
}
const sorted = (rows: Record<string, Json>[]) => rows.sort((a, b) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0);

/** Every column of the rows `where` selects, timestamps as nine-digit text and LOBs in full. */
async function rows(c: Connection, types: DbTypes, table: string, where: string, binds: Record<string, unknown>): Promise<Record<string, Json>[]> {
  const columns = await c.catalog.columns(c, table);
  if (!columns.length || columns.some(col => !/^[A-Z][A-Z0-9_]*$/.test(col.name) || /TIME ZONE/.test(col.dataType))) throw new Error('Missing or unsupported native table: ' + table);
  const projection = columns.map(col => /^(DATE|TIMESTAMP)/.test(col.dataType) ? `TO_CHAR(CAST(${col.name} AS TIMESTAMP(9)), 'YYYY-MM-DD"T"HH24:MI:SS.FF9') AS ${col.name}` : col.name).join(', ');
  const fetchInfo = Object.fromEntries(columns.filter(col => /CLOB/.test(col.dataType)).map(col => [col.name, { type: types.STRING }]));
  const found = (await c.execute<Record<string, unknown>>(`SELECT ${projection} FROM ${table} WHERE ${where}`, binds, { outFormat: types.OUT_FORMAT_OBJECT, fetchInfo })).rows ?? [];
  return sorted(found.map(r => Object.fromEntries(columns.map(col => [col.name, cell(r[col.name])]))));
}
const content = (rs: Record<string, Json>[]) => sorted(rs.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !STAMPS.has(k)))));

/** A class key's parts: root, up to two subpackages, class. */
export function classKey(parts: unknown): { root: string; path: string[]; className: string } {
  if (!Array.isArray(parts) || parts.length < 2 || parts.length > 4 || parts.some(p => typeof p !== 'string')) throw new Error('A class key is [root, subpackage..., class].');
  const [root, ...rest] = parts as string[], className = rest.pop()!;
  if (!ROOT.test(root) || [...rest, className].some(id => !ID.test(id))) throw new Error('Invalid Application Package or class name.');
  return { root, path: rest, className };
}
const programKey = (k: ReturnType<typeof classKey>) => {
  const ids = [104, ...k.path.map((_, i) => 105 + i), 107, 12], values = [k.root, ...k.path, k.className, 'OnExecute'];
  return { where: ids.map((id, i) => `OBJECTID${i + 1} = ${id} AND OBJECTVALUE${i + 1} = :v${i + 1}`).join(' AND ') + (ids.length < 7 ? ` AND OBJECTID${ids.length + 1} = 0` : ''),
    binds: Object.fromEntries(values.map((v, i) => ['v' + (i + 1), v])), parts: values };
};
const qualify = (path: readonly string[]) => (path.length ? path.join(':') : ':');

export async function readClassScope(c: Connection, types: DbTypes, parts: ClassParts): Promise<LifecycleRead> {
  const k = classKey(parts), pk = programKey(k);
  const cls = await rows(c, types, 'PSAPPCLASSDEFN', 'PACKAGEROOT = :r AND QUALIFYPATH = :q AND APPCLASSID = :k', { r: k.root, q: qualify(k.path), k: k.className });
  const code: Record<string, Record<string, Json>[]> = {};
  for (const table of ['PSPCMPROG', 'PSPCMTXT', 'PSPCMNAME']) code[table] = await rows(c, types, table, pk.where, pk.binds);
  const marker = await rows(c, types, 'PSPCMPROGDEL', pk.where, pk.binds);
  // The package rows on the class's path: the root, then each subpackage.
  const path = [await rows(c, types, 'PSPACKAGEDEFN', `PACKAGEROOT = :r AND PACKAGEID = :r AND QUALIFYPATH = '.'`, { r: k.root })];
  for (let level = 1; level <= k.path.length; level++) {
    path.push(await rows(c, types, 'PSPACKAGEDEFN', 'PACKAGEROOT = :r AND PACKAGEID = :p AND QUALIFYPATH = :q', { r: k.root, p: k.path[level - 1], q: level === 1 ? ':' : k.path.slice(0, level - 1).join(':') }));
  }
  const packages = path.flat();
  if (!cls.length && Object.values(code).some(r => r.length)) throw new Error(`${parts.join(':')} has PeopleCode without its class row; this native state is not reviewed.`);
  const value: LifecycleScope | null = cls.length ? { scope: 'app-class/1', tables: { PSAPPCLASSDEFN: content(cls), PSPCMPROG: content(code.PSPCMPROG), PSPCMTXT: content(code.PSPCMTXT),
    PSPCMNAME: content(code.PSPCMNAME), PSPACKAGEDEFN: content(packages) } } : null;
  if (value) { privacy(value as unknown as Json); if (Buffer.byteLength(canonical(value as unknown as Json)) > 8 * 1024 * 1024) throw new Error('Class checkpoint exceeds 8 MiB.'); }
  return { value, hash: hash(value as unknown as Json), token: hash({ cls, code, marker, packages: content(packages) } as unknown as Json) };
}

export async function readPackageScope(c: Connection, types: DbTypes, root: string): Promise<LifecycleRead> {
  if (!ROOT.test(root)) throw new Error('Invalid Application Package name.');
  const packages = await rows(c, types, 'PSPACKAGEDEFN', 'PACKAGEROOT = :r', { r: root });
  const classes = await rows(c, types, 'PSAPPCLASSDEFN', 'PACKAGEROOT = :r', { r: root });
  const marker = await rows(c, types, 'PSPACKAGEDEL', 'PACKAGEROOT = :r', { r: root });
  const head = packages.some(p => String(p.PACKAGEID).trim() === root && String(p.QUALIFYPATH).trim() === '.');
  if (!head && (packages.length || classes.length)) throw new Error(`${root} has package rows without its root; this native state is not reviewed.`);
  const value: LifecycleScope | null = head ? { scope: 'app-package/1', tables: { PSPACKAGEDEFN: content(packages), PSAPPCLASSDEFN: content(classes) } } : null;
  return { value, hash: hash(value as unknown as Json), token: hash({ packages, classes, marker } as unknown as Json) };
}

/** A class's source as its checkpoint stores it (PSPCMTXT in PROGSEQ order). */
export function classSource(value: LifecycleScope): string {
  return [...value.tables.PSPCMTXT].sort((a, b) => Number(a.PROGSEQ) - Number(b.PROGSEQ)).map(r => String(r.PCTEXT ?? '')).join('');
}

/**
 * The typed writer for a reviewed class change from the live state to `after`: create (the PeopleCode writer's new
 * class, c04), delete (dl09) or save the source (c06). A new class's subpackages must exist already: deleting the class
 * again leaves a subpackage behind (App Designer keeps it), so an exact undo could not exist.
 */
export async function writeClassChange(c: Connection, types: DbTypes, parts: ClassParts, live: LifecycleScope | null, after: LifecycleScope | null, operatorId: string): Promise<void> {
  const k = classKey(parts), pk = programKey(k);
  if (!live && !after) throw new Error('A class change needs a class before or after.');
  if (after && (after.scope !== 'app-class/1' || after.tables.PSAPPCLASSDEFN.length !== 1)) throw new Error('Invalid class checkpoint.');
  if (!after) {
    const [head] = await rows(c, types, 'PSPACKAGEDEFN', `PACKAGEROOT = :r AND PACKAGEID = :r AND QUALIFYPATH = '.'`, { r: k.root });
    await deleteClass(c, { root: k.root, path: k.path, className: k.className, openedVersion: Number(head?.VERSION ?? -1), operatorId });
    return;
  }
  const row = after.tables.PSAPPCLASSDEFN[0];
  if (String(row.APPCLASSREF ?? ' ').trim() || String(row.DESCR ?? ' ').trim()) throw new Error('Class description and reference have no calibrated writer; this class is not reviewed.');
  if (!live) {
    const levels = await rows(c, types, 'PSPACKAGEDEFN', 'PACKAGEROOT = :r', { r: k.root });
    for (let level = 1; level <= k.path.length; level++) {
      const q = level === 1 ? ':' : k.path.slice(0, level - 1).join(':');
      if (!levels.some(p => String(p.PACKAGEID).trim() === k.path[level - 1] && String(p.QUALIFYPATH).trim() === q)) throw new Error(`Create subpackage ${[k.root, ...k.path.slice(0, level)].join(':')} first (psft_create_package with that path), then stage the class: undoing this class would leave the subpackage behind.`);
    }
  }
  const stored = await readStoredProgram(c, types, pk.parts, false);
  await savePeopleCode(c, types, pk.parts, { source: classSource(after), openedFingerprint: fingerprint(stored), operatorId,
    objectIds: [104, ...k.path.map((_, i) => 105 + i), 107, 12], ...(live ? {} : { createClass: true }) });
}

/**
 * An existing package whose only change is subpackages added, or subpackages removed (not both): the root row, the other
 * subpackages and the classes are as they were (stamps aside). Added subpackages are App Designer's new rows (PACKAGEREF,
 * DESCR ' ', no DESCRLONG; an owner ID may be set); a removed parent takes its children with it. Anything else is refused.
 */
export function subpackageChange(root: string, live: LifecycleScope, after: LifecycleScope) {
  if (after.scope !== 'app-package/1' || live.scope !== 'app-package/1') throw new Error('Invalid package checkpoint.');
  if (canonical(content(live.tables.PSAPPCLASSDEFN) as unknown as Json) !== canonical(content(after.tables.PSAPPCLASSDEFN) as unknown as Json)) {
    throw new Error('A package change here adds or removes subpackages only; classes are their own reviewed objects.');
  }
  const id = (r: Record<string, Json>) => String(r.QUALIFYPATH).trim() + '|' + String(r.PACKAGEID).trim();
  const before = new Map(content(live.tables.PSPACKAGEDEFN).map(r => [id(r), r])), next = new Map(content(after.tables.PSPACKAGEDEFN).map(r => [id(r), r]));
  for (const [k, r] of next) if (before.has(k) && canonical(before.get(k)!) !== canonical(r)) throw new Error('Existing package and subpackage properties are not reviewed here.');
  const pathOf = (r: Record<string, Json>) => Number(r.PACKAGELEVEL) === 1 ? [String(r.PACKAGEID).trim()] : [String(r.QUALIFYPATH).trim(), String(r.PACKAGEID).trim()];
  const addedRows = [...next].filter(([k]) => !before.has(k)).map(([, r]) => r), removedRows = [...before].filter(([k]) => !next.has(k)).map(([, r]) => r);
  if (addedRows.length && removedRows.length) throw new Error('Add subpackages and remove others in separate changes.');
  if (!addedRows.length && !removedRows.length) throw new Error('The proposal has no changes.');
  for (const r of [...addedRows, ...removedRows]) {
    if (String(r.PACKAGEROOT).trim() !== root || ![1, 2].includes(Number(r.PACKAGELEVEL))) throw new Error('A subpackage row is outside this package.');
    const level = Number(r.PACKAGELEVEL), q = String(r.QUALIFYPATH).trim();
    if (level === 1 ? q !== ':' : !/^[A-Za-z][A-Za-z0-9_]{0,29}$/.test(q)) throw new Error('A subpackage row has an unexpected QUALIFYPATH.');
  }
  for (const r of addedRows) {
    if (String(r.PACKAGEREF ?? ' ').trim() || String(r.DESCR ?? ' ').trim() || r.DESCRLONG !== null) throw new Error('Subpackage descriptions, comments and package references have no calibrated writer.');
    if (Number(r.PACKAGELEVEL) === 2 && !next.has(':|' + String(r.QUALIFYPATH).trim())) throw new Error('A new level-2 subpackage needs its parent.');
  }
  // A removed parent takes its children (App Designer: "Delete Package ... and all its children"), so none may stay.
  for (const r of removedRows) if (Number(r.PACKAGELEVEL) === 1 && [...next.values()].some(x => Number(x.PACKAGELEVEL) === 2 && String(x.QUALIFYPATH).trim() === String(r.PACKAGEID).trim())) {
    throw new Error(`Removing ${root}:${String(r.PACKAGEID).trim()} removes its subpackages too.`);
  }
  return { added: addedRows.map(r => ({ path: pathOf(r), ownerId: String(r.OBJECTOWNERID ?? ' ').trim() })), removed: removedRows.map(pathOf) };
}

/**
 * The typed writers for a reviewed package change: create the root (c03), its subpackages (c05) and Package Properties
 * (pk01); or delete an empty package (dl04). Classes are their own reviewed objects: a package with classes is not
 * deleted here, and an existing package is changed only through its classes.
 */
export async function writePackageChange(c: Connection, types: DbTypes, root: string, live: LifecycleScope | null, after: LifecycleScope | null, operatorId: string): Promise<void> {
  if (live && after) {
    const change = subpackageChange(root, live, after);
    const [head] = await rows(c, types, 'PSPACKAGEDEFN', `PACKAGEROOT = :r AND PACKAGEID = :r AND QUALIFYPATH = '.'`, { r: root });
    const openedVersion = Number(head?.VERSION ?? -1);
    if (change.added.length) await createSubpackages(c, { root, paths: change.added.map(a => a.path), openedVersion, operatorId,
      ownerIds: Object.fromEntries(change.added.filter(a => a.ownerId).map(a => [a.path.join(':'), a.ownerId])) });
    else await deleteSubpackages(c, { root, paths: change.removed, openedVersion, operatorId });
    return;
  }
  if (!after) {
    if (live!.tables.PSAPPCLASSDEFN.length) throw new Error(`${root} still has classes: stage their deletion first.`);
    const [head] = await rows(c, types, 'PSPACKAGEDEFN', `PACKAGEROOT = :r AND PACKAGEID = :r AND QUALIFYPATH = '.'`, { r: root });
    await deletePackage(c, { root, openedVersion: Number(head?.VERSION ?? -1), operatorId });
    return;
  }
  if (after.scope !== 'app-package/1' || after.tables.PSAPPCLASSDEFN.length) throw new Error('A new package is created without classes; add them as their own reviewed objects.');
  const packages = after.tables.PSPACKAGEDEFN, head = packages.find(p => String(p.PACKAGEID).trim() === root && String(p.QUALIFYPATH).trim() === '.');
  if (!head || packages.some(p => String(p.PACKAGEREF ?? ' ').trim() || p !== head && (String(p.DESCR ?? ' ').trim() || p.DESCRLONG !== null))) {
    throw new Error('Subpackage descriptions, comments and package references have no calibrated writer; this package is not reviewed.');
  }
  await createPackage(c, { name: root, operatorId });
  const path = (p: Record<string, Json>) => [...String(p.QUALIFYPATH).trim().split(':').filter(s => s), String(p.PACKAGEID).trim()];
  for (const sub of packages.filter(p => p !== head).sort((a, b) => Number(a.PACKAGELEVEL) - Number(b.PACKAGELEVEL))) {
    const [now] = await rows(c, types, 'PSPACKAGEDEFN', `PACKAGEROOT = :r AND PACKAGEID = :r AND QUALIFYPATH = '.'`, { r: root });
    const ownerId = String(sub.OBJECTOWNERID ?? ' ').trim();
    await createSubpackage(c, { root, path: path(sub), openedVersion: Number(now.VERSION), operatorId, ...(ownerId ? { ownerId } : {}) });
  }
  if (String(head.DESCR ?? ' ').trim() || String(head.OBJECTOWNERID ?? ' ').trim() || head.DESCRLONG !== null) {
    const [now] = await rows(c, types, 'PSPACKAGEDEFN', `PACKAGEROOT = :r AND PACKAGEID = :r AND QUALIFYPATH = '.'`, { r: root });
    await savePackageProperties(c, { root, openedVersion: Number(now.VERSION), description: String(head.DESCR ?? ' ').trimEnd(), comments: head.DESCRLONG === null ? '' : String(head.DESCRLONG),
      ownerId: String(head.OBJECTOWNERID ?? ' ').trim(), operatorId });
  }
}
