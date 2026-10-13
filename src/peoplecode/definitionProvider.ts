import * as vscode from 'vscode';
import { parseUri, toUri } from '../util/uri.js';
import type { Workspace } from '../workspace.js';
import { matchStoredKey, resolveReference } from './definition.js';

/*
 * The VS Code side of Go to Definition: find the reference under the cursor
 * (resolveReference), confirm it exists in the editor's connection, and point
 * at the stored definition. Only psft:// PeopleCode documents are handled, and
 * only while their connection is connected -- the target has to be read to be
 * opened.
 */
export function registerPeopleCodeDefinition(context: vscode.ExtensionContext, workspace: Workspace): void {
  const provider: vscode.DefinitionProvider = {
    async provideDefinition(document, position) {
      if (document.uri.scheme !== 'psft') return undefined;
      let handle: string;
      try { handle = parseUri(document.uri).handle; } catch { return undefined; }
      const prov = workspace.getProviderByHandle(handle);
      if (!prov) return undefined;

      const ref = resolveReference(document.lineAt(position.line).text, position.character);
      if (!ref) return undefined;

      let summaries;
      try { summaries = await prov.search({ type: ref.type, namePattern: ref.parts[0], limit: 500 }); }
      catch { return undefined; }
      const key = matchStoredKey(ref, summaries.map((s) => s.key));
      if (!key) return undefined;
      return new vscode.Location(toUri(prov.id, key), new vscode.Position(0, 0));
    }
  };
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider({ language: 'psft-peoplecode' }, provider));
}
