import * as vscode from 'vscode';
import type { DefinitionProvider } from './providers/provider.js';
import type { Workspace } from './workspace.js';
import { searchProjectText } from './projectTextSearch.js';
import { showTextSearchResults } from './views/textSearchResults.js';

export async function findInProject(workspace: Workspace, node?: unknown): Promise<void> {
  const n = node as { kind?: string; provider?: DefinitionProvider; project?: { name: string } } | undefined;
  let provider = n?.kind === 'project' ? n.provider : undefined;
  if (!provider) {
    const connected = workspace.activeProviders.filter((p) => p.isConnected);
    if (!connected.length) {
      vscode.window.showInformationMessage('Find in Project needs a connected database or an open project export: connect one first.');
      return;
    }
    provider = connected.length === 1 ? connected[0] : (await vscode.window.showQuickPick(
      connected.map((p) => ({ label: p.displayName, provider: p })), { title: 'Find in Project: connection' }))?.provider;
  }
  if (!provider) return;
  const project = n?.kind === 'project' ? n.project?.name : (await vscode.window.showInputBox({
    title: `Find in Project: ${provider.displayName}`, prompt: 'Project name',
    validateInput: (value) => value.trim() ? undefined : 'Enter a project name.'
  }))?.trim();
  if (!project) return;
  const needle = await vscode.window.showInputBox({ title: `Find in ${project}`, prompt: 'Text to find (literal)',
    validateInput: (value) => value.length ? undefined : 'Enter text to find.' });
  if (!needle) return;
  const options = await vscode.window.showQuickPick([
    { label: 'Match Case', option: 'matchCase' }, { label: 'Whole Word', option: 'wholeWord' }
  ], { title: 'Search options', placeHolder: 'Select options, or accept for case-insensitive substring search', canPickMany: true });
  if (!options) return;
  const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification,
    title: `Finding "${needle}" in ${project}`, cancellable: true },
  (progress, token) => searchProjectText(provider, project, needle, {
    matchCase: options.some((o) => o.option === 'matchCase'), wholeWord: options.some((o) => o.option === 'wholeWord')
  }, token, (done, total) => progress.report({ message: `${done} of ${total} text definitions` })));
  const summary = `${result.hits.length} matches in ${project}; ${result.scanned} definitions read, ${result.skipped} skipped${result.cancelled ? ' (cancelled; partial results)' : ''}`;
  vscode.window.showInformationMessage(summary);
  if (result.hits.length) await showTextSearchResults(provider.id, result.hits, needle, summary);
}
