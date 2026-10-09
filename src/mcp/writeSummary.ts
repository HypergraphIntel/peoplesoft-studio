/*
 * What an MCP write shows the user before they approve it (writeTools.ts):
 * where a text changes, and each operation as a line. Kept apart from the
 * tools, which load the MCP SDK and the providers, so it can be unit tested.
 */

/** Where two texts differ, in lines, with a few lines of the new text there. */
export function textChangeSummary(before: string, after: string): string {
  const a = before.replace(/\r\n/g, '\n').split('\n'), b = after.replace(/\r\n/g, '\n').split('\n');
  if (before === '') return `New: ${b.length} lines.`;
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  if (start === a.length && start === b.length) return 'No change to the text.';
  let endA = a.length - 1, endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) { endA--; endB--; }
  if (endB < start) return `${a.length} -> ${b.length} lines; lines ${start + 1}-${endA + 1} removed.`;
  const shown = b.slice(start, Math.min(endB + 1, start + 12)).map((l) => `  ${l.slice(0, 120)}`).join('\n');
  const more = endB + 1 - start > 12 ? `\n  ... ${endB + 1 - start - 12} more changed lines` : '';
  return `${a.length} -> ${b.length} lines; lines ${start + 1}-${endB + 1} now read:\n${shown}${more}`;
}

/** One operation as a line of the approval dialog. */
export const describeOperation = (o: Record<string, unknown>) =>
  `  ${String(o.op)} ${Object.entries(o).filter(([k]) => k !== 'op').map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')}`;
