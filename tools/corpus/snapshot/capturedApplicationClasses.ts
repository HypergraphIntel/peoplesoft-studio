/*
 * Application Classes captured as TYPE METADATA only (Cycle 167): a class's
 * compiled program (PSPCMPROG) and reference list (PSPCMNAME), for classes
 * HCDEV holds no PeopleCode source for (PSPCMTXT) and the corpus therefore
 * does not contain. Decoded locally, the program yields the class header --
 * extends, properties, method signatures -- the type-metadata provider
 * reads. These classes are never corpus definitions: they are not encoded,
 * compared or counted.
 */
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

import { getLatestCompletedSnapshot } from './store';
import { decodeProgram } from '../../../src/peoplecode/decoder';
import { NameTable } from '../../../src/peoplecode/progtext';
import type { ApplicationClassDefinition } from '../../../src/peoplecode/applicationClassTypeMetadata';

export interface CapturedApplicationClass {
  /** Package and class names exactly as HCDEV keys them. */
  path: string[];
  /** PSPCMPROG.PROGTXT chunks in PROGSEQ order, concatenated. */
  program: Buffer;
  /** PSPCMNAME rows in NAMENUM order. */
  names: Array<{ namenum: number; recname: string; refname: string; packageroot?: string; qualifypath?: string; appclassmethod?: string }>;
}

/** The decoded class, as the provider's `{ path, source }`; undefined when the program does not decode. */
export function decodeCapturedApplicationClass(captured: CapturedApplicationClass): ApplicationClassDefinition | undefined {
  const names = new NameTable();
  for (const row of captured.names) {
    const rec = String(row.recname ?? '').trim(), ref = String(row.refname ?? '').trim();
    names.add(Number(row.namenum), rec && ref ? `${rec}.${ref}` : ref || rec);
  }
  try {
    const decoded = decodeProgram(captured.program, names, { mode: 'auto', isApplicationClass: true });
    if (decoded.unknownOpcodes.length > 0 || !/\b(class|interface)\s+\w+/i.test(decoded.text)) return undefined;
    return { path: captured.path, source: decoded.text };
  } catch {
    return undefined;
  }
}

export interface CapturedApplicationClassRow extends CapturedApplicationClass {
  key: Record<string, string | number>;
}

const KEYS = [1, 2, 3, 4, 5, 6, 7];
const NAME_COLUMNS = ['recname', 'refname', 'packageroot', 'qualifypath', 'appclassmethod'] as const;
const text = (value: unknown) => String(value ?? '');
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/** The latest completed snapshot's captured classes, ordered by class path. */
export function listSnapshotCapturedApplicationClasses(db: Database.Database): CapturedApplicationClassRow[] {
  const snapshot = getLatestCompletedSnapshot(db);
  if (!snapshot) return [];
  const classes = db.prepare(`
    SELECT * FROM snapshot_appclass_metadata WHERE snapshot_id = ? ORDER BY class_path
  `).all(snapshot.snapshotId) as Array<Record<string, any>>;
  const names = db.prepare(`
    SELECT * FROM snapshot_appclass_metadata_name WHERE snapshot_id = ? ORDER BY class_path, namenum
  `).all(snapshot.snapshotId) as Array<Record<string, any>>;
  const byClass = new Map<string, CapturedApplicationClass['names']>();
  for (const row of names) {
    const list = byClass.get(row.class_path) ?? [];
    byClass.set(row.class_path, list);
    list.push(row as any);
  }
  return classes.map(row => ({
    path: String(row.class_path).split(':'),
    key: Object.fromEntries(KEYS.flatMap(n => [[`OBJECTID${n}`, row[`objectid${n}`]], [`OBJECTVALUE${n}`, row[`objectvalue${n}`]]])),
    program: row.stored_program as Buffer,
    names: byClass.get(row.class_path) ?? []
  }));
}

/** One line per class: path, program and reference-list digests -- identical for identical captured content. */
export function capturedApplicationClassManifest(classes: CapturedApplicationClassRow[]): string[] {
  return [...classes]
    .sort((a, b) => a.path.join(':') < b.path.join(':') ? -1 : 1)
    .map(c => [
      c.path.join(':'),
      sha256(c.program),
      String(c.program.length),
      sha256(c.names.map(n => [n.namenum, ...NAME_COLUMNS.map(k => text((n as any)[k]))].join('\t')).join('\n')),
      String(c.names.length)
    ].join(' '));
}

/**
 * Replaces the latest completed snapshot's captured classes with `classes`,
 * in one transaction. Corpus definitions and their names are untouched; a
 * class the corpus holds a definition of is refused.
 */
export function importCapturedApplicationClasses(
  db: Database.Database,
  classes: CapturedApplicationClassRow[],
  provenance: { capturedAt: string; source: string }
): { snapshotId: number; classes: number; names: number; contentSha256: string } {
  const snapshot = getLatestCompletedSnapshot(db);
  if (!snapshot) throw new Error('No completed HCDEV corpus snapshot exists.');
  const corpus = db.prepare(`
    SELECT ${KEYS.map(n => `objectvalue${n}`).join(', ')} FROM snapshot_definition WHERE snapshot_id = ? AND objectid1 = 104
  `).all(snapshot.snapshotId) as Array<Record<string, string>>;
  const corpusClasses = new Set(corpus.map(row => {
    const values = KEYS.map(n => text(row[`objectvalue${n}`]).trim());
    const event = values.findIndex(value => value.toLowerCase() === 'onexecute');
    return values.slice(0, event < 0 ? values.length : event).filter(Boolean).join(':').toUpperCase();
  }));
  const sorted = [...classes].sort((a, b) => a.path.join(':') < b.path.join(':') ? -1 : 1);
  for (const c of sorted) {
    if (corpusClasses.has(c.path.join(':').toUpperCase())) throw new Error(`${c.path.join(':')} is a corpus definition`);
  }
  const contentSha256 = sha256(capturedApplicationClassManifest(sorted).join('\n'));
  const insertClass = db.prepare(`
    INSERT INTO snapshot_appclass_metadata (snapshot_id, class_path, ${KEYS.map(n => `objectid${n}, objectvalue${n}`).join(', ')}, stored_program, stored_program_sha256)
    VALUES (?, ?, ${KEYS.map(() => '?, ?').join(', ')}, ?, ?)
  `);
  const insertName = db.prepare(`
    INSERT INTO snapshot_appclass_metadata_name (snapshot_id, class_path, namenum, ${NAME_COLUMNS.join(', ')})
    VALUES (?, ?, ?, ${NAME_COLUMNS.map(() => '?').join(', ')})
  `);
  let names = 0;
  db.transaction(() => {
    db.prepare('DELETE FROM snapshot_appclass_metadata_capture WHERE snapshot_id = ?').run(snapshot.snapshotId);
    db.prepare('DELETE FROM snapshot_appclass_metadata_name WHERE snapshot_id = ?').run(snapshot.snapshotId);
    db.prepare('DELETE FROM snapshot_appclass_metadata WHERE snapshot_id = ?').run(snapshot.snapshotId);
    for (const c of sorted) {
      const classPath = c.path.join(':');
      insertClass.run(snapshot.snapshotId, classPath, ...KEYS.flatMap(n => [Number(c.key[`OBJECTID${n}`]), text(c.key[`OBJECTVALUE${n}`])]), c.program, sha256(c.program));
      for (const n of c.names) {
        insertName.run(snapshot.snapshotId, classPath, Number(n.namenum), ...NAME_COLUMNS.map(k => text((n as any)[k])));
        names++;
      }
    }
    db.prepare(`
      INSERT INTO snapshot_appclass_metadata_capture (snapshot_id, captured_at, imported_at, source, class_count, name_row_count, content_sha256)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(snapshot.snapshotId, provenance.capturedAt, new Date().toISOString(), provenance.source, sorted.length, names, contentSha256);
  })();
  return { snapshotId: snapshot.snapshotId, classes: sorted.length, names, contentSha256 };
}
