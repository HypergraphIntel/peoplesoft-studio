import type { DbConnection as Connection } from '../db/connection.js';
import { DefinitionType, type DefinitionKey } from '../model/definitions.js';
import { csDiscoveryFor, type CsConfiguration, type CsDiscovery, type CsFieldCounts } from '../model/configurableSearch.js';
import { select } from './peopleCodeWriter.js';

/*
 * Configurable Search discovery (model/configurableSearch.ts): a component's
 * content references and, for each, the search configuration in effect
 * (PS_PTS_SRCH_DEFN, the latest EFFDT not after today), its assignment status
 * (PS_PTS_SRCH_ASGN) and what its field rows (PS_PTS_SRCH_DTL_S for Standard,
 * _DTL_E for Keyword Search, at that EFFDT) change. Read only.
 */

const t = (v: unknown) => String(v ?? '').trim();

async function installed(c: Connection): Promise<boolean> {
  const [r] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM PSRECDEFN WHERE RECNAME = 'PTS_SRCH_DEFN'`);
  return Number(r?.N ?? 0) > 0;
}

async function contentReferences(c: Connection, component: string, market: string): Promise<string[]> {
  const rows = await select<{ N: string }>(c,
    `SELECT DISTINCT PORTAL_OBJNAME AS N FROM PSPRSMDEFN WHERE PORTAL_REFTYPE = 'C' AND PORTAL_URI_SEG2 = :c AND PORTAL_URI_SEG3 = :m
        AND PORTAL_CREF_USGT <> 'LINK' ORDER BY 1`, { c: component, m: market });
  return rows.map((r) => t(r.N));
}

/** The configurations in effect on a component's content references. */
export async function readCsConfigurations(c: Connection, component: string, market: string): Promise<CsConfiguration[]> {
  const rows = await select<Record<string, unknown>>(c,
    `SELECT D.PORTAL_NAME AS PN, D.PORTAL_OBJNAME AS N, D.PTS_SEARCH_ID AS ID, TO_CHAR(D.EFFDT, 'YYYY-MM-DD') AS EFFDT, D.EFFDT AS E, D.PTS_SRCH_TYPE AS TY,
            D.PTS_SRCH_RECNM AS REC, D.PTS_SRCH_ESDEF AS ES, D.PTS_SRCH_PG_LBL AS LBL, A.PTS_CONFIG_STATUS AS ST
       FROM PS_PTS_SRCH_DEFN D JOIN PSPRSMDEFN R ON R.PORTAL_NAME = D.PORTAL_NAME AND R.PORTAL_OBJNAME = D.PORTAL_OBJNAME
       LEFT JOIN PS_PTS_SRCH_ASGN A ON A.PTS_SEARCH_ID = D.PTS_SEARCH_ID AND A.PORTAL_NAME = D.PORTAL_NAME AND A.PORTAL_OBJNAME = D.PORTAL_OBJNAME
      WHERE R.PORTAL_URI_SEG2 = :c AND R.PORTAL_URI_SEG3 = :m
        AND D.EFFDT = (SELECT MAX(D1.EFFDT) FROM PS_PTS_SRCH_DEFN D1 WHERE D1.PORTAL_NAME = D.PORTAL_NAME AND D1.PORTAL_OBJNAME = D.PORTAL_OBJNAME
                          AND D1.PTS_SEARCH_ID = D.PTS_SEARCH_ID AND D1.EFFDT <= SYSDATE)
      ORDER BY D.PORTAL_OBJNAME, D.PTS_SEARCH_ID`, { c: component, m: market });
  const out: CsConfiguration[] = [];
  for (const r of rows) {
    const type = t(r.TY);
    const table = type === 'E' ? 'PS_PTS_SRCH_DTL_E' : 'PS_PTS_SRCH_DTL_S';
    const [f] = await select<Record<string, unknown>>(c,
      `SELECT COUNT(*) AS TOTAL, SUM(CASE WHEN PTS_INCL_IN_CRIT = 'Y' THEN 1 ELSE 0 END) AS CRIT, SUM(CASE WHEN PTS_INCL_IN_RSLT = 'Y' THEN 1 ELSE 0 END) AS RSLT,
              SUM(CASE WHEN PTS_INCL_IN_SFF = 'Y' THEN 1 ELSE 0 END) AS SFF, SUM(CASE WHEN PTS_SRCH_KEY_FLG = 'Y' THEN 1 ELSE 0 END) AS KEYS,
              SUM(CASE WHEN PTS_MODIFY_LBL = 'Y' THEN 1 ELSE 0 END) AS LBL, SUM(CASE WHEN PTS_REQUIRED = 'Y' THEN 1 ELSE 0 END) AS REQ,
              SUM(CASE WHEN PTS_HIDE = 'Y' THEN 1 ELSE 0 END) AS HID, SUM(CASE WHEN PTS_DISPLAYONLY = 'Y' THEN 1 ELSE 0 END) AS DSP,
              SUM(CASE WHEN TRIM(PTS_DEF_VALUE) IS NOT NULL THEN 1 ELSE 0 END) AS DEF
         FROM ${table} WHERE PORTAL_NAME = :pn AND PORTAL_OBJNAME = :n AND PTS_SEARCH_ID = :id AND EFFDT = :e`,
      { pn: r.PN, n: r.N, id: r.ID, e: r.E });
    const fields: CsFieldCounts = {
      total: Number(f?.TOTAL ?? 0), criteria: Number(f?.CRIT ?? 0), results: Number(f?.RSLT ?? 0), smallFormFactor: Number(f?.SFF ?? 0), keys: Number(f?.KEYS ?? 0),
      relabelled: Number(f?.LBL ?? 0), required: Number(f?.REQ ?? 0), hidden: Number(f?.HID ?? 0), displayOnly: Number(f?.DSP ?? 0), defaulted: Number(f?.DEF ?? 0)
    };
    out.push({
      cref: t(r.N), component, market, searchId: t(r.ID), effdt: t(r.EFFDT), type, source: type === 'E' ? t(r.ES) : t(r.REC),
      active: t(r.ST) === 'A', ...(t(r.LBL) ? { pageLabel: t(r.LBL) } : {}), fields
    });
  }
  return out;
}

async function discoverComponent(c: Connection, component: string, market: string, isInstalled: boolean): Promise<CsDiscovery> {
  const crefs = await contentReferences(c, component, market);
  return csDiscoveryFor(`${component}.${market}`, isInstalled, crefs, isInstalled ? await readCsConfigurations(c, component, market) : []);
}

/** Configurable Search discovery for a definition; undefined when it does not apply (components and their pages). */
export async function discoverConfigurableSearch(c: Connection, key: DefinitionKey): Promise<CsDiscovery | undefined> {
  switch (key.type) {
    case DefinitionType.Component:
    case DefinitionType.ComponentPeopleCode:
    case DefinitionType.ComponentRecordPeopleCode:
    case DefinitionType.ComponentRecordFieldPeopleCode:
      return discoverComponent(c, key.parts[0], key.parts[1] || 'GBL', await installed(c));
    case DefinitionType.Page:
    case DefinitionType.PagePeopleCode: {
      const page = key.parts[0];
      const isInstalled = await installed(c);
      const comps = await select<{ C: string; M: string }>(c,
        `SELECT DISTINCT PNLGRPNAME AS C, MARKET AS M FROM PSPNLGROUP WHERE PNLNAME = :p ORDER BY 1 FETCH FIRST 20 ROWS ONLY`, { p: page });
      if (!comps.length) {
        return { state: 'VERIFIED_UNAVAILABLE', installed: isInstalled, contentReferences: [], configurations: [],
          evidence: [`${page} is in no component: Configurable Search configures a component's search page.`] };
      }
      const parts: CsDiscovery[] = [];
      for (const r of comps) parts.push(await discoverComponent(c, t(r.C), t(r.M), isInstalled));
      const merged = csDiscoveryFor(`${page}'s ${comps.length === 1 ? 'component' : `${comps.length} components`}`, isInstalled,
        parts.flatMap((d) => d.contentReferences), parts.flatMap((d) => d.configurations));
      merged.evidence.unshift(`${page} is in ${comps.map((r) => `${t(r.C)}.${t(r.M)}`).join(', ')}.`);
      return merged;
    }
    default:
      return undefined;
  }
}
