import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import {
  DefinitionProvider, DefinitionSummary, ProjectSummary, ProviderCapabilities,
  ProviderError, SearchQuery, UnsupportedOperationError
} from './provider.js';
import {
  DefinitionKey, DefinitionType, keyEquals, keyToString, makeKey
} from '../model/definitions.js';
import { FieldType, RecordDefinition, RecordField, RecordType } from '../model/record.js';

/**
 * Reads an App Designer project export.
 *
 * App Designer writes a project to XML with one <PSPROJECTITEM> per definition
 * and the definition's own tables inlined as element trees. PeopleCode appears
 * as plain source text rather than the tokenized database form, which makes
 * this provider the accurate way to read PeopleCode until the decoder is
 * calibrated.
 *
 * Edits are held in memory and flushed back to the XML on save, so the export
 * stays a valid App Designer import file.
 */
export class ProjectFileProvider implements DefinitionProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities = {
    write: true,
    // Only the project's own contents exist here; there is no environment to search.
    globalSearch: false,
    build: false
  };

  private loaded = false;
  private projectName = '';
  private projectDescr = '';
  private readonly texts = new Map<string, string>();
  private readonly records = new Map<string, RecordDefinition>();
  private readonly items: DefinitionSummary[] = [];
  private dirty = new Set<string>();

  constructor(private readonly filePath: string, name?: string) {
    this.id = `project:${filePath}`;
    this.displayName = name ?? path.basename(filePath);
  }

  get isConnected(): boolean { return this.loaded; }

  async connect(): Promise<void> {
    if (this.loaded) return;
    let xml: string;
    try {
      xml = await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      throw new ProviderError(`Could not read project export ${this.filePath}.`, err);
    }

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@',
      // Definition text carries meaningful leading whitespace; never trim it.
      trimValues: false,
      parseTagValue: false,
      isArray: (name) => ARRAY_ELEMENTS.has(name)
    });

    let doc: any;
    try {
      doc = parser.parse(xml);
    } catch (err) {
      throw new ProviderError(`${this.filePath} is not well-formed XML.`, err);
    }

    this.ingest(doc);
    this.loaded = true;
  }

  private ingest(doc: any): void {
    const root = doc?.PSCAMA ?? doc?.['?xml'] ? doc : doc;
    const defn = findFirst(root, 'PSPROJECTDEFN');
    this.projectName = str(defn?.PROJECTNAME) || path.basename(this.filePath, '.xml');
    this.projectDescr = str(defn?.DESCR);

    for (const item of findAll(root, 'PSPROJECTITEM')) {
      const type = Number(str(item.OBJECTTYPE));
      if (!Number.isFinite(type)) continue;
      const key = makeKey(type as DefinitionType,
        ...[1, 2, 3, 4, 5, 6, 7].map((n) => str(item[`OBJECTVALUE${n}`])));
      this.items.push({ key });
    }

    // PeopleCode bodies travel in PSPCMPROG elements, but as source text rather
    // than the database's tokenized form.
    for (const prog of findAll(root, 'PSPCMPROG')) {
      const key = makeKey(Number(str(prog.OBJECTTYPE)) as DefinitionType,
        ...[1, 2, 3, 4, 5, 6, 7].map((n) => str(prog[`OBJECTVALUE${n}`])));
      const text = str(prog.PCTEXT ?? prog.PROGTXT);
      if (text) this.texts.set(keyToString(key), text);
    }

    for (const sql of findAll(root, 'PSSQLTEXTDEFN')) {
      const id = str(sql.SQLID);
      if (!id) continue;
      const key = makeKey(DefinitionType.SqlDefinition, id);
      const prev = this.texts.get(keyToString(key)) ?? '';
      this.texts.set(keyToString(key), prev + str(sql.SQLTEXT));
    }

    for (const rec of findAll(root, 'PSRECDEFN')) {
      const name = str(rec.RECNAME);
      if (!name) continue;
      const key = makeKey(DefinitionType.Record, name);
      this.records.set(keyToString(key), {
        key,
        name,
        description: str(rec.RECDESCR),
        recordType: Number(str(rec.RECTYPE) || '0') as RecordType,
        version: Number(str(rec.VERSION) || '0'),
        fields: this.fieldsFor(root, name)
      });
    }
  }

  private fieldsFor(root: any, recname: string): RecordField[] {
    const out: RecordField[] = [];
    for (const rf of findAll(root, 'PSRECFIELD')) {
      if (str(rf.RECNAME) !== recname) continue;
      out.push({
        name: str(rf.FIELDNAME),
        fieldNum: Number(str(rf.FIELDNUM) || '0'),
        type: Number(str(rf.FIELDTYPE) || '0') as FieldType,
        length: Number(str(rf.LENGTH) || '0'),
        decimalPositions: Number(str(rf.DECIMALPOS) || '0'),
        useEdit: Number(str(rf.USEEDIT) || '0'),
        editTable: str(rf.EDITTABLE) || undefined
      });
    }
    return out.sort((a, b) => a.fieldNum - b.fieldNum);
  }

  async dispose(): Promise<void> {
    if (this.dirty.size > 0) {
      throw new ProviderError(
        `${this.displayName} has ${this.dirty.size} unsaved change(s). Save or discard them first.`);
    }
    this.loaded = false;
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return [{ name: this.projectName, description: this.projectDescr }];
  }

  async listProjectItems(project: string): Promise<DefinitionSummary[]> {
    if (project !== this.projectName) return [];
    return [...this.items];
  }

  async search(query: SearchQuery): Promise<DefinitionSummary[]> {
    const rx = patternToRegExp(query.namePattern ?? '%');
    return this.items.filter((i) =>
      (query.type === undefined || i.key.type === query.type) &&
      rx.test(i.key.parts[0] ?? '')
    ).slice(0, query.limit ?? 500);
  }

  async readText(key: DefinitionKey): Promise<string> {
    const text = this.texts.get(keyToString(key));
    if (text === undefined) {
      throw new ProviderError(
        `${key.parts.join('.')} is not present in ${this.displayName}. ` +
        `A project export only contains the definitions it was built with.`);
    }
    return text;
  }

  async writeText(key: DefinitionKey, text: string): Promise<void> {
    if (!this.items.some((i) => keyEquals(i.key, key))) {
      throw new ProviderError(`${key.parts.join('.')} is not an item of this project.`);
    }
    this.texts.set(keyToString(key), text);
    this.dirty.add(keyToString(key));
    await this.flush();
  }

  async readRecord(key: DefinitionKey): Promise<RecordDefinition> {
    const rec = this.records.get(keyToString(key));
    if (!rec) throw new ProviderError(`Record ${key.parts[0]} is not present in ${this.displayName}.`);
    return rec;
  }

  async writeRecord(_record: RecordDefinition): Promise<void> {
    throw new UnsupportedOperationError('saving record definitions', this.displayName);
  }

  /**
   * Rewrites the export file.
   *
   * Not yet implemented: a faithful writer has to preserve element order,
   * PSCAMA audit blocks and the exact encoding App Designer expects on import,
   * and a lossy rewrite would produce a file that imports incorrectly. Until
   * then, edits stay in memory for the session and the file is left untouched.
   */
  private async flush(): Promise<void> {
    throw new UnsupportedOperationError(
      'writing changes back to the project export file', this.displayName);
  }
}

/** Elements that may legitimately repeat, so the parser must always give arrays. */
const ARRAY_ELEMENTS = new Set([
  'PSPROJECTITEM', 'PSPCMPROG', 'PSPCMNAME', 'PSRECDEFN', 'PSRECFIELD',
  'PSDBFIELD', 'PSDBFLDLABL', 'PSSQLTEXTDEFN', 'PSPNLDEFN', 'PSPNLFIELD',
  'PSPNLGRPDEFN', 'PSPNLGROUP', 'PSMENUDEFN', 'PSMENUITEM', 'PSAEAPPLDEFN',
  'PSAESECTDEFN', 'PSAESTEPDEFN', 'PSAESTEPMSGDEFN'
]);

function str(v: unknown): string {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

/** App Designer nests definitions a few levels deep; find them wherever they sit. */
function findAll(node: any, tag: string, out: any[] = []): any[] {
  if (node === null || typeof node !== 'object') return out;
  for (const [k, v] of Object.entries(node)) {
    if (k === tag) {
      if (Array.isArray(v)) out.push(...v);
      else out.push(v);
    } else if (typeof v === 'object' && v !== null) {
      if (Array.isArray(v)) for (const item of v) findAll(item, tag, out);
      else findAll(v, tag, out);
    }
  }
  return out;
}

function findFirst(node: any, tag: string): any {
  return findAll(node, tag)[0];
}

/** SQL LIKE semantics, since callers write patterns for the database provider. */
function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i');
}
