import * as vscode from 'vscode';
import { parseUri, toUri } from '../util/uri.js';
import type { Workspace } from '../workspace.js';
import { findPeopleCodeReferences } from './findReferences.js';
import { gated } from './languageFeatures.js';

/*
 * Find All References (Shift+F12 / the references peek) for PeopleCode, so the
 * identifier under the cursor can be searched without the command and input
 * box. It is the same engine as the command: on a database, one search of the
 * stored source (PSPCMTXT); on a project export, a bounded scan. The word is
 * matched as a whole token, case-insensitively.
 */
export function registerPeopleCodeReferences(context: vscode.ExtensionContext, workspace: Workspace): void {
  const provider: vscode.ReferenceProvider = {
    async provideReferences(document, position, _context, token) {
      if (document.uri.scheme !== 'psft') return undefined;
      let handle: string;
      try { handle = parseUri(document.uri).handle; } catch { return undefined; }
      const prov = workspace.getProviderByHandle(handle);
      if (!prov) return undefined;

      const range = document.getWordRangeAtPosition(position, /[A-Za-z0-9_&%#$@]+/);
      if (!range) return undefined;
      const needle = document.getText(range);
      if (needle.length < 2) return undefined; // a single character would scan everything for little value

      const r = await findPeopleCodeReferences(prov, needle);
      if (token.isCancellationRequested) return undefined;
      return r.hits.map((h) =>
        new vscode.Location(toUri(prov.id, h.key), new vscode.Range(h.line, h.column, h.line, h.column + needle.length)));
    }
  };
  context.subscriptions.push(
    vscode.languages.registerReferenceProvider({ language: 'psft-peoplecode' }, gated(provider)));
}
