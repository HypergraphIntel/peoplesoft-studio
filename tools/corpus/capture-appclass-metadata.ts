/*
 * Application Classes as TYPE METADATA for classes the corpus does not
 * hold (Cycle 167).
 *
 * The corpus's Application Classes are the 1,510 HCDEV holds PeopleCode
 * source for (PSPCMTXT); HCDEV holds about 13,945 compiled ones
 * (PSPCMPROG), most with no source text at all (PTWIDGETS,
 * HR_TEXT_CATALOG, WCS_* ...). Their class header -- extends, properties,
 * method signatures -- is in the compiled program and decodes locally, so
 * a class's PSPCMPROG + PSPCMNAME rows are its metadata.
 *
 *   capture   (live HCDEV, SELECT only) the listed classes, and with
 *             `--transitive` every class their headers name (extends,
 *             property / method / parameter types, named imports; short
 *             names resolved in the class's own and wildcard-imported
 *             packages), to a fixed point, into a JSON file. Corpus
 *             classes are never captured: they carry source.
 *     npx tsx tools/corpus/capture-appclass-metadata.ts --paths <file> --out <json> [--transitive]
 *   import    (offline) a capture JSON into the local snapshot's
 *             snapshot_appclass_metadata tables, replacing what is there.
 *     npx tsx tools/corpus/capture-appclass-metadata.ts --import <json>
 *   manifest  (offline) the snapshot's captured classes, one line each:
 *             path, program sha256 / length, name rows sha256 / count;
 *             --check-manifest compares them with a committed manifest.
 *     npx tsx tools/corpus/capture-appclass-metadata.ts --manifest [<out>]
 *     npx tsx tools/corpus/capture-appclass-metadata.ts --check-manifest tools/corpus/appclass-metadata/manifest.txt
 *
 * `<file>`: one class path per line (`PKG:Sub:Class`, any case); `#`
 * comments allowed. Paths already in the output are kept, not refetched.
 */
import fs from 'node:fs';
import oracledb from 'oracledb';

import { getConnectionConfig, openCorpusConnection } from './discovery';
import {
  capturedApplicationClassManifest,
  decodeCapturedApplicationClass,
  importCapturedApplicationClasses,
  listSnapshotCapturedApplicationClasses
} from './snapshot/capturedApplicationClasses';
import { listSnapshotApplicationClassDefinitions } from './snapshot/applicationClassTypeMetadata';
import { openSnapshotDatabase } from './snapshot/store';
import { maskNonCode, parseApplicationClassSource } from '../../src/peoplecode/applicationClassProgram';

export interface CapturedApplicationClassProgram {
  /** Package and class names exactly as HCDEV keys them. */
  path: string[];
  key: Record<string, string | number>;
  /** PSPCMPROG.PROGTXT chunks in PROGSEQ order, concatenated, hex. */
  program: string;
  /** PSPCMNAME rows in NAMENUM order, lower-cased column names. */
  names: Record<string, unknown>[];
  capturedAt: string;
  source: 'HCDEV SYSADM.PSPCMPROG + SYSADM.PSPCMNAME (read-only)';
}

export interface ApplicationClassCaptureFile {
  captured: CapturedApplicationClassProgram[];
  /** Requested paths HCDEV has no compiled program for. */
  absent: string[];
}

const KEY_COUNT = 7;

async function blobToBuffer(value: unknown): Promise<Buffer> {
  if (value === null || value === undefined) return Buffer.alloc(0);
  if (Buffer.isBuffer(value)) return value;
  const chunks: Buffer[] = [];
  for await (const chunk of value as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function keyPath(row: Record<string, unknown>): string[] {
  const values: string[] = [];
  for (let i = 1; i <= KEY_COUNT; i++) {
    const value = String(row[`OBJECTVALUE${i}`] ?? '').trim();
    if (value.toLowerCase() === 'onexecute') break;
    if (value !== '') values.push(value);
  }
  return values;
}

function keyPredicate(key: Record<string, unknown>, binds: Record<string, unknown>): string {
  const parts: string[] = [];
  for (let i = 1; i <= KEY_COUNT; i++) {
    parts.push(`OBJECTID${i} = :id${i}`, `OBJECTVALUE${i} = :value${i}`);
    binds[`id${i}`] = key[`OBJECTID${i}`];
    binds[`value${i}`] = key[`OBJECTVALUE${i}`];
  }
  return parts.join(' AND ');
}

const keysByRoot = new Map<string, Record<string, unknown>[]>();

/** Every compiled Application Class key under one package root. */
async function packageKeys(connection: oracledb.Connection, root: string): Promise<Record<string, unknown>[]> {
  const cached = keysByRoot.get(root.toUpperCase());
  if (cached !== undefined) return cached;
  const keys = await connection.execute(
    `SELECT DISTINCT ${Array.from({ length: KEY_COUNT }, (_, i) => `OBJECTID${i + 1}, OBJECTVALUE${i + 1}`).join(', ')}
       FROM SYSADM.PSPCMPROG
      WHERE OBJECTID1 = 104 AND OBJECTVALUE1 = :root`,
    { root: root.toUpperCase() },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  const rows = (keys.rows ?? []) as Record<string, unknown>[];
  keysByRoot.set(root.toUpperCase(), rows);
  return rows;
}

/** The class paths a captured class's header names, as written (full paths) or resolved among live keys (short names). */
export async function referencedClassPaths(connection: oracledb.Connection, captured: CapturedApplicationClassProgram): Promise<string[]> {
  const decoded = decodeCapturedApplicationClass({ path: captured.path, program: Buffer.from(captured.program, 'hex'), names: captured.names as any });
  if (decoded === undefined) return [];
  const parsed = parseApplicationClassSource(decoded.source);
  if (parsed === undefined) return [];
  const masked = maskNonCode(decoded.source);
  const header = masked.slice(0, parsed.unitEnd);
  const found = new Set<string>();
  const wildcardPackages = [captured.path.slice(0, -1).join(':')];
  for (const m of header.matchAll(/\bimport\s+([\w:]+?)(:\*)?\s*;/gi)) {
    if (/^%/.test(m[1])) continue;
    if (m[2]) wildcardPackages.push(m[1]); else found.add(m[1]);
  }
  const typed = header.slice(parsed.unitStart);
  for (const m of typed.matchAll(/(?<![%\w:])[A-Za-z_]\w*(?:\s*:\s*[A-Za-z_]\w*)+\b/g)) found.add(m[0].replace(/\s+/g, ''));
  const shortNames = new Set<string>();
  for (const m of typed.matchAll(/\b(?:extends|implements|as|of|property|method\s+\w+\s*\([^)]*\)\s*returns)\s+([A-Za-z_]\w*)\b(?!\s*:)/gi)) shortNames.add(m[1]);
  for (const m of typed.matchAll(/\bproperty\s+(?:array\s+of\s+)*([A-Za-z_]\w*)\s+\w+/gi)) shortNames.add(m[1]);
  for (const m of typed.matchAll(/\breturns\s+(?:array\s+of\s+)*([A-Za-z_]\w*)\b(?!\s*:)/gi)) shortNames.add(m[1]);
  for (const name of shortNames) {
    for (const packagePath of wildcardPackages) {
      const keys = await packageKeys(connection, packagePath.split(':')[0]);
      const hit = keys.find(row => keyPath(row).join(':').toLowerCase() === `${packagePath}:${name}`.toLowerCase());
      if (hit !== undefined) found.add(keyPath(hit).join(':'));
    }
  }
  return [...found].filter(p => p.toLowerCase() !== captured.path.join(':').toLowerCase());
}

export async function captureApplicationClassPrograms(
  connection: oracledb.Connection,
  requested: string[],
  existing: ApplicationClassCaptureFile = { captured: [], absent: [] }
): Promise<ApplicationClassCaptureFile> {
  const done = new Set(existing.captured.map(c => c.path.join(':').toLowerCase()));
  const wanted = [...new Map(requested.map(p => p.trim()).filter(p => p !== '' && !done.has(p.toLowerCase())).map(p => [p.toLowerCase(), p])).values()];
  const byRoot = new Map<string, string[]>();
  for (const path of wanted) {
    const root = path.split(':')[0].toUpperCase();
    byRoot.set(root, [...(byRoot.get(root) ?? []), path]);
  }
  const captured = [...existing.captured];
  const absent = new Set(existing.absent.filter(p => !wanted.some(w => w.toLowerCase() === p.toLowerCase())));
  for (const [root, paths] of byRoot) {
    const candidates = await packageKeys(connection, root);
    for (const path of paths) {
      const key = candidates.find(row => keyPath(row).join(':').toLowerCase() === path.toLowerCase());
      if (key === undefined) { absent.add(path); continue; }
      if (done.has(keyPath(key).join(':').toLowerCase())) continue;
      done.add(keyPath(key).join(':').toLowerCase());
      const programBinds: Record<string, unknown> = {};
      const program = await connection.execute(
        `SELECT PROGSEQ, PROGTXT FROM SYSADM.PSPCMPROG WHERE ${keyPredicate(key, programBinds)} ORDER BY PROGSEQ`,
        programBinds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const chunks: Buffer[] = [];
      for (const row of (program.rows ?? []) as Record<string, unknown>[]) chunks.push(await blobToBuffer(row.PROGTXT));
      const nameBinds: Record<string, unknown> = {};
      const names = await connection.execute(
        `SELECT * FROM SYSADM.PSPCMNAME WHERE ${keyPredicate(key, nameBinds)} ORDER BY NAMENUM`,
        nameBinds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      captured.push({
        path: keyPath(key),
        key: Object.fromEntries(Object.entries(key).map(([k, v]) => [k, typeof v === 'number' ? v : String(v ?? '')])),
        program: Buffer.concat(chunks).toString('hex'),
        names: ((names.rows ?? []) as Record<string, unknown>[]).map(row =>
          Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v instanceof Date ? v.toISOString() : v]))),
        capturedAt: new Date().toISOString(),
        source: 'HCDEV SYSADM.PSPCMPROG + SYSADM.PSPCMNAME (read-only)'
      });
    }
  }
  captured.sort((a, b) => a.path.join(':') < b.path.join(':') ? -1 : 1);
  return { captured, absent: [...absent].sort() };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const importFile = option('--import');
  if (importFile !== undefined) {
    const file: ApplicationClassCaptureFile = JSON.parse(fs.readFileSync(importFile, 'utf8'));
    const capturedAt = file.captured.map(c => c.capturedAt).sort().at(-1) ?? '';
    const result = importCapturedApplicationClasses(openSnapshotDatabase(), file.captured.map(c => ({
      path: c.path, key: c.key, program: Buffer.from(c.program, 'hex'), names: c.names as any
    })), { capturedAt, source: file.captured[0]?.source ?? '' });
    console.log(`snapshot ${result.snapshotId}: imported ${result.classes} classes, ${result.names} name rows; content sha256 ${result.contentSha256}`);
    return;
  }
  const checkFile = option('--check-manifest');
  if (checkFile !== undefined) {
    const expected = fs.readFileSync(checkFile, 'utf8').split('\n').filter(line => line.trim() !== '' && !line.startsWith('#'));
    const actual = capturedApplicationClassManifest(listSnapshotCapturedApplicationClasses(openSnapshotDatabase()));
    const missing = expected.filter(line => !actual.includes(line));
    const extra = actual.filter(line => !expected.includes(line));
    console.log(`manifest ${expected.length} classes, snapshot ${actual.length}; missing or different ${missing.length}, extra ${extra.length}`);
    for (const line of [...missing.map(l => `- ${l}`), ...extra.map(l => `+ ${l}`)].slice(0, 20)) console.log(line);
    if (missing.length || extra.length) process.exitCode = 1;
    return;
  }
  if (args.includes('--manifest')) {
    const lines = capturedApplicationClassManifest(listSnapshotCapturedApplicationClasses(openSnapshotDatabase()));
    const out = option('--manifest');
    if (out !== undefined && !out.startsWith('--')) fs.writeFileSync(out, `${lines.join('\n')}\n`);
    else console.log(lines.join('\n'));
    return;
  }
  const pathsFile = option('--paths'); const out = option('--out');
  if (pathsFile === undefined || out === undefined) throw new Error('usage: --paths <file> --out <json> [--transitive] | --import <json> | --manifest [<out>] | --check-manifest <file>');
  const corpusClasses = new Set(listSnapshotApplicationClassDefinitions(openSnapshotDatabase()).map(d => d.path.join(':').toLowerCase()));
  const requested = fs.readFileSync(pathsFile, 'utf8').split('\n').map(line => line.replace(/#.*/, '').trim())
    .filter(p => p !== '' && !corpusClasses.has(p.toLowerCase()));
  const existing: ApplicationClassCaptureFile = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { captured: [], absent: [] };
  const connection = await openCorpusConnection(getConnectionConfig());
  try {
    let result = await captureApplicationClassPrograms(connection, requested, existing);
    const requestedSoFar = [...requested];
    const scanned = new Set<string>();
    for (let round = 1; args.includes('--transitive'); round++) {
      const known = new Set([...result.captured.map(c => c.path.join(':')), ...result.absent, ...requestedSoFar].map(p => p.toLowerCase()));
      const next = new Set<string>();
      for (const captured of result.captured) {
        if (scanned.has(captured.path.join(':'))) continue;
        scanned.add(captured.path.join(':'));
        for (const path of await referencedClassPaths(connection, captured)) {
          if (!known.has(path.toLowerCase()) && !corpusClasses.has(path.toLowerCase())) next.add(path);
        }
      }
      if (next.size === 0) break;
      console.log(`round ${round}: ${next.size} referenced classes`);
      requestedSoFar.push(...next);
      result = await captureApplicationClassPrograms(connection, [...next], result);
    }
    fs.writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
    console.log(`captured ${result.captured.length} classes (${result.captured.length - existing.captured.length} new), absent ${result.absent.length}`);
  } finally {
    await connection.close();
  }
}

if (require.main === module) {
  main().catch(error => { console.error(error); process.exit(1); });
}
