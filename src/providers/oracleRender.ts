import { FIELD_TYPE_LABELS, FieldType } from '../model/record.js';

/**
 * Read-only summaries for the definition types that have no editor yet.
 *
 * Mirrors {@link ../providers/projectFileRender.ts}: render what the database
 * actually holds, in App Designer's own vocabulary, and show a raw value
 * rather than an invented interpretation wherever a stored value's meaning
 * (mostly PSPNLFIELD's layout and flag columns) is not established.
 */

export interface FieldRow { FIELDTYPE: number; LENGTH: number; DECIMALPOS: number; VERSION: number }
export interface FieldLabelRow { LABEL_ID: string; LONGNAME: string; SHORTNAME: string }

export function renderField(name: string, defn: FieldRow | undefined, labels: FieldLabelRow[]): string {
  if (!defn) return `# ${name}: field definition not found.\n`;
  const type = defn.FIELDTYPE as FieldType;
  const out = [
    `Field   ${name}`,
    `Type    ${FIELD_TYPE_LABELS[type] ?? `Unknown (${type})`}`,
    `Length  ${defn.DECIMALPOS > 0 ? `${defn.LENGTH}.${defn.DECIMALPOS}` : defn.LENGTH}`,
    `Version ${defn.VERSION}`
  ];
  if (labels.length > 0) {
    out.push('', `Labels (${labels.length})`);
    for (const l of labels) {
      out.push(`  ${l.LABEL_ID.trim().padEnd(20)} ${l.LONGNAME.trim()}` +
        (l.SHORTNAME.trim() ? `  [short: ${l.SHORTNAME.trim()}]` : ''));
    }
  }
  return out.join('\n') + '\n';
}

export interface MenuRow { VERSION: number; DESCR: string }
export interface MenuItemRow { BARNAME: string; ITEMNAME: string; ITEMLABEL: string; PNLGRPNAME: string; MARKET: string }

export function renderMenu(name: string, defn: MenuRow | undefined, items: MenuItemRow[]): string {
  const out = [`Menu     ${name}`];
  if (defn) out.push(`Descr    ${defn.DESCR?.trim() ?? ''}`, `Version  ${defn.VERSION}`);
  out.push('', `Items (${items.length})`);
  for (const i of items) {
    out.push(`  ${i.BARNAME.trim().padEnd(12)} ${(i.ITEMLABEL?.trim() || i.ITEMNAME.trim()).padEnd(30)} ` +
      `-> ${i.PNLGRPNAME.trim()} (${i.MARKET.trim() || 'GBL'})`);
  }
  return out.join('\n') + '\n';
}

export interface PageRow { PNLTYPE: number; VERSION: number; FIELDCOUNT: number; GRIDHORZ: number; GRIDVERT: number; DESCR: string }
export interface PageFieldRow { PNLFLDID: number; RECNAME: string; FIELDNAME: string; PNLFIELDNAME: string }

export function renderPage(name: string, defn: PageRow | undefined, fields: PageFieldRow[]): string {
  const out = [`Page     ${name}`];
  if (defn) {
    out.push(
      `Descr    ${defn.DESCR?.trim() ?? ''}`,
      `Type     ${defn.PNLTYPE}`,
      `Version  ${defn.VERSION}`,
      `Fields   ${defn.FIELDCOUNT}`,
      `Size     ${defn.GRIDHORZ} x ${defn.GRIDVERT}`);
  }
  if (fields.length > 0) {
    out.push('', `Page fields (${fields.length})`, '', '  Id    Field');
    for (const f of fields) {
      const rec = f.RECNAME?.trim();
      const fld = f.FIELDNAME?.trim();
      const label = rec ? `${rec}.${fld}` : (f.PNLFIELDNAME?.trim() || '(unnamed)');
      out.push(`  ${String(f.PNLFLDID).padEnd(6)}${label}`);
    }
  }
  out.push('', '// Page layout (position, size, style) is not rendered yet. See docs/ROADMAP.md.');
  return out.join('\n') + '\n';
}

export interface ComponentRow { DESCR: string; SEARCHRECNAME: string; ADDSRCHRECNAME: string; VERSION: number }
export interface ComponentPageRow { PNLNAME: string; ITEMLABEL: string; HIDDEN: number }

export function renderComponent(
  name: string, market: string, defn: ComponentRow | undefined, pages: ComponentPageRow[]
): string {
  const out = [`Component     ${name}.${market}`];
  if (defn) {
    out.push(
      `Descr         ${defn.DESCR?.trim() ?? ''}`,
      `Search record ${defn.SEARCHRECNAME?.trim() || '(none)'}`,
      `Add search    ${defn.ADDSRCHRECNAME?.trim() || '(none)'}`,
      `Version       ${defn.VERSION}`);
  }
  out.push('', `Pages (${pages.length})`);
  for (const p of pages) {
    out.push(`  ${p.PNLNAME.trim().padEnd(24)} ${p.ITEMLABEL?.trim() ?? ''}` +
      (p.HIDDEN ? '  [hidden]' : ''));
  }
  return out.join('\n') + '\n';
}
