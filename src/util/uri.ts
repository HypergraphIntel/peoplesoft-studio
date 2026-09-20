import * as vscode from 'vscode';
import { DefinitionKey, displayName, fileExtension, keyFromString } from '../model/definitions.js';
import { connectionHandle } from './handle.js';

/**
 * Definitions are surfaced as psft:// URIs so every VS Code feature that works
 * on documents — editors, diff, search, dirty tracking — works on them without
 * special-casing.
 *
 *   psft://<connection handle>/<type>:<key parts>/<display name><ext>
 *
 * ## Why the authority is a hash
 *
 * The obvious encoding puts the connection id — an Oracle name, or a project
 * file's path — straight into the authority. That breaks, because a URI has to
 * survive `toString()` and `parse()` intact: VS Code serializes resources that
 * way across the extension host boundary and compares documents by their string
 * form.
 *
 * Two things happen to an authority on that round-trip. It is lowercased, since
 * RFC 3986 defines the authority as case-insensitive, which destroys the casing
 * of a file path. And its slashes are not re-encoded, so a path in the
 * authority spills into the path component and the URI reparses as something
 * else entirely.
 *
 * So the authority carries a hash of the connection id instead: lowercase hex,
 * no slashes, no colons, stable across sessions. The id itself is resolved back
 * through {@link Workspace}.
 */
export const SCHEME = 'psft';

export { connectionHandle } from './handle.js';

export function toUri(connectionId: string, key: DefinitionKey): vscode.Uri {
  const keyPart = encodeURIComponent(`${key.type}:${key.parts.join('.')}`);
  const label = `${displayName(key)}${fileExtension(key.type)}`;
  return vscode.Uri.parse(
    `${SCHEME}://${connectionHandle(connectionId)}/${keyPart}/${encodeURIComponent(label)}`);
}

export interface ParsedUri {
  /** Hash of the connection id; resolve it through the workspace. */
  handle: string;
  key: DefinitionKey;
}

export function parseUri(uri: vscode.Uri): ParsedUri {
  if (uri.scheme !== SCHEME) {
    throw new Error(`Not a ${SCHEME} URI: ${uri.toString()}`);
  }
  const segments = uri.path.split('/').filter((s) => s.length > 0);
  if (segments.length < 1) {
    throw new Error(`Malformed ${SCHEME} URI, no definition key: ${uri.toString()}`);
  }
  return {
    handle: uri.authority.toLowerCase(),
    key: keyFromString(decodeURIComponent(segments[0]))
  };
}
