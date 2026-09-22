// Conservative source comparison: ignore external whitespace and identifier
// case only. Preserve punctuation, numeric spellings, string contents, comment
// contents and comment kinds. This can undercount semantic equivalence, never
// uses the encoder, and never discards executable tokens.
export function normalizeSource(source) {
  const tokens = [];
  let at = 0;
  source = source.replace(/\r\n?/g, '\n');
  while (at < source.length) {
    if (/\s/.test(source[at])) { at++; continue; }
    let endMarker;
    if (source.startsWith('/*', at)) endMarker = '*/';
    else if (source.startsWith('/+', at)) endMarker = '+/';
    else if (source.startsWith('<*', at)) endMarker = '*>';
    if (endMarker) {
      const end = source.indexOf(endMarker, at + 2);
      if (end < 0) throw new Error('Unterminated source comment');
      tokens.push(['comment', source.slice(at, end + 2)]);
      at = end + 2;
      continue;
    }
    if (source[at] === '"' || source[at] === "'") {
      const quote = source[at++];
      let value = '', closed = false;
      while (at < source.length) {
        const char = source[at++];
        if (char !== quote) value += char;
        else if (source[at] === quote) { value += quote; at++; }
        else { closed = true; break; }
      }
      if (!closed) throw new Error('Unterminated source string');
      tokens.push(['string', value]);
      continue;
    }
    const word = /^[&%]?[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(at));
    if (word) {
      // REM comments run through the semicolon, not just the current line.
      if (word[0].toLowerCase() === 'rem') {
        const end = source.indexOf(';', at + 3);
        if (end < 0) throw new Error('Unterminated REM comment');
        tokens.push(['rem', source.slice(at + 3, end)]);
        at = end + 1;
      } else { tokens.push(['word', word[0].toLowerCase()]); at += word[0].length; }
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(at));
    if (number) { tokens.push(['number', number[0]]); at += number[0].length; continue; }
    const operator = /^(?:<=|>=|<>|!=|\*\*)/.exec(source.slice(at));
    const punctuation = operator?.[0] ?? source[at];
    tokens.push(['punctuation', punctuation]);
    at += punctuation.length;
  }
  return tokens;
}

export function firstDifference(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return i;
  return undefined;
}

export function binaryDifference(original, generated, layoutReader) {
  const offset = firstDifference(original, generated);
  if (offset === undefined) return { equal: true };
  const result = { equal: false, originalLength: original.length, generatedLength: generated.length, firstDifference: offset,
    originalWindow: original.subarray(Math.max(0, offset - 12), offset + 20).toString('hex'),
    generatedWindow: generated.subarray(Math.max(0, offset - 12), offset + 20).toString('hex'), sections: [], sectionDifferences: {}, classification: 'unclassified' };
  try {
    const a = layoutReader(original), b = layoutReader(generated);
    if (!original.subarray(0, 37).equals(generated.subarray(0, 37))) result.sections.push('header');
    for (const section of ['statements', 'names', 'records', 'slots']) {
      const av = original.subarray(a[section].offset, a[section].offset + a[section].byteLength);
      const bv = generated.subarray(b[section].offset, b[section].offset + b[section].byteLength);
      if (!av.equals(bv)) {
        result.sections.push(section);
        const local = firstDifference(av, bv);
        result.sectionDifferences[section] = { offset: local, originalOffset: a[section].offset + local, generatedOffset: b[section].offset + local,
          originalByte: av[local], generatedByte: bv[local],
          originalWindow: av.subarray(Math.max(0, local - 8), local + 16).toString('hex'),
          generatedWindow: bv.subarray(Math.max(0, local - 8), local + 16).toString('hex') };
      }
    }
    result.classification = result.sections.includes('statements') ? 'statement/body'
      : result.sections.some(s => ['names', 'records', 'slots'].includes(s)) ? 'metadata-only'
      : 'header-only';
  } catch (error) { result.layoutError = error.message; }
  return result;
}

export const keyColumns = [1, 2, 3, 4, 5, 6, 7].flatMap(i => [`OBJECTID${i}`, `OBJECTVALUE${i}`]);
export const nameColumns = ['NAMENUM', 'RECNAME', 'REFNAME', 'PACKAGEROOT', 'QUALIFYPATH', 'APPCLASSMETHOD'];

// Only represent fields established in the existing reference model. No
// owner row is copied from the capture, and no missing dependency is inferred.
// PACKAGE SQL-column serialization is not yet calibrated, so it is explicitly
// unrepresentable instead of comparing only a convenient subset of columns.
export function projectNameRows(references, key) {
  const rows = [];
  for (const ref of references) {
    const row = { ...key, NAMENUM: ref.sequence, RECNAME: ' ', REFNAME: ' ', PACKAGEROOT: ' ', QUALIFYPATH: ' ', APPCLASSMETHOD: ' ' };
    if (['owner', 'record-field'].includes(ref.kind)) {
      row.RECNAME = ref.recordName ?? ' ';
      row.REFNAME = ref.fieldName ?? ' ';
    } else if (ref.kind === 'record' || ref.kind === 'scroll') {
      row.RECNAME = ref.kind.toUpperCase(); row.REFNAME = ref.recordName;
    } else if (ref.kind === 'field') {
      row.RECNAME = 'FIELD'; row.REFNAME = ref.fieldName;
    } else return { status: 'unrepresentable', reason: `raw PSPCMNAME serialization for ${ref.kind} is not calibrated`, references };
    if (ref.index !== ref.sequence - 1) return { status: 'unrepresentable', reason: 'invalid reference sequence/index', references };
    rows.push(row);
  }
  return { status: 'represented', rows };
}

export function compareNameRows(original, projected) {
  if (projected.status !== 'represented') return projected;
  const columns = [...keyColumns, ...nameColumns];
  if (original.length !== projected.rows.length) return { status: 'mismatch', originalRows: original.length, generatedRows: projected.rows.length };
  for (let i = 0; i < original.length; i++) {
    for (const column of columns) if (original[i][column] !== projected.rows[i][column]) {
      return { status: 'mismatch', row: i, column, original: original[i][column], generated: projected.rows[i][column] };
    }
    const extra = Object.keys(original[i]).filter(c => !columns.includes(c));
    if (extra.length) return { status: 'unrepresentable', reason: 'unmodeled PSPCMNAME columns', columns: extra };
  }
  return { status: 'exact' };
}
