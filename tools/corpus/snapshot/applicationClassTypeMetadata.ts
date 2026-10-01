/*
 * The local snapshot as an Application Class type-metadata source: every
 * captured Application Class definition (OBJECTID1 104), as a path (the
 * OBJECTVALUEs before `OnExecute`: package components, then the class) and
 * its source, fed to the encoder's pure provider. The encoder never reads
 * the snapshot itself.
 */
import type Database from 'better-sqlite3';

import { getLatestCompletedSnapshot } from './store';
import { isBuiltinObjectTypeName } from '../../../src/peoplecode/encoder';
import {
  createApplicationClassTypeMetadataProvider,
  type ApplicationClassDefinition,
  type ApplicationClassTypeMetadataProvider
} from '../../../src/peoplecode/applicationClassTypeMetadata';

export function listSnapshotApplicationClassDefinitions(db: Database.Database): ApplicationClassDefinition[] {
  const snapshot = getLatestCompletedSnapshot(db);
  if (!snapshot) {
    throw new Error('No completed HCDEV corpus snapshot exists.');
  }
  const rows = db.prepare(`
    SELECT objectvalue1, objectvalue2, objectvalue3, objectvalue4, objectvalue5, objectvalue6, objectvalue7, source_text
    FROM snapshot_definition
    WHERE snapshot_id = ? AND objectid1 = 104
    ORDER BY definition_id
  `).all(snapshot.snapshotId) as Array<Record<string, string>>;
  const definitions: ApplicationClassDefinition[] = [];
  for (const row of rows) {
    const values = [1, 2, 3, 4, 5, 6, 7].map(n => String(row[`objectvalue${n}`] ?? '').trim());
    const event = values.findIndex(value => value.toLowerCase() === 'onexecute');
    const path = values.slice(0, event < 0 ? values.length : event).filter(Boolean);
    if (path.length < 2) continue;
    definitions.push({ path, source: String(row.source_text ?? '') });
  }
  return definitions;
}

let cached: ApplicationClassTypeMetadataProvider | undefined;

/**
 * One provider per process over the snapshot's Application Classes, with
 * the encoder's built-in object types taking precedence over same-named
 * classes. Classes are parsed lazily, on first lookup.
 */
export function snapshotApplicationClassTypeMetadata(db: Database.Database): ApplicationClassTypeMetadataProvider {
  cached ??= createApplicationClassTypeMetadataProvider(
    listSnapshotApplicationClassDefinitions(db),
    { isBuiltinType: isBuiltinObjectTypeName }
  );
  return cached;
}
