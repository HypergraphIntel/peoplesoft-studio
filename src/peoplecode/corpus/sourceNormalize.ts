export function normalizePeopleCodeSource(source: string): string {
  const normalizedNewlines = source
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const lines = normalizedNewlines.split('\n');

  let inBlockComment = false;

  const normalizedLines = lines.map(line => {
    let result = '';
    let i = 0;
    let inString = false;

    /*
     * Leading indentation is formatting, not recoverable from PSPCMPROG.
     * Preserve it inside an already-open block comment because comment
     * text itself is encoded verbatim.
     */
    if (!inBlockComment) {
      while (
        i < line.length &&
        (line[i] === ' ' || line[i] === '\t')
      ) {
        i++;
      }
    }

    while (i < line.length) {
      if (inBlockComment) {
        const end = line.indexOf('*/', i);

        if (end < 0) {
          result += line.slice(i);
          i = line.length;
          break;
        }

        result += line.slice(i, end + 2);
        i = end + 2;
        inBlockComment = false;
        continue;
      }

      if (inString) {
        result += line[i];

        if (line[i] === '"') {
          /*
           * PeopleCode escapes a quote in a string by doubling it.
           */
          if (line[i + 1] === '"') {
            result += line[i + 1];
            i += 2;
            continue;
          }

          inString = false;
        }

        i++;
        continue;
      }

      if (
        line[i] === '/' &&
        line[i + 1] === '*'
      ) {
        inBlockComment = true;
        result += '/*';
        i += 2;
        continue;
      }

      if (line[i] === '"') {
        inString = true;
        result += line[i];
        i++;
        continue;
      }

      /*
       * PSPCMPROG does not retain display whitespace between a callable or
       * indexable identifier and its opening parenthesis. App Designer may
       * save either `Name(...)` or `Name (...)`, while decoding necessarily
       * renders the compact form. Normalize only this token boundary and
       * leave whitespace inside strings and comments untouched.
       */
      if (line[i] === ' ' || line[i] === '\t') {
        let whitespaceEnd = i;
        while (
          whitespaceEnd < line.length &&
          (line[whitespaceEnd] === ' ' || line[whitespaceEnd] === '\t')
        ) {
          whitespaceEnd++;
        }

        if (
          line[whitespaceEnd] === '(' &&
          /[A-Za-z0-9_]/.test(result[result.length - 1] ?? '')
        ) {
          i = whitespaceEnd;
          continue;
        }
      }

      /*
       * The decoder canonicalizes these PeopleCode reference namespaces
       * differently from the original source. Their spelling is
       * case-insensitive, so normalize only these tokens while outside
       * comments and string literals.
       */
      const namespaceMatch =
        /^(Record|Field|Scroll|Component|Page)\b/i.exec(
          line.slice(i)
        );

      if (namespaceMatch) {
        result += namespaceMatch[1].toLowerCase();
        i += namespaceMatch[0].length;
        continue;
      }

      result += line[i];
      i++;
    }

    return result.replace(/[ \t]+$/g, '');
  });

  /*
   * Empty lines introduced only by source formatting do not carry
   * executable semantics. 0x4F preservation is validated independently
   * by byte-exact source encoding and round-trip encoding.
   */
  const compactLines = normalizedLines
    .filter(line => line.trim().length !== 0);

  /*
   * PSPCMPROG does not always preserve whether a 0x4E block comment was
   * displayed on the same physical source line as the preceding semicolon
   * or on the following line. Canonicalize both shapes to:
   *
   *   statement;
   *   /* comment *\/
   *
   * Do this only when the comment begins immediately after a completed
   * statement. Comments in expressions, declarations, or other positions
   * remain untouched.
   */
  const canonicalLines: string[] = [];

  for (const line of compactLines) {
    let inString = false;
    let inComment = false;
    let commentStart = -1;

    for (let i = 0; i < line.length - 1; i++) {
      if (inComment) {
        if (line[i] === '*' && line[i + 1] === '/') {
          inComment = false;
          i++;
        }
        continue;
      }

      if (inString) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            i++;
            continue;
          }

          inString = false;
        }
        continue;
      }

      if (line[i] === '"') {
        inString = true;
        continue;
      }

      if (line[i] === '/' && line[i + 1] === '*') {
        commentStart = i;
        break;
      }
    }

    if (commentStart >= 0) {
      const beforeComment = line
        .slice(0, commentStart)
        .replace(/[ \t]+$/g, '');

      const comment = line.slice(commentStart);

      if (beforeComment.endsWith(';')) {
        canonicalLines.push(beforeComment);
        canonicalLines.push(comment);
        continue;
      }
    }

    canonicalLines.push(line);
  }

  return canonicalLines
    .join('\n')
    .trim();
}

export function sourcesMatch(
  expected: string,
  actual: string
): boolean {
  return (
    normalizePeopleCodeSource(expected) ===
    normalizePeopleCodeSource(actual)
  );
}
