import { promises as fs } from 'node:fs';

/** Flush a renamed directory entry where the operating system supports it.
 * Windows rejects directory fsync (EPERM); writers still flush the complete
 * file before closing and atomically renaming it on every platform. Errors
 * from file flushes or supported directory flushes must propagate.
 */
export async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); }
  finally { await handle.close(); }
}
