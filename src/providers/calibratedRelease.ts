import { createHash } from 'node:crypto';
import type { ColumnInfo, DbConnection } from '../db/connection.js';
import { CALIBRATED_SCHEMAS } from './calibratedSchemas.js';

/*
 * Writers whose save plans were proven row for row against a native save on a given
 * PeopleTools release. A release not listed is refused rather than assumed to match.
 *   query: Windows Query on 8.62.09 (HRDMO qry01-qry14) and 8.61.15 (HCDEV: XX_QRY_AD2,
 *          saved in Windows Query, equals Studio's XX_QRY_ST)
 *   integrationBrokerStandard: PIA on 8.61.15 (HCDEV XX_IB_*_AD equal Studio's XX_IB_*_ST)
 *   oauth: edits CUSTOM applications, and 8.61.15 has no CUSTOM authorization server.
 *
 * Another patch of a calibrated release (8.61.12 for 8.61.15) is accepted when every table
 * the family writes has exactly the columns and types it has on the calibrated patch: the
 * save plans name every column, and the tables are what changes between patches. Different
 * tables are refused, naming them.
 */
export const CALIBRATED_RELEASES = {
  query: ['8.62.09', '8.61.15'],
  integrationBroker: ['8.62.09'],
  // Matched to PIA on 8.61.15 too, created and edited: nonrowset messages, standard
  // services, standard operations without handlers and flat string documents (ibWriter).
  integrationBrokerStandard: ['8.62.09', '8.61.15'],
  oauth: ['8.62.09']
} as const satisfies Record<string, readonly string[]>;
export type CalibratedFamily = keyof typeof CALIBRATED_RELEASES;

const WRITES: Record<CalibratedFamily, string> = {
  query: 'Query saves', integrationBroker: 'Integration Broker writes of this kind (REST, nodes, routings or handlers)',
  integrationBrokerStandard: 'Integration Broker writes', oauth: 'OAuth writes'
};

const IB_STANDARD_TABLES = ['PSMSGDEFN', 'PSMSGVER', 'PSSERVICE', 'PSSERVICEOPR', 'PSOPERATION', 'PSOPRVERDFN', 'PSOPRVERDFNPARM',
  'PSLSDEFN', 'PSLSDEFNBODY', 'PSPHYSSCHDEFN', 'PSPHYSSCHBODY', 'PSDOCSCMADFN', 'PSDOCSCMADATA', 'PSDOCJSCMADATA'];
/** The tables each family writes. */
export const FAMILY_TABLES: Record<CalibratedFamily, readonly string[]> = {
  query: ['PSQRYDEFN', 'PSQRYSELECT', 'PSQRYRECORD', 'PSQRYFIELD', 'PSQRYCRITERIA', 'PSQRYEXPR', 'PSQRYBIND'],
  integrationBrokerStandard: IB_STANDARD_TABLES,
  integrationBroker: [...IB_STANDARD_TABLES, 'PSMSGREC', 'PSMSGFLDOVR', 'PSMSGPARTS', 'PSMSGATTR', 'PSOPRHDLR', 'PSOPERATIONAC',
    'PSOPERATIONAE', 'PSOPERATIONCI', 'PSOPERATIONDMS', 'PSOPERATIONURI', 'PSOPRURIDATA', 'PSOPRVDCONTTYPE', 'PSOPRVERQUEPARM',
    'PSMSGNODEDEFN', 'PSNODECONPROP', 'PSIBRTNGDEFN', 'PSRTNGDFNPARM', 'PSRTNGDFNCONPRP', 'PSRTNGDFNPROP', 'PSIBRTNGSUBDEFN'],
  oauth: ['PSPTSEC_TOKEN', 'PSPTSEC_AUD', 'PSPTSEC_ROLES']
};

/** A table's shape: its column names and types, order-independent (a missing table hashes the empty list). */
export function tableFingerprint(columns: readonly Pick<ColumnInfo, 'name' | 'dataType'>[]): string {
  const lines = columns.map((col) => `${col.name.toUpperCase()}:${col.dataType.toUpperCase()}`).sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
}

export async function familyFingerprints(c: DbConnection, family: CalibratedFamily): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const table of FAMILY_TABLES[family]) out[table] = tableFingerprint(await c.catalog.columns(c, table));
  return out;
}

/** 8.61.15 for TOOLSREL 8.61, PTPATCHREL 15. */
export function releaseName(toolsRel: unknown, patch: unknown): string {
  return `${String(toolsRel ?? '').trim()}.${String(Number(patch)).padStart(2, '0')}`;
}

export function calibrationRefusal(family: CalibratedFamily, release: string): string | undefined {
  const releases: readonly string[] = CALIBRATED_RELEASES[family];
  return releases.includes(release) ? undefined
    : `${WRITES[family]} are calibrated for PeopleTools ${releases.join(' and ')}; this database is ${release}.`;
}

/** The calibrated patch of the same release (8.61.15 for 8.61.12), if any. */
export function sameReleaseCalibration(family: CalibratedFamily, release: string): string | undefined {
  const major = release.split('.').slice(0, 2).join('.');
  return (CALIBRATED_RELEASES[family] as readonly string[]).find((r) => r.split('.').slice(0, 2).join('.') === major);
}

/** Tables whose shape differs from the calibrated patch's; empty when they all match. */
export function schemaDifferences(expected: Readonly<Record<string, string>>, actual: Readonly<Record<string, string>>): string[] {
  return Object.keys(expected).filter((table) => expected[table] !== actual[table]);
}

/** Throws unless this database is a calibrated release, or another patch of one whose tables are the same. */
export async function requireCalibratedRelease(c: DbConnection, family: CalibratedFamily, schemas = CALIBRATED_SCHEMAS): Promise<string> {
  const [row] = (await c.execute<{ TOOLSREL: string; PTPATCHREL: number }>('SELECT TOOLSREL,PTPATCHREL FROM PSSTATUS')).rows ?? [];
  const release = row ? releaseName(row.TOOLSREL, row.PTPATCHREL) : 'unknown';
  const refusal = calibrationRefusal(family, release);
  if (!refusal) return release;
  const calibrated = sameReleaseCalibration(family, release);
  const expected = calibrated ? schemas[family]?.[calibrated] : undefined;
  if (!calibrated || !expected) throw new Error(refusal);
  const differs = schemaDifferences(expected, await familyFingerprints(c, family));
  if (differs.length) throw new Error(`${refusal} Its ${differs.join(', ')} ${differs.length === 1 ? 'table differs' : 'tables differ'} from ${calibrated}'s.`);
  return release;
}
