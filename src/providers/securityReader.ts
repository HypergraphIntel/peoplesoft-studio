import type { DbConnection, DbTypes } from '../db/connection.js';
import { columnOrNull, tableColumns } from './tableColumns.js';
import { OAUTH_COLUMNS, SAML_COLUMNS, securityKey, securityToken, type SecurityKind, type SecurityRow, type SecurityDocument, type SecurityList, type SecurityChoices } from '../model/security.js';

const text = (v: unknown) => String(v ?? '').trim();
async function rows(c: DbConnection, types: DbTypes, sql: string, binds: Record<string, unknown> = {}): Promise<SecurityRow[]> {
  return (await c.execute<SecurityRow>(sql, binds, { outFormat: types.OUT_FORMAT_OBJECT })).rows ?? [];
}
export async function listSecurity(c: DbConnection, types: DbTypes, kind: SecurityKind, query: string, offset = 0): Promise<SecurityList> {
  if (!Number.isInteger(offset) || offset < 0) throw new Error('Invalid search offset.');
  const page = ' OFFSET ' + offset + ' ROWS FETCH NEXT 101 ROWS ONLY';
  const result = kind === 'oauth'
    ? await rows(c, types, 'SELECT PTAPP_NAME,PTAUTHSERVER,PTSECTYPE FROM PSPTSEC_TOKEN WHERE UPPER(PTAPP_NAME) LIKE :q ORDER BY PTAPP_NAME,PTAUTHSERVER' + page, { q: '%' + query.toUpperCase() + '%' })
    : await rows(c, types, 'SELECT CERTALIAS,PTISSUER,PTSUBJECTNAME,PTQUALIFIERNAME,DESCR254 FROM PS_PTWSSINBSAML WHERE UPPER(CERTALIAS) LIKE :q OR UPPER(PTISSUER) LIKE :q OR UPPER(DESCR254) LIKE :q ORDER BY CERTALIAS,PTISSUER,PTSUBJECTNAME,PTQUALIFIERNAME' + page, { q: '%' + query.toUpperCase() + '%' });
  return { items: result.slice(0, 100).map(r => kind === 'oauth'
    ? { key: [text(r.PTAPP_NAME), text(r.PTAUTHSERVER)], label: text(r.PTAPP_NAME), description: text(r.PTAUTHSERVER) + ' · ' + text(r.PTSECTYPE) }
    : { key: [text(r.CERTALIAS), text(r.PTISSUER), text(r.PTSUBJECTNAME), text(r.PTQUALIFIERNAME)], label: text(r.CERTALIAS), description: text(r.DESCR254) || text(r.PTISSUER) }), more: result.length > 100 };
}
export async function readSecurity(c: DbConnection, types: DbTypes, kind: SecurityKind, key: string[]): Promise<SecurityDocument | undefined> {
  securityKey(kind, key);
  const have = kind === 'oauth' ? await tableColumns(c, 'PSPTSEC_TOKEN') : undefined;
  const [properties] = kind === 'oauth'
    // PTJWTEXP is an 8.62 column (not on 8.61.15): one this release's table lacks reads as NULL.
    ? await rows(c, types, 'SELECT ' + OAUTH_COLUMNS.map(col => columnOrNull(have!, 'T', col)).join(',') + ' FROM PSPTSEC_TOKEN T WHERE PTAPP_NAME=:name AND PTAUTHSERVER=:server', { name: key[0], server: key[1] })
    : await rows(c, types, 'SELECT ' + SAML_COLUMNS.map(col => col === 'LASTUPDDTTM' ? "TO_CHAR(LASTUPDDTTM,'YYYY-MM-DD HH24:MI:SS.FF6') AS LASTUPDDTTM" : col).join(',') + ' FROM PS_PTWSSINBSAML WHERE CERTALIAS=:name AND PTISSUER=:issuer AND PTSUBJECTNAME=:subject AND PTQUALIFIERNAME=:qualifier', { name: key[0], issuer: key[1] || ' ', subject: key[2] || ' ', qualifier: key[3] || ' ' });
  if (!properties) return;
  // Project only explicit public configuration fields, even if a driver returns unexpected columns.
  const columns: readonly string[] = kind === 'oauth' ? OAUTH_COLUMNS : SAML_COLUMNS;
  const safe = Object.fromEntries(columns.map(k => [k, typeof properties[k] === 'string' ? properties[k].trimEnd() : properties[k] ?? null]));
  const audiences = kind === 'oauth' ? (await rows(c, types, 'SELECT PTAUDIENCE2 FROM PSPTSEC_AUD WHERE PTAPP_NAME=:name AND PTAUTHSERVER=:server ORDER BY PTAUDIENCE2', { name: key[0], server: key[1] })).map(r => text(r.PTAUDIENCE2)) : [];
  // Role assignments are keyed by application name, not authorization-server code.
  const roles = kind === 'oauth' ? (await rows(c, types, 'SELECT ROLENAME FROM PSPTSEC_ROLES WHERE PTAPP_NAME=:name ORDER BY ROLENAME', { name: key[0] })).map(r => text(r.ROLENAME)) : [];
  return { kind, key, properties: safe, audiences, roles, token: securityToken(safe, audiences, roles) };
}
export async function securityChoices(c: DbConnection, types: DbTypes): Promise<SecurityChoices[]> {
  return (await rows(c, types, "SELECT FIELDNAME,FIELDVALUE,XLATLONGNAME FROM PSXLATITEM WHERE FIELDNAME IN ('PTAUTHSERVER','PTSECTYPE','PTAUTHFLOW','PTSCOPE') AND EFF_STATUS='A' AND EFFDT<=CURRENT_DATE AND EFFDT=(SELECT MAX(X.EFFDT) FROM PSXLATITEM X WHERE X.FIELDNAME=PSXLATITEM.FIELDNAME AND X.FIELDVALUE=PSXLATITEM.FIELDVALUE AND X.EFFDT<=CURRENT_DATE) ORDER BY FIELDNAME,FIELDVALUE")).map(r => ({ field: text(r.FIELDNAME), code: text(r.FIELDVALUE), label: text(r.XLATLONGNAME) }));
}
