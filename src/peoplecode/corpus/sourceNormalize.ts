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

        /*
        * PSPCMPROG does not retain display whitespace immediately before
        * or after an opening parenthesis.
        *
        *   SetReEdit (True)
        *   SetReEdit( True)
        *   SetReEdit(True)
        *
        * therefore normalize identically.
        */
        if (
          (
            line[whitespaceEnd] === '(' &&
            /[A-Za-z0-9_]/.test(result[result.length - 1] ?? '')
          ) ||
          result.endsWith('(')
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
        /^(Record|Field|Scroll|Component|Page|PanelGroup|Panel)\b/i.exec(
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

  for (let lineIndex = 0; lineIndex < compactLines.length; lineIndex++) {
    const line = compactLines[lineIndex];

    let inString = false;
    let inComment = false;
    let commentStart = -1;
    let commentEnd = -1;

    for (let i = 0; i < line.length - 1; i++) {
      if (inComment) {
        if (line[i] === '*' && line[i + 1] === '/') {
          inComment = false;
          commentEnd = i + 2;
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
        inComment = true;
        i++;
      }
    }

    /*
     * Existing calibrated trailing-comment shape:
     *
     *   statement; [block comment]
     *
     * canonicalizes to two lines:
     *
     *   statement;
     *   [block comment]
     */
    if (commentStart >= 0) {
      const beforeComment = line
        .slice(0, commentStart)
        .replace(/[ \t]+$/g, '');

      const comment =
        commentEnd >= 0
          ? line.slice(commentStart, commentEnd)
          : line.slice(commentStart);

      const afterComment =
        commentEnd >= 0
          ? line.slice(commentEnd).trim()
          : '';

      if (beforeComment.endsWith(';')) {
        canonicalLines.push(beforeComment);
        canonicalLines.push(comment);

        if (afterComment.length !== 0) {
          canonicalLines.push(afterComment);
        }

        continue;
      }

      /*
       * A 0x4E comment can occur before the statement terminator:
       *
       *   statement [block comment];
       *
       * Canonicalize it to the same logical representation as the
       * decoder-rendered form.
       */
      if (
        beforeComment.length !== 0 &&
        commentEnd >= 0 &&
        afterComment === ';'
      ) {
        canonicalLines.push(`${beforeComment};`);
        canonicalLines.push(comment);
        continue;
      }
    }

    /*
     * decodeProgram() may render that same 0x4E construct as:
     *
     *   statement
     *   [block comment]
     *   ;
     *
     * Require exactly a standalone block-comment line followed by a
     * standalone semicolon so unrelated comments are not moved.
     */
    if (
      lineIndex + 2 < compactLines.length &&
      !line.trim().endsWith(';')
    ) {
      const commentLine = compactLines[lineIndex + 1].trim();
      const semicolonLine = compactLines[lineIndex + 2].trim();

      if (
        /^\/\*[\s\S]*\*\/$/.test(commentLine) &&
        semicolonLine === ';'
      ) {
        canonicalLines.push(`${line};`);
        canonicalLines.push(commentLine);
        lineIndex += 2;
        continue;
      }
    }

    canonicalLines.push(line);
  }

  const joinedStructuralSemicolons: string[] = [];
  for (const line of canonicalLines) {
    if (
      line.trim() === ';' &&
      /\bThen$/i.test(joinedStructuralSemicolons.at(-1) ?? '')
    ) {
      joinedStructuralSemicolons[joinedStructuralSemicolons.length - 1] += ';';
      continue;
    }
    joinedStructuralSemicolons.push(line);
  }

  return joinedStructuralSemicolons
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
