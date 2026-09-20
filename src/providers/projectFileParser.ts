import { XMLParser } from 'fast-xml-parser';
import { ExportInstance, ExportRow } from './projectFileFormat.js';

/**
 * Parses an App Designer project export into {@link ExportInstance} blocks.
 *
 * Entity handling deserves a note. fast-xml-parser caps total entity
 * expansions at 1000 by default to stop billion-laughs attacks. A real export
 * blows straight through that on legitimate content: PeopleCode variables start
 * with `&`, so `&amp;` alone appeared 1783 times in the first file tested, and
 * `&quot;` 2794 times. Those are the five XML predefined entities, which cannot
 * expand recursively and carry no such risk.
 *
 * So the expansion counters are lifted, and the actual attack surface — entities
 * declared in a DOCTYPE — is removed instead: PeopleSoft never emits a DTD, and
 * a file that contains one is rejected rather than expanded.
 */
export function parseExport(xml: string): ExportInstance[] {
  assertNoDocType(xml);

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    // PeopleCode source carries meaningful leading whitespace and blank lines.
    trimValues: false,
    parseTagValue: false,
    parseAttributeValue: false,
    processEntities: {
      enabled: true,
      // Lifted because the predefined entities are unbounded in legitimate
      // content; DTD-declared entities are refused outright above.
      maxTotalExpansions: Number.MAX_SAFE_INTEGER,
      maxExpandedLength: Number.MAX_SAFE_INTEGER,
      maxEntityCount: Number.MAX_SAFE_INTEGER,
      maxEntitySize: Number.MAX_SAFE_INTEGER
    },
    isArray: (name) => name === 'row' || name === 'rowset' || name === 'instance'
  });

  const doc = parser.parse(xml) as Record<string, unknown>;
  const instances = collectInstances(doc);
  if (instances.length === 0) {
    throw new Error(
      'No <instance> blocks found. This does not look like an Application ' +
      'Designer project export — export a project with File > Export Project ' +
      'to File, which produces XML with <instance class="PJM"> at the top.');
  }
  return instances;
}

function assertNoDocType(xml: string): void {
  // Only inspect the prolog: the string "<!DOCTYPE" appears escaped inside
  // PeopleCode that writes HTML, and that is not a declaration.
  const prolog = xml.slice(0, 4096);
  const stripped = prolog.replace(/<!--[\s\S]*?-->/g, '');
  if (/<!DOCTYPE/i.test(stripped)) {
    throw new Error(
      'This file declares a DOCTYPE. App Designer exports never do, and ' +
      'external entity declarations are not processed.');
  }
}

function collectInstances(doc: Record<string, unknown>): ExportInstance[] {
  const raw = doc['instance'];
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return list.map((node) => toInstance(node as Record<string, unknown>));
}

function toInstance(node: Record<string, unknown>): ExportInstance {
  const cls = String(node['@class'] ?? '').trim();
  const text = node['peoplecode_text'];
  const instance: ExportInstance = {
    cls,
    rowsets: readRowsets(node),
    peopleCodeText: typeof text === 'string' ? text : undefined
  };
  return instance;
}

/**
 * Collects the `<rowset name="...">` children of a node.
 *
 * Rowsets appear both directly under an instance and nested inside `lp*`
 * pointer elements, so any child object is searched, not just known names.
 */
function readRowsets(node: Record<string, unknown>): Map<string, ExportRow[]> {
  const out = new Map<string, ExportRow[]>();

  const addRowsetsFrom = (container: Record<string, unknown>) => {
    const sets = container['rowset'];
    if (sets === undefined) return;
    for (const set of Array.isArray(sets) ? sets : [sets]) {
      const s = set as Record<string, unknown>;
      const name = String(s['@name'] ?? '').trim();
      if (!name) continue;
      const rows = s['row'];
      const rowList = (Array.isArray(rows) ? rows : rows === undefined ? [] : [rows])
        .map((r) => toRow(r as Record<string, unknown>));
      out.set(name, [...(out.get(name) ?? []), ...rowList]);
    }
  };

  addRowsetsFrom(node);
  for (const [key, value] of Object.entries(node)) {
    // A rowset reached indirectly is wrapped in an element whose own text is a
    // marker: `lp*` pointers read "POINTER" or "custom field", `h*` handles read
    // "HANDLE". Both carry the nested rowset and neither prefix is reliable on
    // its own -- record field labels hang off `hDBFldLabel` -- so descend into
    // every child object rather than matching prefixes.
    if (key === 'rowset' || key.startsWith('@')) continue;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    addRowsetsFrom(value as Record<string, unknown>);
  }
  return out;
}

function toRow(node: Record<string, unknown>): ExportRow {
  const fields = new Map<string, string>();
  const nested = readRowsets(node);

  for (const [key, value] of Object.entries(node)) {
    if (key === 'rowset' || key.startsWith('@')) continue;
    if (value === null || value === undefined) {
      fields.set(key, '');
    } else if (typeof value === 'object') {
      // A pointer element: its rowsets are already collected, but it may also
      // carry a scalar marker such as "custom field" worth keeping.
      const text = (value as Record<string, unknown>)['#text'];
      if (typeof text === 'string') fields.set(key, text);
    } else {
      fields.set(key, String(value));
    }
  }
  return { fields, rowsets: nested };
}
