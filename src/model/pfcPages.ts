/*
 * A Page and Field Configurator sequence's page rules (PS_EOCC_CONFIG_PNL), as
 * the configurator's Pages grid edits them: a row per page the sequence
 * changes (any page of the component; EOCC_PNLGRP_DVW), keyed by the page.
 * EOCC_VISIBLE_FLAG N hides the page (the record default), Y shows it -- which
 * also shows a page the component itself hides (PSPNLGROUP.HIDDEN 1;
 * EOCC_COMP_CONFIG:Utility:ConfigurePages) -- and DISPLAYONLY 1 makes it
 * display only. A page without a row is as the component has it. The save
 * warns (EOCC_CONFIG_SEQ SaveEdit) when a required field is on a page hidden or
 * made display only, and when no page is left visible. Rows are compact
 * (pfcWriter reads): EOCC_VISIBLE_FLAG N and DISPLAYONLY 0 are left out.
 */

export type Row = Record<string, unknown>;

export interface PageRule {
  page: string;
  /** Hidden (N) or shown (Y). */
  hidden: boolean;
  displayOnly: boolean;
}

/** A page of the component (PSPNLGROUP), and whether the component hides it. */
export interface ComponentPage { page: string; label: string; hidden: boolean }

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const seqOf = (r: Row) => Number(r.EOCC_SEQUENCE_NBR);

export function pageRulesOf(pages: readonly Row[], seq: Row): PageRule[] {
  return pages.filter((r) => seqOf(r) === seqOf(seq) && s(r.PNLNAME)).map((r) => ({
    page: s(r.PNLNAME), hidden: (s(r.EOCC_VISIBLE_FLAG) || 'N') === 'N', displayOnly: Number(r.DISPLAYONLY ?? 0) === 1
  }));
}

/** The pages with the sequence's rule for a page set (added or replaced). */
export function withPageRule(pages: readonly Row[], seq: Row, rule: PageRule): Row[] {
  const row: Row = { SEQUENCE_NBR: Number(seq.SEQUENCE_NBR), EOCC_SEQUENCE_NBR: seqOf(seq), PNLNAME: rule.page, EOCC_VISIBLE_FLAG: rule.hidden ? 'N' : 'Y', DISPLAYONLY: rule.displayOnly ? 1 : 0 };
  const at = pages.findIndex((r) => seqOf(r) === seqOf(seq) && s(r.PNLNAME) === rule.page);
  return at < 0 ? [...pages, row] : pages.map((r, i) => (i === at ? { ...r, ...row } : r));
}

/** The pages without the sequence's rule for a page: the page is as the component has it. */
export function withoutPageRule(pages: readonly Row[], seq: Row, page: string): Row[] {
  return pages.filter((r) => !(seqOf(r) === seqOf(seq) && s(r.PNLNAME) === page));
}

/** What a rule does to a page, in a few words. */
export function describePageRule(rule: PageRule | undefined, componentHides: boolean): string {
  if (!rule) return componentHides ? 'hidden by the component' : 'as the component has it';
  if (rule.hidden) return 'hidden';
  return `${componentHides ? 'shown (the component hides it)' : 'shown'}${rule.displayOnly ? ', display only' : ''}`;
}

/**
 * The warnings EOCC_CONFIG_SEQ SaveEdit shows for a sequence: a required field (by the component page it was chosen
 * from, STDPNLNAME) on a page hidden or made display only; no page left visible.
 */
export function checkPageRules(sequence: number, componentPages: readonly ComponentPage[], rules: readonly PageRule[], requiredFieldPages: readonly string[]): string[] {
  const out: string[] = [];
  for (const rule of rules) {
    if (!requiredFieldPages.includes(rule.page)) continue;
    if (rule.hidden) out.push(`Sequence ${sequence}: page ${rule.page} is hidden but has a field configured as required.`);
    else if (rule.displayOnly) out.push(`Sequence ${sequence}: page ${rule.page} is display only but has a field configured as required.`);
  }
  const visible = componentPages.filter((p) => {
    const rule = rules.find((r) => r.page === p.page);
    return rule ? !rule.hidden : !p.hidden;
  });
  if (componentPages.length && !visible.length) out.push(`Sequence ${sequence}: every page of the component is hidden.`);
  return out;
}
