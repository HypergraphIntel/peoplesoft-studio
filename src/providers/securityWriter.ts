import type { DbConnection, DbTypes } from '../db/connection.js';
import { readSecurity } from './securityReader.js';
import { oauthEditable, securityKey, validateOAuthChanges, type SecurityDocument } from '../model/security.js';
export interface OAuthSaveRequest { key: string[]; expectedToken: string; changes: unknown; operatorId: string; dryRun?: boolean }
export async function saveOAuth(c: DbConnection, types: DbTypes, request: OAuthSaveRequest): Promise<SecurityDocument> {
  securityKey('oauth', request.key);
  const changes = validateOAuthChanges(request.changes);
  try {
    const status = (await c.execute<{ TOOLSREL: string; PTPATCHREL: number }>('SELECT TOOLSREL,PTPATCHREL FROM PSSTATUS', {}, { outFormat: types.OUT_FORMAT_OBJECT })).rows?.[0];
    if (String(status?.TOOLSREL).trim() !== '8.62' || Number(status?.PTPATCHREL) !== 9) throw new Error('OAuth writes are calibrated only on PeopleTools 8.62.09.');
    if (!(await c.execute('SELECT OPRID FROM PSOPRDEFN WHERE OPRID=:op', { op: request.operatorId }, { outFormat: types.OUT_FORMAT_OBJECT })).rows?.length) throw new Error('PeopleSoft Operator ID does not exist.');
    await c.execute('SELECT PTAPP_NAME FROM PSPTSEC_TOKEN WHERE PTAPP_NAME=:name AND PTAUTHSERVER=:server FOR UPDATE', { name: request.key[0], server: request.key[1] });
    const before = await readSecurity(c, types, 'oauth', request.key);
    if (!before) throw new Error('OAuth application no longer exists. Create it in PIA first.');
    if (before.token !== request.expectedToken) throw new Error('OAuth configuration changed since it was opened. Refresh before saving.');
    if (!oauthEditable(before)) throw new Error('Only CUSTOM / Client Only / Client Credentials edits are calibrated. Use PIA for this application.');
    const changed = Object.entries(changes).filter(([key, value]) => before.properties[key] !== value);
    if (changed.length) {
      const binds: Record<string, unknown> = { name: request.key[0], server: request.key[1] };
      const assignments = changed.map(([key, value], i) => { binds['v' + i] = value; return key + '=:v' + i; });
      const result = await c.execute('UPDATE PSPTSEC_TOKEN SET ' + assignments.join(',') + ' WHERE PTAPP_NAME=:name AND PTAUTHSERVER=:server', binds);
      if (result.rowsAffected !== 1) throw new Error('OAuth configuration update did not affect exactly one application.');
    }
    const after = await readSecurity(c, types, 'oauth', request.key);
    const expected = { ...before.properties, ...changes };
    if (!after || JSON.stringify(after.properties) !== JSON.stringify(expected) || JSON.stringify(after.audiences) !== JSON.stringify(before.audiences) || JSON.stringify(after.roles) !== JSON.stringify(before.roles)) throw new Error('OAuth configuration failed readback verification.');
    // Native captures show no PSVERSION increments or update/operator columns for these edits.
    // No secret/token columns or associated rows are selected or modified.
    if (request.dryRun) await c.rollback(); else await c.commit();
    return after;
  } catch (e) { await c.rollback(); throw e; }
}
