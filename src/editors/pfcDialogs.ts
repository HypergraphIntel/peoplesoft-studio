import * as vscode from 'vscode';
import { DatabaseProvider } from '../providers/database.js';
import { DefinitionType } from '../model/definitions.js';
import { APPLY_TO_LABELS, checkTarget, describeTarget, listsUsed, type ApplyTo, type PfcTarget } from '../model/pfcTargeting.js';
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

/** A role or user found by typing (two characters or more), as the page's prompts find them; undefined when dismissed. */
async function searchOne(provider: DatabaseProvider, kind: 'role' | 'user', title: string): Promise<string | undefined> {
  const picker = vscode.window.createQuickPick<vscode.QuickPickItem & { value: string }>();
  picker.title = title;
  picker.placeholder = kind === 'role' ? 'Type part of a role name' : 'Type part of a user ID or description';
  let generation = 0;
  picker.onDidChangeValue(async (text) => {
    const current = ++generation;
    if (text.trim().length < 2) { picker.items = []; return; }
    picker.busy = true;
    try {
      const items = kind === 'role'
        ? (await provider.search({ type: DefinitionType.Role, namePattern: `%${text.trim().toUpperCase()}%`, limit: 100 })).map((d) => ({ label: d.key.parts[0], description: d.description ?? '', value: d.key.parts[0] }))
        : (await provider.searchOperators(text, 100)).map((u) => ({ label: u.oprid, description: u.description, value: u.oprid }));
      if (current === generation) picker.items = items;
    } finally { if (current === generation) picker.busy = false; }
  });
  const picked = await new Promise<string | undefined>((resolve) => {
    picker.onDidAccept(() => { const item = picker.selectedItems[0]; if (item) { resolve(item.value); picker.hide(); } });
    picker.onDidHide(() => resolve(undefined));
    picker.show();
  });
  generation++;
  picker.dispose();
  return picked;
}

/** A list of roles or users edited: the entries checked to keep, and "Add…" to search for one more; undefined when dismissed. */
async function editList(provider: DatabaseProvider, kind: 'role' | 'user', title: string, current: string[]): Promise<string[] | undefined> {
  let list = [...current];
  for (;;) {
    type Item = vscode.QuickPickItem & { value?: string };
    const add: Item = { label: `$(add) Add a ${kind}…`, alwaysShow: true };
    const chosen = await vscode.window.showQuickPick<Item>([...list.map((v) => ({ label: v, value: v, picked: true })), add],
      { canPickMany: true, title: `${title} (uncheck to take one out)` });
    if (!chosen) return undefined;
    list = chosen.filter((c) => c.value).map((c) => c.value!);
    if (!chosen.includes(add)) return list;
    const more = await searchOne(provider, kind, `${title}: add a ${kind}`);
    if (more && !list.includes(more)) list.push(more);
  }
}

/** Who a sequence (or the configuration) applies to, chosen as the page offers it: Apply To, then the lists it uses. */
export async function pickTarget(provider: DatabaseProvider, current: PfcTarget, scope: string): Promise<PfcTarget | undefined> {
  const picked = await vscode.window.showQuickPick((Object.keys(APPLY_TO_LABELS) as ApplyTo[]).map((a) => ({
    label: `${a === current.applyTo ? '$(check) ' : ''}${APPLY_TO_LABELS[a]}`, applyTo: a, description: a === current.applyTo ? describeTarget(current) : undefined
  })), { title: `Who ${scope} applies to` });
  if (!picked) return undefined;
  const next: PfcTarget = { ...current, applyTo: picked.applyTo, roles: [...current.roles], excludedRoles: [...current.excludedRoles], users: [...current.users], excludedUsers: [...current.excludedUsers] };
  if (next.applyTo === 'R') {
    const role = await searchOne(provider, 'role', `${scope}: the role it applies to${current.role ? ` (now ${current.role})` : ''}`);
    if (!role && !current.role) return undefined;
    next.role = role ?? current.role;
  }
  const titles: Record<string, string> = { roles: 'Roles it applies to', excludedRoles: 'Roles excluded', users: 'Users it applies to', excludedUsers: 'Users excluded' };
  for (const key of listsUsed(next.applyTo)) {
    const edited = await editList(provider, key === 'roles' || key === 'excludedRoles' ? 'role' : 'user', `${scope}: ${titles[key]}`, next[key]);
    if (!edited) return undefined;
    next[key] = edited;
  }
  const problems = checkTarget(next);
  if (problems.length) { void vscode.window.showWarningMessage(problems.join(' ')); return undefined; }
  return next;
}
