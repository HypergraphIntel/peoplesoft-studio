import {
  ALPHABETICAL, BAR_LABEL_MAX, BAR_NAME_MAX, COMPONENT_MAX, DESCR_MAX, ITEM_LABEL_MAX, ITEM_NAME_MAX, ITEM_TYPE_LABELS, ITEM_TYPES_BY_MENU,
  MENU_GROUP_MAX, MENU_LABEL_MAX, MENU_TYPE_LABELS, SEARCH_RECORD_MAX, TRANSFER_ACTIONS
} from '../model/menuDocument.js';
import { escapeHtml as esc } from './propertiesHtml.js';

/*
 * The Menu Designer's page: a shell the client script (media/menuDesigner.js)
 * fills from the document the panel posts (menuDesignerPanel.ts). App
 * Designer's labels, code lists and lengths come from model/menuDocument.ts.
 */

export interface MenuDesignerPage {
  nonce: string;
  cspSource: string;
  script: string;
  styles: string[];
  title: string;
}

export function renderMenuDesignerHtml(page: MenuDesignerPage): string {
  const config = {
    itemTypes: ITEM_TYPE_LABELS, typesByMenu: ITEM_TYPES_BY_MENU, menuTypes: MENU_TYPE_LABELS, transferActions: TRANSFER_ACTIONS, alphabetical: ALPHABETICAL,
    max: { barName: BAR_NAME_MAX, itemName: ITEM_NAME_MAX, barLabel: BAR_LABEL_MAX, itemLabel: ITEM_LABEL_MAX, menuLabel: MENU_LABEL_MAX, group: MENU_GROUP_MAX,
      descr: DESCR_MAX, component: COMPONENT_MAX, searchRecord: SEARCH_RECORD_MAX }
  };
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
