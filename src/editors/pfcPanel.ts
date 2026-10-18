import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { Workspace } from '../workspace.js';
import { DatabaseProvider } from '../providers/database.js';
import { DefinitionType } from '../model/definitions.js';
import { fieldSettingsOf, describeFieldSettings, isBlankFieldRow, maskOf, fieldRowKey, withFieldRow, withoutFieldRow } from '../model/pfcFieldEdits.js';
import { describeCriterion, pickCatalogField, pickCriterion, pickFieldSettings, pickMask, pickPageRule, pickTarget } from './pfcDialogs.js';
import { describePageRule, pageRulesOf } from '../model/pfcPages.js';
import { criterionKey, withCriterion, withoutCriterion } from '../model/pfcCriteria.js';
import { describeTarget, headerLevel, targetOf, withApplyLevel, withTarget } from '../model/pfcTargeting.js';
import { pfcHtml } from './pfcHtml.js';
const panels = new Map<string, vscode.WebviewPanel>();
export async function openPageFieldConfigurator(workspace: Workspace, connectionId?: string, component?: string, market = 'GBL'): Promise<void> {
  const connected = workspace.activeProviders.filter((p): p is DatabaseProvider => p instanceof DatabaseProvider && p.isConnected);
  let provider = connected.find(p => p.id === (connectionId ?? workspace.selectedConnectionId));
  if (!provider && connected.length === 1) provider = connected[0];
  if (!provider && connected.length) provider = (await vscode.window.showQuickPick(connected.map(p => ({ label: p.displayName, provider: p })), { title: 'Page and Field Configurator — connection' }))?.provider;
  if (!provider) { if (!connected.length) void vscode.window.showInformationMessage('Connect a PeopleSoft database to configure Page and Field Configurator.'); return; }
  if (!component) {
    const db = provider;
    const picker = vscode.window.createQuickPick<vscode.QuickPickItem & { parts: string[] }>();
    picker.title = `Page and Field Configurator on ${db.displayName}`;
    picker.placeholder = 'Type at least two characters of a component name';
    let generation = 0;
    picker.onDidChangeValue(async value => {
      const current = ++generation;
      if (value.trim().length < 2) { picker.items = []; picker.busy = false; return; }
      picker.busy = true;
      try {
        const found = await db.search({ type: DefinitionType.Component, namePattern: `%${value.trim().toUpperCase()}%`, limit: 100 });
        if (current === generation) picker.items = found.map(d => ({ label: d.key.parts[0], description: d.key.parts[1], detail: d.description, parts: [...d.key.parts] }));
      } catch (error) {
        if (current === generation) { picker.items = []; void vscode.window.showErrorMessage(String(error)); }
      } finally { if (current === generation) picker.busy = false; }
    });
    const picked = await new Promise<string[] | undefined>(resolve => {
      picker.onDidAccept(() => { const item = picker.selectedItems[0]; if (item) { resolve(item.parts); picker.hide(); } });
      picker.onDidHide(() => resolve(undefined));
      picker.show();
    });
    generation++; picker.dispose();
    if (!picked) return;
    [component, market = 'GBL'] = picked;
  }

  const db = provider, name = component!, id = `${db.id}:${name}:${market}`;
  const existing = panels.get(id); if (existing) { existing.reveal(); return; }
  let type: 'STD' | 'MASK' = 'STD';
  let read = await db.readPageFieldConfiguration(name, market, type);
  type Configuration = NonNullable<typeof read.configuration>;
  const fresh = (): Configuration => ({ header: {}, sequences: [], criteria: [], pages: [], fields: [] });
  let draft = structuredClone(read.configuration ?? fresh());
  let original = JSON.stringify(draft);
  const panel = vscode.window.createWebviewPanel('psft.pageFieldConfigurator', `Page and Field Configurator: ${name}.${market}`, vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
  panels.set(id, panel); panel.onDidDispose(() => panels.delete(id));
  panel.webview.html = pfcHtml(randomBytes(18).toString('hex'));
  const operator = () => workspace.configFor(db.id)?.peoplesoftOperatorId?.trim();
  const editable = () => db.platform === 'oracle' && workspace.isWritable(db.id) && !!operator();
  const dirty = () => JSON.stringify(draft) !== original;
  const post = async (message = '') => {
    panel.title = `${dirty() ? '● ' : ''}Page and Field Configurator: ${name}.${market}`;
    await panel.webview.postMessage({ type: 'state', component: name, market, connection: db.displayName, configType: type, exists: read.exists, editable: editable(), dirty: dirty(), configuration: draft, contentReferences: read.contentReferences, mapsOnSave: read.mapsOnSave, message,
      criteriaRows: draft.criteria.map((row, index) => ({ index, sequence: row.EOCC_SEQUENCE_NBR, text: describeCriterion(row) })),
      pageRules: draft.sequences.map((q) => pageRulesOf(draft.pages, q).map((r) => `${r.page}: ${describePageRule(r, false)}`)),
      headerLevel: headerLevel(draft), headerTarget: describeTarget(targetOf(draft)), sequenceTargets: draft.sequences.map((q) => describeTarget(targetOf(draft, q))),
      fields: draft.fields.map((row, index) => ({ index, sequence: row.EOCC_SEQUENCE_NBR, page: row.STDPNLNAME ?? row.PNLNAME, name: `${row.RECNAME}.${row.FIELDNAME}`, label: row.LBLTEXT, blank: isBlankFieldRow(row), settings: type === 'MASK' ? (maskOf(row) ? `Masked (${maskOf(row)})` : 'Not masked') : describeFieldSettings(fieldSettingsOf(row)) })) });
  };
  const reload = async () => { read = await db.readPageFieldConfiguration(name, market, type); draft = structuredClone(read.configuration ?? fresh()); original = JSON.stringify(draft); };
  let queue = Promise.resolve();
  panel.webview.onDidReceiveMessage((message: unknown) => {
    queue = queue.then(async () => {
      if (!message || typeof message !== 'object') return;
      const m = message as { type?: string; configType?: string; index?: number };
      if (m.type === 'ready') { await post(); return; }
      if (m.type === 'reload' || m.type === 'switch') {
        if (dirty() && await vscode.window.showWarningMessage('Discard unsaved configuration changes?', { modal: true }, 'Discard') !== 'Discard') { await post('Kept unsaved changes.'); return; }
        if (m.type === 'switch') { if (m.configType !== 'STD' && m.configType !== 'MASK') throw new Error('Unknown configuration type.'); type = m.configType; }
        await reload(); await post(); return;
      }
      if (!editable()) throw new Error('Saving requires an Oracle Writable connection and an Operator ID.');
      if (m.type === 'header') {
        const description = await vscode.window.showInputBox({ title: 'Configuration description', value: String(draft.header.DESCR ?? ''), validateInput: v => !v.trim() || v.trim().length > 30 ? 'Enter 1–30 characters.' : undefined });
        if (description !== undefined) draft.header.DESCR = description.trim();
      } else if (m.type === 'active') draft.header.EFF_STATUS = (draft.header.EFF_STATUS ?? 'A') === 'I' ? 'A' : 'I';
      else if (m.type === 'applyLevel') draft = withApplyLevel(draft, headerLevel(draft) ? 'S' : 'H');
      else if (m.type === 'pageRules') {
        const seq = draft.sequences[m.index ?? -1]; if (!seq) throw new Error('Unknown sequence.');
        const pages = await pickPageRule(db, name, market, seq, draft.pages);
        if (pages) draft.pages = pages;
      } else if (m.type === 'addCriterion') {
        const seq = draft.sequences[m.index ?? -1]; if (!seq) throw new Error('Unknown sequence.');
        const picked = await pickCriterion(db, name, market, seq);
        if (picked) draft.criteria = withCriterion(draft.criteria, picked.row);
      } else if (m.type === 'editCriterion' || m.type === 'removeCriterion') {
        const row = draft.criteria[m.index ?? -1]; if (!row) throw new Error('Unknown criterion.');
        const seq = draft.sequences.find(q => Number(q.EOCC_SEQUENCE_NBR) === Number(row.EOCC_SEQUENCE_NBR)); if (!seq) throw new Error('Unknown sequence.');
        if (m.type === 'removeCriterion') draft.criteria = withoutCriterion(draft.criteria, seq, criterionKey(row));
        else { const picked = await pickCriterion(db, name, market, seq, row); if (picked) draft.criteria = withCriterion(draft.criteria, picked.row, picked.replacing); }
      }
      else if (m.type === 'target') {
        // index -1: the configuration (header level); else a sequence.
        const seq = (m.index ?? -1) >= 0 ? draft.sequences[m.index!] : undefined;
        if ((m.index ?? -1) >= 0 && !seq) throw new Error('Unknown sequence.');
        const t = await pickTarget(db, targetOf(draft, seq), seq ? `sequence ${String(seq.EOCC_SEQUENCE_NBR)}` : 'the configuration');
        if (t) draft = withTarget(draft, seq, t);
      }
      else if (m.type === 'addSequence') {
        const description = await vscode.window.showInputBox({ title: 'New sequence (everyone, all form factors)', validateInput: v => v.trim().length > 30 ? 'At most 30 characters.' : undefined });
        if (description !== undefined) {
          const n = Math.max(0, ...draft.sequences.map(r => Number(r.EOCC_SEQUENCE_NBR))) + 1;
          const seq = { SEQUENCE_NBR: n, EOCC_SEQUENCE_NBR: n, DESCR: description.trim() };
          draft.sequences.push(seq); draft.fields.push({ SEQUENCE_NBR: n, EOCC_SEQUENCE_NBR: n });
        }
      } else if (m.type === 'sequenceActive' || m.type === 'addField') {
        const seq = draft.sequences[m.index ?? -1]; if (!seq) throw new Error('Unknown sequence.');
        if (m.type === 'sequenceActive') seq.STATUS = (seq.STATUS ?? 'A') === 'I' ? 'A' : 'I';
        else {
          const field = await pickCatalogField(db, name, market, seq, draft.fields.filter(r => Number(r.EOCC_SEQUENCE_NBR) === Number(seq.EOCC_SEQUENCE_NBR)), type === 'MASK');
          if (field) { const set = type === 'MASK' ? await pickMask(db, field.row) : await pickFieldSettings(field.row, field.pageLabel); if (set) draft.fields = withFieldRow(draft.fields, set.row); }
        }
      } else if (m.type === 'editField' || m.type === 'removeField') {
        const row = draft.fields[m.index ?? -1]; if (!row || isBlankFieldRow(row)) throw new Error('Unknown field.');
        if (m.type === 'removeField') {
          const seq = draft.sequences.find(s => Number(s.EOCC_SEQUENCE_NBR) === Number(row.EOCC_SEQUENCE_NBR)); if (!seq) throw new Error('Unknown sequence.');
          draft.fields = withoutFieldRow(draft.fields, seq, fieldRowKey(row));
        } else { const set = type === 'MASK' ? await pickMask(db, row) : await pickFieldSettings(row); if (set) draft.fields = withFieldRow(draft.fields, set.row); }
      } else if (m.type === 'map') {
        // Apply Configuration / Remove Mapping (Map to Portal Registry) where a save maps nothing; the saved configuration is mapped.
        if (dirty()) throw new Error('Save the configuration first: the saved configuration is what is mapped.');
        const crefs = await vscode.window.showQuickPick(read.contentReferences.map(c => ({ label: c.cref, description: `${c.mappingRows} mapped events${c.inSync ? ' · in sync' : ''}`, picked: true })),
          { title: `Map ${name}.${market}'s ${type} configuration: content references`, canPickMany: true });
        if (!crefs?.length) { await post(); return; }
        const action = await vscode.window.showQuickPick([{ label: 'Apply Configuration', remove: false }, { label: 'Remove Mapping', remove: true }], { title: 'Map or unmap' });
        if (!action) { await post(); return; }
        const request = { component: name, market, type, contentReferences: crefs.map(c => c.label), remove: action.remove, openedToken: read.token, operatorId: operator()! };
        const preview = await db.applyPageFieldMapping({ ...request, dryRun: true });
        const detail = preview.mappings.changes.join('\n');
        if (!preview.mappings.statements.length) { await post('Nothing to change.'); return; }
        if (await vscode.window.showWarningMessage(`${action.label} on ${db.displayName}?`, { modal: true, detail }, action.label) !== action.label) { await post('Cancelled.'); return; }
        await db.applyPageFieldMapping(request); await reload(); await post(`${action.label}: done and verified.`); void vscode.commands.executeCommand('psft.customization.refresh'); return;
      } else if (m.type === 'preview' || m.type === 'save') {
        if (!String(draft.header.DESCR ?? '').trim()) throw new Error('Set a configuration description first.');
        const request = { component: name, market, type, configuration: draft, openedToken: read.token, operatorId: operator()! };
        const preview = await db.savePageFieldConfiguration({ ...request, dryRun: true });
        const detail = [...preview.rows.changes, ...(preview.mappings?.changes ?? []), ...preview.warnings].join('\n');
        if (m.type === 'preview' || preview.rows.empty) { await post(detail || 'Nothing to save.'); return; }
        if (await vscode.window.showWarningMessage(`Save ${type} configuration for ${name}.${market} on ${db.displayName}?`, { modal: true, detail }, 'Save') !== 'Save') { await post('Save cancelled.'); return; }
        await db.savePageFieldConfiguration(request); await reload(); await post('Saved and verified.'); void vscode.commands.executeCommand('psft.customization.refresh'); return;
      }
      await post();
    }).catch(async error => { await post(`Error: ${error instanceof Error ? error.message : String(error)}`); });
  });
}
