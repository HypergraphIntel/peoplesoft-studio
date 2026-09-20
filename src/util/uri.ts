import * as vscode from 'vscode';
import { DefinitionKey, displayName, fileExtension, keyFromString } from '../model/definitions.js';

/**
 * Definitions are surfaced as psft:// URIs so every VS Code feature that works
 * on documents — editors, diff, search, source control decorations — works on
 * them without special-casing.
 *
 *   psft://<connectionId>/<type>:<key parts>/<display name><ext>
 *
 * The trailing segment exists purely so the editor tab and language detection
 * show something meaningful; the authoritative identity is the segment before it.
 */
export const SCHEME = 'psft';

export function toUri(connectionId: string, key: DefinitionKey): vscode.Uri {
  const keyPart = encodeURIComponent(`${key.type}:${key.parts.join('.')}`);
  const label = `${displayName(key)}${fileExtension(key.type)}`;
  return vscode.Uri.parse(
    `${SCHEME}://${encodeURIComponent(connectionId)}/${keyPart}/${encodeURIComponent(label)}`);
}

export interface ParsedUri {
  connectionId: string;
  key: DefinitionKey;
}

export function parseUri(uri: vscode.Uri): ParsedUri {
  if (uri.scheme !== SCHEME) {
    throw new Error(`Not a ${SCHEME} URI: ${uri.toString()}`);
  }
  const connectionId = decodeURIComponent(uri.authority);
  const segments = uri.path.split('/').filter((s) => s.length > 0);
  if (segments.length < 1) {
    throw new Error(`Malformed ${SCHEME} URI, no definition key: ${uri.toString()}`);
  }
  return { connectionId, key: keyFromString(decodeURIComponent(segments[0])) };
}
