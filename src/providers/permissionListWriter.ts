import type { DbConnection, DbTypes } from '../db/connection.js';
import { writeScopeRefusal } from './writeScope.js';

/*
 * Granting a permission list access to a component's pages and to process groups, as the Permission Lists
 * component (ACCESS_CNTRL_LISTX) saves it -- HRDMO evidence, docs/SECURITY.md "Granting access":
 *
 *   PSAUTHITEM   one row per page: CLASSID, MENUNAME, BARNAME, BARITEMNAME (the menu item), PNLITEMNAME (the
 *                component's page item), DISPLAYONLY, AUTHORIZEDACTIONS -- the component's ACTIONS mask on the
 *                vast majority of HRDMO grants (Full Access), 1 Add, 2 Update/Display, 4 Update/Display All, 8 Correction.
 *   PSAUTHPRCS   one row per process group: CLASSID, PRCSGRP (Process Group Permissions).
 *   Counters     SavePreChange UpdatePSLOCK: PSLOCK CLM + 1; SavePostChange UpdateSystemVersions: PSVERSION CLM + 1
 *                and SYS + 1, PSCLASSDEFN.VERSION = the new PSVERSION CLM; LASTUPDDTTM / LASTUPDOPRID stamped.
 *
 * The component's SavePostChange also grants the permission list on the portal registry's content references
 * for the component (GrantPermissionForComponent). That is not written here: the result lists those content
 * references and whether each grants the permission list, for psft_portal_edit (the portal writer's PRSM counters).
 */

export interface PermissionGrantRequest {
  classId: string;
  /** Component pages to grant: the menu the component is registered on, the component and market. */
  components: Array<{ menu: string; component: string; market: string; pages?: string[]; actions?: number; displayOnly?: boolean }>;
  processGroups: string[];
  operatorId: string;
  /** Write scope is checked on these names (the components and process groups being opened up), not the permission list. */
  scopeNames: string[];
  dryRun?: boolean;
}

export interface PermissionGrantResult {
  classId: string;
  version: number;
  pages: Array<{ menu: string; bar: string; item: string; page: string; actions: number; displayOnly: boolean; change: 'inserted' | 'updated' | 'unchanged' }>;
  processGroups: Array<{ group: string; change: 'inserted' | 'unchanged' }>;
  contentReferences: Array<{ portal: string; name: string; label: string; grantsPermissionList: boolean }>;
}

export async function grantPermissionListAccess(c: DbConnection, types: DbTypes, request: PermissionGrantRequest): Promise<PermissionGrantResult> {
  const q = async <T>(sql: string, b: Record<string, unknown> = {}) => (await c.execute<T>(sql, b, { outFormat: types.OUT_FORMAT_OBJECT })).rows ?? [];
  const run = async (sql: string, b: Record<string, unknown>, count: number, what: string) => {
    if ((await c.execute(sql, b)).rowsAffected !== count) throw new Error(`${what} affected an unexpected number of rows.`);
  };
  const classId = request.classId.trim();
  try {
    for (const n of request.scopeNames) { const scope = writeScopeRefusal(n); if (scope) throw new Error(scope); }
    if (!request.components.length && !request.processGroups.length) throw new Error('Nothing to grant.');
    if (!(await q('SELECT OPRID FROM PSOPRDEFN WHERE OPRID=:o', { o: request.operatorId })).length) throw new Error('A valid PeopleSoft Operator ID is required.');
    const [lock] = await q<{ VERSION: number }>("SELECT VERSION FROM PSLOCK WHERE OBJECTTYPENAME='CLM' FOR UPDATE");
    const counters = await q<{ OBJECTTYPENAME: string; VERSION: number }>("SELECT OBJECTTYPENAME, VERSION FROM PSVERSION WHERE OBJECTTYPENAME IN ('CLM','SYS') FOR UPDATE");
    const clm = counters.find((r) => r.OBJECTTYPENAME.trim() === 'CLM'), sys = counters.find((r) => r.OBJECTTYPENAME.trim() === 'SYS');
    if (!lock || !clm || !sys) throw new Error('Security version counters (PSLOCK/PSVERSION CLM, SYS) are missing.');
    if (!(await q('SELECT CLASSID FROM PSCLASSDEFN WHERE CLASSID=:k FOR UPDATE', { k: classId })).length) throw new Error(`There is no permission list ${classId}.`);

    const pages: PermissionGrantResult['pages'] = [];
    const crefs: PermissionGrantResult['contentReferences'] = [];
    for (const g of request.components) {
      const menu = g.menu.trim().toUpperCase(), component = g.component.trim().toUpperCase(), market = (g.market || 'GBL').trim().toUpperCase();
      const [comp] = await q<{ ACTIONS: number }>('SELECT ACTIONS FROM PSPNLGRPDEFN WHERE PNLGRPNAME=:c AND MARKET=:m', { c: component, m: market });
      if (!comp) throw new Error(`There is no component ${component}.${market}.`);
      const items = await q<{ BARNAME: string; ITEMNAME: string }>('SELECT BARNAME, ITEMNAME FROM PSMENUITEM WHERE MENUNAME=:menu AND PNLGRPNAME=:c AND MARKET=:m',
        { menu, c: component, m: market });
      if (!items.length) throw new Error(`${component}.${market} is not registered on menu ${menu} (psft_menu_edit adds it).`);
      if (items.length > 1) throw new Error(`${component}.${market} is on menu ${menu} more than once; grant through PIA.`);
      const compPages = (await q<{ ITEMNAME: string }>('SELECT ITEMNAME FROM PSPNLGROUP WHERE PNLGRPNAME=:c AND MARKET=:m ORDER BY SUBITEMNUM', { c: component, m: market }))
        .map((r) => r.ITEMNAME.trim());
      const wanted = g.pages?.length ? g.pages.map((p) => p.trim().toUpperCase()) : compPages;
      for (const p of wanted) if (!compPages.includes(p)) throw new Error(`${p} is not a page item of ${component}.${market} (${compPages.join(', ')}).`);
      const allowed = Number(comp.ACTIONS);
      const actions = g.actions ?? allowed;
      if (!actions || (actions & ~allowed)) throw new Error(`Actions ${actions} are not a non-empty subset of the component's actions (${allowed}).`);
      const displayOnly = g.displayOnly ? 1 : 0;
      const bar = items[0].BARNAME.trim(), item = items[0].ITEMNAME.trim();
      for (const page of wanted) {
        const key = { k: classId, menu, bar, item, page };
        const [existing] = await q<{ DISPLAYONLY: number; AUTHORIZEDACTIONS: number }>(
          'SELECT DISPLAYONLY, AUTHORIZEDACTIONS FROM PSAUTHITEM WHERE CLASSID=:k AND MENUNAME=:menu AND BARNAME=:bar AND BARITEMNAME=:item AND PNLITEMNAME=:page', key);
        let change: 'inserted' | 'updated' | 'unchanged' = 'unchanged';
        if (!existing) {
          await run('INSERT INTO PSAUTHITEM (CLASSID, MENUNAME, BARNAME, BARITEMNAME, PNLITEMNAME, DISPLAYONLY, AUTHORIZEDACTIONS) VALUES (:k, :menu, :bar, :item, :page, :d, :a)',
            { ...key, d: displayOnly, a: actions }, 1, 'Granting page access');
          change = 'inserted';
        } else if (Number(existing.DISPLAYONLY) !== displayOnly || Number(existing.AUTHORIZEDACTIONS) !== actions) {
          await run('UPDATE PSAUTHITEM SET DISPLAYONLY=:d, AUTHORIZEDACTIONS=:a WHERE CLASSID=:k AND MENUNAME=:menu AND BARNAME=:bar AND BARITEMNAME=:item AND PNLITEMNAME=:page',
            { ...key, d: displayOnly, a: actions }, 1, 'Updating page access');
          change = 'updated';
        }
        pages.push({ menu, bar, item, page, actions, displayOnly: !!displayOnly, change });
      }
      for (const r of await q<{ PORTAL_NAME: string; PORTAL_OBJNAME: string; PORTAL_LABEL: string; N: number }>(
        `SELECT D.PORTAL_NAME, D.PORTAL_OBJNAME, D.PORTAL_LABEL, (SELECT COUNT(*) FROM PSPRSMPERM P WHERE P.PORTAL_NAME=D.PORTAL_NAME AND P.PORTAL_REFTYPE=D.PORTAL_REFTYPE
           AND P.PORTAL_OBJNAME=D.PORTAL_OBJNAME AND P.PORTAL_PERMTYPE='P' AND P.PORTAL_PERMNAME=:k) AS N
         FROM PSPRSMDEFN D WHERE D.PORTAL_REFTYPE='C' AND D.PORTAL_URI_SEG1=:menu AND D.PORTAL_URI_SEG2=:c AND D.PORTAL_URI_SEG3=:m`, { k: classId, menu, c: component, m: market })) {
        crefs.push({ portal: r.PORTAL_NAME.trim(), name: r.PORTAL_OBJNAME.trim(), label: r.PORTAL_LABEL.trim(), grantsPermissionList: Number(r.N) > 0 });
      }
    }

    const groups: PermissionGrantResult['processGroups'] = [];
    for (const raw of request.processGroups) {
      const group = raw.trim().toUpperCase();
      if (!group) continue;
      if ((await q('SELECT 1 FROM PSAUTHPRCS WHERE CLASSID=:k AND PRCSGRP=:g', { k: classId, g: group })).length) { groups.push({ group, change: 'unchanged' }); continue; }
      if (!(await q('SELECT 1 FROM PS_PRCSDEFNGRP WHERE PRCSGRP=:g', { g: group })).length) throw new Error(`No process definition is in process group ${group}; add it to the process definition first.`);
      await run('INSERT INTO PSAUTHPRCS (CLASSID, PRCSGRP) VALUES (:k, :g)', { k: classId, g: group }, 1, 'Granting process group access');
      groups.push({ group, change: 'inserted' });
    }

    const changed = pages.some((p) => p.change !== 'unchanged') || groups.some((g) => g.change !== 'unchanged');
    let version = 0;
    if (changed) {
      version = Number(clm.VERSION) + 1;
      await run("UPDATE PSLOCK SET VERSION=:v WHERE OBJECTTYPENAME='CLM'", { v: Number(lock.VERSION) + 1 }, 1, 'PSLOCK CLM');
      await run("UPDATE PSVERSION SET VERSION=VERSION+1 WHERE OBJECTTYPENAME IN ('CLM','SYS')", {}, 2, 'PSVERSION CLM/SYS');
      await run('UPDATE PSCLASSDEFN SET VERSION=:v, LASTUPDDTTM=SYSTIMESTAMP, LASTUPDOPRID=:o WHERE CLASSID=:k', { v: version, o: request.operatorId, k: classId }, 1, 'PSCLASSDEFN');
      // Readback: every granted row as asked.
      for (const p of pages) {
        const [r] = await q<{ DISPLAYONLY: number; AUTHORIZEDACTIONS: number }>(
          'SELECT DISPLAYONLY, AUTHORIZEDACTIONS FROM PSAUTHITEM WHERE CLASSID=:k AND MENUNAME=:menu AND BARNAME=:bar AND BARITEMNAME=:item AND PNLITEMNAME=:page',
          { k: classId, menu: p.menu, bar: p.bar, item: p.item, page: p.page });
        if (!r || Number(r.AUTHORIZEDACTIONS) !== p.actions || Number(r.DISPLAYONLY) !== (p.displayOnly ? 1 : 0)) throw new Error('Permission list save failed readback verification.');
      }
      for (const g of groups) if (!(await q('SELECT 1 FROM PSAUTHPRCS WHERE CLASSID=:k AND PRCSGRP=:g', { k: classId, g: g.group })).length) throw new Error('Process group grant failed readback verification.');
    } else {
      version = Number((await q<{ VERSION: number }>('SELECT VERSION FROM PSCLASSDEFN WHERE CLASSID=:k', { k: classId }))[0].VERSION);
    }
    if (request.dryRun || !changed) await c.rollback(); else await c.commit();
    return { classId, version, pages, processGroups: groups, contentReferences: crefs };
  } catch (e) { await c.rollback(); throw e; }
}
