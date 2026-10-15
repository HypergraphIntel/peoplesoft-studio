import type { DefinitionKey } from './model/definitions.js';
import { searchText, type TextSearchHit, type TextSearchOptions } from './model/textSearch.js';
import type { DefinitionProvider } from './providers/provider.js';

export interface ProjectTextSearchResult {
  hits: Array<TextSearchHit & { key: DefinitionKey }>;
  scanned: number;
  skipped: number;
  cancelled: boolean;
}

export async function searchProjectText(
  provider: Pick<DefinitionProvider, 'listProjectItems' | 'canReadAsText' | 'readText'>,
  project: string, needle: string, options: TextSearchOptions = {},
  token = { isCancellationRequested: false },
  report: (done: number, total: number) => void = () => {}
): Promise<ProjectTextSearchResult> {
  const result: ProjectTextSearchResult = { hits: [], scanned: 0, skipped: 0, cancelled: false };
  if (token.isCancellationRequested) return { ...result, cancelled: true };
  const items = (await provider.listProjectItems(project)).filter((item) => provider.canReadAsText(item.key.type));
  for (const item of items) {
    if (token.isCancellationRequested) break;
    report(result.scanned + result.skipped, items.length);
    try {
      const text = await provider.readText(item.key);
      result.scanned++;
      for (const hit of searchText(text, needle, options)) result.hits.push({ key: item.key, ...hit });
    } catch {
      result.skipped++;
    }
  }
  result.cancelled = token.isCancellationRequested;
  report(result.scanned + result.skipped, items.length);
  return result;
}
