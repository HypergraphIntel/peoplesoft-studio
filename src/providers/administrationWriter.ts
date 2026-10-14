import type { DbConnection, DbTypes } from '../db/connection.js';
import { select, expectRows, operatorExists, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';
import { adminToken, adminInputKey, validateAdminInput, messageInput, textInput, urlInput, urlProtocol, invalidTextTags,
  type AdminDocument, type AdminInput, type AdminKind, type AdminRow, type AdminSummary } from '../model/administration.js';
import { writeScopeRefusal } from './writeScope.js';

const blank = (value: string) => value === '' ? ' ' : value;
const trim = (value: unknown) => String(value ?? '').trim();
const TEXT_KEYS = ['OBJECTOWNERID', 'HR_SSTEXT_SUB_ID', 'TEXT_ID', 'EFFDT', ...Array.from({ length: 6 }, (_, i) => 'HR_SSTEXT_KEY' + (i + 1))];
async function rows(c: DbConnection, types: DbTypes, sql: string, binds: Record<string, unknown>): Promise<AdminRow[]> {
  return (await c.execute<AdminRow>(sql, binds, { outFormat: types.OUT_FORMAT_OBJECT, fetchTypeHandler: (meta: { dbType: unknown }) =>
    meta.dbType === types.DB_TYPE_CLOB || meta.dbType === types.DB_TYPE_NCLOB ? { type: types.STRING } : undefined })).rows ?? [];
}
function textWhere(key: readonly string[]) {
  if (key.length !== 11) throw new Error('Text Catalog key requires owner, sub-ID, ID, date, six context keys and language.');
  const binds: Record<string, unknown> = {};
  const where = TEXT_KEYS.map((column, i) => {
    binds['k' + i] = blank(key[i]);
    return column + (i === 3 ? " = TO_DATE(:k3, 'YYYY-MM-DD')" : ' = :k' + i);
  }).join(' AND ');
  return { where, binds };
}

export async function listAdministration(c: DbConnection, types: DbTypes, kind: AdminKind, query: string, offset = 0): Promise<{ items: AdminSummary[]; more: boolean }> {
  if (!Number.isInteger(offset) || offset < 0 || offset > 1000000) throw new Error('Invalid page offset.');
  const n = '%' + query.toUpperCase() + '%';
  const page = ` OFFSET ${offset} ROWS FETCH NEXT 101 ROWS ONLY`;
  if (kind === 'message') {
    const result = await rows(c, types, `SELECT M.MESSAGE_SET_NBR, M.MESSAGE_NBR, M.MESSAGE_TEXT, M.MSG_SEVERITY FROM PSMSGCATDEFN M
      LEFT JOIN PSMSGSETDEFN S ON S.MESSAGE_SET_NBR=M.MESSAGE_SET_NBR
      WHERE TO_CHAR(M.MESSAGE_SET_NBR) LIKE :n OR UPPER(M.MESSAGE_TEXT) LIKE :n OR UPPER(S.DESCR) LIKE :n OR TO_CHAR(M.MESSAGE_SET_NBR) || '.' || TO_CHAR(M.MESSAGE_NBR) LIKE :n
      ORDER BY M.MESSAGE_SET_NBR, M.MESSAGE_NBR${page}`, { n });
    return { items: result.slice(0, 100).map(r => ({ key: [String(r.MESSAGE_SET_NBR), String(r.MESSAGE_NBR)], label: r.MESSAGE_SET_NBR + ', ' + r.MESSAGE_NBR, description: trim(r.MESSAGE_TEXT) })), more: result.length > 100 };
  }
  if (kind === 'url') {
    const result = await rows(c, types, `SELECT URL_ID, DESCR FROM PSURLDEFN WHERE UPPER(URL_ID) LIKE :n OR UPPER(DESCR) LIKE :n ORDER BY URL_ID${page}`, { n });
    return { items: result.slice(0, 100).map(r => ({ key: [trim(r.URL_ID)], label: trim(r.URL_ID), description: trim(r.DESCR) })), more: result.length > 100 };
  }
  const result = await rows(c, types, `SELECT T.OBJECTOWNERID, T.HR_SSTEXT_SUB_ID, T.TEXT_ID, TO_CHAR(T.EFFDT, 'YYYY-MM-DD') AS EFFDT,
    T.HR_SSTEXT_KEY1,T.HR_SSTEXT_KEY2,T.HR_SSTEXT_KEY3,T.HR_SSTEXT_KEY4,T.HR_SSTEXT_KEY5,T.HR_SSTEXT_KEY6,M.DESCR254_MIXED
    FROM PS_HR_SSTEXT_TEXT T JOIN PS_HR_SSTEXT_MSGID M ON M.OBJECTOWNERID=T.OBJECTOWNERID AND M.HR_SSTEXT_SUB_ID=T.HR_SSTEXT_SUB_ID AND M.TEXT_ID=T.TEXT_ID
    WHERE UPPER(T.TEXT_ID) LIKE :n OR UPPER(T.OBJECTOWNERID) LIKE :n OR UPPER(M.DESCR254_MIXED) LIKE :n
    ORDER BY T.OBJECTOWNERID,T.HR_SSTEXT_SUB_ID,T.TEXT_ID,T.EFFDT DESC,T.HR_SSTEXT_KEY1,T.HR_SSTEXT_KEY2,T.HR_SSTEXT_KEY3,T.HR_SSTEXT_KEY4,T.HR_SSTEXT_KEY5,T.HR_SSTEXT_KEY6${page}`, { n });
  return { items: result.slice(0, 100).map(r => {
    const key = TEXT_KEYS.map(k => trim(r[k])).concat('');
    return { key, label: key.slice(0, 4).join(' / '), description: trim(r.DESCR254_MIXED) + (key.slice(4, 10).some(Boolean) ? ' · ' + key.slice(4, 10).join(' / ') : '') };
  }), more: result.length > 100 };
}

export async function readAdministration(c: DbConnection, types: DbTypes, kind: AdminKind, key: string[], lock = false): Promise<AdminDocument | undefined> {
  let row: AdminRow | undefined, parent: AdminRow | undefined, related: AdminRow[] = [];
  const suffix = lock ? ' FOR UPDATE' : '';
  if (kind === 'message') {
    if (key.length !== 2 || key.some(k => !/^\d{1,5}$/.test(k) || Number(k) < 1 || Number(k) > 32767)) throw new Error('Invalid message key.');
    const binds = { s: Number(key[0]), m: Number(key[1]) };
    [parent] = await rows(c, types, 'SELECT * FROM PSMSGSETDEFN WHERE MESSAGE_SET_NBR=:s' + suffix, { s: binds.s });
    [row] = await rows(c, types, `SELECT MESSAGE_SET_NBR,MESSAGE_NBR,MESSAGE_TEXT,MSG_SEVERITY,DESCRLONG,
      TO_CHAR(LAST_UPDATE_DTTM, ${TIMESTAMP_FORMAT}) AS LAST_UPDATE_DTTM FROM PSMSGCATDEFN WHERE MESSAGE_SET_NBR=:s AND MESSAGE_NBR=:m${suffix}`, binds);
    related = await rows(c, types, 'SELECT * FROM PSMSGCATLANG WHERE MESSAGE_SET_NBR=:s AND MESSAGE_NBR=:m ORDER BY LANGUAGE_CD' + suffix, binds);
  } else if (kind === 'url') {
    if (key.length !== 1 || !key[0] || key[0].length > 30) throw new Error('Invalid URL ID.');
    [row] = await rows(c, types, `SELECT URL_ID,VERSION,DESCR,URL,ICLIENT_SERVERFLAG,OBJECTOWNERID,LASTUPDOPRID,COMMENTS,
      TO_CHAR(LASTUPDDTTM,${TIMESTAMP_FORMAT}) AS LASTUPDDTTM FROM PSURLDEFN WHERE URL_ID=:id${suffix}`, { id: key[0] });
    // Only names/protocols are read: secret property values stay in the database.
    related = await rows(c, types, 'SELECT URL_ID,TRPROTOCOL,PT_PROP_NAME FROM PS_PT_URL_PROPS WHERE URL_ID=:id ORDER BY PT_PROP_NAME' + suffix, { id: key[0] });
  } else {
    const { where, binds } = textWhere(key);
    const head = { o: blank(key[0]), s: blank(key[1]), t: key[2] };
    [parent] = await rows(c, types, 'SELECT * FROM PS_HR_SSTEXT_MSGID WHERE OBJECTOWNERID=:o AND HR_SSTEXT_SUB_ID=:s AND TEXT_ID=:t' + suffix, head);
    const language = key[10];
    [row] = await rows(c, types, `SELECT ${TEXT_KEYS.filter(k => k !== 'EFFDT').join(',')},TO_CHAR(EFFDT,'YYYY-MM-DD') AS EFFDT,${language ? 'LANGUAGE_CD' : 'SYSTEM_DATA_FLG'},HR_SSTEXT_TEXT
      FROM ${language ? 'PS_HR_SSTEXT_LANG' : 'PS_HR_SSTEXT_TEXT'} WHERE ${where}${language ? ' AND LANGUAGE_CD=:lang' : ''}${suffix}`, { ...binds, ...(language ? { lang: language } : {}) });
    if (!language) related = await rows(c, types, `SELECT LANGUAGE_CD,HR_SSTEXT_TEXT FROM PS_HR_SSTEXT_LANG WHERE ${where} ORDER BY LANGUAGE_CD${suffix}`, binds);
  }
  return row ? { kind, key, row, related, parent, token: adminToken(kind, key, row, related, parent) } : undefined;
}

/** Delivered SavePreChange uses the returned SYS version on sets and URLs. */
async function bumpSystemVersion(c: DbConnection): Promise<number> {
  const [r] = await select<{ VERSION: number }>(c, "SELECT VERSION FROM PSVERSION WHERE OBJECTTYPENAME='SYS' FOR UPDATE");
  if (!r) throw new Error('PSVERSION SYS is missing.');
  const next = Number(r.VERSION) + 1;
  await expectRows(c, "UPDATE PSVERSION SET VERSION=:v WHERE OBJECTTYPENAME='SYS'", { v: next }, 1, 'Updating SYS version');
  return next;
}
export interface AdminSaveRequest { kind: AdminKind; input: unknown; expectedToken: string; operatorId: string }

export async function saveAdministration(c: DbConnection, types: DbTypes, request: AdminSaveRequest): Promise<AdminDocument> {
  const input = validateAdminInput(request.kind, request.input);
  const key = adminInputKey(request.kind, input);
  try {
    if (!await operatorExists(c, request.operatorId)) throw new Error('PeopleSoft Operator ID does not exist.');
    const current = await readAdministration(c, types, request.kind, key, true);
    if ((current?.token ?? 'absent') !== request.expectedToken) throw new Error('This entry changed after it was opened. Reload before saving.');
    if (request.kind === 'message') await saveMessage(c, types, messageInput.parse(input), current);
    else if (request.kind === 'url') await saveUrl(c, types, urlInput.parse(input), current, request.operatorId);
    else await saveText(c, types, textInput.parse(input), current);
    const stored = await readAdministration(c, types, request.kind, key);
    if (!stored || !matchesInput(stored, input, !!current)) throw new Error('Saved entry failed readback verification.');
    await c.commit();
    return stored;
  } catch (error) { await c.rollback(); throw error; }
}
function matchesInput(doc: AdminDocument, input: AdminInput, existed: boolean): boolean {
  if (doc.kind === 'message') {
    const m = messageInput.parse(input);
    return String(doc.row.MESSAGE_TEXT ?? '') === m.text && trim(doc.row.MSG_SEVERITY) === m.severity
      && String(doc.row.DESCRLONG ?? '') === m.explanation
      && (!existed || (trim(doc.parent?.DESCR) === m.setDescription.trim() && trim(doc.parent?.DESCRSHORT) === (m.setShortDescription || m.setDescription.slice(0, 10)).trim()));
  }
  if (doc.kind === 'url') {
    const u = urlInput.parse(input);
    return trim(doc.row.DESCR) === u.description.trim() && String(doc.row.URL ?? '') === u.url
      && trim(doc.row.OBJECTOWNERID) === u.owner.trim() && String(doc.row.COMMENTS ?? '') === u.comments;
  }
  return String(doc.row.HR_SSTEXT_TEXT ?? '') === textInput.parse(input).text;
}
async function saveMessage(c: DbConnection, types: DbTypes, input: ReturnType<typeof messageInput.parse>, current: AdminDocument | undefined) {
  const version = await bumpSystemVersion(c);
  const [set] = await rows(c, types, 'SELECT * FROM PSMSGSETDEFN WHERE MESSAGE_SET_NBR=:s FOR UPDATE', { s: input.set });
  if (set && !current && ((input.setDescription && input.setDescription.trim() !== trim(set.DESCR))
    || (input.setShortDescription && input.setShortDescription.trim() !== trim(set.DESCRSHORT)))) {
    throw new Error('This message set already exists. Leave its description fields blank or use its current descriptions when adding a message.');
  }
  const binds = { s: input.set, v: version, d: blank(input.setDescription), sd: blank(input.setShortDescription || input.setDescription.slice(0, 10)) };
  if (set && !current) await expectRows(c, 'UPDATE PSMSGSETDEFN SET VERSION=:v WHERE MESSAGE_SET_NBR=:s', { s: input.set, v: version }, 1, 'Updating message set version');
  else if (set) await expectRows(c, 'UPDATE PSMSGSETDEFN SET VERSION=:v,DESCR=:d,DESCRSHORT=:sd WHERE MESSAGE_SET_NBR=:s', binds, 1, 'Saving message set');
  else await expectRows(c, 'INSERT INTO PSMSGSETDEFN (MESSAGE_SET_NBR,VERSION,DESCR,DESCRSHORT) VALUES (:s,:v,:d,:sd)', binds, 1, 'Creating message set');
  if (current && String(current.row.MESSAGE_TEXT ?? '') === input.text && trim(current.row.MSG_SEVERITY) === input.severity
    && String(current.row.DESCRLONG ?? '') === input.explanation) return;
  const b = { s: input.set, m: input.number, t: input.text, sev: input.severity, e: { val: input.explanation, type: types.CLOB } };
  await expectRows(c, current ? 'UPDATE PSMSGCATDEFN SET MESSAGE_TEXT=:t,MSG_SEVERITY=:sev,DESCRLONG=:e,LAST_UPDATE_DTTM=SYSTIMESTAMP WHERE MESSAGE_SET_NBR=:s AND MESSAGE_NBR=:m'
    : 'INSERT INTO PSMSGCATDEFN (MESSAGE_SET_NBR,MESSAGE_NBR,MESSAGE_TEXT,MSG_SEVERITY,DESCRLONG,LAST_UPDATE_DTTM) VALUES (:s,:m,:t,:sev,:e,SYSTIMESTAMP)', b, 1, 'Saving message');
}
async function saveUrl(c: DbConnection, types: DbTypes, input: ReturnType<typeof urlInput.parse>, current: AdminDocument | undefined, operatorId: string) {
  const scope = writeScopeRefusal(input.id); if (scope) throw new Error(scope);
  if (current?.related.length && urlProtocol(trim(current.row.URL)) !== urlProtocol(input.url)) throw new Error('Changing protocol on a URL with protocol properties is not supported. Existing properties were preserved.');
  const version = await bumpSystemVersion(c);
  const b = { id: input.id, v: version, d: blank(input.description), u: input.url, o: blank(input.owner), op: operatorId, cm: { val: input.comments, type: types.CLOB } };
  await expectRows(c, current ? 'UPDATE PSURLDEFN SET VERSION=:v,DESCR=:d,URL=:u,OBJECTOWNERID=:o,LASTUPDOPRID=:op,COMMENTS=:cm,LASTUPDDTTM=SYSTIMESTAMP WHERE URL_ID=:id'
    : "INSERT INTO PSURLDEFN (URL_ID,VERSION,DESCR,URL,OBJECTOWNERID,LASTUPDOPRID,COMMENTS,LASTUPDDTTM,ICLIENT_SERVERFLAG) VALUES (:id,:v,:d,:u,:o,:op,:cm,SYSTIMESTAMP,' ')", b, 1, 'Saving URL');
}
async function saveText(c: DbConnection, types: DbTypes, input: ReturnType<typeof textInput.parse>, current: AdminDocument | undefined) {
  const scope = writeScopeRefusal(input.id); if (scope) throw new Error(scope);
  const headerBinds = { o: input.owner, s: blank(input.subId), t: input.id };
  const [config] = await rows(c, types, 'SELECT * FROM PS_HR_SSTEXT_CFG WHERE OBJECTOWNERID=:o AND HR_SSTEXT_SUB_ID=:s', { o: input.owner, s: blank(input.subId) });
  if (!config) throw new Error('Text Catalog owner/sub-ID configuration does not exist.');
  if (input.usage) {
    const [{ N }] = await select<{ N: number }>(c, "SELECT COUNT(*) AS N FROM PSXLATITEM WHERE FIELDNAME='HR_SSTEXT_USAGE' AND FIELDVALUE=:u AND EFF_STATUS='A'", { u: input.usage });
    if (!Number(N)) throw new Error('Invalid Text Catalog usage code.');
  }
  const tags = new Set((await rows(c, types, 'SELECT HR_SSTEXT_TAG FROM PS_HR_SSTEXT_TAGS', {})).map(r => trim(r.HR_SSTEXT_TAG)));
  const invalid = !current || String(current.row.HR_SSTEXT_TEXT ?? '') !== input.text ? invalidTextTags(input.text, tags) : [];
  if (invalid.length) throw new Error('Unrecognized Text Catalog tags: ' + invalid.join(', '));
  const { where, binds } = textWhere(adminInputKey('text', input));
  const value = { val: input.text, type: types.CLOB };
  if (input.language) {
    const [base] = await rows(c, types, `SELECT TEXT_ID FROM PS_HR_SSTEXT_TEXT WHERE ${where}`, binds);
    if (!base) throw new Error('Create the base-language context row before translating it.');
    const [{ N }] = await select<{ N: number }>(c, 'SELECT COUNT(*) AS N FROM PSLANGUAGES WHERE LANGUAGE_CD=:l', { l: input.language });
    if (!Number(N)) throw new Error('Language code does not exist.');
    await expectRows(c, current ? `UPDATE PS_HR_SSTEXT_LANG SET HR_SSTEXT_TEXT=:text WHERE ${where} AND LANGUAGE_CD=:lang`
      : `INSERT INTO PS_HR_SSTEXT_LANG (${TEXT_KEYS.join(',')},LANGUAGE_CD,HR_SSTEXT_TEXT) VALUES (:k0,:k1,:k2,TO_DATE(:k3,'YYYY-MM-DD'),:k4,:k5,:k6,:k7,:k8,:k9,:lang,:text)`,
      { ...binds, lang: input.language, text: value }, 1, 'Saving Text Catalog translation');
    return;
  }
  const [header] = await rows(c, types, 'SELECT * FROM PS_HR_SSTEXT_MSGID WHERE OBJECTOWNERID=:o AND HR_SSTEXT_SUB_ID=:s AND TEXT_ID=:t FOR UPDATE', headerBinds);
  if (header && !current && ((input.description && input.description.trim() !== trim(header.DESCR254_MIXED))
    || (input.usage && input.usage !== trim(header.HR_SSTEXT_USAGE)))) {
    throw new Error('This Text ID already exists. Leave description and usage blank or use its current values when adding a context or effective date.');
  }
  if (!header) await expectRows(c, 'INSERT INTO PS_HR_SSTEXT_MSGID (OBJECTOWNERID,HR_SSTEXT_SUB_ID,TEXT_ID,HR_SSTEXT_USAGE,SYSTEM_DATA_FLG,DESCR254_MIXED) VALUES (:o,:s,:t,:u,:sys,:d)',
    { ...headerBinds, u: blank(input.usage), sys: input.systemData ? 'Y' : 'N', d: blank(input.description) }, 1, 'Creating text ID');
  const [effective] = await rows(c, types, "SELECT TEXT_ID FROM PS_HR_SSTEXT_EFFDT WHERE OBJECTOWNERID=:o AND HR_SSTEXT_SUB_ID=:s AND TEXT_ID=:t AND EFFDT=TO_DATE(:dt,'YYYY-MM-DD') FOR UPDATE", { ...headerBinds, dt: input.effectiveDate });
  if (!effective) await expectRows(c, "INSERT INTO PS_HR_SSTEXT_EFFDT (OBJECTOWNERID,HR_SSTEXT_SUB_ID,TEXT_ID,EFFDT,SYSTEM_DATA_FLG) VALUES (:o,:s,:t,TO_DATE(:dt,'YYYY-MM-DD'),:sys)",
    { ...headerBinds, dt: input.effectiveDate, sys: input.systemData ? 'Y' : 'N' }, 1, 'Creating text effective date');
  await expectRows(c, current ? `UPDATE PS_HR_SSTEXT_TEXT SET HR_SSTEXT_TEXT=:text,SYSTEM_DATA_FLG=:sys WHERE ${where}`
    : `INSERT INTO PS_HR_SSTEXT_TEXT (${TEXT_KEYS.join(',')},SYSTEM_DATA_FLG,HR_SSTEXT_TEXT) VALUES (:k0,:k1,:k2,TO_DATE(:k3,'YYYY-MM-DD'),:k4,:k5,:k6,:k7,:k8,:k9,:sys,:text)`,
    { ...binds, sys: input.systemData ? 'Y' : 'N', text: value }, 1, 'Saving Text Catalog text');
}

export async function verifyAdministration(c: DbConnection, types: DbTypes, saved: AdminDocument): Promise<void> {
  const current = await readAdministration(c, types, saved.kind, saved.key);
  if (!current || current.token !== saved.token) throw new Error('After COMMIT the administration entry differs from the saved result.');
}
