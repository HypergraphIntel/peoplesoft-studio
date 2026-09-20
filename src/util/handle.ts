import { createHash } from 'node:crypto';

/**
 * A stable, URI-safe handle for a connection id.
 *
 * This lives apart from uri.ts, which imports the `vscode` module and so cannot
 * be loaded outside the extension host. Keeping the hash here lets the URI
 * encoding be tested directly.
 *
 * Lowercase hex, because a URI authority is case-insensitive and VS Code
 * lowercases it on serialization. Truncated to 16 characters: long enough that
 * a collision between the handful of connections one person configures is not a
 * practical concern, short enough to keep URIs readable.
 */
export function connectionHandle(connectionId: string): string {
  return createHash('sha256').update(connectionId, 'utf8').digest('hex').slice(0, 16);
}
