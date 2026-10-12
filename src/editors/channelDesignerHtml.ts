import { CHANNEL_NAME_MAX, DESCR_MAX, FIELD_NAME_MAX } from '../model/channelDocument.js';
import { escapeHtml as esc } from './propertiesHtml.js';

/*
 * The Message Channel window's page: a shell the client script
 * (media/channelDesigner.js) fills from the document the panel posts
 * (channelDesignerPanel.ts).
 */

export interface ChannelDesignerPage {
  nonce: string;
  cspSource: string;
  script: string;
  styles: string[];
  title: string;
}

export function renderChannelDesignerHtml(page: ChannelDesignerPage): string {
  const config = { max: { name: CHANNEL_NAME_MAX, descr: DESCR_MAX, field: FIELD_NAME_MAX } };
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
    <div id="left"><div id="view" tabindex="0"></div></div>
    <div id="splitter"></div>
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
