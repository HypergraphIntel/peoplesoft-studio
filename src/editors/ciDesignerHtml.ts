import { CI_CONFLICT, CI_KEY_SCROLL, CI_METHODS, CI_UPLOAD } from '../model/ciDocument.js';
import { escapeHtml as esc } from './propertiesHtml.js';

/*
 * The CI Designer's page: a shell the client script (media/ciDesigner.js)
 * fills from the document and buffer the panel posts (ciDesignerPanel.ts).
 * App Designer's code lists come from model/ciDocument.ts.
 */

export interface CiDesignerPage {
  nonce: string;
  cspSource: string;
  script: string;
  styles: string[];
  title: string;
}

export function renderCiDesignerHtml(page: CiDesignerPage): string {
  const config = { methods: CI_METHODS, conflict: CI_CONFLICT, upload: CI_UPLOAD, keyScroll: CI_KEY_SCROLL };
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${page.cspSource}; script-src 'nonce-${page.nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${page.styles.map((s) => `<link rel="stylesheet" href="${esc(s)}">`).join('\n')}
<title>${esc(page.title)}</title>
</head>
<body>
<div id="app" tabindex="-1">
  <div id="toolbar"></div>
  <div id="main">
    <div id="buffer" class="pane" tabindex="0"></div>
    <div id="splitter1" class="vsplit"></div>
    <div id="ci" class="pane" tabindex="0"></div>
    <div id="splitter" class="vsplit"></div>
    <div id="props"></div>
  </div>
  <div id="output"></div>
  <div id="menu" hidden></div>
</div>
<script nonce="${page.nonce}" id="config" type="application/json">${JSON.stringify(config).replace(/</g, '\\u003c')}</script>
<script nonce="${page.nonce}" src="${esc(page.script)}"></script>
</body>
</html>`;
}
