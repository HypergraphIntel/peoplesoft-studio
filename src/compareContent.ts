import * as vscode from 'vscode';
import { displayName, fileExtension, type DefinitionKey } from './model/definitions.js';

/*
 * The other side of Compare With Environment: a definition's text as read
 * from another connection, served read-only under its own scheme. The text
 * is read once, through a connection that is never made active
 * (Workspace.readFromConnection), so the one-active-connection rule holds;
 * the document is a snapshot, not a live view of that environment.
 */

export const COMPARE_SCHEME = 'psft-compare';

export class CompareContent implements vscode.TextDocumentContentProvider {
  private readonly texts = new Map<string, string>();

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.texts.get(uri.toString()) ?? 'This comparison is no longer available: run Compare With Environment again.';
  }

  /** Keeps a text read from a connection; the URI ends in the definition's file extension, so it opens in the same language. */
  put(connectionName: string, key: DefinitionKey, text: string): vscode.Uri {
    const uri = vscode.Uri.from({
      scheme: COMPARE_SCHEME,
      path: `/${encodeURIComponent(connectionName)}/${encodeURIComponent(displayName(key))}${fileExtension(key.type)}`,
      // A new read is a new document: an earlier comparison's tab keeps its own snapshot.
      query: `read=${Date.now()}`
    });
    this.texts.set(uri.toString(), text);
    return uri;
  }

  /** Forgets a snapshot when its document closes. */
  forget(uri: vscode.Uri): void {
    this.texts.delete(uri.toString());
  }
}
