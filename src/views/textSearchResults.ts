import * as vscode from 'vscode';
import { displayName, typeLabel, type DefinitionKey } from '../model/definitions.js';
import type { TextSearchHit } from '../model/textSearch.js';
import { toUri } from '../util/uri.js';

export async function showTextSearchResults(connectionId: string, hits: Array<TextSearchHit & { key: DefinitionKey }>,
  needle: string, title: string): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    hits.map((h) => ({ label: `${displayName(h.key)}:${h.line + 1}`, description: typeLabel(h.key.type), detail: h.context, hit: h })),
    { title, matchOnDescription: true, matchOnDetail: true });
  if (!picked) return;
  const doc = await vscode.workspace.openTextDocument(toUri(connectionId, picked.hit.key));
  const at = new vscode.Position(picked.hit.line, picked.hit.column);
  await vscode.window.showTextDocument(doc, { selection: new vscode.Range(at, at.translate(0, needle.length)) });
}
