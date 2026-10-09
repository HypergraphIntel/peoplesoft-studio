import { escapeHtml as esc } from './propertiesHtml.js';
import type { PageControl, PageLayout } from '../model/pageLayout.js';

/*
 * A page drawn as App Designer's Layout view: each control positioned from its
 * stored geometry (model/pageLayout.ts), styled by its shape, with its label,
 * clickable to inspect. On a Writable connection it is editable -- drag to
 * move, corner-resize, Delete to remove, edit the label and use in the
 * inspector -- and Save writes the changes through pageWriter.ts. A second tab
 * shows the Order view text.
 *
 * Positions are set by per-control rules in a nonce'd <style> block, not inline
 * style attributes (the webview CSP's style-src is nonce-only). During editing
 * the script moves controls with element.style.* (CSSOM, which the CSP allows)
 * and keeps each control's stored PSPNLFIELD columns in data-* attributes, so
 * Save round-trips the exact columns the writer expects.
 */

const px = (n: number) => `${Math.round(n)}px`;

export interface PageHtmlOptions {
  /** The connection is Writable and has an operator: the page can be edited and saved. */
  editable: boolean;
}

/** The control's editable columns as data-* attributes, for the editor round-trip. */
function columnData(c: PageControl): string {
  const k = c.columns;
  return `data-id="${c.pnlFldId}" data-num="${c.num}" data-fl="${k.fieldLeft}" data-ft="${k.fieldTop}" data-fr="${k.fieldRight}"` +
    ` data-fb="${k.fieldBottom}" data-ell="${k.editLblLeft}" data-elt="${k.editLblTop}" data-elr="${k.editLblRight}"` +
    ` data-elb="${k.editLblBottom}" data-fst="${k.fieldSizeType}" data-lt="${k.lblType}" data-lx="${esc(k.lblText)}"` +
    ` data-fu="${k.fieldUse}" data-si="${k.secureInvisible}"`;
}

function controlsHtml(controls: readonly PageControl[], editable: boolean): string {
  return controls.map((c) => {
    const parts: string[] = [];
    if (c.label) parts.push(`<div class="lbl" id="l${c.pnlFldId}">${esc(c.label.text)}</div>`);
    const inner = c.shape === 'checkbox' ? '<span class="box"></span>'
      : c.shape === 'radio' ? '<span class="dot"></span>'
      : c.shape === 'dropdown' ? '<span class="caret">▾</span>'
      : c.shape === 'button' ? esc(c.label?.text || c.typeName) : '';
    const use = [c.displayOnly ? 'Display Only' : '', c.invisible ? 'Invisible' : ''].filter(Boolean).join(', ');
    const title = `${c.num}. ${c.typeName}${c.recordField ? ` — ${c.recordField}` : ''}${use ? ` (${use})` : ''}`;
    const cls = `ctl s-${c.shape}${c.displayOnly ? ' u-display-only' : ''}${c.invisible ? ' u-invisible' : ''}`;
    parts.push(
      `<div class="${cls}" id="c${c.pnlFldId}" tabindex="0" title="${esc(title)}"` +
      ` data-type="${esc(c.typeName)}" data-target="${esc(c.target)}" data-name="${esc(c.pageFieldName)}" data-level="${c.level}" ${columnData(c)}>` +
      `${inner}${editable ? '<span class="rsz" aria-hidden="true"></span>' : ''}</div>`);
    return parts.join('');
  }).join('\n');
}

function geometryCss(controls: readonly PageControl[]): string {
  const rules: string[] = [];
  for (const c of controls) {
    rules.push(`#c${c.pnlFldId}{left:${px(c.rect.left)};top:${px(c.rect.top)};width:${px(c.rect.width)};height:${px(c.rect.height)};` +
      `z-index:${c.shape === 'container' ? 1 : 2}}`);
    if (c.label) {
      rules.push(`#l${c.pnlFldId}{left:${px(c.label.rect.left)};top:${px(c.label.rect.top)};` +
        `${c.label.rect.width ? `max-width:${px(c.label.rect.width)};` : ''}}`);
    }
  }
  return rules.join('\n');
}

export function renderPageHtml(layout: PageLayout, orderText: string, nonce: string, options: PageHtmlOptions = { editable: false }): string {
  const editable = options.editable;
  const subtitle = [layout.pageType, `${layout.controls.length} controls`, `${layout.width}×${layout.height}`,
    `v${layout.version}`, editable ? 'editable' : 'read-only', layout.description].filter(Boolean).join(' · ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>${esc(layout.name)}</title>
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  header { padding: 0.5rem 1rem 0; display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; }
  h1 { font-size: 1.1em; margin: 0; }
  .sub { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin: 0.1rem 0 0.4rem; }
  .toolbar { margin-left: auto; display: flex; gap: 0.5rem; align-items: center; }
  button.action { font: inherit; padding: 0.25rem 0.8rem; border: 1px solid var(--vscode-button-border, transparent);
    background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-radius: 3px; cursor: pointer; }
  button.action:disabled { opacity: 0.5; cursor: default; }
  .status { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .status.err { color: var(--vscode-errorForeground); }
  .tabs { display: flex; gap: 2px; padding: 0 1rem; border-bottom: 1px solid var(--vscode-panel-border, #8884); }
  .tab { background: transparent; color: var(--vscode-foreground); border: none; border-bottom: 2px solid transparent; padding: 0.35rem 0.9rem; opacity: 0.75; cursor: pointer; font: inherit; }
  .tab.selected { opacity: 1; border-bottom-color: var(--vscode-panelTitle-activeBorder, var(--vscode-focusBorder)); }
  .tab:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
  .panel { display: none; } .panel.selected { display: block; }
  .layout-wrap { display: flex; height: calc(100vh - 86px); }
  .canvas-scroll { flex: 1; overflow: auto; padding: 16px; }
  .canvas { position: relative; background: #fbfbfb; border: 1px solid #b9b9b9; width: ${layout.width}px; height: ${layout.height}px; }
  .ctl { position: absolute; box-sizing: border-box; font-size: 11px; color: #1a1a1a; overflow: hidden; display: flex; align-items: center; padding: 0 2px; }
  .ctl:focus { outline: 2px solid var(--vscode-focusBorder); }
  .lbl { position: absolute; font-size: 11px; color: #1a1a1a; white-space: nowrap; z-index: 2; }
  .s-field, .s-dropdown { background: #fff; border: 1px solid #7a7a7a; }
  .s-dropdown { justify-content: flex-end; } .caret { color: #555; }
  .s-checkbox, .s-radio { border: none; background: transparent; }
  .s-checkbox .box { width: 12px; height: 12px; border: 1px solid #555; background: #fff; display: inline-block; }
  .s-radio .dot { width: 12px; height: 12px; border: 1px solid #555; border-radius: 50%; background: #fff; display: inline-block; }
  .s-button { background: #e6e6e6; border: 1px solid #707070; border-radius: 2px; justify-content: center; font-size: 10px; color: #222; }
  .s-container { background: rgba(120,140,200,0.05); border: 1px solid #9aa7c8; }
  .s-label { border: 1px dashed transparent; } .s-image { background: #eef; border: 1px dashed #88a; }
  .s-rule { background: #999; } .s-misc { border: 1px dotted #888; background: #f4f4f4; }
  .u-display-only { opacity: 0.55; }
  .u-invisible { background-image: repeating-linear-gradient(45deg, #0000 0 4px, #8883 4px 6px); border-style: dashed; }
  .removed { display: none; }
  .selected-ctl { outline: 2px solid #c02; outline-offset: 0; }
  .editable .ctl { cursor: move; }
  .rsz { position: absolute; right: -3px; bottom: -3px; width: 8px; height: 8px; background: #c02; border: 1px solid #fff; cursor: nwse-resize; display: none; z-index: 3; }
  .selected-ctl .rsz { display: block; }
  .inspector { width: 268px; border-left: 1px solid var(--vscode-panel-border, #8884); padding: 12px; overflow: auto; background: var(--vscode-editorWidget-background, transparent); }
  .inspector h2 { font-size: 0.95em; margin: 0 0 0.5rem; }
  .inspector dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.15rem 0.6rem; margin: 0 0 0.6rem; }
  .inspector dt { color: var(--vscode-descriptionForeground); } .inspector dd { margin: 0; word-break: break-word; }
  .inspector label { display: block; margin: 0.3rem 0 0.1rem; color: var(--vscode-descriptionForeground); }
  .inspector input[type=text], .inspector select { width: 100%; box-sizing: border-box; font: inherit; }
  .inspector .row { display: flex; align-items: center; gap: 0.4rem; margin: 0.3rem 0; }
  .hint { color: var(--vscode-descriptionForeground); }
  pre.order { font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); white-space: pre; padding: 12px 16px; margin: 0; overflow: auto; height: calc(100vh - 86px); font-variant-ligatures: none; }
${geometryCss(layout.controls)}
</style>
</head>
<body class="${editable ? 'editable' : ''}">
  <header>
    <div><h1>${esc(layout.name)}</h1><p class="sub">${esc(subtitle)}</p></div>
    ${editable ? `<div class="toolbar"><span class="status" id="status">No changes</span>
      <button class="action" id="save" disabled>Save</button></div>` : ''}
  </header>
  <div class="tabs" role="tablist">
    <button class="tab selected" id="tab-layout" role="tab" aria-selected="true" aria-controls="panel-layout">Layout</button>
    <button class="tab" id="tab-order" role="tab" aria-selected="false" aria-controls="panel-order">Order</button>
  </div>
  <div class="panel selected" id="panel-layout" role="tabpanel">
    <div class="layout-wrap">
      <div class="canvas-scroll"><div class="canvas" id="canvas">
${controlsHtml(layout.controls, editable)}
      </div></div>
      <aside class="inspector" id="inspector"><h2>Control</h2>
        <p class="hint" id="inspector-body">Select a control${editable ? ' to edit it' : ''}.</p></aside>
    </div>
  </div>
  <div class="panel" id="panel-order" role="tabpanel"><pre class="order">${esc(orderText)}</pre></div>
<script nonce="${nonce}">
  const editable = ${editable} && typeof acquireVsCodeApi === 'function';
  const vscode = editable ? acquireVsCodeApi() : null;
  const tabs = { layout: document.getElementById('tab-layout'), order: document.getElementById('tab-order') };
  const panels = { layout: document.getElementById('panel-layout'), order: document.getElementById('panel-order') };
  function show(w) { for (const k of ['layout','order']) { const on = k===w; tabs[k].classList.toggle('selected',on); tabs[k].setAttribute('aria-selected',String(on)); panels[k].classList.toggle('selected',on); } }
  tabs.layout.onclick = () => show('layout'); tabs.order.onclick = () => show('order');

  const canvas = document.getElementById('canvas');
  const status = document.getElementById('status');
  const saveBtn = document.getElementById('save');
  let dirty = false;
  function markDirty() { if (!editable) return; dirty = true; if (saveBtn) saveBtn.disabled = false; if (status) { status.textContent = 'Unsaved changes'; status.classList.remove('err'); } }
  const n = (el, a) => Number(el.dataset[a]);
  const setN = (el, a, v) => { el.dataset[a] = String(Math.round(v)); };

  let selected = null;
  const body = document.getElementById('inspector-body');
  function textNode(tag, s) { const e = document.createElement(tag); e.textContent = s == null ? '' : String(s); return e; }
  function inspect(el) {
    if (selected) selected.classList.remove('selected-ctl');
    selected = el; el.classList.add('selected-ctl');
    const d = el.dataset;
    const dl = document.createElement('dl');
    const add = (k,v) => { dl.appendChild(textNode('dt',k)); dl.appendChild(textNode('dd',v)); };
    add('Number', d.num); add('Type', d.type); add('Record field / target', d.target || '—'); add('Page field id', d.id);
    body.replaceChildren(dl);
    if (!editable) return;
    const mk = (html) => { const t = document.createElement('template'); t.innerHTML = html; return t.content.firstElementChild; };
    const lx = mk('<div><label>Label text</label><input type="text" id="i-lx"></div>'); lx.querySelector('input').value = d.lx || '';
    const lt = mk('<div><label>Label type</label><select id="i-lt"><option value="0">None</option><option value="1">Text</option><option value="2">RFT Short</option><option value="3">RFT Long</option></select></div>'); lt.querySelector('select').value = d.lt;
    const doRow = mk('<div class="row"><input type="checkbox" id="i-do"><label for="i-do">Display Only</label></div>'); doRow.querySelector('input').checked = (n(el,'fu') & 1) !== 0;
    const invRow = mk('<div class="row"><input type="checkbox" id="i-inv"><label for="i-inv">Invisible</label></div>'); invRow.querySelector('input').checked = (n(el,'fu') & 2) !== 0;
    const delRow = mk('<div class="row"><button class="action" id="i-del">Delete control</button></div>');
    body.append(lx, lt, doRow, invRow, delRow);
    lx.querySelector('input').oninput = (e) => { el.dataset.lx = e.target.value; const l = document.getElementById('l'+d.id); if (l) l.textContent = e.target.value; markDirty(); };
    lt.querySelector('select').onchange = (e) => { el.dataset.lt = e.target.value; markDirty(); };
    const useChange = () => { let u = n(el,'fu') & ~3; if (doRow.querySelector('input').checked) u |= 1; const inv = invRow.querySelector('input').checked; if (inv) u |= 2; setN(el,'fu',u); setN(el,'si', inv ? 1 : 0); el.classList.toggle('u-display-only',(u&1)!==0); el.classList.toggle('u-invisible',(u&2)!==0); markDirty(); };
    doRow.querySelector('input').onchange = useChange; invRow.querySelector('input').onchange = useChange;
    delRow.querySelector('button').onclick = () => { el.classList.add('removed'); el.dataset.removed = '1'; const l = document.getElementById('l'+d.id); if (l) l.classList.add('removed'); markDirty(); body.replaceChildren(textNode('p','Control deleted.')); };
  }
  canvas.addEventListener('click', (e) => { const el = e.target.closest('.ctl'); if (el && e.target.className !== 'rsz') inspect(el); });
  canvas.addEventListener('keydown', (e) => { if ((e.key==='Delete'||e.key==='Backspace') && editable && e.target.classList.contains('ctl')) { e.preventDefault(); e.target.classList.add('removed'); e.target.dataset.removed='1'; const l=document.getElementById('l'+e.target.dataset.id); if(l) l.classList.add('removed'); markDirty(); } });

  if (editable) {
    let drag = null;
    canvas.addEventListener('mousedown', (e) => {
      const el = e.target.closest('.ctl'); if (!el) return;
      inspect(el);
      const resize = e.target.classList.contains('rsz');
      drag = { el, resize, x: e.clientX, y: e.clientY, l: n(el,'fl'), t: n(el,'ft'), w: el.offsetWidth, h: el.offsetHeight };
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y, el = drag.el;
      if (drag.resize) {
        const w = Math.max(6, drag.w + dx), h = Math.max(6, drag.h + dy);
        el.style.width = w + 'px'; el.style.height = h + 'px';
        setN(el,'fr', n(el,'fl') + w); setN(el,'fb', n(el,'ft') + h); el.dataset.fst = '2';
      } else {
        const l = drag.l + dx, t = drag.t + dy;
        el.style.left = l + 'px'; el.style.top = t + 'px';
        setN(el,'fl', l); setN(el,'ft', t);
        // App Designer moves the label box with the field (docs/PAGE_SAVE.md 03-move).
        setN(el,'ell', n(el,'ell')+dx); setN(el,'elr', n(el,'elr')+dx); setN(el,'elt', n(el,'elt')+dy); setN(el,'elb', n(el,'elb')+dy);
        const lbl = document.getElementById('l'+el.dataset.id);
        if (lbl) { lbl.style.left = (parseFloat(lbl.style.left||getComputedStyle(lbl).left) + dx) + 'px'; lbl.style.top = (parseFloat(lbl.style.top||getComputedStyle(lbl).top) + dy) + 'px'; }
        drag.x = e.clientX; drag.y = e.clientY; drag.l = l; drag.t = t;
      }
    });
    window.addEventListener('mouseup', () => { if (drag) { markDirty(); drag = null; } });

    saveBtn.addEventListener('click', () => {
      const controls = [...canvas.querySelectorAll('.ctl')].filter((el) => !el.dataset.removed).map((el) => ({
        pnlFldId: n(el,'id'), fieldLeft: n(el,'fl'), fieldTop: n(el,'ft'), fieldRight: n(el,'fr'), fieldBottom: n(el,'fb'),
        editLblLeft: n(el,'ell'), editLblTop: n(el,'elt'), editLblRight: n(el,'elr'), editLblBottom: n(el,'elb'),
        fieldSizeType: n(el,'fst'), lblType: n(el,'lt'), lblText: el.dataset.lx || '', fieldUse: n(el,'fu'), secureInvisible: n(el,'si')
      }));
      saveBtn.disabled = true; status.textContent = 'Saving…'; status.classList.remove('err');
      vscode.postMessage({ type: 'save', controls });
    });
    window.addEventListener('message', (ev) => {
      const m = ev.data;
      if (m.type === 'saved') { dirty = false; saveBtn.disabled = true; status.textContent = 'Saved (v' + m.version + ')'; status.classList.remove('err'); }
      else if (m.type === 'error') { saveBtn.disabled = false; status.textContent = m.message; status.classList.add('err'); }
    });
  }
</script>
</body>
</html>`;
}
