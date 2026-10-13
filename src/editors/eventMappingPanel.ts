import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import {
  EVENT_LEVEL_LABELS, EVENTS_BY_LEVEL, eventLabel, normalizeConfigRow, PROCESSING_LABELS, validateConfigRows, type EventLevel, type EventMappingConfigRow
} from '../model/eventMapping.js';
import type { ConfigurationSaveResult } from '../providers/eventMappingWriter.js';
import { escapeHtml as esc } from './propertiesHtml.js';

/*
 * The Configure Event Mapping page in VS Code (docs/CUSTOMIZATION.md
 * "Writing Event Mapping"): one content reference's configuration as the
 * page's grid -- level, page or record and field, event, service,
 * processing, Event Map Parameter, sequence, enabled -- saved as the page
 * saves it (providers/eventMappingWriter.ts) after the plan is shown: what
 * changes, how many unchanged rows the save re-saves (Oracle's among them),
 * and rows that reach outside the component. New Service creates the class
 * and the service a row runs. The rows live here; the webview
 * (media/eventMapping.js) shows them and sends edits.
 */

export interface EventMappingHost {
  connection: { id: string; displayName: string };
  cref: string;
  portal: string;
  label: string;
  component: { name: string; market: string };
  /** Undefined when the connection cannot save (read-only, no Operator ID). */
  save?: (rows: EventMappingConfigRow[], token: string, dryRun: boolean) => Promise<ConfigurationSaveResult>;
  remove?: (token: string) => Promise<void>;
  newService?: () => Promise<string | undefined>;
  reload: () => Promise<{ rows: EventMappingConfigRow[]; token: string; exists: boolean }>;
  choices: () => Promise<{ pages: string[]; records: string[]; services: Array<{ id: string; name: string; appClass: string }> }>;
  fields: (record: string) => Promise<{ onComponent: string[]; all: string[] }>;
  openClass: (appClass: string) => Promise<void>;
}

interface Open {
  panel: vscode.WebviewPanel;
  host: EventMappingHost;
  rows: EventMappingConfigRow[];
  stored: EventMappingConfigRow[];
  token: string;
  exists: boolean;
  status?: string;
  warnings: string[];
  choices?: Awaited<ReturnType<EventMappingHost['choices']>>;
}

type Message =
  | { type: 'ready' }
  | { type: 'edit'; rows: EventMappingConfigRow[] }
  | { type: 'save' } | { type: 'revert' } | { type: 'remove' } | { type: 'newService' }
  | { type: 'fields'; record: string }
  | { type: 'openClass'; serviceId: string };

let extUri: vscode.Uri | undefined;
export function setEventMappingExtensionUri(uri: vscode.Uri): void { extUri = uri; }

export class EventMappingPanel {
  static readonly viewType = 'psft.eventMapping';
  private static readonly open = new Map<string, Open>();

  static key(connectionId: string, cref: string): string { return `${connectionId}\u0000${cref}`; }

  static async show(host: EventMappingHost): Promise<void> {
    const id = EventMappingPanel.key(host.connection.id, host.cref);
    const existing = EventMappingPanel.open.get(id);
    if (existing) { existing.panel.reveal(); return; }
    if (!extUri) throw new Error('The Event Mapping editor is not initialised.');
    const read = await host.reload();
    const panel = vscode.window.createWebviewPanel(EventMappingPanel.viewType, `Event Mapping: ${host.label}`, vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(extUri, 'media')] });
    const open: Open = { panel, host, rows: read.rows, stored: read.rows, token: read.token, exists: read.exists, warnings: [],
      ...(read.exists ? {} : { status: 'Not configured yet: the first Save configures this content reference.' }) };
    EventMappingPanel.open.set(id, open);
    panel.onDidDispose(() => EventMappingPanel.open.delete(id));
    panel.webview.onDidReceiveMessage((m) => { void EventMappingPanel.receive(open, m as Message); });
    const media = (f: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(extUri!, 'media', f)).toString();
    const nonce = randomBytes(16).toString('base64');
    const config = {
      levels: EVENT_LEVEL_LABELS, processing: PROCESSING_LABELS,
      events: Object.fromEntries((Object.keys(EVENTS_BY_LEVEL) as EventLevel[]).map((l) => [l, EVENTS_BY_LEVEL[l].map((e) => ({ code: e, label: eventLabel({ level: l, event: e }) }))]))
    };
    panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${esc(media('eventMapping.css'))}">
<title>${esc(host.label)}</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" id="config" type="application/json">${JSON.stringify(config).replace(/</g, '\\u003c')}</script>
<script nonce="${nonce}" src="${esc(media('eventMapping.js'))}"></script>
</body>
</html>`;
  }

  /** After a save made elsewhere (the MCP tools): an open, unchanged editor shows the stored configuration. */
  static async reloadIfOpen(connectionId: string, cref: string): Promise<void> {
    const open = EventMappingPanel.open.get(EventMappingPanel.key(connectionId, cref));
    if (!open || EventMappingPanel.dirty(open)) return;
    await EventMappingPanel.reload(open, 'Reloaded: the configuration was saved elsewhere.');
  }

  private static dirty(open: Open): boolean {
    const text = (rows: EventMappingConfigRow[]) => JSON.stringify(rows.map(normalizeConfigRow));
    return text(open.rows) !== text(open.stored);
  }

  private static async reload(open: Open, status?: string): Promise<void> {
    const read = await open.host.reload();
    open.rows = read.rows; open.stored = read.rows; open.token = read.token; open.exists = read.exists; open.warnings = [];
    if (status !== undefined) open.status = status;
    await EventMappingPanel.post(open);
  }

  private static async post(open: Open, extra: Record<string, unknown> = {}): Promise<void> {
    const h = open.host;
    open.choices ??= await h.choices().catch(() => ({ pages: [], records: [], services: [] }));
    const dirty = EventMappingPanel.dirty(open);
    open.panel.title = `${dirty ? '● ' : ''}Event Mapping: ${h.label}`;
    await open.panel.webview.postMessage({
      type: 'state',
      cref: h.cref, label: h.label, portal: h.portal, component: h.component, connection: h.connection.displayName,
      rows: open.rows, exists: open.exists, dirty, editable: !!h.save,
      problems: validateConfigRows(open.rows).map((p) => (p.row ? `Row ${p.row}: ` : '') + p.message),
      warnings: open.warnings, status: open.status ?? '', choices: open.choices, ...extra
    });
  }

  private static async receive(open: Open, m: Message): Promise<void> {
    const h = open.host;
    try {
      switch (m.type) {
        case 'ready': await EventMappingPanel.post(open); return;
        case 'edit': open.rows = m.rows; open.status = ''; await EventMappingPanel.post(open); return;
        case 'revert': await EventMappingPanel.reload(open, 'Reverted to the stored configuration.'); return;
        case 'fields': await open.panel.webview.postMessage({ type: 'fields', record: m.record, ...(await h.fields(m.record)) }); return;
        case 'openClass': {
          const s = open.choices?.services.find((x) => x.id === m.serviceId);
          if (s) await h.openClass(s.appClass);
          return;
        }
        case 'newService': {
          if (!h.newService) return;
          const id = await h.newService();
          if (!id) return;
          open.choices = undefined;
          open.status = `Created service ${id}: choose it on a row.`;
          await EventMappingPanel.post(open);
          return;
        }
        case 'save': await EventMappingPanel.save(open); return;
        case 'remove': await EventMappingPanel.remove(open); return;
      }
    } catch (error) {
      open.status = `Error: ${error instanceof Error ? error.message : String(error)}`;
      await EventMappingPanel.post(open);
    }
  }

  private static async save(open: Open): Promise<void> {
    const h = open.host;
    if (!h.save) return;
    const problems = validateConfigRows(open.rows);
    if (problems.length) { open.status = 'Fix the rows marked first.'; await EventMappingPanel.post(open); return; }
    const preview = await h.save(open.rows, open.token, true);
    open.warnings = preview.plan.summary.warnings;
    if (preview.plan.empty) { open.status = 'Nothing to save.'; await EventMappingPanel.post(open); return; }
    const s = preview.plan.summary;
    const detail = [
      ...s.changes,
      ...(s.restamped ? [`${s.restamped} unchanged row(s) re-saved and restamped, as the Configure Event Mapping page re-saves every row.`] : []),
      ...s.warnings.map((w) => `Warning: ${w}`)
    ].slice(0, 30).join('\n');
    const answer = await vscode.window.showInformationMessage(`Save the Event Mapping configuration of ${h.label} (${h.cref}) on ${h.connection.displayName}?`,
      { modal: true, detail }, 'Save');
    if (answer !== 'Save') return;
    await h.save(open.rows, open.token, false);
    await EventMappingPanel.reload(open, `Saved ${new Date().toLocaleTimeString()}: ${s.changes.length} change(s).`);
  }

  private static async remove(open: Open): Promise<void> {
    const h = open.host;
    if (!h.remove || !open.exists) return;
    const answer = await vscode.window.showWarningMessage(`Remove the Event Mapping configuration of ${h.label} (${h.cref})?`,
      { modal: true, detail: `All ${open.stored.length} row(s) are deleted, as the Configure Event Mapping list's Remove does. The services are kept.` }, 'Remove');
    if (answer !== 'Remove') return;
    await h.remove(open.token);
    await EventMappingPanel.reload(open, 'Removed. Save configures the content reference again.');
  }
}
