import { disabledCommentEnd } from './applicationClassProgram.js';

/*
 * Cycle 115: PeopleCode conditional compilation.
 *
 *   #If #ToolsRel >= "8.55" #Then
 *      ...
 *   #Else
 *      ...
 *   #End-If;
 *
 * PeopleTools evaluates the condition at compile time against its own
 * Tools release and compiles only the taken branch -- but the directives
 * stay in PSPCMPROG as length-prefixed text records (the decoder's 0x75 ..
 * 0x78):
 *
 *   0x75  the `#If` text up to `#Then`, trailing whitespace trimmed
 *   0x76  `#Then` -- alone when the Then branch is compiled (its code
 *         follows as ordinary tokens); when it is not, `#Then` plus the
 *         branch's source text up to the last newline before the next
 *         directive line
 *   0x77  `#Else`, the same way
 *   0x78  `#End-If`
 *
 * LOCAL SNAPSHOT (`cycle115-conditional-compilation-census.ts`): 231
 * blocks in 139 definitions; the condition text matches in 231, the
 * dead-branch text in 117 of 117; exactly one branch of every `#Else`
 * block is compiled. The dead text is never tokenized: 19510's dead branch
 * is an incomplete `If ... Then` header whose body follows `#End-If`.
 *
 * The preprocessor works lexically on the source, before any parsing:
 * every directive region -- `#If ... #Then` plus a dead Then branch,
 * `#Else` plus a dead Else branch, `#End-If` -- together with a `;`
 * written right after its keyword (`#End-If;`, `#Then;`: stored `78 15`,
 * a terminator of the directive, not an empty statement) and the rest of
 * its line, is masked in place as spaces: source offsets are preserved,
 * dead code is invisible to the parser, and a directive line is not a
 * line of the program's layout. LOCAL SNAPSHOT: after `#End-If` the stored
 * 0x4F count equals the source's blank lines with the directive line
 * removed; a declaration section still open before a directive closes at
 * the next real item, after the directive's records (18230 `Local ...;
 * #If ... #Then <blank> /* ... *\/` stores `15 75 76 2D 4F 24`; 18323
 * `#End-If; <2 blank> X` stores `78 15 2D 4F 4F`). The encoder writes a
 * region's records when its whitespace skipping reaches the region.
 *
 * Grammar (exactly what the corpus holds; anything else is unsupported):
 * `#If`, `#Else`, `#End-If` start a line (after whitespace) in code
 * context -- not inside strings, block comments, `<* *>` disabled code,
 * `/+ +/` signature comments or REM statements; `#Then` ends the `#If`
 * line's condition; no nesting. The condition is `#ToolsRel <op>
 * "<version>"` terms (`>=`, `<=`, `>`, `<`, `=`, `<>`; `#ToolsRel` in any
 * case) joined by `&&` (binding tighter) and `||`.
 */

export interface ConditionalCompilationOptions {
  /** The PeopleTools release the program is compiled under, e.g. "8.61". */
  readonly toolsRelease: string;
}

export interface ConditionalDirectiveRegion {
  /** Absolute offset of the masked region in the program source. */
  readonly start: number;
  /** Exclusive end offset. */
  readonly end: number;
  /** The directive records the region compiles to. */
  readonly records: Buffer;
}

export interface PreprocessedConditionalSource {
  /** The source with every directive region masked as spaces (same length). */
  readonly source: string;
  /** Directive regions by their start offset. */
  readonly regions: ReadonlyMap<number, ConditionalDirectiveRegion>;
}

export class ConditionalCompilationError extends Error {
  constructor(readonly offset: number, message: string) {
    super(message);
  }
}

/** 0 code, 1 string, 2 block comment, 3 disabled code, 4 REM, 5 signature comment. */
function lexicalContexts(source: string): Uint8Array {
  const n = source.length;
  const ctx = new Uint8Array(n);
  let i = 0;
  let atStatementStart = true;
  while (i < n) {
    const c = source[i];
    if (c === '"') {
      const start = i;
      i++;
      while (i < n) {
        if (source[i] === '"') {
          if (source[i + 1] === '"') { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      ctx.fill(1, start, i);
      atStatementStart = false;
      continue;
    }
    const span = (open: string, close: string, kind: number): boolean => {
      if (!source.startsWith(open, i)) return false;
      // Cycle 157: `<* *>` nests (see `disabledCommentEnd`)
      const e = open === '<*' ? disabledCommentEnd(source, i) - 2 : source.indexOf(close, i + 2);
      const end = e < 0 ? n : e + 2;
      ctx.fill(kind, i, end);
      i = end;
      return true;
    };
    if (span('/*', '*/', 2) || span('<*', '*>', 3) || span('/+', '+/', 5)) continue;
    if (atStatementStart && /^rem\b/i.test(source.slice(i, i + 4)) && (i === 0 || !/[A-Za-z0-9_&%#$]/.test(source[i - 1]))) {
      const e = source.indexOf(';', i);
      const end = e < 0 ? n : e + 1;
      ctx.fill(4, i, end);
      i = end;
      continue;
    }
    if (c === ';') { atStatementStart = true; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    const word = /^[A-Za-z_#][A-Za-z0-9_\-#]*/.exec(source.slice(i, i + 40));
    if (word) {
      atStatementStart = ['then', 'else', 'repeat', 'try', '#then', '#else', '#end-if'].includes(word[0].toLowerCase());
      i += word[0].length;
      continue;
    }
    atStatementStart = false;
    i++;
  }
  return ctx;
}

interface DirectiveToken { kind: 'If' | 'Then' | 'Else' | 'End-If'; at: number }

function directiveTokens(source: string): DirectiveToken[] {
  if (!source.includes('#')) return [];
  const pattern = /#(If|Then|Else|End-If)\b/g;
  const candidates = [...source.matchAll(pattern)];
  if (candidates.length === 0) return [];
  const ctx = lexicalContexts(source);
  return candidates
    .filter(m => ctx[m.index!] === 0)
    .map(m => ({ kind: m[1] as DirectiveToken['kind'], at: m.index! }));
}

/** Whether the source holds a conditional-compilation directive in code context. */
export function hasConditionalDirectives(source: string): boolean {
  return directiveTokens(source).length > 0;
}

function parseVersion(text: string): number[] {
  return text.split('.').map(part => Number(part));
}

/** Numeric dotted comparison at the literal's precision (a missing release component counts 0). */
function compareRelease(release: number[], literal: number[]): number {
  for (let k = 0; k < literal.length; k++) {
    const a = release[k] ?? 0, b = literal[k];
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

/**
 * Evaluates a directive condition (the text after `#If`) against a Tools
 * release. `undefined` for any text outside the supported grammar.
 */
export function evaluateToolsRelCondition(condition: string, toolsRelease: string): boolean | undefined {
  if (!/^\d+(?:\.\d+)*$/.test(toolsRelease)) return undefined;
  const release = parseVersion(toolsRelease);
  const tokens = condition.match(/#\w+|"[^"]*"|>=|<=|<>|&&|\|\||=|<|>|\S+/g) ?? [];
  if (tokens.length === 0) return undefined;
  let result = false;
  let conjunct = true;
  for (let t = 0; t < tokens.length;) {
    const [symbol, op, literal] = tokens.slice(t, t + 3);
    if (!/^#toolsrel$/i.test(symbol ?? '') || !/^"\d+(?:\.\d+)*"$/.test(literal ?? '')) return undefined;
    const c = compareRelease(release, parseVersion(literal.slice(1, -1)));
    const value =
      op === '>=' ? c >= 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 :
      op === '<' ? c < 0 : op === '=' ? c === 0 : op === '<>' ? c !== 0 : undefined;
    if (value === undefined) return undefined;
    conjunct = conjunct && value;
    t += 3;
    if (tokens[t] === '&&') { t++; if (t >= tokens.length) return undefined; continue; }
    result = result || conjunct;
    conjunct = true;
    if (tokens[t] === '||') { t++; if (t >= tokens.length) return undefined; continue; }
    if (t < tokens.length) return undefined;
  }
  return result;
}

function textRecord(opcode: number, text: string): Buffer {
  const payload = Buffer.from(text, 'utf16le');
  if (payload.length > 0xffff) throw new ConditionalCompilationError(0, 'conditional directive text exceeds uint16 byte-length field');
  const header = Buffer.alloc(3);
  header[0] = opcode;
  header.writeUInt16LE(payload.length, 1);
  return Buffer.concat([header, payload]);
}


const lineStartsAt = (source: string, at: number): boolean => {
  let i = at - 1;
  while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) i--;
  return i < 0 || source[i] === '\n' || source[i] === '\r';
};

/**
 * Masks every conditional-compilation directive region of `source` and
 * returns the regions' directive records, or `undefined` when the source
 * has no directive. Throws `ConditionalCompilationError` for a directive
 * outside the supported grammar.
 */
export function preprocessConditionalCompilation(
  source: string,
  options: ConditionalCompilationOptions
): PreprocessedConditionalSource | undefined {
  const tokens = directiveTokens(source);
  if (tokens.length === 0) return undefined;

  const regions = new Map<number, ConditionalDirectiveRegion>();
  const masked = source.split('');
  // A region also takes a `;` right after its keyword (a 0x15 record) and
  // the rest of its line when that is blank, line terminator included.
  const addRegion = (start: number, keywordEnd: number, records: Buffer[]) => {
    let end = keywordEnd;
    if (source[end] === ';') {
      records.push(Buffer.from([0x15]));
      end++;
    }
    const rest = /^[ \t]*(\r?\n|$)/.exec(source.slice(end));
    if (rest) end += rest[0].length;
    regions.set(start, { start, end, records: Buffer.concat(records) });
    for (let k = start; k < end; k++) masked[k] = ' ';
  };
  // the dead text of a branch runs to the last newline before the next directive line
  const deadEnd = (nextDirective: number) => source.lastIndexOf('\n', nextDirective - 1);

  for (let t = 0; t < tokens.length;) {
    const ifToken = tokens[t];
    if (ifToken.kind !== 'If') throw new ConditionalCompilationError(ifToken.at, `#${ifToken.kind} without #If`);
    const thenToken = tokens[t + 1];
    if (thenToken?.kind !== 'Then') throw new ConditionalCompilationError(ifToken.at, '#If without #Then');
    if (!lineStartsAt(source, ifToken.at) || source.slice(ifToken.at, thenToken.at).includes('\n')) {
      throw new ConditionalCompilationError(ifToken.at, '#If must start a line and reach #Then on that line');
    }
    let k = t + 2;
    const elseToken = tokens[k]?.kind === 'Else' ? tokens[k++] : undefined;
    const endToken = tokens[k];
    if (endToken?.kind !== 'End-If') {
      throw new ConditionalCompilationError(ifToken.at, endToken?.kind === 'If' ? 'nested #If is not supported' : '#If without #End-If');
    }
    for (const token of [elseToken, endToken]) {
      if (token !== undefined && !lineStartsAt(source, token.at)) throw new ConditionalCompilationError(token.at, `#${token.kind} must start a line`);
    }

    const conditionText = source.slice(ifToken.at, thenToken.at).replace(/\s+$/, '');
    const taken = evaluateToolsRelCondition(conditionText.slice(3), options.toolsRelease);
    if (taken === undefined) throw new ConditionalCompilationError(ifToken.at, `unsupported conditional-compilation condition: ${conditionText}`);

    const elseOrEnd = elseToken?.at ?? endToken.at;
    const thenRegionEnd = taken ? thenToken.at + '#Then'.length : deadEnd(elseOrEnd);
    if (thenRegionEnd < thenToken.at + '#Then'.length) throw new ConditionalCompilationError(thenToken.at, 'dead #Then branch shares the directive line');
    addRegion(ifToken.at, thenRegionEnd, [
      textRecord(0x75, conditionText),
      textRecord(0x76, source.slice(thenToken.at, thenRegionEnd))
    ]);
    if (elseToken !== undefined) {
      const elseRegionEnd = taken ? deadEnd(endToken.at) : elseToken.at + '#Else'.length;
      if (elseRegionEnd < elseToken.at + '#Else'.length) throw new ConditionalCompilationError(elseToken.at, 'dead #Else branch shares the directive line');
      addRegion(elseToken.at, elseRegionEnd, [textRecord(0x77, source.slice(elseToken.at, elseRegionEnd))]);
    }
    addRegion(endToken.at, endToken.at + '#End-If'.length, [textRecord(0x78, '#End-If')]);
    t = k + 1;
  }
  return { source: masked.join(''), regions };
}
