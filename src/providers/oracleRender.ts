import { FIELD_TYPE_LABELS, FieldType } from '../model/record.js';

/**
 * The read-only field summary (pages, components and menus: model/uiDefinitions.ts).
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
