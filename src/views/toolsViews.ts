import * as vscode from 'vscode';
import { TOOL_TREES, type ToolNode, type ToolViewId } from '../model/toolTrees.js';

/*
 * Configuration Tools and Data Migration Tools: two panes of PeopleSoft's
 * online tools, placeholders for now. Every entry is shown greyed (its label
 * through a file decoration colour, its icon in the disabled colour) and says
 * it is not available yet when chosen. The trees themselves are plain data
 * (model/toolTrees.ts), so filling one in later is a matter of giving an
 * entry a command and dropping `planned`.
 */


/** The command a placeholder entry runs. */
export const PLANNED_TOOL_COMMAND = 'psft.plannedTool';
/** The scheme of the URIs that carry an entry's greyed label colour. */
const SCHEME = 'psft-tool';

interface Node { view: ToolViewId; path: string[]; tool: ToolNode }

export class ToolsView implements vscode.TreeDataProvider<Node> {
  constructor(private readonly view: ToolViewId) {}

  getChildren(node?: Node): Node[] {
    const list = node ? node.tool.children ?? [] : TOOL_TREES[this.view].nodes;
    return list.map((tool) => ({ view: this.view, path: [...(node?.path ?? []), tool.label], tool }));
  }

  getTreeItem(node: Node): vscode.TreeItem {
    const { tool } = node;
    const item = new vscode.TreeItem(tool.label,
      tool.children?.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(tool.icon, tool.planned ? new vscode.ThemeColor('disabledForeground') : undefined);
    if (tool.planned) {
      // The label itself takes the decoration's disabled colour (PlannedToolDecorations).
      item.resourceUri = vscode.Uri.from({ scheme: SCHEME, path: `/${node.view}/${node.path.map(encodeURIComponent).join('/')}` });
      item.tooltip = `${node.path.join(' › ')} — not available yet`;
      item.contextValue = 'plannedTool';
      if (!tool.children?.length) {
        item.description = 'Coming soon';
        item.command = { command: PLANNED_TOOL_COMMAND, title: 'Not available yet', arguments: [node.path.join(' › ')] };
      }
    }
    return item;
  }
}

/** Greys the labels of planned entries: a tree item's resourceUri decoration colours its label. */
class PlannedToolDecorations implements vscode.FileDecorationProvider {
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== SCHEME) return undefined;
    return { color: new vscode.ThemeColor('disabledForeground'), tooltip: 'Not available yet' };
  }
}

/** Registers both panes, their decorations and the placeholder command. */
export function registerToolsViews(context: vscode.ExtensionContext): void {
  for (const id of Object.keys(TOOL_TREES) as ToolViewId[]) {
    const view = vscode.window.createTreeView(id, { treeDataProvider: new ToolsView(id), showCollapseAll: true });
    view.description = 'Coming soon';
    context.subscriptions.push(view);
  }
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(new PlannedToolDecorations()),
    vscode.commands.registerCommand(PLANNED_TOOL_COMMAND, (what?: string) => {
      void vscode.window.showInformationMessage(`${what ?? 'This tool'} is not available yet.`);
    })
  );
}
