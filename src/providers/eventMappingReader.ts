import type { DbConnection as Connection } from '../db/connection.js';
import { DefinitionType, type DefinitionKey } from '../model/definitions.js';
import { discoveryFor, EVENT_MAPPING_PORTAL, type ContentReference, type EventMappingDiscovery, type EventMappingRow } from '../model/eventMapping.js';
import { select, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';

/*
 * Event Mapping discovery (model/eventMapping.ts, docs/CUSTOMIZATION.md):
 * whether a definition can take Event Mapping on this database -- its
 * component(s) registered as content references -- and the configurations
 * already on them, with their services' application classes. Read only.
 */

interface ComponentRef { component: string; market: string }

async function contentReferences(c: Connection, components: readonly ComponentRef[]): Promise<ContentReference[]> {
  const out: ContentReference[] = [];
  const seen = new Set<string>();
  for (const { component, market } of components) {
    const rows = await select<{ P: string; N: string; L: string; M: string }>(c,
      `SELECT PORTAL_NAME AS P, PORTAL_OBJNAME AS N, PORTAL_LABEL AS L, PORTAL_URI_SEG1 AS M FROM PSPRSMDEFN
        WHERE PORTAL_REFTYPE = 'C' AND PORTAL_URI_SEG2 = :c AND PORTAL_URI_SEG3 = :m ORDER BY PORTAL_NAME, PORTAL_OBJNAME`, { c: component, m: market });
    for (const r of rows) {
      const k = `${String(r.P).trim()}.${String(r.N).trim()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ portal: String(r.P).trim(), name: String(r.N).trim(), label: String(r.L ?? '').trim(), menu: String(r.M ?? '').trim() });
    }
  }
  return out;
}

const MAPPING_COLUMNS = `C.PORTAL_OBJNAME AS CREF, C.PTCS_SERVICEID AS SID, C.PTCS_ISCOMPSERVICE AS LVL, C.PNLNAME AS PNL, C.RECNAME AS REC, C.FIELDNAME AS FLD,
  C.PTCS_CMPEVENT AS CEV, C.PTCS_CMPRECEVENT AS REV, C.PTCS_PROCSEQ AS PROC, C.SEQNUM AS SEQ, C.PTCS_ENABLE AS ENA, C.LASTUPDOPRID AS OPR,
  TO_CHAR(C.LASTUPDDTTM, ${TIMESTAMP_FORMAT}) AS DTTM, D.PACKAGEROOT AS PKG, D.QUALIFYPATH AS QP, D.APPCLASSID AS CLS`;

function mappingOf(r: Record<string, unknown>): EventMappingRow {
  const s = (v: unknown) => String(v ?? '').trim();
  const level = s(r.LVL);
  const pkg = s(r.PKG);
  const path = s(r.QP);
  return {
    contentReference: s(r.CREF), serviceId: s(r.SID), level,
    ...(pkg ? { applicationClass: [pkg, ...(path && path !== ':' ? path.split(':').filter(Boolean) : []), s(r.CLS)].join(':') } : {}),
    ...(s(r.PNL) ? { page: s(r.PNL) } : {}), ...(s(r.REC) ? { record: s(r.REC) } : {}), ...(s(r.FLD) ? { field: s(r.FLD) } : {}),
    event: level === 'C' ? s(r.CEV) : s(r.REV), processing: s(r.PROC), sequence: Number(r.SEQ ?? 0), enabled: s(r.ENA) === 'Y',
    ...(s(r.OPR) ? { operator: s(r.OPR) } : {}), ...(s(r.DTTM) ? { updated: s(r.DTTM).slice(0, 19) } : {})
  };
}

async function mappingsOn(c: Connection, crefs: readonly ContentReference[], where = '', binds: Record<string, unknown> = {}): Promise<EventMappingRow[]> {
  const names = [...new Set(crefs.map((r) => r.name))];
  if (!names.length) return [];
  const out: EventMappingRow[] = [];
  // In chunks: an IN list has a size limit.
  for (let i = 0; i < names.length; i += 500) {
    const chunk = names.slice(i, i + 500);
    const b: Record<string, unknown> = { ...binds, p: EVENT_MAPPING_PORTAL };
    chunk.forEach((n, j) => { b[`n${j}`] = n; });
    const rows = await select<Record<string, unknown>>(c,
      `SELECT ${MAPPING_COLUMNS} FROM PSPTCSSRVCONF C LEFT JOIN PSPTCSSRVDEFN D ON D.PTCS_SERVICEID = C.PTCS_SERVICEID
        WHERE C.PORTAL_NAME = :p AND C.PORTAL_OBJNAME IN (${chunk.map((_, j) => `:n${j}`).join(', ')})${where}
        ORDER BY C.PORTAL_OBJNAME, C.PTCS_ISCOMPSERVICE, C.SEQNUM, C.PTCS_SERVICEID`, b);
    out.push(...rows.map(mappingOf));
  }
  return out;
}

async function serviceCount(c: Connection): Promise<number> {
  const [r] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM PSPTCSSRVDEFN WHERE PTCS_SERVICEURLTYP = 'UAPC'`);
  return Number(r?.N ?? 0);
}

/** The components a page is in, or a record is used on (on the components' own pages; subpages not followed). */
async function componentsOf(c: Connection, key: DefinitionKey): Promise<ComponentRef[]> {
  const rows = key.type === DefinitionType.Page
    ? await select<{ C: string; M: string }>(c, `SELECT DISTINCT PNLGRPNAME AS C, MARKET AS M FROM PSPNLGROUP WHERE PNLNAME = :x FETCH FIRST 200 ROWS ONLY`, { x: key.parts[0] })
    : await select<{ C: string; M: string }>(c,
      `SELECT DISTINCT G.PNLGRPNAME AS C, G.MARKET AS M FROM PSPNLGROUP G WHERE G.PNLNAME IN (SELECT F.PNLNAME FROM PSPNLFIELD F WHERE F.RECNAME = :x)
        FETCH FIRST 200 ROWS ONLY`, { x: key.parts[0] });
  return rows.map((r) => ({ component: String(r.C).trim(), market: String(r.M).trim() }));
}

/** The definition Event Mapping is judged on: a component, a page, or a record (their PeopleCode by its owner). */
function subject(key: DefinitionKey): { kind: 'component' | 'page' | 'record'; key: DefinitionKey } | undefined {
  const p = key.parts;
  switch (key.type) {
    case DefinitionType.Component:
    case DefinitionType.ComponentPeopleCode:
    case DefinitionType.ComponentRecordPeopleCode:
    case DefinitionType.ComponentRecordFieldPeopleCode:
      return { kind: 'component', key: { type: DefinitionType.Component, parts: [p[0], p[1] || 'GBL'] } };
    case DefinitionType.Page:
    case DefinitionType.PagePeopleCode:
      return { kind: 'page', key: { type: DefinitionType.Page, parts: [p[0]] } };
    case DefinitionType.Record:
    case DefinitionType.RecordPeopleCode:
      return { kind: 'record', key: { type: DefinitionType.Record, parts: [p[0]] } };
    default:
      return undefined;
  }
}

/** Event Mapping discovery for a definition; undefined when Event Mapping does not apply to its type. */
export async function discoverEventMapping(c: Connection, key: DefinitionKey): Promise<EventMappingDiscovery | undefined> {
  const s = subject(key);
  if (!s) return undefined;
  const services = await serviceCount(c);
  if (s.kind === 'component') {
    const [component, market] = s.key.parts;
    const crefs = await contentReferences(c, [{ component, market }]);
    return discoveryFor(`${component}.${market}`, crefs, await mappingsOn(c, crefs), services);
  }
  const name = s.key.parts[0];
  const components = await componentsOf(c, s.key);
  if (!components.length) {
    return { state: 'VERIFIED_UNAVAILABLE', contentReferences: [], mappings: [], services,
      evidence: [`${name} is in no component${s.kind === 'record' ? '\'s pages' : ''}: Event Mapping maps a component's events.`] };
  }
  const crefs = await contentReferences(c, components);
  const where = s.kind === 'page' ? ` AND C.PNLNAME = :x` : ` AND C.RECNAME = :x`;
  const mappings = await mappingsOn(c, crefs, where, { x: name });
  const d = discoveryFor(`${name}'s ${components.length === 1 ? 'component' : `${components.length} components`}`, crefs, mappings, services);
  d.evidence.unshift(`${name} is ${s.kind === 'page' ? 'in' : 'used on the pages of'} ${components.length} component${components.length === 1 ? '' : 's'}: ` +
    `${components.slice(0, 5).map((x) => `${x.component}.${x.market}`).join(', ')}${components.length > 5 ? ' ...' : ''}.`);
  if (d.state === 'VERIFIED_AVAILABLE') d.evidence[2] = mappings.length
    ? `${mappings.length} configuration${mappings.length === 1 ? '' : 's'} name ${name} directly.`
    : `No configuration names ${name} directly (component-level ones may still run on it).`;
  return d;
}
