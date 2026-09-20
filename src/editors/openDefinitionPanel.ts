import * as vscode from 'vscode';
import { Workspace } from '../workspace.js';
import { DefinitionProvider, DefinitionSummary } from '../providers/provider.js';
import { DefinitionKey, displayName, typeLabel } from '../model/definitions.js';

/**
 * App Designer's Open Definition dialog.
 *
 * Deliberately a panel rather than a chain of quick picks. The dialog is a
 * loop, not a wizard: pick a type, search, look at what came back, adjust the
 * pattern, search again. Quick picks force that into a one-way sequence where
 * refining a search means starting over.
 *
 * Nothing is searched until Search is pressed. That is the point — connecting
 * to an environment should cost one round trip, not a listing of every
 * definition in it.
 */
export class OpenDefinitionPanel {
  private static current?: OpenDefinitionPanel;

  private readonly disposables: vscode.Disposable[] = [];
  private results: DefinitionSummary[] = [];
  private provider?: DefinitionProvider;

  static show(workspace: Workspace, extensionUri: vscode.Uri): void {
    // One dialog at a time; reopening reveals the existing one so a search in
    // progress is not thrown away.
    if (OpenDefinitionPanel.current) {
      OpenDefinitionPanel.current.panel.reveal();
      OpenDefinitionPanel.current.refreshEnvironments();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'psft.openDefinition',
      'Open Definition',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [extensionUri] });

    OpenDefinitionPanel.current = new OpenDefinitionPanel(panel, workspace);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly workspace: Workspace
  ) {
    panel.webview.html = this.render();

    panel.onDidDispose(() => {
      OpenDefinitionPanel.current = undefined;
      for (const d of this.disposables) d.dispose();
    }, null, this.disposables);

    panel.webview.onDidReceiveMessage(
      (message) => void this.onMessage(message), null, this.disposables);

    this.workspace.onDidChange(() => this.refreshEnvironments(), null, this.disposables);
    this.refreshEnvironments();
  }

  /** Sends the connected environments and their searchable types to the page. */
  private refreshEnvironments(): void {
    const connected = this.workspace.activeProviders.filter((p) => p.isConnected);
    void this.panel.webview.postMessage({
      kind: 'environments',
      environments: connected.map((p) => ({
        id: p.id,
        name: p.displayName,
        types: p.searchableTypes.map((t) => ({ value: t, label: typeLabel(t) }))
      }))
    });
  }

  private async onMessage(message: any): Promise<void> {
    switch (message?.kind) {
      case 'search': return this.search(message.environment, Number(message.type), String(message.pattern ?? ''));
      case 'open': return this.open(Number(message.index));
      case 'cancel': this.panel.dispose(); return;
    }
  }

  private async search(environmentId: string, type: number, pattern: string): Promise<void> {
    const provider = this.workspace.getProvider(environmentId);
    if (!provider) {
      return this.post({ kind: 'error', message: 'That environment is no longer connected.' });
    }
    this.provider = provider;

    try {
      this.results = await provider.search({
        type,
        // A bare name means "starts with", which is how App Designer's dialog
        // behaves. An explicit % anywhere means the user is driving the
        // pattern themselves, so it is passed through untouched.
        namePattern: pattern.includes('%') ? pattern : `${pattern}%`,
        limit: 500
      });
      this.post({
        kind: 'results',
        rows: this.results.map((r) => ({
          name: displayName(r.key),
          description: r.description ?? '',
          updatedBy: r.lastUpdatedBy ?? ''
        }))
      });
    } catch (err) {
      this.results = [];
      this.post({ kind: 'error', message: (err as Error).message });
    }
  }

  private async open(index: number): Promise<void> {
    const summary = this.results[index];
    if (!summary || !this.provider) return;
    await vscode.commands.executeCommand(
      'psft.openDefinition', this.provider.id, summary.key satisfies DefinitionKey);
    this.panel.dispose();
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  private render(): string {
    const nonce = createNonce();
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         background: var(--vscode-editor-background); padding: 1rem 1.25rem;
         display: flex; flex-direction: column; height: 100vh;
         box-sizing: border-box; margin: 0; }
  h1 { font-size: 1.05rem; margin: 0 0 .9rem; }
  .row { display: flex; gap: .5rem; align-items: flex-end; flex-wrap: wrap;
         margin-bottom: .75rem; }
  .field { display: flex; flex-direction: column; gap: .25rem; }
  .field.grow { flex: 1 1 14rem; }
  label { font-size: .78rem; color: var(--vscode-descriptionForeground); }
  select, input {
    font-family: inherit; font-size: .88rem; padding: .35rem .4rem;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px;
  }
  input:focus, select:focus { outline: 1px solid var(--vscode-focusBorder); }
  button {
    font-family: inherit; font-size: .88rem; padding: .38rem .9rem; border: none;
    border-radius: 2px; cursor: pointer;
    color: var(--vscode-button-foreground); background: var(--vscode-button-background);
  }
  button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: .45; cursor: default; }
  button.secondary {
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
  }
  #status { font-size: .8rem; color: var(--vscode-descriptionForeground);
            margin-bottom: .4rem; min-height: 1.1em; }
  #status.error { color: var(--vscode-errorForeground); }
  #results { flex: 1; overflow-y: auto; border: 1px solid var(--vscode-panel-border);
             border-radius: 2px; min-height: 8rem; }
  table { border-collapse: collapse; width: 100%; font-size: .85rem; }
  th { position: sticky; top: 0; text-align: left; font-weight: 600;
       padding: .35rem .6rem; background: var(--vscode-editor-background);
       border-bottom: 1px solid var(--vscode-panel-border); }
  td { padding: .3rem .6rem; }
  tbody tr { cursor: pointer; }
  tbody tr:hover { background: var(--vscode-list-hoverBackground); }
  tbody tr[aria-selected="true"] {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }
  td.name { font-family: var(--vscode-editor-font-family); }
  td.who { color: var(--vscode-descriptionForeground); }
  tbody tr[aria-selected="true"] td.who { color: inherit; }
  .footer { display: flex; justify-content: flex-end; gap: .5rem; padding-top: .8rem; }
  .empty { padding: 1.4rem; text-align: center;
           color: var(--vscode-descriptionForeground); font-size: .85rem; }
</style>
</head>
<body>
  <h1>Open Definition</h1>

  <div class="row">
    <div class="field">
      <label for="environment">Environment</label>
      <select id="environment"></select>
    </div>
    <div class="field">
      <label for="type">Definition Type</label>
      <select id="type"></select>
    </div>
    <div class="field grow">
      <label for="name">Name</label>
      <input id="name" type="text" placeholder="Starts with, or use % as a wildcard"
             autocomplete="off" autofocus>
    </div>
    <button id="search">Search</button>
  </div>

  <div id="status">Choose a definition type and search.</div>
  <div id="results"><div class="empty">No search yet.</div></div>

  <div class="footer">
    <button id="cancel" class="secondary">Cancel</button>
    <button id="open" disabled>Open</button>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  let environments = [];
  let selected = -1;

  function setStatus(text, isError) {
    const el = $('status');
    el.textContent = text;
    el.className = isError ? 'error' : '';
  }

  function renderTypes() {
    const env = environments.find((e) => e.id === $('environment').value);
    const type = $('type');
    const previous = type.value;
    type.innerHTML = '';
    for (const t of env ? env.types : []) {
      const option = document.createElement('option');
      option.value = String(t.value);
      option.textContent = t.label;
      type.appendChild(option);
    }
    // Keep the chosen type across an environment change when it still exists.
    if (previous && [...type.options].some((o) => o.value === previous)) {
      type.value = previous;
    }
    $('search').disabled = type.options.length === 0;
  }

  function select(index) {
    selected = index;
    for (const row of document.querySelectorAll('tbody tr')) {
      row.setAttribute('aria-selected', String(Number(row.dataset.index) === index));
    }
    $('open').disabled = index < 0;
  }

  function renderResults(rows) {
    const host = $('results');
    if (rows.length === 0) {
      host.innerHTML = '<div class="empty">No definitions matched.</div>';
      select(-1);
      return;
    }
    const table = document.createElement('table');
    table.innerHTML =
      '<thead><tr><th>Name</th><th>Description</th><th>Last updated by</th></tr></thead>';
    const body = document.createElement('tbody');
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      tr.dataset.index = String(i);
      tr.innerHTML =
        '<td class="name"></td><td class="descr"></td><td class="who"></td>';
      tr.children[0].textContent = r.name;
      tr.children[1].textContent = r.description;
      tr.children[2].textContent = r.updatedBy;
      tr.addEventListener('click', () => select(i));
      tr.addEventListener('dblclick', () => open());
      body.appendChild(tr);
    });
    table.appendChild(body);
    host.innerHTML = '';
    host.appendChild(table);
    select(0);
  }

  function search() {
    const env = $('environment').value;
    const type = $('type').value;
    if (!env || type === '') return;
    setStatus('Searching...');
    $('results').innerHTML = '<div class="empty">Searching...</div>';
    select(-1);
    vscode.postMessage({ kind: 'search', environment: env, type, pattern: $('name').value.trim() });
  }

  function open() {
    if (selected >= 0) vscode.postMessage({ kind: 'open', index: selected });
  }

  $('search').addEventListener('click', search);
  $('open').addEventListener('click', open);
  $('cancel').addEventListener('click', () => vscode.postMessage({ kind: 'cancel' }));
  $('environment').addEventListener('change', renderTypes);
  $('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') vscode.postMessage({ kind: 'cancel' });
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.kind === 'environments') {
      environments = message.environments;
      const select = $('environment');
      const previous = select.value;
      select.innerHTML = '';
      for (const e of environments) {
        const option = document.createElement('option');
        option.value = e.id;
        option.textContent = e.name;
        select.appendChild(option);
      }
      if (previous && environments.some((e) => e.id === previous)) select.value = previous;
      renderTypes();
      if (environments.length === 0) {
        setStatus('No environment is connected.', true);
        $('search').disabled = true;
      }
    } else if (message.kind === 'results') {
      renderResults(message.rows);
      setStatus(message.rows.length === 1
        ? '1 definition found.'
        : message.rows.length + ' definitions found.');
      if (message.rows.length > 0) $('open').focus();
    } else if (message.kind === 'error') {
      $('results').innerHTML = '<div class="empty">Search failed.</div>';
      select(-1);
      setStatus(message.message, true);
    }
  });
</script>
</body>
</html>`;
  }
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
