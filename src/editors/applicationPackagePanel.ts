import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { packageAddress, type ApplicationPackageDocument, type PackageNode } from '../model/appPackages.js';
import type { DefinitionKey } from '../model/definitions.js';
import { escapeHtml as esc } from './propertiesHtml.js';

export interface ApplicationPackageHost {
  connection: { id: string; displayName: string };
  load(): Promise<ApplicationPackageDocument | undefined>;
  writable(): boolean;
  insertPackage(parent: DefinitionKey, version: number): Promise<void>;
  insertClass(parent: DefinitionKey): Promise<void>;
  openClass(key: DefinitionKey): Promise<void>;
}

interface OpenPackage {
  panel: vscode.WebviewPanel;
  host: ApplicationPackageHost;
  doc: ApplicationPackageDocument;
  busy: boolean;
  disposed: boolean;
  reloading?: Promise<void>;
  rendered?: string;
}

/** A package is a tree of definitions; its class source stays in the normal PeopleCode editor. */
export class ApplicationPackagePanel {
  private static readonly open = new Map<string, OpenPackage>();

  static async show(host: ApplicationPackageHost, root: string): Promise<void> {
    const id = JSON.stringify([host.connection.id, root]);
    const existing = this.open.get(id);
    if (existing) { existing.panel.reveal(); await this.reload(existing); return; }
    const doc = await host.load();
    if (!doc) throw new Error(`Application Package ${root} was not found on ${host.connection.displayName}.`);
    const panel = vscode.window.createWebviewPanel('psft.applicationPackage', root, vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true });
    panel.iconPath = new vscode.ThemeIcon('package');
    const open: OpenPackage = { panel, host, doc, busy: false, disposed: false };
    this.open.set(id, open);
    panel.onDidDispose(() => { open.disposed = true; this.open.delete(id); });
    panel.webview.onDidReceiveMessage(message => void this.receive(open, message));
    this.render(open);
  }

  static refreshAll(): void {
    for (const open of this.open.values()) void this.reload(open).catch(error => {
      if (!open.disposed) this.render(open, error instanceof Error ? error.message : String(error));
    });
  }

  private static render(open: OpenPackage, status = ''): void {
    if (!open.disposed) {
      const writable = open.host.writable();
      open.rendered = JSON.stringify([open.doc, writable]);
      open.panel.webview.html = renderApplicationPackageHtml(open.doc, open.host.connection.displayName,
        writable, randomBytes(16).toString('base64'), status);
    }
  }

  private static async reload(open: OpenPackage, force = false): Promise<void> {
    if (open.reloading) return open.reloading;
    if (open.busy || open.disposed) return;
    open.busy = true;
    open.reloading = Promise.resolve().then(async () => {
      try {
        const doc = await open.host.load();
        if (!doc) throw new Error(`Application Package ${open.doc.root} no longer exists on this connection.`);
        open.doc = doc;
        if (force || open.rendered !== JSON.stringify([doc, open.host.writable()])) this.render(open);
      } finally { open.busy = false; open.reloading = undefined; }
    });
    return open.reloading;
  }

  private static async receive(open: OpenPackage, message: unknown): Promise<void> {
    if (open.reloading) await open.reloading.catch(() => {});
    if (open.busy || open.disposed || !message || typeof message !== 'object') return;
    const m = message as { action?: string; key?: DefinitionKey; version?: number };
    if (m.action === 'refresh') { await this.reload(open, true).catch(error => this.render(open, String(error))); return; }
    if (!['open', 'insertPackage', 'insertClass'].includes(m.action ?? '')) return;
    // Only keys from this displayed package can be acted on, never arbitrary webview input.
    let found: PackageNode | undefined;
    const visit = (node: PackageNode): void => {
      if (JSON.stringify(node.key) === JSON.stringify(m.key)) found = node;
      node.children.forEach(visit);
    };
    visit(open.doc.tree);
    if (!found?.key) return;
    open.busy = true;
    try {
      if (m.action === 'open' && found.kind === 'class') await open.host.openClass(found.key);
      else if (found.kind === 'package' && m.action !== 'open') {
        if (!open.host.writable()) throw new Error('This connection is read-only or has no PeopleSoft Operator ID.');
        if (m.action === 'insertClass') await open.host.insertClass(found.key);
        else {
          if (m.version !== open.doc.version || open.doc.version === undefined) throw new Error('Refresh the package before inserting a subpackage.');
          await open.host.insertPackage(found.key, open.doc.version);
        }
        const doc = await open.host.load();
        if (!doc) throw new Error('The package no longer exists.');
        open.doc = doc; this.render(open);
      }
    } catch (error) {
      this.render(open, error instanceof Error ? error.message : String(error));
    } finally { open.busy = false; }
  }
}

export function renderApplicationPackageHtml(doc: ApplicationPackageDocument, connection: string, writable: boolean, nonce: string, status = ''): string {
  const keyAttr = (key: DefinitionKey | undefined) => esc(JSON.stringify(key));
  const icon = (kind: PackageNode['kind']): string => `<svg class="node-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linejoin="round" aria-hidden="true" focusable="false">${kind === 'package'
    ? '<path d="m8 1.5 6 3.3v6.4l-6 3.3-6-3.3V4.8L8 1.5Zm-6 3.3 6 3.3 6-3.3M8 8.1v6.4M5 3.2l6 3.3"/>'
    : '<path d="M3 1.5h7l3 3v10H3zM10 1.5v3h3M5 7h6M5 9.5h6M5 12h4"/>'}</svg>`;
  const label = (n: PackageNode): string => `${icon(n.kind)}<span class="node-label">${esc(n.name)}</span>`;
  const twisty = '<span class="twisty" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor"><path d="m6 4 4 4-4 4"/></svg></span>';
  const node = (n: PackageNode): string => n.kind === 'class'
    ? `<li><button class="class" data-key="${keyAttr(n.key)}" data-kind="class" title="${esc(n.name)}">${label(n)}</button></li>`
    : `<li><details open><summary>${twisty}<button class="package" data-key="${keyAttr(n.key)}" data-kind="package" title="${esc(n.name)}">${label(n)}</button></summary><ul>${n.children.map(node).join('') || '<li class="empty">Empty package</li>'}</ul></details></li>`;
  const rootKey = doc.tree.key!;
  const initialPath = packageAddress(rootKey).root;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${esc(nonce)}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(doc.root)}</title>
<style>
*{box-sizing:border-box}body{font-family:var(--vscode-font-family,sans-serif);font-size:var(--vscode-font-size,13px);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;padding:16px;max-width:1100px}
h1{font-size:18px;margin:0 0 6px}.muted,.empty{color:var(--vscode-descriptionForeground);font-size:12px}.toolbar{display:flex;align-items:center;gap:6px;margin:14px 0;flex-wrap:wrap}
button{font:inherit;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:1px solid transparent;padding:5px 10px;cursor:pointer;border-radius:2px}
button:disabled{opacity:.45;cursor:default}button:focus-visible{outline:1px solid var(--vscode-focusBorder)}
.layout{display:grid;grid-template-columns:minmax(260px,1fr) minmax(200px,.7fr);border-top:1px solid var(--vscode-panel-border);padding-top:12px;gap:20px}
nav{min-width:0}nav ul{list-style:none;padding:0;margin:0}nav li{margin:0;padding:0}nav details>ul{margin-left:7px;padding-left:10px;border-left:1px solid var(--vscode-tree-indentGuidesStroke,var(--vscode-panel-border))}
summary{display:flex;align-items:center;list-style:none;cursor:pointer;height:22px}summary::-webkit-details-marker{display:none}
.twisty{display:flex;align-items:center;justify-content:center;flex:0 0 16px;height:22px}.twisty svg{width:16px;height:16px;stroke-width:1.5}details[open]>summary>.twisty svg{transform:rotate(90deg)}summary:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}
nav button{display:flex;align-items:center;gap:4px;max-width:100%;min-width:0;height:22px;line-height:20px;color:var(--vscode-foreground);background:transparent;text-align:left;padding:0 4px;border:0;border-radius:0}nav .class{margin-left:16px;max-width:calc(100% - 16px)}
.node-icon{display:block;flex:0 0 16px;width:16px;height:16px}.node-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}nav button:hover{background:var(--vscode-list-hoverBackground)}nav button.selected{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}
.empty{height:22px;line-height:22px;padding-left:20px}aside{border-left:1px solid var(--vscode-panel-border);padding-left:16px}aside p:first-child{margin-top:2px}#path{overflow-wrap:anywhere;font-weight:600}#status{white-space:pre-wrap;color:var(--vscode-errorForeground)}#status:empty{display:none}
@media(max-width:760px){.layout{grid-template-columns:1fr}aside{border:0;padding:0}}
</style></head><body><h1>${esc(doc.root)}</h1><div class="muted">Application Package · ${esc(connection)} · ${writable ? 'Writable' : 'Read-only'}</div>
<div class="toolbar"><button id="insertPackage" ${writable && doc.version !== undefined ? '' : 'disabled'}>Insert Subpackage</button><button id="insertClass" ${writable ? '' : 'disabled'}>Insert Class</button><button id="openClass" disabled>Open PeopleCode</button><button id="refresh">Refresh</button></div>
<p id="status" role="status">${esc(status)}</p><div class="layout"><nav aria-label="Application Package hierarchy"><ul>${node(doc.tree)}</ul></nav>
<aside><p id="path">${esc(initialPath)}</p><p id="hint">Select a class to open its PeopleCode.</p><p class="muted">${writable ? 'New classes open with a declaration. Save their PeopleCode to create them; saved classes then appear in this tree.' : 'This connection is read-only. Classes open for viewing.'}</p></aside></div>
<script nonce="${esc(nonce)}">
const vscode=acquireVsCodeApi(), writable=${JSON.stringify(writable)}, version=${JSON.stringify(doc.version ?? null)};
const saved=vscode.getState?.();let selected=document.querySelector('button.package'), busy=false;
const pkg=document.getElementById('insertPackage'), cls=document.getElementById('insertClass'), open=document.getElementById('openClass');
function select(button){if(busy)return;selected?.classList.remove('selected');selected=button;button.classList.add('selected');const key=JSON.parse(button.dataset.key),isClass=button.dataset.kind==='class';
const path=isClass?key.parts.filter(p=>p!=='OnExecute'&&p!==':').join(':'):(key.parts.length===1?key.parts[0]:key.parts[2]==='.'?key.parts[1]:[key.parts[1],...key.parts[2].split(':').filter(Boolean),key.parts[0]].join(':'));
document.getElementById('path').textContent=path;document.getElementById('hint').textContent=isClass?(writable?'Open PeopleCode to edit this class.':'Open PeopleCode to view this class.'):(writable?'Insert into this package. Double-click a class to open its PeopleCode.':'Select a class to view its PeopleCode.');
const depth=isClass?0:key.parts.length===1||key.parts[2]==='.'?0:key.parts[2]===':'?1:2;
pkg.disabled=!writable||isClass||version===null||depth>=2;cls.disabled=!writable||isClass;open.disabled=!isClass;vscode.setState?.({key:button.dataset.key});}
function send(action){if(busy||!selected)return;busy=true;document.querySelectorAll('.toolbar button').forEach(b=>b.disabled=true);vscode.postMessage({action,key:JSON.parse(selected.dataset.key),version});if(action==='open'){busy=false;select(selected);document.getElementById('refresh').disabled=false;}}
document.querySelectorAll('nav button').forEach(button=>{button.addEventListener('click',e=>{e.preventDefault();select(button)});button.addEventListener('dblclick',()=>{if(button.dataset.kind==='class')send('open')})});
pkg.onclick=()=>send('insertPackage');cls.onclick=()=>send('insertClass');open.onclick=()=>send('open');document.getElementById('refresh').onclick=()=>send('refresh');select([...document.querySelectorAll('nav button')].find(b=>b.dataset.key===saved?.key)||selected);
</script></body></html>`;
}
