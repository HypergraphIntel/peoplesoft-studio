import path from 'node:path';
import { readZip } from './zip.js';

/*
 * Text from a build request's attachments, so an agent can read a functional
 * spec or a mapping spreadsheet through the MCP: plain text files as they
 * are, Word documents, Excel workbooks and PowerPoint decks from their XML
 * parts. Anything else (PDFs, images, legacy .doc/.xls) keeps only its
 * original file, which the agent reads with its own tools.
 */

export type ExtractionMethod = 'text' | 'docx' | 'xlsx' | 'pptx';

export type Extraction =
  | { method: ExtractionMethod; text: string }
  | { method: 'none'; reason: string };

const TEXT_EXTENSIONS = new Set([
  '.txt', '.text', '.md', '.markdown', '.csv', '.tsv', '.psv', '.dat', '.json', '.xml', '.xsd', '.wsdl', '.wadl', '.yaml', '.yml',
  '.sql', '.dms', '.html', '.htm', '.log', '.ini', '.properties', '.cfg', '.conf', '.pc', '.peoplecode', '.eml', '.rtf', '.js', '.ts', '.py', '.sh'
]);

/** The most rows of one worksheet rendered as text; a sample of a large data sheet is enough to design from. */
const MAX_SHEET_ROWS = 2000;

export function extractText(fileName: string, content: Buffer): Extraction {
  const ext = path.extname(fileName).toLowerCase();
  try {
    if (ext === '.docx' || ext === '.docm') return { method: 'docx', text: docxText(content) };
    if (ext === '.xlsx' || ext === '.xlsm') return { method: 'xlsx', text: xlsxText(content) };
    if (ext === '.pptx') return { method: 'pptx', text: pptxText(content) };
  } catch (error) {
    return { method: 'none', reason: `Could not read the ${ext} file: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (TEXT_EXTENSIONS.has(ext) || (!ext && looksLikeText(content))) {
    const text = decodeText(content);
    return text === undefined ? { method: 'none', reason: 'The file is binary.' } : { method: 'text', text };
  }
  return { method: 'none', reason: `No text extraction for ${ext || 'this file type'}; read the original file.` };
}

function looksLikeText(content: Buffer): boolean {
  return decodeText(content.subarray(0, 8192)) !== undefined;
}

function decodeText(content: Buffer): string | undefined {
  if (content[0] === 0xff && content[1] === 0xfe) return content.subarray(2).toString('utf16le');
  if (content[0] === 0xfe && content[1] === 0xff) return Buffer.from(content.subarray(2)).swap16().toString('utf16le');
  if (content.includes(0)) return undefined;
  const text = content.toString('utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
    e[0] !== '#' ? ENTITIES[e] : String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
}

/** XML as a stream of tags and text, without a parser: Office parts are flat and well formed. */
function* tokens(xml: string): Generator<{ tag: string; close: boolean; empty: boolean; attrs: string } | { text: string }> {
  const re = /<(\/?)([\w:.-]+)([^>]*?)(\/?)>|<[?!][^>]*>|([^<]+)/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[5] !== undefined) yield { text: m[5] };
    else if (m[2]) yield { tag: m[2], close: m[1] === '/', empty: m[4] === '/', attrs: m[3] };
  }
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? decodeXml(m[1]) : undefined;
}

function part(zip: Map<string, () => Buffer>, name: string): string | undefined {
  return zip.get(name)?.().toString('utf8');
}

/** A Word document's body: paragraphs as lines, table rows as cells joined by " | ". */
export function docxText(content: Buffer): string {
  const zip = readZip(content);
  const xml = part(zip, 'word/document.xml');
  if (xml === undefined) throw new Error('No word/document.xml.');
  let out = '', inText = false, cellDepth = 0;
  for (const t of tokens(xml)) {
    if ('text' in t) { if (inText) out += decodeXml(t.text); continue; }
    switch (t.tag) {
      case 'w:t': inText = !t.close && !t.empty; break;
      case 'w:tab': if (!t.close) out += '\t'; break;
      case 'w:br': case 'w:cr': if (!t.close) out += cellDepth ? ' ' : '\n'; break;
      case 'w:tc': if (t.close) { out = out.replace(/ +$/, '') + ' | '; cellDepth--; } else if (!t.empty) cellDepth++; break;
      case 'w:tr': if (t.close) out = out.replace(/ \| $/, '') + '\n'; break;
      case 'w:p': if (t.close) out += cellDepth ? ' ' : '\n'; break;
    }
  }
  return tidy(out);
}

/** An Excel workbook: each sheet under a heading, rows as tab-separated cells in their columns. */
export function xlsxText(content: Buffer): string {
  const zip = readZip(content);
  const shared: string[] = [];
  const sst = part(zip, 'xl/sharedStrings.xml');
  if (sst) {
    let current: string | undefined, inText = false;
    for (const t of tokens(sst)) {
      if ('text' in t) { if (inText && current !== undefined) current += decodeXml(t.text); continue; }
      if (t.tag === 'si') { if (t.close) { shared.push(current ?? ''); current = undefined; } else if (t.empty) shared.push(''); else current = ''; }
      else if (t.tag === 't') inText = !t.close && !t.empty;
      else if (t.tag === 'rPh') inText = false; // phonetic runs are not cell text
    }
  }
  const rels = new Map<string, string>();
  for (const t of tokens(part(zip, 'xl/_rels/workbook.xml.rels') ?? '')) {
    if ('tag' in t && t.tag === 'Relationship') {
      const id = attr(t.attrs, 'Id'), target = attr(t.attrs, 'Target');
      if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    }
  }
  const sheets: Array<{ name: string; file: string }> = [];
  for (const t of tokens(part(zip, 'xl/workbook.xml') ?? '')) {
    if ('tag' in t && t.tag === 'sheet') {
      const file = rels.get(attr(t.attrs, 'r:id') ?? '');
      if (file) sheets.push({ name: attr(t.attrs, 'name') ?? file, file });
    }
  }
  const out: string[] = [];
  for (const sheet of sheets) {
    const xml = part(zip, sheet.file);
    if (xml === undefined) continue;
    out.push(`## Sheet: ${sheet.name}`);
    let row: string[] = [], rows = 0, col = 0, type = '', value = '', capture = false, truncated = false;
    for (const t of tokens(xml)) {
      if ('text' in t) { if (capture) value += decodeXml(t.text); continue; }
      if (t.tag === 'row') {
        if (!t.close) row = [];
        if (t.close || t.empty) {
          if (rows >= MAX_SHEET_ROWS) { truncated = true; continue; }
          if (row.some((c) => c !== '')) { out.push(row.join('\t').replace(/\t+$/, '')); rows++; }
        }
      } else if (t.tag === 'c') {
        if (!t.close) { col = columnIndex(attr(t.attrs, 'r')) ?? row.length; type = attr(t.attrs, 't') ?? ''; value = ''; }
        if (t.close || t.empty) {
          const text = type === 's' ? shared[Number(value)] ?? '' : type === 'b' ? (value === '1' ? 'TRUE' : 'FALSE') : value;
          while (row.length < col) row.push('');
          row[col] = text.replace(/[\t\r\n]+/g, ' ');
        }
      } else if (t.tag === 'v' || t.tag === 't') capture = !t.close && !t.empty;
    }
    if (truncated) out.push(`… (only the first ${MAX_SHEET_ROWS} non-empty rows are shown; read the original file for the rest)`);
    out.push('');
  }
  return tidy(out.join('\n'));
}

function columnIndex(ref: string | undefined): number | undefined {
  const letters = /^([A-Z]+)\d+$/.exec(ref ?? '')?.[1];
  if (!letters) return undefined;
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

/** A PowerPoint deck: each slide's text runs, one paragraph per line. */
export function pptxText(content: Buffer): string {
  const zip = readZip(content);
  const slides = [...zip.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  const out: string[] = [];
  slides.forEach((name, i) => {
    let text = '', inText = false;
    for (const t of tokens(part(zip, name) ?? '')) {
      if ('text' in t) { if (inText) text += decodeXml(t.text); continue; }
      if (t.tag === 'a:t') inText = !t.close && !t.empty;
      else if (t.tag === 'a:p' && t.close) text += '\n';
      else if (t.tag === 'a:br') text += '\n';
    }
    out.push(`## Slide ${i + 1}`, text.trim(), '');
  });
  return tidy(out.join('\n'));
}

function tidy(text: string): string {
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
