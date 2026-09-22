import * as vscode from 'vscode';

/**
 * Outline / breadcrumbs for PeopleCode.
 * Regex-based: good enough for Function / method / class / property headers.
 * Not a full parser — nested structure is approximate.
 */

interface Match {
  name: string;
  kind: vscode.SymbolKind;
  line: number;
  startChar: number;
  endChar: number;
  /** Lines that increase nest depth after this header (class/interface/function/method). */
  opensContainer: boolean;
}

const PATTERNS: { re: RegExp; kind: vscode.SymbolKind; opensContainer: boolean; nameGroup: number }[] = [
  // class Foo / class Foo extends Bar / class Foo implements I
  { re: /^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\b/i, kind: vscode.SymbolKind.Class, opensContainer: true, nameGroup: 1 },
  { re: /^\s*interface\s+([A-Za-z_][A-Za-z0-9_]*)\b/i, kind: vscode.SymbolKind.Interface, opensContainer: true, nameGroup: 1 },
  // method Foo( / method Foo Returns / method Foo &x As string
  { re: /^\s*method\s+([A-Za-z_][A-Za-z0-9_]*)\b/i, kind: vscode.SymbolKind.Method, opensContainer: true, nameGroup: 1 },
  // Function Foo(
  { re: /^\s*Function\s+([A-Za-z_][A-Za-z0-9_]*)\b/i, kind: vscode.SymbolKind.Function, opensContainer: true, nameGroup: 1 },
  // property string Name get set;  /  property number Count get;
  {
    re: /^\s*property\s+(?:private\s+|protected\s+)?(?:readonly\s+)?(?:[A-Za-z_][A-Za-z0-9_:]*\s+)+([A-Za-z_][A-Za-z0-9_]*)\b/i,
    kind: vscode.SymbolKind.Property,
    opensContainer: false,
    nameGroup: 1,
  },
  // instance / private instance declarations often act as fields
  {
    re: /^\s*(?:private\s+|protected\s+)?instance\s+(?:[A-Za-z_][A-Za-z0-9_:]*\s+)+&?([A-Za-z_][A-Za-z0-9_]*)\b/i,
    kind: vscode.SymbolKind.Field,
    opensContainer: false,
    nameGroup: 1,
  },
];

function collectMatches(document: vscode.TextDocument): Match[] {
  const matches: Match[] = [];
  const lineCount = document.lineCount;

  for (let line = 0; line < lineCount; line++) {
    const text = document.lineAt(line).text;
    for (const p of PATTERNS) {
      const m = p.re.exec(text);
      if (!m) continue;
      const name = m[p.nameGroup];
      if (!name) continue;
      const startChar = m.index + m[0].indexOf(name);
      matches.push({
        name,
        kind: p.kind,
        line,
        startChar,
        endChar: startChar + name.length,
        opensContainer: p.opensContainer,
      });
      break; // one symbol per line
    }
  }
  return matches;
}

/**
 * Build a tree: class/interface contain methods/properties/fields;
 * function/method are leaves unless we later want locals (we don't).
 */
function buildSymbols(document: vscode.TextDocument, matches: Match[]): vscode.DocumentSymbol[] {
  const lineCount = document.lineCount;
  const root: vscode.DocumentSymbol[] = [];
  /** Stack of open containers: { symbol, startLine } */
  const stack: { symbol: vscode.DocumentSymbol; startLine: number }[] = [];

  const endLineFor = (startLine: number, kind: vscode.SymbolKind): number => {
    // Scan forward for matching end-* or next sibling container at same level
    const lookingFor =
      kind === vscode.SymbolKind.Class ? /^end-class\b/i :
      kind === vscode.SymbolKind.Interface ? /^end-interface\b/i :
      kind === vscode.SymbolKind.Method ? /^end-method\b/i :
      kind === vscode.SymbolKind.Function ? /^End-Function\b/i :
      null;

    for (let i = startLine + 1; i < lineCount; i++) {
      const t = document.lineAt(i).text;
      if (lookingFor && lookingFor.test(t.trim())) return i;
      // Function/method without body still ends at next Function/method/class at column 0-ish
    }
    return lineCount - 1;
  };

  for (let idx = 0; idx < matches.length; idx++) {
    const m = matches[idx];
    const nameRange = new vscode.Range(m.line, m.startChar, m.line, m.endChar);

    let endLine = m.line;
    if (m.opensContainer) {
      endLine = endLineFor(m.line, m.kind);
    }

    // Range covers full body for containers; name range is the identifier
    const fullRange = new vscode.Range(m.line, 0, endLine, document.lineAt(endLine).text.length);
    const symbol = new vscode.DocumentSymbol(
      m.name,
      symbolDetail(m.kind),
      m.kind,
      fullRange,
      nameRange
    );

    // Pop containers that ended before this line
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const topEnd = top.symbol.range.end.line;
      if (m.line <= topEnd && m.line > top.startLine) {
        // still inside top — but if top is function/method and we see another method, close top
        if (
          (top.symbol.kind === vscode.SymbolKind.Method || top.symbol.kind === vscode.SymbolKind.Function) &&
          (m.kind === vscode.SymbolKind.Method || m.kind === vscode.SymbolKind.Function ||
           m.kind === vscode.SymbolKind.Class || m.kind === vscode.SymbolKind.Interface)
        ) {
          stack.pop();
          continue;
        }
        break;
      }
      if (m.line > topEnd) {
        stack.pop();
        continue;
      }
      break;
    }

    if (stack.length === 0) {
      root.push(symbol);
    } else {
      stack[stack.length - 1].symbol.children.push(symbol);
    }

    if (m.opensContainer) {
      stack.push({ symbol, startLine: m.line });
    }
  }

  return root;
}

function symbolDetail(kind: vscode.SymbolKind): string {
  switch (kind) {
    case vscode.SymbolKind.Class: return 'class';
    case vscode.SymbolKind.Interface: return 'interface';
    case vscode.SymbolKind.Method: return 'method';
    case vscode.SymbolKind.Function: return 'function';
    case vscode.SymbolKind.Property: return 'property';
    case vscode.SymbolKind.Field: return 'instance';
    default: return '';
  }
}

export function registerPeopleCodeSymbols(context: vscode.ExtensionContext): void {
  const provider: vscode.DocumentSymbolProvider = {
    provideDocumentSymbols(document) {
      const matches = collectMatches(document);
      if (matches.length === 0) return [];
      return buildSymbols(document, matches);
    },
  };

  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      { language: 'psft-peoplecode' },
      provider
    )
  );
}