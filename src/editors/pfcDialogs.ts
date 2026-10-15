import * as vscode from 'vscode';
import { DatabaseProvider } from '../providers/database.js';
import { catalogFieldRow } from '../providers/pfcCatalog.js';
import { fieldRowKey, fieldSettingsOf, checkFieldSettings, withFieldSettings, describeFieldSettings, maskOf, defaultMaskFor, withMask, type PfcFieldSettings } from '../model/pfcFieldEdits.js';
type PfcRow = Record<string, unknown>;

/** A field chosen from the configurator's catalog (a page, then one of its fields) as a row of the sequence; the row already there when it is configured. */
export async function pickCatalogField(provider: DatabaseProvider, component: string, market: string, seq: PfcRow, seqFields: PfcRow[], mask = false): Promise<{ row: PfcRow; pageLabel: string } | undefined> {
  const pages = await provider.readPageFieldCatalogPages(component, market);
  const page = await vscode.window.showQuickPick(pages.map((p) => ({ label: p.label, description: `${p.page}${p.type === 'S' ? ` · secondary page, from ${p.from}` : ''}`, p })),
    { title: `Configure a field: the page (${component}.${market})`, matchOnDescription: true });
  if (!page) return undefined;
  const catalog = await provider.readPageFieldCatalogFields(page.p.page, page.p.type, { mask });
  const taken = new Set(seqFields.map(fieldRowKey));
  const field = await vscode.window.showQuickPick(catalog.map((f) => {
    const r = catalogFieldRow(f, { SEQUENCE_NBR: Number(seq.SEQUENCE_NBR), EOCC_SEQUENCE_NBR: Number(seq.EOCC_SEQUENCE_NBR) });
    return { label: f.label || `${f.record}.${f.field}`, description: `${f.record}.${f.field}${f.level ? ` · level ${f.level}` : ''}${f.page !== f.componentPage ? ` · ${f.page}` : ''}${taken.has(fieldRowKey(r)) ? ' · already configured' : ''}`, f, r };
  }), { title: `Configure a field on ${page.p.label} (${page.p.page})`, matchOnDescription: true });
  if (!field) return undefined;
  return { row: seqFields.find((r) => fieldRowKey(r) === fieldRowKey(field.r)) ?? field.r, pageLabel: field.f.label };
}

/** The field's settings chosen (hidden, display only, required, a label), applied to its row. */
export async function pickFieldSettings(row: PfcRow, pageLabel?: string): Promise<{ row: PfcRow; description: string } | undefined> {
  const now = fieldSettingsOf(row);
  type Setting = vscode.QuickPickItem & { key: 'hidden' | 'displayOnly' | 'required' | 'label' };
  const options: Setting[] = [
    { label: 'Hidden', key: 'hidden', picked: now.hidden },
    { label: 'Display only', key: 'displayOnly', picked: now.displayOnly },
    { label: 'Required', key: 'required', picked: now.required, description: 'a check box always has a value: required shows nothing on one' },
    { label: 'Relabel…', key: 'label', picked: now.label !== undefined, ...(now.label !== undefined ? { description: `now "${now.label}"` } : {}) }
  ];
  const chosen = await vscode.window.showQuickPick(options, { canPickMany: true, title: `Settings for ${String(row.LBLTEXT ?? '')} (${String(row.RECNAME)}.${String(row.FIELDNAME)})` });
  if (!chosen) return undefined;
  const on = new Set(chosen.map((c) => c.key));
  let label: string | undefined;
  if (on.has('label')) {
    label = await vscode.window.showInputBox({ title: 'The label to show', value: now.label ?? String(row.LBLTEXT ?? ''), validateInput: (v) => (v.trim() ? undefined : 'A label cannot be blank.') });
    if (label === undefined) return undefined;
  }
  const settings: PfcFieldSettings = { hidden: on.has('hidden'), displayOnly: on.has('displayOnly'), required: on.has('required'), ...(label !== undefined ? { label } : {}) };
  const problems = checkFieldSettings(settings);
  if (problems.length) { void vscode.window.showWarningMessage(problems.join(' ')); return undefined; }
  return { row: withFieldSettings(row, settings, pageLabel), description: describeFieldSettings(settings) };
}

/** A masked field's profile chosen (its field group's, else the default profile, preselected), or masking taken away. */
export async function pickMask(provider: DatabaseProvider, row: PfcRow): Promise<{ row: PfcRow; description: string } | undefined> {
  const { profiles, fieldDefaults } = await provider.readPageFieldMaskProfiles();
  if (!profiles.length) { void vscode.window.showWarningMessage('This database has no mask profiles (PS_EOCC_MASK_PROF).'); return undefined; }
  const now = maskOf(row);
  const suggested = now ?? defaultMaskFor(String(row.FIELDNAME ?? ''), profiles, fieldDefaults);
  type Pick = vscode.QuickPickItem & { id?: string };
  const items: Pick[] = [
    ...profiles.map((p) => ({ label: `${p.id === suggested ? '$(check) ' : ''}${p.label}`, description: `${p.id}${p.id === fieldDefaults[String(row.FIELDNAME ?? '')] ? ' · the field group\'s' : p.isDefault ? ' · default' : ''}`, detail: p.description, id: p.id })),
    ...(now ? [{ label: '$(close) Not masked', description: 'take the masking away' }] : [])
  ];
  const picked = await vscode.window.showQuickPick(items, { title: `Mask profile for ${String(row.LBLTEXT ?? '')} (${String(row.RECNAME)}.${String(row.FIELDNAME)})`, matchOnDescription: true });
  if (!picked) return undefined;
  return { row: withMask(row, picked.id), description: picked.id ? `masked (${picked.id})` : 'not masked' };
}
