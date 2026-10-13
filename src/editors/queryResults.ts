/*
 * Run SQL's results (psft.sql.run): the rows as a table, in a page that runs
 * nothing (no scripts, nothing fetched). Values as the database returned
 * them: dates as ISO text, binary as its size, NULL shown as such, long text
 * cut at 500 characters.
 */

export interface QueryResultsView {
  connection: string;
  sql: string;
  rows: ReadonlyArray<Record<string, unknown>>;
  truncated: boolean;
  maxRows: number;
  ms: number;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function cellText(v: unknown): { text: string; kind: 'null' | 'binary' | 'value' } {
  if (v === null || v === undefined) return { text: 'NULL', kind: 'null' };
  if (Buffer.isBuffer(v)) return { text: `(${v.length} bytes)`, kind: 'binary' };
  if (v instanceof Date) return { text: Number.isNaN(v.getTime()) ? String(v) : v.toISOString().replace('T', ' ').replace(/\.000Z$|Z$/, ''), kind: 'value' };
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return { text: s.length > 500 ? `${s.slice(0, 500)}…` : s, kind: 'value' };
}

export function renderQueryResults(v: QueryResultsView): string {
  const columns = v.rows.length ? Object.keys(v.rows[0]) : [];
  const head = columns.map((c) => `<th>${esc(c)}</th>`).join('');
  const body = v.rows.map((r) => `<tr>${columns.map((c) => {
    const cell = cellText(r[c]);
    return `<td${cell.kind === 'value' ? '' : ` class="${cell.kind}"`}>${esc(cell.text)}</td>`;
  }).join('')}</tr>`).join('');
  const count = v.rows.length === 0 ? 'No rows'
    : `${v.rows.length} row${v.rows.length === 1 ? '' : 's'}${v.truncated ? ` (the first ${v.maxRows}; there are more)` : ''}`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 8px 12px; }
  .meta { color: var(--vscode-descriptionForeground); margin-bottom: 6px; }
  pre { white-space: pre-wrap; background: var(--vscode-textCodeBlock-background); padding: 6px 8px; margin: 0 0 10px; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid var(--vscode-panel-border); padding: 2px 6px; text-align: left; vertical-align: top; white-space: pre; }
  th { position: sticky; top: 0; background: var(--vscode-editor-background); }
  td.null, td.binary { color: var(--vscode-descriptionForeground); font-style: italic; }
</style></head><body>
<div class="meta">${esc(v.connection)} · ${esc(count)} · ${v.ms} ms · read only, rolled back</div>
<pre>${esc(v.sql)}</pre>
${columns.length ? `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` : ''}
</body></html>`;
}
