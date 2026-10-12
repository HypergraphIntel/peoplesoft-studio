import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { documentFromRows, pcKeyOf, type MenuDocument, type MenuRows, type Row } from '../model/menuDocument.js';
import type { StoredProgram } from '../peoplecode/writeback/savePlan.js';
import type { StoredMenu } from '../providers/menuWriter.js';

/*
 * App Designer's menu saves, as captured on the lab VM
 * (tools/corpus/save-protocol/results, docs/MENUS.md): one menu's rows
 * before and after a save. Both capture formats (def-capture.mts,
 * snapshot.ts) keep each watched table as { columns, rows }.
 */

export const RESULTS = path.join('tools', 'corpus', 'save-protocol', 'results');

interface Watched { columns: { name: string }[]; rows: (string | null)[][] }

export function menuCaptureExists(caseName: string): boolean {
  return existsSync(path.join(RESULTS, caseName, 'after.json'));
}

const parsed = new Map<string, Record<string, Watched>>();
function watch(caseName: string, phase: 'before' | 'after'): Record<string, Watched> {
  const file = path.join(RESULTS, caseName, `${phase}.json`);
  let w = parsed.get(file);
  if (!w) {
    w = JSON.parse(readFileSync(file, 'utf8')).watch as Record<string, Watched>;
    parsed.set(file, w);
  }
  return w;
}

/** A watched table's rows as objects; menu tables and menu PeopleCode filtered to one menu (all menus when menu is undefined). */
export function rowsOf(caseName: string, phase: 'before' | 'after', table: string, menu?: string): Row[] {
  const t = watch(caseName, phase)[table];
  if (!t) return [];
  const rows = t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c.name, r[i]])) as Row);
  if (menu === undefined) return rows;
  return rows.filter((r) => ('MENUNAME' in r ? r.MENUNAME === menu : 'OBJECTVALUE1' in r ? r.OBJECTID1 === '3' && r.OBJECTVALUE1 === menu : true));
}

export function counters(caseName: string, phase: 'before' | 'after'): Record<string, number> {
  return Object.fromEntries(rowsOf(caseName, phase, 'PSVERSION').map((r) => [String(r.OBJECTTYPENAME).trim(), Number(r.VERSION)]));
}

export function menuRows(caseName: string, phase: 'before' | 'after', menu: string): MenuRows | undefined {
  const t = (table: string) => rowsOf(caseName, phase, table, menu);
  const [m] = t('PSMENUDEFN');
  if (!m) return undefined;
  return { menu: m, items: t('PSMENUITEM'), transfers: t('PSXFERITEM'), languages: t('PSMENUDEFNLANG'), itemLanguages: t('PSMENUITEMLANG'), origins: t('PSMENUORIGIN') };
}

export function capturedPeopleCode(caseName: string, phase: 'before' | 'after', menu: string): Map<string, StoredProgram> {
  const out = new Map<string, StoredProgram>();
  const entry = (r: Row) => {
    const values = [1, 2, 3, 4, 5, 6, 7].map((n) => String(r[`OBJECTVALUE${n}`]));
    const k = pcKeyOf(values[1].trim(), values[2].trim());
    if (!out.has(k)) out.set(k, { key: { objectIds: [1, 2, 3, 4, 5, 6, 7].map((n) => Number(r[`OBJECTID${n}`])), objectValues: values }, text: [], program: [], names: [] });
    return out.get(k)!;
  };
  for (const r of rowsOf(caseName, phase, 'PSPCMTXT', menu)) entry(r).text.push({ progseq: Number(r.PROGSEQ), text: String(r.PCTEXT), hashSignature: String(r.HASH_SIGNATURE) });
  for (const r of rowsOf(caseName, phase, 'PSPCMPROG', menu)) {
    entry(r).program.push({
      progseq: Number(r.PROGSEQ), version: Number(r.VERSION), namecount: Number(r.NAMECOUNT), proglen: Number(r.PROGLEN), progrunloc: Number(r.PROGRUNLOC),
      progflags: Number(r.PROGFLAGS), licenseCode: String(r.LICENSE_CODE), lastupddttm: String(r.LASTUPDDTTM), lastupdoprid: String(r.LASTUPDOPRID),
      progextends: String(r.PROGEXTENDS), pttoolsrel: String(r.PTTOOLSREL), bytes: Buffer.from(String(r.PROGTXT), 'hex')
    });
  }
  for (const r of rowsOf(caseName, phase, 'PSPCMNAME', menu)) {
    entry(r).names.push({ namenum: Number(r.NAMENUM), recname: String(r.RECNAME), refname: String(r.REFNAME), packageroot: String(r.PACKAGEROOT), qualifypath: String(r.QUALIFYPATH), appclassmethod: String(r.APPCLASSMETHOD) });
  }
  return out;
}

const sourceOf = (p: StoredProgram) => [...p.text].sort((a, b) => a.progseq - b.progseq).map((t) => t.text).join('');

/** The menu as stored on one side of a capture (exists false when it has no row there; its tombstones are still read). */
export function storedMenu(caseName: string, phase: 'before' | 'after', menu: string): StoredMenu {
  const rows = menuRows(caseName, phase, menu);
  const tombstones = { menu: rowsOf(caseName, phase, 'PSMENUDEL', menu), peopleCode: rowsOf(caseName, phase, 'PSPCMPROGDEL', menu) };
  if (!rows) return { exists: false, rows: { menu: {}, items: [], transfers: [], languages: [], itemLanguages: [], origins: [] }, peopleCode: new Map(), tombstones, group: [] };
  const g = String(rows.menu.MENUGROUP).trim();
  const group = g ? rowsOf(caseName, phase, 'PSMENUDEFN').filter((r) => r.MENUNAME !== menu && String(r.MENUGROUP).trim() === g && r.MENUTYPE === '0') : [];
  return { exists: true, rows, peopleCode: capturedPeopleCode(caseName, phase, menu), tombstones, group };
}

export function storedDocument(s: StoredMenu): MenuDocument {
  return documentFromRows(s.rows, new Map([...s.peopleCode].map(([k, p]) => [k, sourceOf(p)])));
}

/**
 * The edit a capture made, as a document: the menu after the save, its
 * bars and items carrying their stored identity before it (renames given
 * as hints: new key -> old key), new ones none.
 */
export function editedDocument(caseName: string, menu: string, hints: { items?: Record<string, string>; bars?: Record<string, string> } = {}): MenuDocument {
  const after = storedDocument(storedMenu(caseName, 'after', menu));
  const before = storedMenu(caseName, 'before', menu);
  const had = new Set(before.rows.items.map((r) => `${String(r.BARNAME).trim()}|${String(r.ITEMNAME).trim()}`));
  const hadBars = new Set(before.rows.items.map((r) => String(r.BARNAME).trim()));
  for (const bar of after.bars) {
    const oldBar = hints.bars?.[bar.name] ?? bar.name;
    if (hadBars.has(oldBar)) bar.origin = oldBar; else delete bar.origin;
    for (const it of bar.items) {
      const hinted = hints.items?.[`${bar.name}|${it.name}`];
      const old = hinted ?? `${oldBar}|${it.name}`;
      if (had.has(old)) { const [b, i] = old.split('|'); it.origin = { bar: b, item: i }; } else delete it.origin;
    }
  }
  if (!before.exists) {
    for (const bar of after.bars) { delete bar.origin; for (const it of bar.items) delete it.origin; }
  }
  return after;
}
