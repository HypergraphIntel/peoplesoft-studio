import * as vscode from 'vscode';
import { DatabaseProvider } from '../providers/database.js';
import { DefinitionType } from '../model/definitions.js';
import { describePageRule, pageRulesOf, withPageRule, withoutPageRule } from '../model/pfcPages.js';
import { APPLY_TO_LABELS, checkTarget, describeTarget, listsUsed, type ApplyTo, type PfcTarget } from '../model/pfcTargeting.js';
import { catalogCriteriaRow, catalogFieldRow } from '../providers/pfcCatalog.js';
import { CRITERIA_OPERATORS, checkCriterion, criterionKey, describeCriterion, withCriterionValue } from '../model/pfcCriteria.js';
import { fieldRowKey, fieldSettingsOf, checkFieldSettings, withFieldSettings, describeFieldSettings, maskOf, defaultMaskFor, withMask, type PfcFieldSettings } from '../model/pfcFieldEdits.js';
type PfcRow = Record<string, unknown>;

/** A field chosen from the configurator's catalog (a page, then one of its fields) as a row of the sequence; the row already there when it is configured. */
export async function pickCatalogField(provider: DatabaseProvider, component: string, market: string, seq: PfcRow, seqFields: PfcRow[], mask = false): Promise<{ row: PfcRow; pageLabel: string } | undefined> {
  const pages = await provider.readPageFieldCatalogPages(component, market);
  const page = await vscode.window.showQuickPick(pages.map((p) => ({ label: p.label, description: `${p.page}${p.type === 'S' ? ` · secondary page, from ${p.from}` : ''}`, p })),
    { title: `Configure a field: the page (${component}.${market})`, matchOnDescription: true });
  if (!page) return undefined;
  const catalog = await provider.readPageFieldCatalogFields(page.p.page, page.p.type, { mask, secondaryLevel: page.p.level });
  const taken = new Set(seqFields.map(fieldRowKey));
  const field = await vscode.window.showQuickPick(catalog.map((f) => {
    const r = catalogFieldRow(f, { SEQUENCE_NBR: Number(seq.SEQUENCE_NBR), EOCC_SEQUENCE_NBR: Number(seq.EOCC_SEQUENCE_NBR) });
    return { label: f.label || `${f.record}.${f.field}`, description: `${f.record}.${f.field}${f.occursLevel ? ` · level ${f.occursLevel}` : ''}${f.page !== f.componentPage ? ` · ${f.page}` : ''}${taken.has(fieldRowKey(r)) ? ' · already configured' : ''}`, f, r };
  }), { title: `Configure a field on ${page.p.label} (${page.p.page})`, matchOnDescription: true });
  if (!field) return undefined;
  return { row: seqFields.find((r) => fieldRowKey(r) === fieldRowKey(field.r)) ?? field.r, pageLabel: field.f.label };
}

/** The field's settings chosen (hidden, display only, required, a label), applied to its row. */
export async function pickFieldSettings(row: PfcRow, pageLabel?: string): Promise<{ row: PfcRow; description: string } | undefined> {
  const now = fieldSettingsOf(row);
  type Setting = vscode.QuickPickItem & { key: 'hidden' | 'displayOnly' | 'required' | 'label' | 'default' | 'blank' };
  // Defaults are not offered on images (8, 18) nor on prompt fields (EOCC_CONFIG_FLD RowInit).
  const kind = String(row.PTCS_PNLFLDNAME ?? '').split('.').pop();
  const defaultable = ![8, 18].includes(Number(row.FIELDTYPE)) && kind !== 'Prmpt';
  const options: Setting[] = [
    { label: 'Hidden', key: 'hidden', picked: now.hidden },
    { label: 'Display only', key: 'displayOnly', picked: now.displayOnly },
    { label: 'Required', key: 'required', picked: now.required, description: 'a check box always has a value: required shows nothing on one' },
    { label: 'Relabel…', key: 'label', picked: now.label !== undefined, ...(now.label !== undefined ? { description: `now "${now.label}"` } : {}) },
    ...(defaultable ? [{ label: 'Default value…', key: 'default' as const, picked: now.defaultValue !== undefined, description: now.defaultValue !== undefined ? `now "${now.defaultValue}"` : 'a value, or a system variable such as %Date' }] : []),
    { label: 'Set to blank', key: 'blank', picked: !!now.setBlank, description: 'when the sequence applies; a hidden or display-only field, in a sequence with criteria' }
  ];
  const chosen = await vscode.window.showQuickPick(options, { canPickMany: true, title: `Settings for ${String(row.LBLTEXT ?? '')} (${String(row.RECNAME)}.${String(row.FIELDNAME)})` });
  if (!chosen) return undefined;
  const on = new Set(chosen.map((c) => c.key));
  let label: string | undefined;
  if (on.has('label')) {
    label = await vscode.window.showInputBox({ title: 'The label to show', value: now.label ?? String(row.LBLTEXT ?? ''), validateInput: (v) => (v.trim() ? undefined : 'A label cannot be blank.') });
    if (label === undefined) return undefined;
  }
  let defaultValue: string | undefined, overrideDefault = false;
  if (on.has('default')) {
    defaultValue = await vscode.window.showInputBox({ title: 'Default value', prompt: 'In the field\'s format (YYYY-MM-DD for a date), or a system variable such as %Date or %OperatorId',
      value: now.defaultValue ?? '', validateInput: (v) => (v.trim() ? undefined : 'Enter a value, or uncheck Default value.') });
    if (defaultValue === undefined) return undefined;
    const when = await vscode.window.showQuickPick([
      { label: 'Only when the field is blank', override: false }, { label: 'Replace the value already there', override: true }
    ], { title: `Default ${defaultValue.trim()}: when does it apply?` });
    if (!when) return undefined;
    overrideDefault = when.override;
  }
  const settings: PfcFieldSettings = {
    hidden: on.has('hidden'), displayOnly: on.has('displayOnly'), required: on.has('required'), ...(label !== undefined ? { label } : {}),
    ...(defaultValue !== undefined ? { defaultValue, overrideDefault } : {}), ...(on.has('blank') ? { setBlank: true } : {})
  };
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

/**
 * A criterion chosen as the configurator's Criteria grid offers it: for a new one a page of the component, then one of its
 * criteria fields (level 0 and 1); then the operator and its value(s), checked against the field's database type.
 * Returns the row and, for an existing one, the key it had (its operator may change).
 */
export async function pickCriterion(provider: DatabaseProvider, component: string, market: string, seq: PfcRow, existing?: PfcRow): Promise<{ row: PfcRow; replacing?: string } | undefined> {
  let row = existing;
  if (!row) {
    const pages = (await provider.readPageFieldCatalogPages(component, market)).filter((p) => p.type === 'P');
    const page = await vscode.window.showQuickPick(pages.map((p) => ({ label: p.label, description: p.page, p })),
      { title: `Criterion: the page (${component}.${market})`, matchOnDescription: true });
    if (!page) return undefined;
    const fields = await provider.readPageFieldCatalogFields(page.p.page, 'P', { criteria: true });
    const field = await vscode.window.showQuickPick(fields.map((f) => ({ label: f.label || `${f.record}.${f.field}`, description: `${f.record}.${f.field}${f.level ? ` · level ${f.level}` : ''}${f.page !== f.componentPage ? ` · ${f.page}` : ''}`, f })),
      { title: `Criterion: a field on ${page.p.label} (levels 0 and 1)`, matchOnDescription: true });
    if (!field) return undefined;
    const types = await provider.readFieldDatabaseTypes([field.f.field]);
    row = catalogCriteriaRow(field.f, types.get(field.f.field) ?? 0, { SEQUENCE_NBR: Number(seq.SEQUENCE_NBR), EOCC_SEQUENCE_NBR: Number(seq.EOCC_SEQUENCE_NBR) }, 'A');
  }
  const dbType = Number(row.EOCC_FIELD_TYPE ?? 0);
  const current = existing ? String(existing.EOCC_CRITERIA_SYM ?? '').trim() : '';
  const op = await vscode.window.showQuickPick(Object.entries(CRITERIA_OPERATORS).map(([code, o]) => ({ label: `${code === current ? '$(check) ' : ''}${o.label}`, code })),
    { title: `Criterion on ${String(row.LBLTEXT ?? row.FIELDNAME)}: the operator` });
  if (!op) return undefined;
  const values = CRITERIA_OPERATORS[op.code].values;
  const format = dbType === 4 ? ' (YYYY-MM-DD)' : dbType === 5 ? ' (HH:MM:SS)' : dbType === 2 || dbType === 3 ? ' (a number)' : '';
  const keep = existing && current === op.code;
  let value = '', value2 = '';
  if (values !== 0) {
    const first = await vscode.window.showInputBox({
      title: `${String(row.LBLTEXT ?? row.FIELDNAME)} ${CRITERIA_OPERATORS[op.code].label.toLowerCase()}…`,
      prompt: values === 'list' ? `Values, comma separated${format}` : values === 2 ? `The first value${format}` : `The value${format}`,
      value: keep ? String(existing!.EOCC_VALUE_MATCH ?? '') : '',
      validateInput: (v) => (values === 2 ? checkCriterion(op.code, dbType, v, '1').filter((p) => !p.includes('second'))[0] : checkCriterion(op.code, dbType, v)[0])
    });
    if (first === undefined) return undefined;
    value = first;
    if (values === 2) {
      const second = await vscode.window.showInputBox({ title: `…and${format}`, value: keep ? String(existing!.EOCC_VALUE_MATCH2 ?? '') : '',
        validateInput: (v) => checkCriterion(op.code, dbType, value, v)[0] });
      if (second === undefined) return undefined;
      value2 = second;
    }
  }
  const problems = checkCriterion(op.code, dbType, value, value2);
  if (problems.length) { void vscode.window.showWarningMessage(problems.join(' ')); return undefined; }
  const next = withCriterionValue(row, op.code, value, value2);
  return { row: next, ...(existing ? { replacing: criterionKey(existing) } : {}) };
}

export { describeCriterion };

/**
 * A sequence's rule for one page chosen as the configurator's Pages grid offers it: a page of the component, then
 * hidden, shown, shown display only, or as the component has it (no rule). Returns the sequence's page rows.
 */
export async function pickPageRule(provider: DatabaseProvider, component: string, market: string, seq: PfcRow, pages: PfcRow[]): Promise<PfcRow[] | undefined> {
  const componentPages = await provider.readComponentPages(component, market);
  const rules = pageRulesOf(pages, seq);
  const page = await vscode.window.showQuickPick(componentPages.map((p) => ({
    label: p.label, description: `${p.page} · ${describePageRule(rules.find((r) => r.page === p.page), p.hidden)}`, p
  })), { title: `Page rules for sequence ${String(seq.EOCC_SEQUENCE_NBR)}: the page`, matchOnDescription: true });
  if (!page) return undefined;
  const rule = rules.find((r) => r.page === page.p.page);
  type Act = vscode.QuickPickItem & { act: 'none' | 'hide' | 'show' | 'showReadOnly' };
  const options: Act[] = [
    { label: 'Hidden', act: 'hide' },
    { label: page.p.hidden ? 'Shown (the component hides it)' : 'Shown', act: 'show' },
    { label: 'Shown, display only', act: 'showReadOnly' },
    { label: 'As the component has it', description: 'no rule for this page', act: 'none' }
  ];
  const now = !rule ? 'none' : rule.hidden ? 'hide' : rule.displayOnly ? 'showReadOnly' : 'show';
  const picked = await vscode.window.showQuickPick(options.map((o) => ({ ...o, label: `${o.act === now ? '$(check) ' : ''}${o.label}` })),
    { title: `${page.p.label} (${page.p.page}) in sequence ${String(seq.EOCC_SEQUENCE_NBR)}` });
  if (!picked) return undefined;
  if (picked.act === 'none') return withoutPageRule(pages, seq, page.p.page);
  return withPageRule(pages, seq, { page: page.p.page, hidden: picked.act === 'hide', displayOnly: picked.act === 'showReadOnly' });
}
