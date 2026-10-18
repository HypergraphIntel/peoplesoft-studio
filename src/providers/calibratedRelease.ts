import type { DbConnection } from '../db/connection.js';

/*
 * Writers whose save plans were proven row for row against a native save on a given
 * PeopleTools release. A release not listed is refused rather than assumed to match.
 *   query: Windows Query on 8.62.09 (HRDMO qry01-qry14) and 8.61.15 (HCDEV: XX_QRY_AD2,
 *          saved in Windows Query, equals Studio's XX_QRY_ST)
 *   integrationBrokerStandard: PIA on 8.61.15 (HCDEV XX_IB_*_AD equal Studio's XX_IB_*_ST)
 *   oauth: edits CUSTOM applications, and 8.61.15 has no CUSTOM authorization server.
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

/** 8.61.15 for TOOLSREL 8.61, PTPATCHREL 15. */
export function releaseName(toolsRel: unknown, patch: unknown): string {
  return `${String(toolsRel ?? '').trim()}.${String(Number(patch)).padStart(2, '0')}`;
}

export function calibrationRefusal(family: CalibratedFamily, release: string): string | undefined {
  const releases: readonly string[] = CALIBRATED_RELEASES[family];
  return releases.includes(release) ? undefined
    : `${WRITES[family]} are calibrated for PeopleTools ${releases.join(' and ')}; this database is ${release}.`;
}

/** Throws unless this database's PeopleTools release is one the family was calibrated on. */
export async function requireCalibratedRelease(c: DbConnection, family: CalibratedFamily): Promise<string> {
  const [row] = (await c.execute<{ TOOLSREL: string; PTPATCHREL: number }>('SELECT TOOLSREL,PTPATCHREL FROM PSSTATUS')).rows ?? [];
  const release = row ? releaseName(row.TOOLSREL, row.PTPATCHREL) : 'unknown';
  const refusal = calibrationRefusal(family, release);
  if (refusal) throw new Error(refusal);
  return release;
}
