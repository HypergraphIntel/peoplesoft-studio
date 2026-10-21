/** Read the complete Oracle locator, avoiding inline CLOB conversion that can
 * split supplementary Unicode at a prefetch boundary. Other adapters already
 * return strings. Release the locator on successful and failed reads. */
export async function readTextLob(value: unknown): Promise<unknown> {
  if (!value || typeof value !== 'object' || !('getData' in value) || typeof value.getData !== 'function'
    || !('close' in value) || typeof value.close !== 'function') return value;
  try { return await value.getData(); }
  finally { await value.close(); }
}
