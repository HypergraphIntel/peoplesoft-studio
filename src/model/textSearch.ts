export interface TextSearchOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
}

export interface TextSearchHit {
  /** Zero-based UTF-16 positions, as VS Code uses. */
  line: number;
  column: number;
  context: string;
}

/** Literal, line-by-line search; whole words use letters, numbers and underscores. */
export function searchText(text: string, needle: string, options: TextSearchOptions = {}): TextSearchHit[] {
  if (!needle || /[\r\n]/.test(needle)) return [];
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escaped, options.matchCase ? 'gu' : 'giu');
  const word = /[\p{L}\p{N}_]/u;
  const hits: TextSearchHit[] = [];
  text.split(/\r\n|\r|\n/).forEach((lineText, line) => {
    for (const match of lineText.matchAll(pattern)) {
      const column = match.index!;
      if (options.wholeWord) {
        const last = lineText.charCodeAt(column - 1);
        const before = lineText.slice(column - (last >= 0xDC00 && last <= 0xDFFF ? 2 : 1), column);
        const after = lineText.codePointAt(column + match[0].length);
        if (word.test(before) || (after !== undefined && word.test(String.fromCodePoint(after)))) continue;
      }
      hits.push({ line, column, context: lineText.trim().slice(0, 200) });
    }
  });
  return hits;
}
