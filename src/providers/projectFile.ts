import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  DefinitionProvider, DefinitionSummary, ProjectSummary, ProviderCapabilities,
  ProviderError, SearchQuery, UnsupportedOperationError
} from './provider.js';
import {
  DefinitionKey, DefinitionType, isPeopleCode, keyToString, makeKey
} from '../model/definitions.js';
import { FieldType, RecordDefinition, RecordField, RecordType, UseEdit } from '../model/record.js';
import { parseExport } from './projectFileParser.js';
import {
  ExportInstance, ExportRow, allRows, findScalar, firstRow, intField, objectValues,
  rawField, strField
} from './projectFileFormat.js';
import {
  renderApplicationPackage, renderComponent, renderField, renderMenu, renderPage
} from './projectFileRender.js';

/**
 * Reads an App Designer project export.
 *
 * PeopleCode arrives as plain source here rather than the tokenized form the
 * database stores, which makes this the accurate way to read PeopleCode while
 * the decoder is still being calibrated.
 */
export class ProjectFileProvider implements DefinitionProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities = {
    // Writing back has to preserve App Designer's exact serialization or the
    // file will not re-import; see flush().
    write: false,
    // Only this project's contents exist here; there is no environment to search.
    globalSearch: false,
    build: false
  };

  private loaded = false;
  private projectName = '';
  private projectDescr = '';
  private readonly items: DefinitionSummary[] = [];
  private readonly texts = new Map<string, string>();
  private readonly records = new Map<string, RecordDefinition>();
  /** Definition instances indexed by the name they are keyed on in the item list. */
  private readonly byName = new Map<string, ExportInstance>();

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
      throw new ProviderError(`Could not read ${this.filePath}.`, err);
    }

    let instances: ExportInstance[];
    try {
      instances = parseExport(xml);
    } catch (err) {
      throw new ProviderError(
        `Could not read ${path.basename(this.filePath)}: ${(err as Error).message}`, err);
    }

    this.ingest(instances);
    this.loaded = true;
  }

  private ingest(instances: readonly ExportInstance[]): void {
    for (const instance of instances) {
      switch (instance.cls) {
        case 'PJM': this.ingestProject(instance); break;
        case 'PCM': this.ingestPeopleCode(instance); break;
        case 'RDM': this.ingestRecord(instance); break;
        // The remaining classes are indexed by name and rendered on demand.
        // An export carries definitions the project merely references as well
        // as its own items, so more instances than items is normal.
        case 'FIELD': this.index(instance, 'szFieldName'); break;
        case 'CRM': this.index(instance, 'szContName'); break;
        case 'PGM': this.index(instance, 'szPnlGrpName'); break;
        case 'MDM': this.index(instance, 'szMenuName'); break;
        case 'PDM': this.index(instance, 'szPnlName'); break;
        case 'APM': this.index(instance, 'szPackageRoot'); break;
        default: break;
      }
    }

    if (!this.projectName) {
      // Fall back to the file name, extension-insensitively: exports are
      // commonly named .XML in upper case.
      this.projectName = path.basename(this.filePath).replace(/\.xml$/i, '');
    }
  }

  /**
   * Indexes an instance under its class and name.
   *
   * Only the first instance of a given name is kept. An export can repeat a
   * definition in more than one language, and the base row comes first.
   */
  private index(instance: ExportInstance, nameField: string): void {
    const name = findScalar(instance, nameField);
    if (!name) return;
    const id = `${instance.cls}:${name.toUpperCase()}`;
    if (!this.byName.has(id)) this.byName.set(id, instance);
  }

  /** The PJM instance holds the project name and its item list. */
  private ingestProject(instance: ExportInstance): void {
    const defn = firstRow(instance.rowsets, 'PjmDefn');
    if (defn) {
      this.projectName = strField(defn, 'szProjectName');
      this.projectDescr = strField(defn, 'szProjectDescr');
    }

    for (const row of allRows(instance.rowsets, 'PjmPit')) {
      // Project items carry four key slots, not the seven a definition uses.
      const parts = objectValues(row, 4);
      this.items.push({
        key: makeKey(intField(row, 'eObjectType') as DefinitionType, ...parts)
      });
    }
  }

  /** A PCM instance pairs a program key with its plain source text. */
  private ingestPeopleCode(instance: ExportInstance): void {
    const prog = firstRow(instance.rowsets, 'PcmProg');
    if (!prog || instance.peopleCodeText === undefined) return;

    // The program's own key uses seven slots; its type is not stored on the
    // instance, so it is recovered from the project item list.
    //
    // The item's key is a prefix of the program's, not an exact match: an
    // application class appears in the item list as PACKAGE.PATH.CLASS but the
    // program key appends the OnExecute event, and the item list only carries
    // four key slots against the program's seven.
    const parts = objectValues(prog, 7);

    // Several items can be a prefix of the same program key: a record-field
    // program WEBLIB_OU_LP.ISCRIPT1.FieldFormula is also prefixed by the record
    // WEBLIB_OU_LP itself. Prefer a PeopleCode-typed item, then the longest
    // prefix, so the program is not filed under its parent record.
    const item = this.items
      .filter((i) => isKeyPrefix(i.key.parts, parts))
      .sort((a, b) => {
        const byType = Number(isPeopleCode(b.key.type)) - Number(isPeopleCode(a.key.type));
        return byType !== 0 ? byType : b.key.parts.length - a.key.parts.length;
      })[0];
    if (!item) return;

    // Store the text under the item's own key so a click in the tree finds it.
    this.texts.set(keyToString(item.key), instance.peopleCodeText);
  }

  private ingestRecord(instance: ExportInstance): void {
    const defn = firstRow(instance.rowsets, 'RecDefn');
    if (!defn) return;

    const name = strField(defn, 'szRecName');
    if (!name) return;
    const key = makeKey(DefinitionType.Record, name);

    // An export names record fields with the `atm` (atom) prefix and carries
    // only their physical attributes -- there is no USEEDIT column here. Key
    // membership lives in the record's primary index instead.
    const keyFields = primaryKeyFields(instance);

    const fields: RecordField[] = allRows(instance.rowsets, 'RecField').map((f, i) => {
      const fieldName = strField(f, 'atmFieldName');
      return {
        name: fieldName,
        // Field order is positional in an export; there is no field number.
        fieldNum: i + 1,
        type: intField(f, 'eFieldType') as FieldType,
        length: intField(f, 'nLength'),
        decimalPositions: intField(f, 'nDecimalPos'),
        useEdit: keyFields.has(fieldName.toUpperCase()) ? UseEdit.Key : 0,
        label: fieldLabel(f, fieldName)
      };
    });

    this.records.set(keyToString(key), {
      key,
      name,
      // An export holds the description in a long-text handle rather than a
      // scalar, so it is left blank rather than guessed at.
      description: '',
      recordType: intField(defn, 'eRecType') as RecordType,
      version: intField(defn, 'lVersion'),
      fields
    });
  }

  async dispose(): Promise<void> { this.loaded = false; }

  async listProjects(): Promise<ProjectSummary[]> {
    return [{ name: this.projectName, description: this.projectDescr || undefined }];
  }

  async listProjectItems(project: string): Promise<DefinitionSummary[]> {
    if (project.toUpperCase() !== this.projectName.toUpperCase()) return [];
    return [...this.items];
  }

  async search(query: SearchQuery): Promise<DefinitionSummary[]> {
    const rx = patternToRegExp(query.namePattern ?? '%');
    return this.items
      .filter((i) => (query.type === undefined || i.key.type === query.type)
        && rx.test(i.key.parts[0] ?? ''))
      .slice(0, query.limit ?? 500);
  }

  async readText(key: DefinitionKey): Promise<string> {
    const text = this.texts.get(keyToString(key));
    if (text !== undefined) return text;

    const rendered = this.render(key);
    if (rendered !== undefined) return rendered;

    const known = this.items.some((i) => keyToString(i.key) === keyToString(key));
    throw new ProviderError(known
      ? `${key.parts.join('.')} is in this project, but the export does not carry ` +
        `its definition. An export includes referenced definitions selectively.`
      : `${key.parts.join('.')} is not an item of ${this.projectName}.`);
  }

  /** Renders a definition that has no dedicated editor yet, as read-only text. */
  private render(key: DefinitionKey): string | undefined {
    const name = (key.parts[0] ?? '').toUpperCase();
    const find = (cls: string) => this.byName.get(`${cls}:${name}`);

    switch (key.type) {
      case DefinitionType.Field: {
        const i = find('FIELD');
        return i && renderField(i);
      }
      case DefinitionType.HtmlDefinition: {
        const i = find('CRM');
        return i && htmlContent(i);
      }
      case DefinitionType.Component: {
        const i = find('PGM');
        return i && renderComponent(i);
      }
      case DefinitionType.Menu: {
        const i = find('MDM');
        return i && renderMenu(i);
      }
      case DefinitionType.Page: {
        const i = find('PDM');
        return i && renderPage(i);
      }
      case DefinitionType.ApplicationPackage: {
        // A package item is keyed PACKAGEID.PACKAGEROOT, and the instance is
        // indexed by root, so try both slots.
        const i = this.byName.get(`APM:${name}`)
          ?? this.byName.get(`APM:${(key.parts[1] ?? '').toUpperCase()}`);
        return i && renderApplicationPackage(i);
      }
      default:
        return undefined;
    }
  }

  async writeText(): Promise<void> { return this.flush(); }
  async writeRecord(): Promise<void> { return this.flush(); }

  async readRecord(key: DefinitionKey): Promise<RecordDefinition> {
    const rec = this.records.get(keyToString(key));
    if (!rec) {
      throw new ProviderError(
        `Record ${key.parts[0]} is not carried by ${this.projectName}.`);
    }
    return rec;
  }

  /**
   * Writing back is not implemented.
   *
   * App Designer re-imports its own serialization, so a writer has to preserve
   * element order, the `lp*` pointer markers and the exact numeric encoding.
   * A lossy rewrite produces a file that imports incorrectly, which is worse
   * than not writing at all.
   */
  private async flush(): Promise<never> {
    throw new UnsupportedOperationError(
      'saving changes back to a project export file', this.displayName);
  }
}

/**
 * The text of an HTML or content definition.
 *
 * Content hangs off the definition row in a `char` rowset, inside an element
 * that repeats the name of its own handle. Whitespace is significant here, so
 * the value is read untrimmed.
 */
function htmlContent(instance: ExportInstance): string | undefined {
  for (const row of allRows(instance.rowsets, 'char')) {
    const text = rawField(row, 'hContStrData');
    if (text) return text;
  }
  return undefined;
}

/**
 * The display label for a field.
 *
 * Labels hang off the field row in a nested DBFldLabel rowset, one row per
 * label id. A field can carry several; the one whose id matches the field name
 * is the default that App Designer shows, so prefer it and fall back to the
 * first.
 */
function fieldLabel(field: ExportRow, fieldName: string): string | undefined {
  const labels = allRows(field.rowsets, 'DBFldLabel');
  if (labels.length === 0) return undefined;
  const match = labels.find(
    (l) => strField(l, 'atmLabelID').toUpperCase() === fieldName.toUpperCase());
  return strField(match ?? labels[0], 'atmLongName') || undefined;
}

/** True when `prefix` matches the leading key parts of `full`, ignoring case. */
function isKeyPrefix(prefix: readonly string[], full: readonly string[]): boolean {
  if (prefix.length === 0 || prefix.length > full.length) return false;
  return prefix.every((p, i) => p.toUpperCase() === full[i].toUpperCase());
}

/**
 * Field names of the record's primary key.
 *
 * App Designer writes key membership as an index whose id is `_`, with one
 * KeyDefn row per key field. Other IndexDefn rows are alternate and user
 * indexes, which are not key fields.
 */
function primaryKeyFields(instance: ExportInstance): Set<string> {
  const out = new Set<string>();
  for (const index of allRows(instance.rowsets, 'IndexDefn')) {
    if (strField(index, 'cIndexId') !== '_') continue;
    for (const k of allRows(index.rowsets, 'KeyDefn')) {
      const name = strField(k, 'szFieldName');
      if (name) out.add(name.toUpperCase());
    }
  }
  return out;
}

/** SQL LIKE semantics, since callers write patterns for the database provider. */
function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i');
}
