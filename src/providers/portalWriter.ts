import type { DbConnection, DbTypes } from '../db/connection.js';
import { select, expectRows, operatorExists, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';
import { writeScopeRefusal } from './writeScope.js';
import { portalIdentity, portalInput, portalToken, portalTargetColumns, type PortalDocument, type PortalIdentity, type PortalRow } from '../model/portalDocument.js';
const trim = (v: unknown) => String(v ?? '').trim();
const where = 'PORTAL_NAME=:p AND PORTAL_REFTYPE=:t AND PORTAL_OBJNAME=:n';
const binds = (id: PortalIdentity) => ({ p: id.portal, t: id.refType, n: id.name });
async function rows(c: DbConnection, types: DbTypes, sql: string, b: Record<string, unknown>): Promise<PortalRow[]> {
  return (await c.execute<PortalRow>(sql, b, { outFormat: types.OUT_FORMAT_OBJECT,
    fetchTypeHandler: (m: { dbType: unknown }) => m.dbType === types.DB_TYPE_CLOB || m.dbType === types.DB_TYPE_NCLOB ? { type: types.STRING } : undefined })).rows ?? [];
}
export async function readPortalDocument(c: DbConnection, types: DbTypes, identity: PortalIdentity, lock = false): Promise<PortalDocument | undefined> {
  const id = portalIdentity.parse(identity), b = binds(id), suffix = lock ? ' FOR UPDATE' : '';
  const [row] = await rows(c, types, `SELECT P.*,TO_CHAR(LASTUPDDTTM,${TIMESTAMP_FORMAT}) AS UPDATED FROM PSPRSMDEFN P WHERE ${where}${suffix}`, b);
  if (!row) return;
  // Use the lossless timestamp string for concurrency (drivers otherwise truncate microseconds).
  row.LASTUPDDTTM = row.UPDATED; delete row.UPDATED;
  const permissions = await rows(c, types, `SELECT * FROM PSPRSMPERM WHERE ${where} ORDER BY PORTAL_PERMTYPE,PORTAL_PERMNAME${suffix}`, b);
  const attributes = await rows(c, types, `SELECT * FROM PSPRSMATTRVAL WHERE ${where} ORDER BY PORTAL_ATTR_NAM,PORTAL_SEQ_NUM${suffix}`, b);
  return { identity: id, row, permissions, attributes, token: portalToken(row, permissions, attributes) };
}
export interface PortalSaveRequest { input: unknown; expectedToken: string; operatorId: string; dryRun?: boolean }
export async function savePortalDocument(c: DbConnection, types: DbTypes, request: PortalSaveRequest): Promise<PortalDocument> {
  const input = portalInput.parse(request.input), b = binds(input);
  const refusal = writeScopeRefusal(input.name); if (refusal) throw new Error(refusal);
  if (input.name === 'PORTAL_ROOT_OBJECT') throw new Error('The portal root cannot be changed here.');
  try {
    if (!await operatorExists(c, request.operatorId)) throw new Error('PeopleSoft Operator ID does not exist.');
    // Global registry lock serializes hierarchy changes, including cycle checks and creates.
    const versions = await select<{ OBJECTTYPENAME: string; VERSION: number }>(c, "SELECT OBJECTTYPENAME,VERSION FROM PSVERSION WHERE OBJECTTYPENAME IN ('PRSM','SYS') ORDER BY OBJECTTYPENAME FOR UPDATE");
    if (versions.length !== 2) throw new Error('Registry/system cache version rows are missing.');
    const current = await readPortalDocument(c, types, input, true);
    if ((current?.token ?? 'absent') !== request.expectedToken) throw new Error('This registry entry changed after it was opened. Reload before saving.');
    if (!current && input.refType === 'C' && !input.target) throw new Error('A new content reference requires a target.');
    const [portal] = await select(c, 'SELECT PORTAL_NAME FROM PSPRDMDEFN WHERE PORTAL_NAME=:p', { p: input.portal });
    if (!portal) throw new Error('Portal does not exist.');
    let parent = input.parent;
    const seen = new Set<string>();
    while (parent) {
      if (seen.has(parent) || (input.refType === 'F' && parent === input.name)) throw new Error('The selected parent would create a folder cycle.');
      seen.add(parent);
      const [folder] = await select<PortalRow>(c, "SELECT PORTAL_PRNTOBJNAME FROM PSPRSMDEFN WHERE PORTAL_NAME=:p AND PORTAL_REFTYPE='F' AND PORTAL_OBJNAME=:n", { p: input.portal, n: parent });
      if (!folder) throw new Error('Parent folder does not exist in this portal: ' + parent);
      parent = trim(folder.PORTAL_PRNTOBJNAME);
    }
    if (input.owner && !(await select(c, "SELECT FIELDVALUE FROM PSXLATITEM WHERE FIELDNAME='OBJECTOWNERID' AND FIELDVALUE=:o AND EFF_STATUS='A'", { o: input.owner })).length) throw new Error('Owner ID does not exist.');
    if (input.target?.type === 'component') {
      const t = input.target;
      if (!(await select(c, 'SELECT MSGNODENAME FROM PSMSGNODEDEFN WHERE MSGNODENAME=:n', { n: t.node })).length) throw new Error('Content provider node does not exist.');
      if (!(await select(c, 'SELECT PNLGRPNAME FROM PSMENUITEM WHERE MENUNAME=:m AND PNLGRPNAME=:c AND MARKET=:k', { m: t.menu, c: t.component, k: t.market })).length) throw new Error('Component/market is not registered on this menu.');
      if (t.page && !(await select(c, 'SELECT PNLNAME FROM PSPNLGROUP WHERE PNLGRPNAME=:c AND MARKET=:k AND PNLNAME=:pg', { c: t.component, k: t.market, pg: t.page })).length) throw new Error('Page is not in the selected component.');
    }
    for (const permission of input.permissions ?? []) {
      if (!(await select(c, permission.type === 'P' ? 'SELECT CLASSID FROM PSCLASSDEFN WHERE CLASSID=:v' : 'SELECT ROLENAME FROM PSROLEDEFN WHERE ROLENAME=:v', { v: permission.name })).length)
        throw new Error('Security principal does not exist: ' + permission.name);
    }
    const urlType = input.target?.type === 'component' ? 'UPGE' : input.target ? 'UEXT' : trim(current?.row.PORTAL_CREF_URLT);
    if (input.permissions?.some(p => p.type === 'R') && ['UPGE', 'USCR'].includes(urlType)) throw new Error('Component and iScript references use permission lists, not role grants.');
    if (input.refType === 'C' && input.permissions?.some(p => p.cascade)) throw new Error('Security cascading applies to folders only.');
    const version = Number(versions.find(v => v.OBJECTTYPENAME === 'PRSM')!.VERSION) + 1;
    const values: PortalRow = { PORTAL_PRNTOBJNAME: input.parent, PORTAL_LABEL: input.label, DESCR254: input.description || ' ',
      PORTAL_SEQ_NUM: input.sequence, OBJECTOWNERID: input.owner || ' ', ...(input.publicAccess === undefined ? {} : { PORTAL_ISPUBLIC: input.publicAccess ? 1 : 0 }),
      ...(input.target ? portalTargetColumns(input.target) : {}), VERSION: version, LASTUPDOPRID: request.operatorId };
    if (input.target && current && (trim(current.row.PORTAL_LINKOBJNAME) || trim(current.row.PORTAL_CREF_USGT) !== 'TARG')) throw new Error('Target changes are supported for ordinary target content references only. Other entry settings are preserved.');
    if (!current) Object.assign(values, {
      PORTAL_NAME: input.portal, PORTAL_REFTYPE: input.refType, PORTAL_OBJNAME: input.name,
      PORTAL_URL_CHKSUM: 0, PORTAL_CNTPRV_NAM: ' ', PORTAL_CREF_USGT: input.refType === 'C' ? 'TARG' : ' ',
      PORTAL_CREF_TMPT: input.refType === 'C' ? 'HTML' : ' ', PORTAL_CREF_STGT: input.refType === 'C' ? 'RMTE' : ' ', PORTAL_CREF_URLT: ' ',
      PORTAL_PRODUCT: ' ', OPRID: request.operatorId, PORTAL_TEMPL_NAME: ' ', PORTAL_STG_NAME: ' ', PORTAL_ISPUBLIC: input.publicAccess ? 1 : 0,
      PORTAL_LINKOBJNAME: ' ', PORTAL_LINK_PORTAL: ' ', PORTAL_URI_SEG1: ' ', PORTAL_URI_SEG2: ' ', PORTAL_URI_SEG3: ' ', PORTAL_URI_SEG4: ' ',
      FLUIDMODE: 0, SMALLFFOPT: 0, PORTAL_URLTEXT: null, ...(input.target ? portalTargetColumns(input.target) : {})
    });
    const vb = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, k === 'PORTAL_URLTEXT' ? { val: v, type: types.CLOB } : v]));
    if (current) await expectRows(c, `UPDATE PSPRSMDEFN SET ${Object.keys(values).map(k => `${k}=:${k}`).join(',')},LASTUPDDTTM=SYSTIMESTAMP WHERE ${where}`, { ...b, ...vb }, 1, 'Saving registry entry');
    else {
      await expectRows(c, `INSERT INTO PSPRSMDEFN (${Object.keys(values).join(',')},PORTAL_EFFDT,PORTAL_CREATION_DT,PORTAL_EXPIRE_DT,LASTUPDDTTM) VALUES (${Object.keys(values).map(k => ':' + k).join(',')},TRUNC(SYSDATE),TRUNC(SYSDATE),NULL,SYSTIMESTAMP)`, vb, 1, 'Creating registry entry');
      if (input.refType === 'C') await expectRows(c, `INSERT INTO PSPRSMNUI (PORTAL_NAME,PORTAL_OBJNAME,PORTAL_REFTYPE,PNLNAME,GROUPLET_ID,PORTAL_CNTPRV_NAM,PORTAL_CREF_URLT,PORTAL_URI_SEG1,PORTAL_URI_SEG2,PORTAL_URI_SEG3,PORTAL_URI_SEG4,IMAGE_FIELD,GROUPLET_DISPLAY,MODAL_PARAMS,GROUPLET_WIDTH,GROUPLET_HEIGHT,GROUPLET_TIMER,GROUPLET_TYPE,GROUPLET_AUTOSIZE,GROUPLET_ALTWIDTH,GROUPLET_ALTHEIGHT,GROUPLET_HS_DISABL,EVENTNAME,PORTAL_URLTEXT)
        VALUES (:p,:n,:t,' ',' ',' ','NONE',' ',' ',' ',' ',' ',0,' ',1,1,0,1,'N',0,0,'N',' ',NULL)`, b, 1, 'Creating content reference display settings');
    }
    if (input.permissions) {
      await c.execute(`DELETE FROM PSPRSMPERM WHERE ${where}`, b);
      for (const p of input.permissions) await expectRows(c, `INSERT INTO PSPRSMPERM (PORTAL_NAME,PORTAL_REFTYPE,PORTAL_OBJNAME,PORTAL_PERMNAME,PORTAL_PERMTYPE,PORTAL_ISCASCADE) VALUES (:p,:t,:n,:pn,:pt,:cascade)`, { ...b, pn: p.name, pt: p.type, cascade: p.cascade ? 1 : 0 }, 1, 'Saving direct security grant');
    }
    // Observed em02: the immediate parent takes PRSM and a new stamp; its operator stays unchanged.
    const parents = new Set([input.parent, ...(current ? [trim(current.row.PORTAL_PRNTOBJNAME)] : [])]);
    for (const p of parents) if (p) await expectRows(c, "UPDATE PSPRSMDEFN SET VERSION=:v,LASTUPDDTTM=SYSTIMESTAMP WHERE PORTAL_NAME=:p AND PORTAL_REFTYPE='F' AND PORTAL_OBJNAME=:n", { p: input.portal, n: p, v: version }, 1, 'Restamping parent folder');
    for (const row of versions) {
      const next = Number(row.VERSION) + 1;
      await expectRows(c, 'UPDATE PSVERSION SET VERSION=:v WHERE OBJECTTYPENAME=:t', { v: next, t: row.OBJECTTYPENAME }, 1, 'Updating registry cache version');
      if (row.OBJECTTYPENAME === 'PRSM') await c.execute("UPDATE PSLOCK SET VERSION=:v WHERE OBJECTTYPENAME='PRSM'", { v: next });
    }
    const saved = await readPortalDocument(c, types, input);
    if (!saved || Object.entries(values).some(([k, v]) => k === 'PORTAL_URLTEXT' ? String(saved.row[k] ?? '') !== String(v ?? '') : trim(saved.row[k]) !== trim(v))) throw new Error('Registry entry failed readback verification.');
    if (input.permissions) {
      const normalize = (items: { type: string; name: string; cascade: boolean }[]) => items.map(p => JSON.stringify([p.type, p.name, p.cascade])).sort();
      const actual = saved.permissions.map(p => ({ type: trim(p.PORTAL_PERMTYPE), name: trim(p.PORTAL_PERMNAME), cascade: Number(p.PORTAL_ISCASCADE) === 1 }));
      if (JSON.stringify(normalize(actual)) !== JSON.stringify(normalize(input.permissions))) throw new Error('Security grants failed readback verification.');
    }
    if (current && JSON.stringify(saved.attributes) !== JSON.stringify(current.attributes)) throw new Error('Registry attributes changed unexpectedly.');
    if (request.dryRun) await c.rollback(); else await c.commit();
    return saved;
  } catch (error) { await c.rollback(); throw error; }
}
