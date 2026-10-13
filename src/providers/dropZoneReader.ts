import type { DbConnection as Connection } from '../db/connection.js';
import { DefinitionType, type DefinitionKey } from '../model/definitions.js';
import {
  DROP_ZONE_GROUP_BOX_TYPE, DROP_ZONE_SERVICE_URL_TYPE, UNREGISTERED_COMPONENT_PORTAL,
  dropZoneDiscoveryFor, dropZoneFieldName, dropZoneLabel, type DropZone, type DropZoneDiscovery
} from '../model/dropZones.js';
import { select } from './peopleCodeWriter.js';

/*
 * Drop Zone discovery (model/dropZones.ts): the drop zones on a component's
 * pages -- followed into the subpages and secondary pages they place, as
 * Configure Drop Zones follows them -- and the custom subpage configured into
 * each. Read only.
 */

const SUBPAGE = 11;
const SECONDARY_PAGE = 18;
/** A bound on the pages walked from one component page, against a cycle or a runaway tree. */
const MAX_CONTAINERS = 400;

const t = (v: unknown) => String(v ?? '').trim();

async function stubSubpageName(c: Connection): Promise<string> {
  const [r] = await select<{ S: string }>(c, `SELECT PTSTUBSUBPAGE AS S FROM PSOPTIONS`);
  return t(r?.S);
}

/**
 * The pages and subpages a page shows, each with the page it shows on: a subpage shows on the page that
 * places it, a secondary page is a page of its own (GetDZConfigForComponent's dzInfoPageName).
 */
async function containersOf(c: Connection, top: string, stub: string): Promise<Array<{ container: string; page: string }>> {
  const out: Array<{ container: string; page: string }> = [{ container: top, page: top }];
  const seen = new Set([`${top}|${top}`]);
  for (let i = 0; i < out.length && out.length < MAX_CONTAINERS; i++) {
    const { container, page } = out[i];
    const rows = await select<{ S: string; T: number }>(c,
      `SELECT DISTINCT SUBPNLNAME AS S, FIELDTYPE AS T FROM PSPNLFIELD WHERE PNLNAME = :p AND FIELDTYPE IN (${SUBPAGE}, ${SECONDARY_PAGE}) AND SUBPNLNAME <> :stub`,
      { p: container, stub });
    for (const r of rows) {
      const sub = t(r.S);
      if (!sub) continue;
      const next = { container: sub, page: Number(r.T) === SECONDARY_PAGE ? sub : page };
      const k = `${next.container}|${next.page}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(next);
    }
  }
  return out;
}

interface ZoneRow { ID: number; NUM: number; LVL: number; REC: string; FLD: string; TXT: string; LT: number; MSG: string }

/** The drop zones defined on one page or subpage: a type-21 group box immediately followed by the stub subpage. */
async function zonesIn(c: Connection, container: string, stub: string): Promise<ZoneRow[]> {
  return select<ZoneRow>(c,
    `SELECT G.PNLFLDID AS ID, G.FIELDNUM AS NUM, G.OCCURSLEVEL AS LVL, G.RECNAME AS REC, G.FIELDNAME AS FLD, G.LBLTEXT AS TXT, G.LBLTYPE AS LT,
            M.MESSAGE_TEXT AS MSG
       FROM PSPNLFIELD S
       JOIN PSPNLFIELD G ON G.PNLNAME = S.PNLNAME AND G.FIELDNUM = S.FIELDNUM - 1 AND G.FIELDTYPE = 2
       JOIN PSPNLFIELDEXT X ON X.PNLNAME = G.PNLNAME AND X.PNLFLDID = G.PNLFLDID AND X.GRPBOXTYPE = ${DROP_ZONE_GROUP_BOX_TYPE}
       LEFT JOIN PSMSGCATDEFN M ON M.MESSAGE_SET_NBR = G.GRDLBLMSGSET AND M.MESSAGE_NBR = G.GRDLBLMSGNUM
      WHERE S.PNLNAME = :p AND S.SUBPNLNAME = :stub
      ORDER BY G.FIELDNUM`, { p: container, stub });
}

/** The portals and content references a component's drop-zone configuration can be stored under. */
async function configurationOwners(c: Connection, component: string, market: string): Promise<Array<{ portal: string; name: string }>> {
  const rows = await select<{ P: string; N: string }>(c,
    `SELECT DISTINCT PORTAL_NAME AS P, PORTAL_OBJNAME AS N FROM PSPRSMDEFN WHERE PORTAL_REFTYPE = 'C' AND PORTAL_URI_SEG2 = :c AND PORTAL_URI_SEG3 = :m`,
    { c: component, m: market });
  return [...rows.map((r) => ({ portal: t(r.P), name: t(r.N) })), { portal: UNREGISTERED_COMPONENT_PORTAL, name: component }];
}

/** The custom subpage configured into each drop zone of a component, by "<page>|<fieldName>". */
async function configuredSubpages(c: Connection, component: string, market: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const o of await configurationOwners(c, component, market)) {
    const rows = await select<{ PNL: string; FLD: string; SUB: string }>(c,
      `SELECT M.PTCS_PNLNAME AS PNL, M.PTCS_PNLFLDNAME AS FLD, D.PNLNAME AS SUB
         FROM PSPTCS_MAPFLDS M
         JOIN PSPTCSSRVCONF C ON C.PORTAL_NAME = M.PORTAL_NAME AND C.PORTAL_OBJNAME = M.PORTAL_OBJNAME
                             AND C.PTCS_SERVICEID = M.PTCS_SERVICEID AND C.PTCS_INSTANCEID = M.PTCS_INSTANCEID
         JOIN PSPTCSSRVDEFN D ON D.PTCS_SERVICEID = C.PTCS_SERVICEID AND D.PTCS_SERVICEURLTYP = '${DROP_ZONE_SERVICE_URL_TYPE}'
        WHERE M.PORTAL_NAME = :p AND M.PORTAL_OBJNAME = :n AND M.PTCS_PARAMETERNAME = 'PTCS_MENUFIELD'
          AND C.PTCS_EMBEDDABLE = 'Y' AND C.PTCS_SUOWSERV = 'Y' AND C.VERSION <> 0`, { p: o.portal, n: o.name });
    for (const r of rows) out.set(`${t(r.PNL)}|${t(r.FLD)}`, t(r.SUB));
  }
  return out;
}

/** Every drop zone of a component (its pages in order), with any configured subpage. */
export async function readComponentDropZones(c: Connection, component: string, market: string, stub?: string): Promise<DropZone[]> {
  const stubName = stub ?? await stubSubpageName(c);
  if (!stubName) return [];
  const pages = await select<{ P: string }>(c,
    `SELECT PNLNAME AS P FROM PSPNLGROUP WHERE PNLGRPNAME = :c AND MARKET = :m ORDER BY SUBITEMNUM`, { c: component, m: market });
  const configured = await configuredSubpages(c, component, market);
  const zones: DropZone[] = [];
  const seen = new Set<string>();
  for (const { P } of pages) {
    const top = t(P);
    for (const { container, page } of await containersOf(c, top, stubName)) {
      for (const z of await zonesIn(c, container, stubName)) {
        const record = t(z.REC);
        const field = t(z.FLD);
        const id = Number(z.ID);
        const fieldName = dropZoneFieldName(Number(z.LVL), record, field, id);
        const fieldId = `${top}.${id}.`;
        const key = `${page}|${container}|${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const text = t(z.TXT) || (Number(z.LT) === 7 ? t(z.MSG) : '');
        const subpage = configured.get(`${page}|${fieldName}`);
        zones.push({
          component, market, page, container, groupBoxId: id, tabOrder: Number(z.NUM), level: Number(z.LVL), record, field,
          label: dropZoneLabel(text, record, field, fieldId), fieldName, fieldId, ...(subpage ? { subpage } : {})
        });
      }
    }
  }
  return zones;
}

/** Drop Zone discovery for a definition; undefined when Drop Zones do not apply to its type (they are on pages). */
export async function discoverDropZones(c: Connection, key: DefinitionKey): Promise<DropZoneDiscovery | undefined> {
  const stub = await stubSubpageName(c);
  switch (key.type) {
    case DefinitionType.Component:
    case DefinitionType.ComponentPeopleCode:
    case DefinitionType.ComponentRecordPeopleCode:
    case DefinitionType.ComponentRecordFieldPeopleCode: {
      const component = key.parts[0];
      const market = key.parts[1] || 'GBL';
      return dropZoneDiscoveryFor(`${component}.${market}`, stub ? await readComponentDropZones(c, component, market, stub) : [], stub);
    }
    case DefinitionType.Page:
    case DefinitionType.PagePeopleCode: {
      const page = key.parts[0];
      const comps = await select<{ C: string; M: string }>(c,
        `SELECT DISTINCT PNLGRPNAME AS C, MARKET AS M FROM PSPNLGROUP WHERE PNLNAME = :p FETCH FIRST 20 ROWS ONLY`, { p: page });
      const zones: DropZone[] = [];
      if (stub) {
        if (comps.length) {
          // As each component sees it (so a configured subpage is read where it is configured); this page's zones only.
          const seen = new Set<string>();
          for (const r of comps) {
            for (const z of await readComponentDropZones(c, t(r.C), t(r.M), stub)) {
              if (z.page !== page && !z.fieldId.startsWith(`${page}.`)) continue;
              const k = `${z.component}|${z.container}|${z.groupBoxId}`;
              if (!seen.has(k)) { seen.add(k); zones.push(z); }
            }
          }
        } else {
          for (const { container } of await containersOf(c, page, stub)) {
            for (const z of await zonesIn(c, container, stub)) {
              const record = t(z.REC); const field = t(z.FLD); const id = Number(z.ID);
              const fieldId = `${page}.${id}.`;
              zones.push({ component: '', market: '', page, container, groupBoxId: id, tabOrder: Number(z.NUM), level: Number(z.LVL), record, field,
                label: dropZoneLabel(t(z.TXT) || (Number(z.LT) === 7 ? t(z.MSG) : ''), record, field, fieldId),
                fieldName: dropZoneFieldName(Number(z.LVL), record, field, id), fieldId });
            }
          }
        }
      }
      return dropZoneDiscoveryFor(page, zones, stub);
    }
    default:
      return undefined;
  }
}
