import type { DbConnection as Connection } from '../db/connection.js';
import { DefinitionType, type DefinitionKey } from '../model/definitions.js';
import { pfcDiscoveryFor, type PfcConfiguration, type PfcDiscovery, type PfcSequence } from '../model/pageFieldConfigurator.js';
import { select } from './peopleCodeWriter.js';

/*
 * Page and Field Configurator discovery (model/pageFieldConfigurator.ts): a
 * component's configurations -- what each sequence changes -- its content
 * references, and which of them carry the EOCC Event Mapping that applies the
 * configurations at run time. Read only.
 */

const t = (v: unknown) => String(v ?? '').trim();
const EVENT_MAPPING_PORTAL = '_PTCS_PTEVMAP';

async function installed(c: Connection): Promise<boolean> {
  const [r] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM PSRECDEFN WHERE RECNAME = 'EOCC_CONFIG_HDR'`);
  return Number(r?.N ?? 0) > 0;
}

async function contentReferences(c: Connection, component: string, market: string): Promise<string[]> {
  const rows = await select<{ N: string }>(c,
    // Content reference links (PORTAL_CREF_USGT LINK) point at a target and get no EOCC mapping of their own [pfc01].
    `SELECT DISTINCT PORTAL_OBJNAME AS N FROM PSPRSMDEFN WHERE PORTAL_REFTYPE = 'C' AND PORTAL_URI_SEG2 = :c AND PORTAL_URI_SEG3 = :m
        AND PORTAL_CREF_USGT <> 'LINK' ORDER BY 1`,
    { c: component, m: market });
  return rows.map((r) => t(r.N));
}

async function appliedOn(c: Connection, crefs: readonly string[]): Promise<string[]> {
  if (!crefs.length) return [];
  const binds: Record<string, unknown> = { p: EVENT_MAPPING_PORTAL };
  crefs.forEach((n, i) => { binds[`n${i}`] = n; });
  const rows = await select<{ N: string }>(c,
    `SELECT DISTINCT PORTAL_OBJNAME AS N FROM PSPTCSSRVCONF WHERE PORTAL_NAME = :p AND PTCS_SERVICEID LIKE 'EOCC%'
        AND PORTAL_OBJNAME IN (${crefs.map((_, i) => `:n${i}`).join(', ')}) ORDER BY 1`, binds);
  return rows.map((r) => t(r.N));
}

/** The component's configurations, each sequence with what its page and field rows change. */
export async function readPfcConfigurations(c: Connection, component: string, market: string): Promise<PfcConfiguration[]> {
  const key = { c: component, m: market };
  const headers = await select<{ T: string; D: string; S: string }>(c,
    `SELECT EOCC_CONFIG_TYPE AS T, DESCR AS D, EFF_STATUS AS S FROM PS_EOCC_CONFIG_HDR WHERE PNLGRPNAME = :c AND MARKET = :m ORDER BY 1`, key);
  const out: PfcConfiguration[] = [];
  for (const h of headers) {
    const type = t(h.T);
    const k = { ...key, t: type };
    const seqs = await select<Record<string, unknown>>(c,
      `SELECT EOCC_SEQUENCE_NBR AS N, DESCR AS D, STATUS AS S, EOCC_APPLY_TO AS A, ROLENAME AS R,
              EOCC_SMALL_FF AS FS, EOCC_MEDIUM_FF AS FM, EOCC_LARGE_FF AS FL, EOCC_XLARGE_FF AS FX
         FROM PS_EOCC_CONFIG_SEQ WHERE PNLGRPNAME = :c AND MARKET = :m AND EOCC_CONFIG_TYPE = :t ORDER BY EOCC_SEQUENCE_NBR`, k);
    const fields = new Map((await select<Record<string, unknown>>(c,
      `SELECT EOCC_SEQUENCE_NBR AS N, COUNT(*) AS TOT,
              SUM(CASE WHEN EOCC_VISIBLE_FLAG = 'N' THEN 1 ELSE 0 END) AS HID, SUM(CASE WHEN EOCC_IS_REQUIRED = 'Y' THEN 1 ELSE 0 END) AS REQ,
              SUM(CASE WHEN EOCC_LBL_OVERRIDE = 'Y' THEN 1 ELSE 0 END) AS LBL, SUM(CASE WHEN EOCC_DISABLED = 'Y' THEN 1 ELSE 0 END) AS DIS,
              SUM(CASE WHEN TRIM(EOCC_DFLT_VALUE) IS NOT NULL THEN 1 ELSE 0 END) AS DEF, SUM(CASE WHEN EOCC_SET_BLANK = 'Y' THEN 1 ELSE 0 END) AS BLK,
              SUM(CASE WHEN EOCC_MASK_FLAG = 'Y' THEN 1 ELSE 0 END) AS MSK
         FROM PS_EOCC_CONFIG_FLD WHERE PNLGRPNAME = :c AND MARKET = :m AND EOCC_CONFIG_TYPE = :t GROUP BY EOCC_SEQUENCE_NBR`, k))
      .map((r) => [Number(r.N), r]));
    const pages = new Map((await select<Record<string, unknown>>(c,
      `SELECT EOCC_SEQUENCE_NBR AS N, SUM(CASE WHEN EOCC_VISIBLE_FLAG = 'N' THEN 1 ELSE 0 END) AS HID,
              SUM(CASE WHEN EOCC_VISIBLE_FLAG <> 'N' AND DISPLAYONLY = 1 THEN 1 ELSE 0 END) AS DSP
         FROM PS_EOCC_CONFIG_PNL WHERE PNLGRPNAME = :c AND MARKET = :m AND EOCC_CONFIG_TYPE = :t GROUP BY EOCC_SEQUENCE_NBR`, k))
      .map((r) => [Number(r.N), r]));
    const criteria = new Map((await select<{ N: number; C: number }>(c,
      `SELECT EOCC_SEQUENCE_NBR AS N, COUNT(*) AS C FROM PS_EOCC_CONFIG_CRT WHERE PNLGRPNAME = :c AND MARKET = :m AND EOCC_CONFIG_TYPE = :t GROUP BY EOCC_SEQUENCE_NBR`, k))
      .map((r) => [Number(r.N), Number(r.C)]));
    const n = (r: Record<string, unknown> | undefined, col: string) => Number(r?.[col] ?? 0);
    const sequences: PfcSequence[] = seqs.map((s) => {
      const num = Number(s.N);
      const f = fields.get(num);
      const p = pages.get(num);
      return {
        number: num, description: t(s.D), active: t(s.S) !== 'I', applyTo: t(s.A), ...(t(s.R) ? { role: t(s.R) } : {}),
        formFactors: [['FS', 'Small'], ['FM', 'Medium'], ['FL', 'Large'], ['FX', 'Extra Large']].filter(([col]) => t(s[col]) === 'Y').map(([, label]) => label),
        criteria: criteria.get(num) ?? 0, pagesHidden: n(p, 'HID'), pagesDisplayOnly: n(p, 'DSP'),
        fields: { total: n(f, 'TOT'), hidden: n(f, 'HID'), required: n(f, 'REQ'), relabelled: n(f, 'LBL'), disabled: n(f, 'DIS'), defaulted: n(f, 'DEF'), blanked: n(f, 'BLK'), masked: n(f, 'MSK') }
      };
    });
    out.push({ component, market, type, description: t(h.D), active: t(h.S) !== 'I', sequences });
  }
  return out;
}

async function discoverComponent(c: Connection, component: string, market: string, isInstalled: boolean): Promise<PfcDiscovery> {
  const crefs = await contentReferences(c, component, market);
  const configs = isInstalled ? await readPfcConfigurations(c, component, market) : [];
  const d = pfcDiscoveryFor(`${component}.${market}`, isInstalled, crefs, isInstalled ? await appliedOn(c, crefs) : [], configs);
  return crefs.length ? { ...d, components: [{ component, market }] } : d;
}

/** Page and Field Configurator discovery for a definition; undefined when it does not apply (components and their pages). */
export async function discoverPageFieldConfigurator(c: Connection, key: DefinitionKey): Promise<PfcDiscovery | undefined> {
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
        return { state: 'VERIFIED_UNAVAILABLE', installed: isInstalled, contentReferences: [], appliedOn: [], configurations: [],
          evidence: [`${page} is in no component: Page and Field Configurator configures a component's pages.`] };
      }
      // The page's components, as one: their content references, applied mapping and configurations.
      const parts: PfcDiscovery[] = [];
      for (const r of comps) parts.push(await discoverComponent(c, t(r.C), t(r.M), isInstalled));
      const merged = pfcDiscoveryFor(`${page}'s ${comps.length === 1 ? 'component' : `${comps.length} components`}`, isInstalled,
        parts.flatMap((d) => d.contentReferences), parts.flatMap((d) => d.appliedOn), parts.flatMap((d) => d.configurations));
      merged.components = parts.flatMap((d) => d.components ?? []);
      merged.evidence.unshift(`${page} is in ${comps.map((r) => `${t(r.C)}.${t(r.M)}`).join(', ')}.`);
      return merged;
    }
    default:
      return undefined;
  }
}
