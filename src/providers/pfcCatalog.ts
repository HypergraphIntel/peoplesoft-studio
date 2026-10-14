import type { DbConnection as Connection } from '../db/connection.js';
import { select } from './peopleCodeWriter.js';

/*
 * The fields a Page and Field Configurator configuration can name, as the
 * configurator's Select Fields page lists them (EOCC_PGFLDS_DVW.LBLTEXT
 * FieldFormula PageFieldsList / GetPageFieldsList / SecondaryPageList,
 * EOCC_SELECT_FIELDS OK_PB, EOCC_CONFIG_WRK.EOCC_ADD_PB) -- a port, same
 * queries, same order, in the base language:
 *
 * - each component page's fields of the types the page offers (edit box, drop
 *   down, check box, radio button, long edit, push buttons, grids ...),
 *   subpages walked (their fields' level is the subpage control's plus their
 *   own; Supplemental Data's SD_RT_SBP skipped), fields without a field name
 *   and invisible fields (FIELDUSE 0x2) left out;
 * - a field's key PTCS_PNLFLDNAME "level.record.field.pnlfldid.ownLevel.P"
 *   ("S" on a secondary page), the record substituted when a subpage's primary
 *   record is (RECNAME_BASE the original), PNLNAME the (sub)page it is on,
 *   STDPNLNAME the component page (the secondary page itself for "S");
 * - a related display field (FIELDUSE 0x10) carries its control field in
 *   RECNAME1 / FIELDNAME1;
 * - the label: the page field's text, or its record field label (short/long
 *   by label type, a message catalog text), else the record field's label.
 */

const t = (v: unknown) => String(v ?? '').trim();
const INVISIBLE = 0x2;
const RELATED_DISPLAY = 0x10;
const FIELD_TYPES = '4,5,6,7,9,11,12,13,14,15,16,17,21,26,29,31';

/** A field the configurator offers, with the values its field row takes. */
export interface PfcCatalogField {
  /** PTCS_PNLFLDNAME: level.record.field.pnlfldid.ownLevel.(P|S). */
  pageField: string;
  level: number;
  record: string;
  field: string;
  pnlfldid: number;
  /** EOCC_SBP_LEVEL: the field's level on the (sub)page it is on. */
  ownLevel: number;
  /** PNLNAME: the page or subpage the field is on. */
  page: string;
  /** STDPNLNAME: the component page (or secondary page) it was chosen from. */
  componentPage: string;
  label: string;
  fieldType: number;
  fieldUse: number;
  record1: string;
  field1: string;
  recordBase: string;
}

export interface PfcCatalogPage {
  page: string;
  label: string;
  /** P: a page of the component; S: a secondary page reached from one. */
  type: 'P' | 'S';
  /** For a secondary page, the component page it is reached from. */
  from?: string;
  fields: PfcCatalogField[];
}

interface Raw { key: string; label: string; fieldUse: number; page: string; fieldType: number; assocFieldNum: number; base: string }

class Catalog {
  constructor(private readonly c: Connection) {}

  /** FieldLabel: a record field label's short (2) or long text, by label id or the default label. */
  async fieldLabel(field: string, labelId: string, type: number): Promise<string> {
    const [r] = labelId
      ? await select<{ S: string; L: string }>(this.c, `SELECT SHORTNAME AS S, LONGNAME AS L FROM PSDBFLDLABL WHERE FIELDNAME = :f AND LABEL_ID = :l`, { f: field, l: labelId })
      : await select<{ S: string; L: string }>(this.c, `SELECT SHORTNAME AS S, LONGNAME AS L FROM PSDBFLDLABL WHERE FIELDNAME = :f AND DEFAULT_LABEL = 1`, { f: field });
    return t(type === 2 ? r?.S : r?.L);
  }

  /** RecFieldLabel: the record field's label, long. */
  async recFieldLabel(record: string, field: string): Promise<string> {
    const [r] = await select<{ L: string }>(this.c, `SELECT LABEL_ID AS L FROM PSRECFIELD WHERE RECNAME = :r AND FIELDNAME = :f`, { r: record, f: field });
    return this.fieldLabel(field, t(r?.L), 3);
  }

  /** PageFieldLabel (base language). */
  async pageFieldLabel(page: string, key: string): Promise<string> {
    const [lvl, record, field, id] = key.split('.');
    let label = '';
    if (Number(id) === 0) {
      const [r] = await select<{ T: string }>(this.c, `SELECT LBLTEXT AS T FROM PSPNLFIELD WHERE PNLNAME = :p AND RECNAME = :r AND FIELDNAME = :f AND OCCURSLEVEL = :o`,
        { p: page, r: record, f: field, o: Number(lvl) });
      label = t(r?.T);
    } else {
      const [r] = await select<{ L: string; T: string; Y: number; D: number; S: number; N: number }>(this.c,
        `SELECT LABEL_ID AS L, LBLTEXT AS T, LBLTYPE AS Y, USEDEFAULTLABEL AS D, GRDLBLMSGSET AS S, GRDLBLMSGNUM AS N FROM PSPNLFIELD
          WHERE PNLNAME = :p AND RECNAME = :r AND FIELDNAME = :f AND PNLFLDID = :i`, { p: page, r: record, f: field, i: Number(id) });
      const type = Number(r?.Y ?? 0);
      if (type === 0 || type === 1) label = t(r?.T);
      else if ((type === 2 || type === 3) && (t(r?.L) || Number(r?.D) === 1)) {
        const l = await this.fieldLabel(field, t(r?.L), type);
        if (l) return l;
        label = t(r?.T);
      } else if (type === 7) {
        const [m] = await select<{ T: string }>(this.c, `SELECT MESSAGE_TEXT AS T FROM PSMSGCATDEFN WHERE MESSAGE_SET_NBR = :s AND MESSAGE_NBR = :n`, { s: Number(r?.S), n: Number(r?.N) });
        if (t(m?.T)) return t(m?.T);
      }
    }
    return label || this.recFieldLabel(record, field);
  }

  /** GetSubpagePrimaryRecord. */
  async subpagePrimaryRecord(subpage: string): Promise<string> {
    const rows = await select<{ T: number; R: string; F: string }>(this.c, `SELECT FIELDTYPE AS T, RECNAME AS R, FIELDNAME AS F FROM PSPNLFIELD WHERE PNLNAME = :p ORDER BY FIELDNUM`, { p: subpage });
    for (const r of rows) {
      if (Number(r.T) === 2) continue;
      if (Number(r.T) === 19 && t(r.R)) return t(r.R);
      if (!t(r.R) || !t(r.F) || t(r.R) === 'PSXLATITEM') continue;
      return t(r.R);
    }
    return '';
  }

  /** GetPageFieldsList: the page's fields, subpages walked. */
  async pageFields(page: string, subRecord: string, subPrimary: string, subLevel: number, superPage: string, out: Raw[]): Promise<void> {
    const rows = await select<Record<string, unknown>>(this.c,
      `SELECT PNLFLDID AS ID, FIELDTYPE AS T, OCCURSLEVEL AS O, FIELDUSE AS U, RECNAME AS R, FIELDNAME AS F, SUBPNLNAME AS S, ASSOCFIELDNUM AS A
         FROM PSPNLFIELD WHERE PNLNAME = :p AND FIELDTYPE IN (${FIELD_TYPES}) ORDER BY OCCURSLEVEL, FIELDNUM`, { p: page });
    for (const r of rows) {
      const own = Number(r.O);
      const level = own + subLevel;
      const record = t(r.R);
      if (Number(r.T) === 11) {
        const sub = t(r.S);
        const primary = record ? await this.subpagePrimaryRecord(sub) : '';
        if (sub !== 'SD_RT_SBP') await this.pageFields(sub, record, primary, level, `${Number(r.ID)}.${page}`, out);
        continue;
      }
      if (!t(r.F)) continue;
      let rec = record;
      let base = ` .${superPage}`;
      if (subPrimary === record) { rec = subRecord; base = `${record}.${superPage}`; }
      const key = `${level}.${rec}.${t(r.F)}.${Number(r.ID)}.${own}`;
      out.push({ key, label: await this.pageFieldLabel(page, key), fieldUse: Number(r.U), page, fieldType: Number(r.T), assocFieldNum: Number(r.A) + 1, base });
    }
  }

  /** PageFieldsList: the catalog rows of a page (invisible fields left out, related display fields' controls found). */
  async pageFieldsList(page: string, componentPage: string, type: 'P' | 'S'): Promise<PfcCatalogField[]> {
    const raw: Raw[] = [];
    await this.pageFields(page, '', '', 0, '', raw);
    const out: PfcCatalogField[] = [];
    for (const r of raw) {
      const parts = r.key.split('.');
      if (parts.length !== 5 || (r.fieldUse & INVISIBLE)) continue;
      const sub = r.base.split('.');
      let recordBase = sub[0].trim();
      let record1 = '', field1 = '';
      if (r.fieldUse & RELATED_DISPLAY) {
        const [ctl] = await select<{ R: string; F: string }>(this.c, `SELECT RECNAME AS R, FIELDNAME AS F FROM PSPNLFIELD WHERE PNLNAME = :p AND FIELDNUM = :n`, { p: r.page, n: r.assocFieldNum });
        record1 = t(ctl?.R); field1 = t(ctl?.F);
        if (sub.length > 2 && record1) {
          const [isSub] = await select<{ X: string }>(this.c, `SELECT 'X' AS X FROM PSRECDEFN WHERE RECNAME = :r AND RECTYPE = 3`, { r: record1 });
          if (isSub) {
            const [tmp] = await select<{ R: string }>(this.c, `SELECT RECNAME AS R FROM PSPNLFIELD WHERE PNLNAME = :p AND PNLFLDID = :i`, { p: sub.slice(2).join('.'), i: Number(sub[1]) });
            if (t(tmp?.R)) { recordBase = record1; record1 = t(tmp?.R); }
          }
        }
      }
      out.push({
        pageField: `${r.key}.${type}`, level: Number(parts[0]), record: parts[1], field: parts[2], pnlfldid: Number(parts[3]), ownLevel: Number(parts[4]),
        page: r.page, componentPage, label: r.label, fieldType: r.fieldType, fieldUse: r.fieldUse, record1, field1, recordBase
      });
    }
    return out;
  }

  /** GetSecondaryPageList: secondary pages (and pages behind push buttons) reached from a page, subpages walked. */
  async secondaryPages(page: string, level: number, out: Array<[string, number]>): Promise<void> {
    const rows = await select<{ S: string; T: number; O: number }>(this.c,
      `SELECT SUBPNLNAME AS S, FIELDTYPE AS T, OCCURSLEVEL AS O FROM PSPNLFIELD WHERE PNLNAME = :p AND FIELDTYPE IN (11, 18, 21)`, { p: page });
    for (const r of rows) {
      const sub = t(r.S);
      const lvl = level + Number(r.O);
      if (Number(r.T) === 11) { if (sub !== 'SD_RT_SBP') await this.secondaryPages(sub, Number(r.O), out); }
      else if (Number(r.T) === 18 && sub) { out.push([sub, lvl]); await this.secondaryPages(sub, Number(r.O), out); }
      else if (sub) out.push([sub, lvl]);
    }
  }
}

/** The component's pages, then each one's secondary pages (first reached from), as the Select Fields page offers them; no fields. */
export async function pfcCatalogPages(c: Connection, component: string, market: string): Promise<Array<Omit<PfcCatalogPage, 'fields'>>> {
  const cat = new Catalog(c);
  const pages = await select<{ P: string; L: string }>(c,
    `SELECT PNLNAME AS P, ITEMLABEL AS L FROM PSPNLGROUP WHERE PNLGRPNAME = :c AND MARKET = :m ORDER BY SUBITEMNUM`, { c: component, m: market });
  const out: Array<Omit<PfcCatalogPage, 'fields'>> = [];
  const seen = new Set<string>();
  for (const p of pages) {
    const page = t(p.P);
    out.push({ page, label: t(p.L).replace(/&/g, '') || page, type: 'P' });
    const secondary: Array<[string, number]> = [];
    await cat.secondaryPages(page, 0, secondary);
    for (const [s] of secondary) {
      if (seen.has(s)) continue;
      seen.add(s);
      const [d] = await select<{ D: string }>(c, `SELECT DESCR AS D FROM PSPNLDEFN WHERE PNLNAME = :p`, { p: s });
      out.push({ page: s, label: t(d?.D) || s, type: 'S', from: page });
    }
  }
  return out;
}

/**
 * The fields the configurator offers on one page of the catalog (a component page "P" or a secondary page "S"). For a
 * Masking configuration (EOCC_MSKFLD_DVW.LBLTEXT FieldFormula) long fields (PSDBFIELD.FIELDTYPE 1) are left out.
 */
export async function pfcCatalogFields(c: Connection, page: string, type: 'P' | 'S', options: { mask?: boolean } = {}): Promise<PfcCatalogField[]> {
  const fields = await new Catalog(c).pageFieldsList(page, page, type);
  if (!options.mask || !fields.length) return fields;
  const names = [...new Set(fields.map((f) => f.field))];
  const long = new Set<string>();
  for (let i = 0; i < names.length; i += 500) {
    const chunk = names.slice(i, i + 500);
    const rows = await select<{ F: string }>(c, `SELECT FIELDNAME AS F FROM PSDBFIELD WHERE FIELDTYPE = 1 AND FIELDNAME IN (${chunk.map((_, j) => `:f${j}`).join(', ')})`,
      Object.fromEntries(chunk.map((n, j) => [`f${j}`, n])));
    for (const r of rows) long.add(t(r.F));
  }
  return fields.filter((f) => !long.has(f.field));
}

/** A mask profile (PS_EOCC_MASK_PROF): how a masked field is shown. */
export interface PfcMaskProfile { id: string; label: string; description: string; type: string; isDefault: boolean }

/** The mask profiles, and the profile each field group gives its fields (PS_EOCC_GRP_FIELDS, PS_EOCC_FLDGRP_TBL). */
export async function pfcMaskProfiles(c: Connection): Promise<{ profiles: PfcMaskProfile[]; fieldDefaults: Record<string, string> }> {
  const profiles = (await select<Record<string, unknown>>(c,
    `SELECT EOCC_MASK_ID AS I, EOCC_MSK_SHRTDESCR AS S, EOCC_MASK_DESCR AS D, EOCC_MASK_TYPE AS T, DEFAULT_FLG AS F FROM PS_EOCC_MASK_PROF ORDER BY EOCC_MASK_ID`))
    .map((r) => ({ id: t(r.I), label: t(r.S) || t(r.I), description: t(r.D), type: t(r.T), isDefault: t(r.F) === 'Y' }));
  const groups = await select<{ F: string; M: string }>(c,
    `SELECT A.FIELDNAME AS F, B.EOCC_MASK_ID AS M FROM PS_EOCC_GRP_FIELDS A, PS_EOCC_FLDGRP_TBL B WHERE B.EOCC_FLD_GRP_ID = A.EOCC_FLD_GRP_ID`);
  return { profiles, fieldDefaults: Object.fromEntries(groups.map((g) => [t(g.F), t(g.M)])) };
}

/** The whole catalog: every page with its fields. */
export async function pfcFieldCatalog(c: Connection, component: string, market: string): Promise<PfcCatalogPage[]> {
  const out: PfcCatalogPage[] = [];
  for (const p of await pfcCatalogPages(c, component, market)) out.push({ ...p, fields: await pfcCatalogFields(c, p.page, p.type) });
  return out;
}

/** A configuration field row (by column) for a catalog field, as the page's Add fills it in. */
export function catalogFieldRow(f: PfcCatalogField, sequence: { SEQUENCE_NBR: number; EOCC_SEQUENCE_NBR: number }): Record<string, unknown> {
  return {
    SEQUENCE_NBR: sequence.SEQUENCE_NBR, EOCC_SEQUENCE_NBR: sequence.EOCC_SEQUENCE_NBR, RECNAME: f.record, FIELDNAME: f.field, OCCURSLEVEL: f.level,
    LBLTEXT: f.label, PTCS_PNLFLDNAME: f.pageField, FIELDTYPE: f.fieldType, FIELDUSE: f.fieldUse, STDPNLNAME: f.componentPage, PNLNAME: f.page,
    RECNAME1: f.record1 || ' ', FIELDNAME1: f.field1 || ' ', RECNAME_BASE: f.recordBase || ' ', EOCC_SBP_LEVEL: f.ownLevel, EOCC_PROF_STATUS: ' '
  };
}
