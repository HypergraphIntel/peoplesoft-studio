import { escapeHtml as esc } from './propertiesHtml.js';
import type { PageControl, PageLayout } from '../model/pageLayout.js';

/*
 * A page drawn as App Designer's Layout view: each control positioned from its
 * stored geometry (model/pageLayout.ts), styled by its shape, with its label,
 * and clickable to inspect. Read-only. A second tab shows the Order view text.
 *
 * Controls are positioned by a per-control rule in a nonce'd <style> block,
 * not inline style attributes, which the webview's Content-Security-Policy
 * (style-src 'nonce-...') does not allow.
 */

const px = (n: number) => `${Math.round(n)}px`;

/** The controls as positioned boxes, containers (group boxes, grids) behind the fields. */
function controlsHtml(controls: readonly PageControl[]): string {
  return controls.map((c) => {
    const parts: string[] = [];
    if (c.label) {
      parts.push(
        `<div class="lbl" id="lbl${c.num}">${esc(c.label.text)}</div>`);
    }
    const inner = c.shape === 'checkbox' ? '<span class="box"></span>'
      : c.shape === 'radio' ? '<span class="dot"></span>'
      : c.shape === 'dropdown' ? '<span class="caret">▾</span>'
      : c.typeName.startsWith('Push Button') || c.shape === 'button' ? esc(c.label?.text || c.typeName)
      : '';
    const use = [c.displayOnly ? 'Display Only' : '', c.invisible ? 'Invisible' : ''].filter(Boolean).join(', ');
    const title = `${c.num}. ${c.typeName}${c.recordField ? ` — ${c.recordField}` : ''}${use ? ` (${use})` : ''}`;
    const cls = `ctl s-${c.shape}${c.displayOnly ? ' u-display-only' : ''}${c.invisible ? ' u-invisible' : ''}`;
    parts.push(
      `<div class="${cls}" id="c${c.num}" tabindex="0" title="${esc(title)}"` +
      ` data-num="${c.num}" data-type="${esc(c.typeName)}" data-target="${esc(c.target)}"` +
      ` data-use="${c.use}${use ? ` (${use})` : ''}" data-name="${esc(c.pageFieldName)}" data-level="${c.level}">${inner}</div>`);
    return parts.join('');
  }).join('\n');
}

/** The per-control position rules (CSP forbids inline style attributes). */
function geometryCss(controls: readonly PageControl[]): string {
  const rules: string[] = [];
  for (const c of controls) {
    rules.push(`#c${c.num}{left:${px(c.rect.left)};top:${px(c.rect.top)};width:${px(c.rect.width)};height:${px(c.rect.height)};` +
      `z-index:${c.shape === 'container' ? 1 : 2}}`);
    if (c.label) {
      rules.push(`#lbl${c.num}{left:${px(c.label.rect.left)};top:${px(c.label.rect.top)};` +
        `${c.label.rect.width ? `max-width:${px(c.label.rect.width)};` : ''}}`);
    }
  }
  return rules.join('\n');
}

export function renderPageHtml(layout: PageLayout, orderText: string, nonce: string): string {
  const subtitle = [layout.pageType, `${layout.controls.length} controls`, `${layout.width}×${layout.height}`,
    layout.description].filter(Boolean).join(' · ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>${esc(layout.name)}</title>
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground);
    background: var(--vscode-editor-background); }
  header { padding: 0.5rem 1rem 0; }
  h1 { font-size: 1.1em; margin: 0; }
  .sub { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin: 0.1rem 0 0.4rem; }
  .tabs { display: flex; gap: 2px; padding: 0 1rem; border-bottom: 1px solid var(--vscode-panel-border, #8884); }
  .tab { background: transparent; color: var(--vscode-foreground); border: none; border-bottom: 2px solid transparent;
    padding: 0.35rem 0.9rem; opacity: 0.75; cursor: pointer; font: inherit; }
  .tab.selected { opacity: 1; border-bottom-color: var(--vscode-panelTitle-activeBorder, var(--vscode-focusBorder)); }
  .tab:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
  .panel { display: none; }
  .panel.selected { display: block; }
  .layout-wrap { display: flex; gap: 0; height: calc(100vh - 86px); }
  .canvas-scroll { flex: 1; overflow: auto; padding: 16px; }
  /* A light page surface so controls read the same in dark and light themes, as App Designer's canvas is light. */
  .canvas { position: relative; background: #fbfbfb; border: 1px solid #b9b9b9; width: ${layout.width}px; height: ${layout.height}px; }
  .ctl { position: absolute; box-sizing: border-box; font-size: 11px; color: #1a1a1a; overflow: hidden;
    display: flex; align-items: center; padding: 0 2px; }
  .ctl:focus { outline: 2px solid var(--vscode-focusBorder); outline-offset: 0; }
  .lbl { position: absolute; font-size: 11px; color: #1a1a1a; white-space: nowrap; z-index: 2; }
  .s-field { background: #fff; border: 1px solid #7a7a7a; }
  .s-dropdown { background: #fff; border: 1px solid #7a7a7a; justify-content: flex-end; }
  .caret { color: #555; }
  .s-checkbox, .s-radio { border: none; background: transparent; }
  .s-checkbox .box { width: 12px; height: 12px; border: 1px solid #555; background: #fff; display: inline-block; }
  .s-radio .dot { width: 12px; height: 12px; border: 1px solid #555; border-radius: 50%; background: #fff; display: inline-block; }
  .s-button { background: #e6e6e6; border: 1px solid #707070; border-radius: 2px; justify-content: center;
    font-size: 10px; color: #222; }
  .s-container { background: rgba(120,140,200,0.05); border: 1px solid #9aa7c8; }
  .s-label { border: 1px dashed transparent; color: #1a1a1a; }
  .s-image { background: #eef; border: 1px dashed #88a; }
  .s-rule { background: #999; border: none; }
  .s-misc { border: 1px dotted #888; background: #f4f4f4; }
  /* Use state, proven in docs/PAGE_SAVE.md: display-only dimmed, invisible hatched. */
  .u-display-only { opacity: 0.55; }
  .u-invisible { background-image: repeating-linear-gradient(45deg, #0000 0 4px, #8883 4px 6px); border-style: dashed; }
  .selected-ctl { outline: 2px solid #c02; outline-offset: 0; }
  .inspector { width: 260px; border-left: 1px solid var(--vscode-panel-border, #8884); padding: 12px; overflow: auto;
    background: var(--vscode-editorWidget-background, transparent); }
  .inspector h2 { font-size: 0.95em; margin: 0 0 0.5rem; }
  .inspector dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.15rem 0.6rem; margin: 0; }
  .inspector dt { color: var(--vscode-descriptionForeground); }
  .inspector dd { margin: 0; word-break: break-word; }
  .hint { color: var(--vscode-descriptionForeground); }
  pre.order { font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); white-space: pre;
    padding: 12px 16px; margin: 0; overflow: auto; height: calc(100vh - 86px); font-variant-ligatures: none; }
${geometryCss(layout.controls)}
</style>
</head>
<body>
  <header>
    <h1>${esc(layout.name)}</h1>
    <p class="sub">${esc(subtitle)}</p>
  </header>
  <div class="tabs" role="tablist">
    <button class="tab selected" id="tab-layout" role="tab" aria-selected="true" aria-controls="panel-layout">Layout</button>
    <button class="tab" id="tab-order" role="tab" aria-selected="false" aria-controls="panel-order">Order</button>
  </div>
  <div class="panel selected" id="panel-layout" role="tabpanel">
    <div class="layout-wrap">
      <div class="canvas-scroll">
        <div class="canvas" id="canvas">
${controlsHtml(layout.controls)}
        </div>
      </div>
      <aside class="inspector" id="inspector">
        <h2>Control</h2>
        <p class="hint" id="inspector-body">Select a control to see its properties.</p>
      </aside>
    </div>
  </div>
  <div class="panel" id="panel-order" role="tabpanel"><pre class="order">${esc(orderText)}</pre></div>
<script nonce="${nonce}">
  const tabs = { layout: document.getElementById('tab-layout'), order: document.getElementById('tab-order') };
  const panels = { layout: document.getElementById('panel-layout'), order: document.getElementById('panel-order') };
  function show(which) {
    for (const key of ['layout', 'order']) {
      const on = key === which;
      tabs[key].classList.toggle('selected', on);
      tabs[key].setAttribute('aria-selected', String(on));
      panels[key].classList.toggle('selected', on);
    }
  }
  tabs.layout.addEventListener('click', () => show('layout'));
  tabs.order.addEventListener('click', () => show('order'));

  let selected = null;
  const body = document.getElementById('inspector-body');
  function text(node, s) { node.textContent = s == null ? '' : String(s); return node; }
  function inspect(el) {
    if (selected) selected.classList.remove('selected-ctl');
    selected = el;
    el.classList.add('selected-ctl');
    const d = el.dataset;
    const rows = [
      ['Number', d.num], ['Type', d.type], ['Record field / target', d.target || '—'],
      ['Occurs level', d.level], ['Use (FIELDUSE)', d.use], ['Page field name', d.name || '—']
    ];
    const dl = document.createElement('dl');
    for (const r of rows) {
      dl.appendChild(text(document.createElement('dt'), r[0]));
      dl.appendChild(text(document.createElement('dd'), r[1]));
    }
    body.replaceChildren(dl);
  }
  document.getElementById('canvas').addEventListener('click', (e) => {
    const el = e.target.closest('.ctl');
    if (el) inspect(el);
  });
  document.getElementById('canvas').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('ctl')) { e.preventDefault(); inspect(e.target); }
  });
</script>
</body>
</html>`;
}
