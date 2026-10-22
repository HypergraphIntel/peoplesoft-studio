import { promises as fs } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

/** Retry only Windows sharing/scan conflicts while publishing the same already
 * flushed local file. Never delete the destination or rerun a native writer.
 */
export async function replaceFile(temporary: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await fs.rename(temporary, destination); return; }
    catch (error) {
      if (process.platform !== 'win32' || attempt >= 12 ||
          !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await delay(Math.min(20 * (attempt + 1), 200));
    }
  }
}
