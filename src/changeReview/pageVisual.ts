import { buildPageLayout, type PageLayout } from '../model/pageLayout.js';
import { pageDrawing, PAGE_CONTROL_CSS } from '../editors/pageHtml.js';
import { escapeHtml as esc } from '../editors/propertiesHtml.js';
import { nativePageSnapshot, nativePageDiff, type NativePageSnapshot, type PageRow } from '../providers/pageSnapshot.js';
import type { Difference, Json } from './model.js';

/** Project retained native rows through the same layout model as the Page designer. */
export function snapshotPageLayout(value: unknown): PageLayout {
    const s = nativePageSnapshot(value), heads = s.tables.PSPNLDEFN;
    if (heads.length !== 1 || typeof heads[0].PNLNAME !== 'string') throw new Error('Page preview needs one named definition.');
    const name = heads[0].PNLNAME.trim();
    for (const rows of Object.values(s.tables)) {
        if (rows.some(r => typeof r.PNLNAME !== 'string' || r.PNLNAME.trim() !== name)) throw new Error('Page preview contains another Page.');
    }
    const keyed = (rows: PageRow[]) => {
        const ids = rows.map(r => r.PNLFLDID);
        if (ids.some(id => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length)
            throw new Error('Page preview has ambiguous control identities.');
        return new Map(rows.map(r => [r.PNLFLDID, r]));
    };
    keyed(s.tables.PSPNLFIELD);
    const ext = keyed(s.tables.PSPNLFIELDEXT), html = keyed(s.tables.PSPNLHTMLAREA), rich = keyed(s.tables.PSPTPNLRTEDITOR);
    const fields = s.tables.PSPNLFIELD.map(f => ({ ...f,
        ...Object.fromEntries(Object.entries(ext.get(f.PNLFLDID) ?? {}).map(([k, v]) => ['EXT_' + k, v])),
        EXT_HTMLAREA: html.get(f.PNLFLDID)?.HTMLAREA ?? null,
        ...Object.fromEntries(Object.entries({ PNLFLDID: 'PNLFLDID', PTRTECFGSETTINGSID: 'CFG', PTRTEIMGLOCURLID: 'IMG', PTRTEPLUGIN: 'PLUGIN', PTRTETEMPLATE: 'TEMPLATE', PTRTESTYLE: 'STYLE' })
            .map(([k, alias]) => ['RTE_' + alias, rich.get(f.PNLFLDID)?.[k] ?? null]))
    }));
    const layout = buildPageLayout(name, { page: heads[0], fields, components: [] });
    if (layout.controls.length > 2000 || [layout.width, layout.height, ...layout.controls.flatMap(c => [c.rect.left, c.rect.top, c.rect.width, c.rect.height])]
        .some(n => !Number.isFinite(n) || Math.abs(n) > 100000)) throw new Error('Page exceeds visual preview bounds; inspect the native diff.');
    return layout;
}

export interface PageControlChange { id: number; label: string; changes: string[]; differences: Difference[] }
export function pageControlChanges(before: NativePageSnapshot, after: NativePageSnapshot): PageControlChange[] {
    const a = snapshotPageLayout(before), b = snapshotPageLayout(after);
    if (a.name !== b.name) throw new Error('Cannot visually compare different Pages.');
    const diffs = nativePageDiff.compare(before as unknown as Json, after as unknown as Json);
    const result: PageControlChange[] = [];
    for (const id of new Set([...a.controls, ...b.controls].map(c => c.pnlFldId))) {
        const x = a.controls.find(c => c.pnlFldId === id), y = b.controls.find(c => c.pnlFldId === id);
        const differences = diffs.filter(d => new RegExp('^\\$\\.tables\\.(PSPNLFIELD|PSPNLFIELDEXT|PSPNLHTMLAREA|PSPTPNLRTEDITOR)\\[' + id + '\\](?:\\.|$)').test(d.path));
        if (!differences.length) continue;
        const changes: string[] = [];
        if (!x || !y) changes.push(x ? 'Removed' : 'Added');
        else {
            if (x.columns.fieldLeft !== y.columns.fieldLeft || x.columns.fieldTop !== y.columns.fieldTop) changes.push('Moved');
            if (x.rect.width !== y.rect.width || x.rect.height !== y.rect.height || x.columns.fieldSizeType !== y.columns.fieldSizeType) changes.push('Resized');
            if (differences.some(d => /\.(LBLTEXT|LBLTYPE|EDITLBLLEFT|EDITLBLTOP|EDITLBLRIGHT|EDITLBLBOTTOM)$/.test(d.path))) changes.push('Label');
            if (x.invisible !== y.invisible) changes.push(y.invisible ? 'Hidden' : 'Shown');
            if (x.displayOnly !== y.displayOnly) changes.push(y.displayOnly ? 'Display only' : 'Editable');
            if (!changes.length) changes.push('Native properties');
        }
        result.push({ id, label: (y ?? x)!.columns.lblText || (y ?? x)!.typeName, changes, differences });
    }
    return result;
}

export const PAGE_REVIEW_CSS = `${PAGE_CONTROL_CSS}
.page-review{margin:18px 0;border:1px solid var(--vscode-panel-border);padding:12px;min-width:0}
.page-review .page-panes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.page-review .page-scroll{overflow:auto;max-height:560px;border:1px solid var(--vscode-panel-border);padding:12px}
.page-review .page-canvas{position:relative;background:#fbfbfb;border:1px solid #b9b9b9;transform-origin:top left}
.page-review .changed{outline:2px solid #b66a00;outline-offset:2px}
.page-review .page-canvas .review-selected{outline:3px solid #c02!important;outline-offset:3px}
.page-review .control-changes{width:100%;border-collapse:collapse;margin-top:12px}
.page-review th,.page-review td{text-align:left;vertical-align:top;border-bottom:1px solid var(--vscode-panel-border);padding:6px}
.page-review summary{cursor:pointer}.page-review .page-notice{color:var(--vscode-descriptionForeground)}
@media(max-width:900px){.page-review .page-panes{grid-template-columns:1fr}}
`;

/** No active HTML, data URLs, editor actions or native writes are emitted. */
export function renderPageComparison(beforeValue: unknown, afterValue: unknown, prefix = 'proposal-', title = 'Page layout comparison', afterKnown = true): string {
    if (!/^[a-z][a-z0-9-]*-$/.test(prefix)) throw new Error('Invalid Page comparison prefix.');
    if (!afterKnown) return '<p>Page after-state is unknown; visual comparison is unavailable.</p>';
    try {
        const before = nativePageSnapshot(beforeValue), after = nativePageSnapshot(afterValue), a = snapshotPageLayout(before), b = snapshotPageLayout(after);
        const changes = pageControlChanges(before, after), changed = new Set(changes.map(c => c.id));
        const pane = (layout: PageLayout, side: string, label: string) => {
            const drawing = pageDrawing(layout, prefix + side + '-');
            const highlights = [...changed].map(id => '#' + prefix + side + '-c' + id + ',#' + prefix + side + '-l' + id + '{outline:2px solid #b66a00;outline-offset:2px}').join('');
            return `<div><h4>${esc(label)}</h4><p>${esc(layout.description)} · ${layout.controls.length} controls · ${layout.width} × ${layout.height}</p><div class="page-scroll"><div class="page-canvas" style="width:${layout.width}px;height:${layout.height}px">${drawing.html}</div></div><style>${drawing.css}${highlights}</style></div>`;
        };
        const rows = changes.map(c => `<tr><td><button type="button" data-page-control="${c.id}" data-page-scope="${prefix}">Control ${c.id}</button> ${esc(c.label)}</td><td>${esc(c.changes.join(', '))}</td><td><details><summary>${c.differences.length} native differences</summary><pre>${esc(JSON.stringify(c.differences, null, 2))}</pre></details></td></tr>`).join('');
        return `<section class="page-review" data-page-preview="${prefix}"><h3>${esc(title)}</h3><p class="page-notice">Stored layout preview using the Page designer's geometry. Auto-sized controls use the designer's stand-in sizes; subpages, Fluid layout, styles and runtime behavior are not expanded. Hidden controls stay visible with hatching. Amber outlines mark changed control IDs; the full native diff below also includes changes outside this drawing.</p>
          <label>Preview scale <select data-page-zoom><option value="fit">Fit both panes</option><option value="1">100%</option><option value="0.75">75%</option><option value="0.5">50%</option></select></label>
          <div class="page-panes">${pane(a, 'before', 'Before')}${pane(b, 'after', 'After')}</div>
          ${changes.length ? `<table class="control-changes"><thead><tr><th>Persisted control</th><th>Changes</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table>` : '<p>No control changes. Review Page properties and the native diff below.</p>'}</section>`;
    } catch (error) { return `<p class="notice">Visual Page comparison unavailable: ${esc(error instanceof Error ? error.message : String(error))}</p>`; }
}

export const PAGE_REVIEW_SCRIPT = `document.querySelectorAll('[data-page-control]').forEach(b=>b.addEventListener('click',()=>{const section=b.closest('.page-review');section.querySelectorAll('.review-selected').forEach(e=>e.classList.remove('review-selected'));['before','after'].forEach(side=>{const e=document.getElementById(b.dataset.pageScope+side+'-c'+b.dataset.pageControl);if(e){e.classList.add('review-selected');e.scrollIntoView({block:'nearest',inline:'nearest'});}});}));document.querySelectorAll('[data-page-zoom]').forEach(s=>{const scale=()=>{const panes=[...s.closest('.page-review').querySelectorAll('.page-canvas')];const zoom=s.value==='fit'?Math.min(1,...panes.map(e=>(e.parentElement.clientWidth-26)/parseFloat(e.style.width))):Number(s.value);panes.forEach(e=>{e.style.zoom=String(Math.max(0.05,zoom));});};s.addEventListener('change',scale);window.addEventListener('resize',scale);scale();});`;
