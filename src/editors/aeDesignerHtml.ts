import { ACTION_LABELS, ACTION_ORDER, LABELS } from '../model/appEngine.js';
import { escapeHtml as esc } from './propertiesHtml.js';

/*
 * The App Engine Designer's page: a shell the client script
 * (media/aeDesigner.js) fills from the document the panel posts
 * (aeDesignerPanel.ts). The labels and code lists App Designer uses are
 * handed to the script here, from model/appEngine.ts, so there is one copy.
 */

export interface AeDesignerPage {
  nonce: string;
  cspSource: string;
  script: string;
  style: string;
  title: string;
}

export function renderAeDesignerHtml(page: AeDesignerPage): string {
  const config = {
    actionOrder: ACTION_ORDER,
    actionLabels: ACTION_LABELS,
    labels: LABELS,
    platforms: [[' ', 'default'], ['1', 'DB2'], ['7', 'Microsoft'], ['2', 'Oracle']],
    legacyPlatforms: [['3', 'Informix'], ['4', 'DB2/UNIX'], ['5', 'AllBase'], ['6', 'Sybase']],
    programTypes: [['0', 'Standard'], ['1', 'Upgrade Only'], ['2', 'Import Only'], ['3', 'Daemon Only'], ['4', 'Transform Only']]
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${page.cspSource}; script-src 'nonce-${page.nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${esc(page.style)}">
<title>${esc(page.title)}</title>
</head>
<body>
<div id="app" tabindex="-1">
  <div id="toolbar"></div>
  <div id="main">
    <div id="left">
      <div id="tabs"></div>
      <div id="view" tabindex="0"></div>
    </div>
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
