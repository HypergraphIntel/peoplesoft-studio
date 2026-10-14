import type { DbConnection as Connection } from '../db/connection.js';
import { select } from './peopleCodeWriter.js';

/*
 * The Event Mapping a Page and Field Configurator configuration needs, as the
 * configurator works it out when it saves (EOCC_COMP_CONFIG:EventMapping:Mapper
 * and :ServiceHandler, Utility:Helper, driven by EOCC_CONFIG_WRK.NAVIGATION
 * FieldFormula AddEventMapping) -- a port, same queries, same order:
 *
 * - its content references: PSPRSMDEFN rows for the component and market that
 *   are not links (PORTAL_LINKOBJNAME blank), deduplicated;
 * - the record events: for each configured field (sequences, then fields, in
 *   key order), a level-1 field's parent record gets RowInit and RowInsert, a
 *   level-2/3 field's parent too and every ancestor scroll's record RowInit
 *   (a derived record's parent is the scroll's primary record before it on the
 *   page); deduplicated keeping the first; numbered EOCC_ROWINIT1.. and
 *   EOCC_ROWINSERT1.. in that order (Standard), or EOCC_MASK_* (Masking);
 * - component events: PostBuild and SavePreChange (Standard), PostBuild at
 *   sequence 999 (Masking), the change-tracking SavePreChange at 998 (TRK);
 * - page events when the header's EOCC_PAGE_EVENT is Y: PageActivate on the
 *   pages holding configured fields, and on secondary pages (key part 6 "S");
 * - FieldChange on the criteria fields of active sequences.
 * Search and prompt field events (key part 6 "Srch"/"Prmpt") are listed too.
 */

export type MappingLevel = 'C' | 'P' | 'R' | 'F';

/** One Event Mapping row the configuration needs on a content reference. */
export interface PfcMapping {
  serviceId: string;
  level: MappingLevel;
  record?: string;
  field?: string;
  page?: string;
  /** Component event (POST, SPRE) or record/field/page event (RINI, RINS, PACT, SINT, SSVE, RFCH). */
  event: string;
  sequence: number;
  label: string;
}

const t = (v: unknown) => String(v ?? '').trim();
const SEARCH_KEY = 0x0800;

interface FieldRow { rec: string; fld: string; level: number; rec1: string; pnlName: string; stdPnlName: string; pageField: string }

/** Cached page-structure lookups, one per derivation. */
class PageStructure {
  private derived = new Map<string, boolean>();
  constructor(private c: Connection) {}

  async isDerived(rec: string): Promise<boolean> {
    if (!this.derived.has(rec)) {
      const [r] = await select<{ X: string }>(this.c, `SELECT 'X' AS X FROM PSRECDEFN WHERE RECNAME = :r AND RECTYPE = 2`, { r: rec });
      this.derived.set(rec, Boolean(r));
    }
    return this.derived.get(rec)!;
  }

  /** Helper.GetScrollPrimaryRecord: the first non-derived record before the field at its level (into subpages). */
  async scrollPrimaryRecord(pnlFldId: number, pnlName: string, includeCurrent: boolean): Promise<string> {
    const [f] = await select<{ N: number; L: number }>(this.c,
      `SELECT FIELDNUM AS N, OCCURSLEVEL AS L FROM PSPNLFIELD WHERE PNLNAME = :p AND PNLFLDID = :id`, { p: pnlName, id: pnlFldId });
    if (!f) return '';
    const rows = await select<{ R: string; S: string; T: number }>(this.c,
      `SELECT RECNAME AS R, SUBPNLNAME AS S, FIELDTYPE AS T FROM PSPNLFIELD WHERE PNLNAME = :p AND FIELDNUM ${includeCurrent ? '<=' : '<'} :n
          AND OCCURSLEVEL = :l AND ASSOCFIELDNUM = 0 ORDER BY FIELDNUM DESC`, { p: pnlName, n: f.N, l: f.L });
    for (const r of rows) {
      const rec = t(r.R);
      if (rec && !(await this.isDerived(rec))) return rec;
      if (Number(r.T) === 11) {
        const [s] = await select<{ I: number }>(this.c,
          `SELECT PNLFLDID AS I FROM PSPNLFIELD WHERE PNLNAME = :p AND OCCURSLEVEL = 0 AND ASSOCFIELDNUM = 0 ORDER BY FIELDNUM DESC`, { p: t(r.S) });
        const found = s ? await this.scrollPrimaryRecord(Number(s.I), t(r.S), includeCurrent) : '';
        if (found) return found;
      }
    }
    return '';
  }

  /** Helper.GetParentPage: the page placing subpage `sub` at `level`, searched from `std` down; with that subpage control's id. */
  async parentPage(sub: string, std: string, level: number): Promise<{ page: string; pnlFldId: number }> {
    const [direct] = await select<{ I: number }>(this.c,
      `SELECT PNLFLDID AS I FROM PSPNLFIELD WHERE PNLNAME = :p AND FIELDTYPE = 11 AND OCCURSLEVEL = :l AND SUBPNLNAME = :s`, { p: std, l: level, s: sub });
    if (direct) return { page: std, pnlFldId: Number(direct.I) };
    const subs = await select<{ S: string; L: number }>(this.c,
      `SELECT SUBPNLNAME AS S, OCCURSLEVEL AS L FROM PSPNLFIELD WHERE PNLNAME = :p AND OCCURSLEVEL <= :l AND FIELDTYPE = 11`, { p: std, l: level });
    for (const s of subs) {
      const found = await this.parentPage(sub, t(s.S), level - Number(s.L));
      if (found.page) return found;
    }
    return { page: '', pnlFldId: 0 };
  }

  /** Helper.GetParentRecord: the record whose row a configured field belongs to. */
  async parentRecord(rec: string, controlRec: string, pnlName: string, stdPnl: string, pageField: string): Promise<string> {
    const parts = pageField.split('.');
    const base = controlRec || rec;
    // No record at all: straight to the parent page (IsRecordDerived('') is False, so PeopleCode returns '').
    let out = !base ? '' : !(await this.isDerived(base)) ? base : await this.scrollPrimaryRecord(Number(parts[3]), pnlName, false);
    if (!out && pnlName && pnlName !== stdPnl) {
      const parent = await this.parentPage(pnlName, stdPnl, Number(parts[0]));
      out = await this.parentRecord('EOCC_CONFIG_WRK', '', parent.page, stdPnl, `${parts[0]}...${parent.pnlFldId}`);
    }
    return out;
  }

  /** Helper.GetFirstParentScrollField: the nearest field one level up, before this one. */
  async firstParentScrollField(id: number, pnlName: string): Promise<number> {
    const [f] = await select<{ N: number; L: number }>(this.c,
      `SELECT FIELDNUM AS N, OCCURSLEVEL AS L FROM PSPNLFIELD WHERE PNLNAME = :p AND PNLFLDID = :id`, { p: pnlName, id });
    if (!f) return 0;
    const [p] = await select<{ I: number }>(this.c,
      `SELECT PNLFLDID AS I FROM PSPNLFIELD WHERE PNLNAME = :p AND FIELDNUM < :n AND OCCURSLEVEL = :l ORDER BY FIELDNUM DESC`,
      { p: pnlName, n: f.N, l: Number(f.L) - 1 });
    return p ? Number(p.I) : 0;
  }

  /** Helper.GetParentRowSetRecords: the records of the scrolls above a level-2/3 field. */
  async parentRowsetRecords(subPnl: string, stdPnl: string, pageField: string): Promise<string[]> {
    const out: string[] = [];
    const parts = pageField.split('.');
    let next = Number(parts[3]);
    let page = subPnl || stdPnl;
    for (let i = Number(parts[0]); i >= 2; i--) {
      next = await this.firstParentScrollField(next, page);
      if (next) {
        out.push(await this.scrollPrimaryRecord(next, page, true));
      } else if (page && page !== stdPnl) {
        const parent = await this.parentPage(page, stdPnl, i);
        page = parent.page;
        next = parent.pnlFldId;
        i++;
      } else {
        out.push('');
      }
    }
    return out;
  }

  private async subpagePrimaryRecord(sub: string): Promise<string> {
    const rows = await select<{ T: number; R: string; F: string }>(this.c,
      `SELECT FIELDTYPE AS T, RECNAME AS R, FIELDNAME AS F FROM PSPNLFIELD WHERE PNLNAME = :p ORDER BY FIELDNUM`, { p: sub });
    for (const r of rows) {
      const type = Number(r.T);
      if (type === 2) continue;
      if (type === 19 && t(r.R)) return t(r.R);
      if (!t(r.R) || !t(r.F) || t(r.R) === 'PSXLATITEM') continue;
      return t(r.R);
    }
    return '';
  }

  /** Helper.GetPageFieldsList: "level.record.field.id.absolutelevel" for every field of a page and its subpages. */
  async pageFieldsList(pnlName: string, subRec = '', subPrimRec = '', subLevel = 0, out: string[] = []): Promise<string[]> {
    const rows = await select<{ I: number; T: number; L: number; R: string; F: string; S: string }>(this.c,
      `SELECT PNLFLDID AS I, FIELDTYPE AS T, OCCURSLEVEL AS L, RECNAME AS R, FIELDNAME AS F, SUBPNLNAME AS S FROM PSPNLFIELD
        WHERE PNLNAME = :p AND FIELDTYPE IN (4,5,6,7,9,11,12,13,14,15,16,17,21,26,29,31) ORDER BY OCCURSLEVEL, FIELDNUM`, { p: pnlName });
    for (const r of rows) {
      const abs = Number(r.L);
      const level = abs + subLevel;
      const rec = t(r.R);
      if (Number(r.T) === 11) {
        const sub = t(r.S);
        const prim = rec ? await this.subpagePrimaryRecord(sub) : '';
        if (sub !== 'SD_RT_SBP') await this.pageFieldsList(sub, rec, prim, level, out);
      } else if (t(r.F)) {
        out.push(`${level}.${subPrimRec === rec ? subRec : rec}.${t(r.F)}.${Number(r.I)}.${abs}`);
      }
    }
    return out;
  }
}

/** Keep the first of each, in order (Helper.RefineArray / RefineOneDimensionArray). */
function refine<T>(items: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** The content references the configurator maps: not links, deduplicated by object, menu and component. */
export async function pfcContentReferences(c: Connection, component: string, market: string): Promise<Array<{ cref: string; menu: string }>> {
  const rows = await select<{ N: string; M: string }>(c,
    `SELECT PORTAL_OBJNAME AS N, PORTAL_URI_SEG1 AS M FROM PSPRSMDEFN WHERE PORTAL_URI_SEG2 = :c AND PORTAL_URI_SEG3 = :m AND PORTAL_LINKOBJNAME = ' '
      ORDER BY PORTAL_NAME, PORTAL_OBJNAME`, { c: component, m: market });
  return refine(rows.map((r) => ({ cref: t(r.N), menu: t(r.M) })), (x) => `${x.cref}|${x.menu}`);
}

/** The Event Mapping rows (in the order the configurator adds them) a stored configuration needs on each content reference. */
export async function derivePfcMappings(c: Connection, component: string, market: string, type: string): Promise<PfcMapping[]> {
  const key = { c: component, m: market, t: type };
  const [hdr] = await select<{ E: string }>(c, `SELECT EOCC_PAGE_EVENT AS E FROM PS_EOCC_CONFIG_HDR WHERE PNLGRPNAME = :c AND MARKET = :m AND EOCC_CONFIG_TYPE = :t`, key);
  if (!hdr) return [];
  const pageEvents = t(hdr.E) === 'Y';
  const rows: FieldRow[] = (await select<Record<string, unknown>>(c,
    `SELECT F.RECNAME AS REC, F.FIELDNAME AS FLD, F.OCCURSLEVEL AS LVL, F.RECNAME1 AS REC1, F.PNLNAME AS PNL, F.STDPNLNAME AS STD, F.PTCS_PNLFLDNAME AS PF
       FROM PS_EOCC_CONFIG_SEQ S JOIN PS_EOCC_CONFIG_FLD F ON F.PNLGRPNAME = S.PNLGRPNAME AND F.MARKET = S.MARKET AND F.EOCC_CONFIG_TYPE = S.EOCC_CONFIG_TYPE
            AND F.SEQUENCE_NBR = S.SEQUENCE_NBR AND F.EOCC_SEQUENCE_NBR = S.EOCC_SEQUENCE_NBR
      WHERE S.PNLGRPNAME = :c AND S.MARKET = :m AND S.EOCC_CONFIG_TYPE = :t
      ORDER BY S.EOCC_SEQUENCE_NBR, S.SEQUENCE_NBR, F.RECNAME, F.FIELDNAME, F.OCCURSLEVEL, F.RECNAME1, F.FIELDNAME1`, key))
    .map((r) => ({ rec: t(r.REC), fld: t(r.FLD), level: Number(r.LVL), rec1: t(r.REC1), pnlName: t(r.PNL), stdPnlName: t(r.STD), pageField: t(r.PF) }));
  const ps = new PageStructure(c);
  const mask = type === 'MASK';
  const std = type === 'STD';

  // Record events (Mapper.GenerateMappingList / AddToList), then refined.
  const recordEvents: Array<[string, 'RINI' | 'RINS']> = [];
  for (const r of rows) {
    if (r.level < 1 || r.level > 3) continue;
    const parent = await ps.parentRecord(r.rec, r.rec1, r.pnlName, r.stdPnlName, r.pageField);
    if (parent) recordEvents.push([parent, 'RINI'], [parent, 'RINS']);
    if (r.level >= 2) for (const a of await ps.parentRowsetRecords(r.pnlName, r.stdPnlName, r.pageField)) if (a) recordEvents.push([a, 'RINI']);
  }
  const refinedEvents = refine(recordEvents, ([rec, ev]) => `${rec}|${ev}`);

  const out: PfcMapping[] = [];
  if (std) {
    out.push({ serviceId: 'EOCC_POSTBUILD', level: 'C', event: 'POST', sequence: 0, label: 'PostBuild Event' });
    out.push({ serviceId: 'EOCC_SAVEPRECHANGE', level: 'C', event: 'SPRE', sequence: 0, label: 'SavePreChange Event' });
  } else if (mask) {
    out.push({ serviceId: 'EOCC_MASK_POSTBUILD', level: 'C', event: 'POST', sequence: 999, label: 'PostBuild Event' });
  } else if (type === 'TRK') {
    out.push({ serviceId: 'EOCC_CHGTRK_SAVEPRECHANGE', level: 'C', event: 'SPRE', sequence: 998, label: 'SavePreChange Event' });
    return out;
  }
  let nRini = 0, nRins = 0;
  for (const [rec, ev] of refinedEvents) {
    if (ev === 'RINI') {
      nRini++;
      out.push({ serviceId: mask ? 'EOCC_MASK_ROWINIT' : `EOCC_ROWINIT${nRini}`, level: 'P', record: rec, event: 'RINI', sequence: mask ? 999 : 0, label: 'RowInit Event' });
    } else {
      nRins++;
      out.push({ serviceId: mask ? 'EOCC_MASK_ROWINSERT' : `EOCC_ROWINSERT${nRins}`, level: 'P', record: rec, event: 'RINS', sequence: mask ? 999 : 0, label: 'RowInsert Event' });
    }
  }

  // Page events (Mapper.GenerateSecondaryPageList, GeneratePageMappingList).
  const keyPart = (pf: string, n: number) => pf.split('.')[n] ?? '';
  const secondary = refine(rows.filter((r) => keyPart(r.pageField, 5) === 'S').map((r) => r.stdPnlName), (x) => x);
  if (pageEvents) {
    const onPages = rows.filter((r) => r.stdPnlName && !secondary.includes(r.stdPnlName));
    const pages = refine(onPages.map((r) => r.stdPnlName), (x) => x);
    const configured = refine(onPages.map((r) => [r.rec, r.fld, String(r.level)] as const), (x) => x.join('|'));
    const compPages = await select<{ P: string }>(c, `SELECT PNLNAME AS P FROM PSPNLGROUP WHERE PNLGRPNAME = :c AND MARKET = :m ORDER BY SUBITEMNUM`, { c: component, m: market });
    for (const { P } of compPages) {
      const page = t(P);
      if (pages.includes(page)) continue;
      const fields = await ps.pageFieldsList(page);
      if (configured.some(([rec, fld, lvl]) => fields.some((f) => { const p = f.split('.'); return p[1] === rec && p[2] === fld && p[0] === lvl; }))) pages.push(page);
    }
    for (const page of pages) {
      out.push({ serviceId: mask ? 'EOCC_MASK_PAGEACTIVATE' : 'EOCC_PAGEACTIVATE', level: 'R', page, event: 'PACT', sequence: mask ? 999 : 0, label: 'Page Activate Event' });
    }
  }
  for (const page of secondary) {
    out.push({ serviceId: mask ? 'EOCC_MASK_SECPAGEACTIVATE' : 'EOCC_SECONDARYPAGEACTIVATE', level: 'R', page, event: 'PACT', sequence: mask ? 999 : 0, label: 'Page Activate Event' });
  }

  // Search and prompt fields (key part 6 Srch / Prmpt): the record's search keys.
  const searchPrompt: Array<{ rec: string; fld: string; kind: string }> = [];
  const seenRec = new Set<string>();
  for (const r of rows) {
    const kind = keyPart(r.pageField, 5);
    if ((kind !== 'Srch' && kind !== 'Prmpt') || seenRec.has(r.rec)) continue;
    seenRec.add(r.rec);
    // The record's fields as PeopleCode's Record object has them: subrecords expanded (PSRECFIELDDB) [PERALL_SEC_SRCH.EMPLID].
    const keys = await select<{ F: string }>(c,
      `SELECT FIELDNAME AS F FROM PSRECFIELDDB WHERE RECNAME = :r AND BITAND(USEEDIT, ${SEARCH_KEY}) <> 0 ORDER BY FIELDNUM`, { r: r.rec });
    for (const k of kind === 'Srch' ? keys.slice(0, 1) : keys) searchPrompt.push({ rec: r.rec, fld: t(k.F), kind });
  }
  if (mask) {
    for (const s of searchPrompt) out.push({ serviceId: 'EOCC_MASK_SEARCHINIT', level: 'F', record: s.rec, field: s.fld, event: 'SINT', sequence: 999, label: 'FieldSearchInit Event' });
  } else {
    const [stdPfc] = await select<{ Y: string }>(c, `SELECT 'Y' AS Y FROM PSRECDEFN WHERE RECNAME = 'EOCC_STDPFC_WRK'`);
    if (stdPfc) {
      for (const s of searchPrompt) {
        if (s.kind === 'Srch') {
          out.push({ serviceId: 'EOCC_SEARCHINIT', level: 'P', record: s.rec, event: 'SINT', sequence: 0, label: 'SearchInit Event' });
          out.push({ serviceId: 'EOCC_SEARCHSAVE', level: 'F', record: s.rec, field: s.fld, event: 'SSVE', sequence: 0, label: 'FieldSearchSave Event' });
        } else {
          out.push({ serviceId: 'EOCC_SEARCHINIT', level: 'F', record: s.rec, field: s.fld, event: 'SINT', sequence: 0, label: 'FieldSearchInit Event' });
        }
      }
    }
  }

  // FieldChange on the criteria fields of active sequences (re-evaluating criteria), when the configurator has that feature.
  const [crtFeature] = await select<{ Y: string }>(c,
    `SELECT 'Y' AS Y FROM PSPNLFIELD WHERE PNLNAME = 'EOCC_CONFIGURE' AND RECNAME = 'EOCC_CONFIG_SEQ' AND FIELDNAME = 'EOCC_SEQUENCE_NBR'`);
  if (crtFeature) {
    const crt = await select<{ R: string; F: string }>(c,
      `SELECT C.RECNAME AS R, C.FIELDNAME AS F FROM PS_EOCC_CONFIG_SEQ S JOIN PS_EOCC_CONFIG_CRT C ON C.PNLGRPNAME = S.PNLGRPNAME AND C.MARKET = S.MARKET
            AND C.EOCC_CONFIG_TYPE = S.EOCC_CONFIG_TYPE AND C.SEQUENCE_NBR = S.SEQUENCE_NBR AND C.EOCC_SEQUENCE_NBR = S.EOCC_SEQUENCE_NBR
        WHERE S.PNLGRPNAME = :c AND S.MARKET = :m AND S.EOCC_CONFIG_TYPE = :t AND S.STATUS = 'A'
        ORDER BY S.EOCC_SEQUENCE_NBR, S.SEQUENCE_NBR, C.RECNAME, C.FIELDNAME, C.PNLFLDID, C.EOCC_CRITERIA_SYM`, key);
    const fc = refine(crt.map((r) => [t(r.R), t(r.F)] as const).filter(([r, f]) => r && f && r !== 'SYSTEM_VARIABLE'), (x) => x.join('|'));
    for (const [rec, fld] of fc) {
      out.push({ serviceId: mask ? 'EOCC_MASK_FIELDCHANGE' : 'EOCC_FIELDCHANGE', level: 'F', record: rec, field: fld, event: 'RFCH', sequence: mask ? 999 : 0, label: 'Field Change Event' });
    }
  }
  return out;
}
