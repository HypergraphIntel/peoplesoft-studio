import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { typeLabel } from '../model/definitions.js';
import {
  DISCOVERY_LABELS, FRAMEWORKS, frameworksFor, PLAN_STAGES, POLICY_LABELS, singular, type CustomizationContext, type CustomizationPolicy
} from '../model/customizationStrategy.js';
import { escapeHtml as esc } from './propertiesHtml.js';

/*
 * The Customization Plan editor (CUSTOMIZATION_STRATEGY_PANEL.md section 4):
 * a tab per definition with the five stages -- Requirement, Discover,
 * Strategy, Validate, Approval -- the strategy comparison and the
 * delivered-object approval dialog. A PREVIEW: the stages can be walked and a
 * requirement typed, but nothing is discovered, validated, approved or
 * written; every capability shows as unknown and every action is disabled.
 */

export class CustomizationPlanPanel {
  static readonly viewType = 'psft.customizationPlan';
  private static readonly open = new Map<string, vscode.WebviewPanel>();

  static show(extensionUri: vscode.Uri, ctx: CustomizationContext | undefined, policy: CustomizationPolicy): void {
    const id = ctx ? `${ctx.connection ?? ''}\u0000${ctx.type}\u0000${ctx.name}` : '';
    const existing = CustomizationPlanPanel.open.get(id);
    if (existing) { existing.reveal(); return; }
    const panel = vscode.window.createWebviewPanel(CustomizationPlanPanel.viewType, `Customization Plan${ctx ? `: ${ctx.name}` : ''}`,
      vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')] });
    CustomizationPlanPanel.open.set(id, panel);
    panel.onDidDispose(() => CustomizationPlanPanel.open.delete(id));
    panel.webview.onDidReceiveMessage((m: { type: string }) => {
      if (m.type === 'openSettings') void vscode.commands.executeCommand('psft.customization.openSettings');
    });
    const media = (f: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', f)).toString();
    panel.webview.html = renderPlanHtml({ nonce: randomBytes(16).toString('base64'), cspSource: panel.webview.cspSource,
      script: media('customizationPlan.js'), style: media('customizationPlan.css') }, ctx, policy);
  }
}

export function renderPlanHtml(page: { nonce: string; cspSource: string; script: string; style: string }, ctx: CustomizationContext | undefined, policy: CustomizationPolicy): string {
  const config = {
    target: ctx ? { name: ctx.name, kind: singular(typeLabel(ctx.type)), connection: ctx.connection ?? '' } : null,
    policy: { strategy: POLICY_LABELS[policy.defaultStrategy], delivered: POLICY_LABELS[policy.deliveredObjectPolicy], prefix: policy.organizationPrefix },
    stages: PLAN_STAGES,
    frameworks: (ctx ? frameworksFor(ctx.type) : []).map((f) => ({ ...FRAMEWORKS[f], state: DISCOVERY_LABELS.UNKNOWN }))
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${page.cspSource}; script-src 'nonce-${page.nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${esc(page.style)}">
<title>Customization Plan</title>
</head>
<body>
<div id="app"></div>
<script nonce="${page.nonce}" id="config" type="application/json">${JSON.stringify(config).replace(/</g, '\\u003c')}</script>
<script nonce="${page.nonce}" src="${esc(page.script)}"></script>
</body>
</html>`;
}
