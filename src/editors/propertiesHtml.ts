import type { DefinitionProperties, PropertyItem } from '../model/properties.js';

/*
 * The Properties panel's page. Static and script-free: rendered once from
 * DefinitionProperties, every value escaped, styled by theme variables. The
 * Content-Security-Policy allows nothing but this page's own nonce'd style.
 * Free of the `vscode` module so it can be tested directly.
 */

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function item(i: PropertyItem): string {
  const value = i.value === ''
    ? '<span class="blank">(blank)</span>'
    : i.multiline ? `<div class="long">${escapeHtml(i.value)}</div>` : escapeHtml(i.value);
  return `<tr><th scope="row">${escapeHtml(i.label)}</th><td>${value}</td></tr>`;
}

function table(items: PropertyItem[]): string {
  return `<table>${items.map(item).join('')}</table>`;
}

export function renderPropertiesHtml(props: DefinitionProperties, connection: string, nonce: string): string {
  const sections = props.sections
    .filter((s) => s.items.length > 0)
    .map((s) => `<section><h2>${escapeHtml(s.title)}</h2>${table(s.items)}</section>`)
    .join('');
  const stored = props.stored
    .map((s) => `<details><summary>Stored columns: ${escapeHtml(s.table)} (${s.columns.length})</summary>${table(s.columns)}</details>`)
    .join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(props.name)} Properties</title>
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground);
         background: var(--vscode-editor-background); padding: 0 20px 24px; max-width: 900px; }
  header { padding: 16px 0 8px; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 8px; }
  h1 { font-size: 1.4em; font-weight: 600; margin: 0; }
  .sub { color: var(--vscode-descriptionForeground); margin-top: 4px; }
  .note { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  h2 { font-size: 1.05em; font-weight: 600; margin: 20px 0 6px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; vertical-align: top; padding: 4px 8px; border-bottom: 1px solid var(--vscode-editorWidget-border, transparent); }
  th { font-weight: normal; color: var(--vscode-descriptionForeground); width: 32%; }
  td { font-family: var(--vscode-editor-font-family); word-break: break-word; }
  .long { white-space: pre-wrap; font-family: var(--vscode-font-family); }
  .blank { color: var(--vscode-disabledForeground); font-family: var(--vscode-font-family); }
  details { margin-top: 20px; }
  summary { cursor: pointer; font-weight: 600; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(props.name)}</h1>
  <div class="sub">${escapeHtml(props.typeLabel)} · ${escapeHtml(connection)} · read-only</div>
</header>
<p class="note">Codes without a known name are shown as stored.</p>
${sections}
${stored}
</body>
</html>`;
}
