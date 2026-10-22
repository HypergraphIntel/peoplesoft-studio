import * as vscode from 'vscode';
import { parseUri } from '../util/uri.js';
import type { Workspace } from '../workspace.js';
import { formatPeopleCode } from './formatProgram.js';
import { gated } from './languageFeatures.js';

/*
 * Format Document for psft:// PeopleCode: the program laid out as Application
 * Designer shows it (formatProgram.ts), for the connection's PeopleTools
 * release. A program the proof refuses is left as it is, with the reason.
 */
export function registerPeopleCodeFormatting(context: vscode.ExtensionContext, workspace: Workspace): void {
  const provider: vscode.DocumentFormattingEditProvider = {
    async provideDocumentFormattingEdits(document) {
      if (document.uri.scheme !== 'psft') return [];
      let parsed: ReturnType<typeof parseUri>;
      try { parsed = parseUri(document.uri); } catch { return []; }
      const prov = workspace.getProviderByHandle(parsed.handle);
      const release = (prov?.isConnected ? (await Promise.resolve(prov.readEnvironment?.()).catch(() => undefined))?.toolsRelease : undefined) ?? '8.62';
      const text = document.getText();
      const result = formatPeopleCode(text, parsed.key, release);
      if ('refused' in result) {
        void vscode.window.showWarningMessage(`Format Document left the PeopleCode as it is: ${result.refused}`);
        return [];
      }
      if (result.text === text) return [];
      return [vscode.TextEdit.replace(new vscode.Range(document.positionAt(0), document.positionAt(text.length)), result.text)];
    }
  };
  context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider({ language: 'psft-peoplecode' }, gated(provider)));
}
