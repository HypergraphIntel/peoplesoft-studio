import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { DefinitionType, displayName, type DefinitionKey } from '../model/definitions.js';
import { FieldType } from '../model/record.js';
import { layoutEditRefusal } from '../model/recordEdit.js';
import { applyRecordOperations, type RecordOperation } from '../model/recordOperations.js';
import { applyPageOperations, pageLayoutForAgent, type PageOperation } from '../model/pageOperations.js';
import { DatabaseProvider } from '../providers/database.js';
import { fieldCreateRefusal, type FieldLabelEdit } from '../providers/fieldWriter.js';
import type { TranslateChange } from '../providers/translateWriter.js';
import type { PeopleCodeSaveResult } from '../providers/peopleCodeWriter.js';
import { writeScopeRefusal } from '../providers/writeScope.js';
import { Workspace } from '../workspace.js';
import { jsonResult, keyFromInput, requireProvider } from './tools.js';
import { describeOperation, textChangeSummary } from './writeSummary.js';

/*
 * The MCP's write tools: the same writers the editors use (PeopleCode, SQL /
 * HTML / style sheets, pages, records, fields, translates, projects,
 * packages), behind the same gates -- a connected database connection set
 * to Writable, an Operator ID, a name in the write scope -- and one more: no
 * editor holding unsaved changes to the definition. Then, unless
 * peoplesoft.mcp.writes is "allow", VS Code asks the user (a modal naming the
 * connection, the definition and the change) and nothing is written without
 * their yes. "off" refuses every write. Each writer keeps its own checks:
 * concurrency tokens are read here, just before the write, so the save is
 * refused if the definition moves between the read and the write.
 */

export type McpWriteMode = 'confirm' | 'allow' | 'off';

/** What the VS Code side provides: the setting, the confirmation, and editor state. */
export interface McpWriteHost {
  mode(): McpWriteMode;
  /** Asks the user; true only on an explicit yes. */
  confirm(request: { title: string; detail: string }): Promise<boolean>;
  /** Whether an open editor has unsaved changes to the definition. */
  hasUnsavedEditor(connectionId: string, key: DefinitionKey): boolean;
  /** After a write: refresh open editors and the trees; a PeopleCode save also leaves its report (the rows it replaced). */
  saved(connectionId: string, key: DefinitionKey, peopleCode?: PeopleCodeSaveResult): void;
}

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const DESTRUCTIVE = { ...WRITE, destructiveHint: true } as const;
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const GATES =
  'Writes need a database connection set to Writable with an Operator ID, and a name in the write scope; ' +
  'unless peoplesoft.mcp.writes is "allow", the user approves each write in VS Code.';

interface Gate { provider: DatabaseProvider; operatorId: string }

/** The connection may be written and the name is in the write scope; throws the reason otherwise. */
async function writable(workspace: Workspace, host: McpWriteHost, connection: string, name: string): Promise<Gate> {
  if (host.mode() === 'off') {
    throw new Error('Writes through the MCP are off (peoplesoft.mcp.writes). The user can turn them on in PeopleSoft Studio Settings.');
  }
  const provider = await requireProvider(workspace, connection);
  if (!(provider instanceof DatabaseProvider)) throw new Error(`${provider.displayName} is a project export; only database connections are written.`);
  if (!provider.isConnected) throw new Error(`${provider.displayName} is not connected.`);
  if (!workspace.isWritable(provider.id)) throw new Error(`${provider.displayName} is read-only (Access in PeopleSoft Studio Settings).`);
  const operatorId = workspace.configFor(provider.id)?.peoplesoftOperatorId?.trim();
  if (!operatorId) throw new Error(`Set the Operator ID for ${provider.displayName} in PeopleSoft Studio Settings before writing.`);
  const scope = writeScopeRefusal(name);
  if (scope) throw new Error(scope);
  return { provider: provider as DatabaseProvider, operatorId };
}

/** No editor holds unsaved changes to it, and the user says yes (unless writes are "allow"). */
async function approve(host: McpWriteHost, gate: Gate, key: DefinitionKey, action: string, detail: string): Promise<void> {
  if (host.hasUnsavedEditor(gate.provider.id, key)) {
    throw new Error(`${displayName(key)} is open in VS Code with unsaved changes; the user must save or revert them first.`);
  }
  if (host.mode() === 'allow') return;
  const ok = await host.confirm({
    title: `An AI agent wants to ${action} on ${gate.provider.displayName}.`,
    detail: `${detail}\n\nSaved as operator ${gate.operatorId}, through the PeopleSoft Studio MCP.`
  });
  if (!ok) throw new Error('The user declined this write in VS Code; nothing was saved.');
}

const pageOperation = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add'),
    kind: z.enum(['frame', 'groupBox', 'horizontalRule', 'staticText', 'checkBox', 'dropDown', 'editBox', 'pushButton']),
    left: z.number(), top: z.number(), width: z.number().optional(), height: z.number().optional(),
    record: z.string().optional().describe('Record of a record-bound control (check box, drop down, edit box, push button).'),
    field: z.string().optional(), label: z.string().optional()
  }),
  z.object({ op: z.literal('move'), id: z.number().int(), left: z.number(), top: z.number() }),
  z.object({ op: z.literal('resize'), id: z.number().int(), width: z.number(), height: z.number() }),
  z.object({ op: z.literal('set_label'), id: z.number().int(), text: z.string().optional(), labelType: z.number().int().optional().describe('0 None, 1 Text, 2 RFT Short, 3 RFT Long') }),
  z.object({ op: z.literal('set_use'), id: z.number().int(), displayOnly: z.boolean().optional(), invisible: z.boolean().optional() }),
  z.object({ op: z.literal('delete'), id: z.number().int() }),
  z.object({
    op: z.literal('set_properties'), description: z.string().max(30).optional(), comments: z.string().optional(),
    width: z.number().optional().describe('Page size; setting it makes the Page Size choice Custom.'), height: z.number().optional(),
    ownerId: z.string().optional().describe('Owner ID (PSXLATITEM OBJECTOWNERID); "" for none.'),
    styleSheet: z.string().optional().describe('Page Style Sheet; "" for the default style.'),
    background: z.string().optional().describe('Page Background style class; "" for the default style.'),
    deferProc: z.boolean().optional().describe('Allow Deferred Processing.'),
    adjustLayout: z.boolean().optional().describe('Adjust Layout for Hidden Fields.'),
    popupMenu: z.string().optional().describe('Popup Menu (a popup menu definition); "" for none.'),
    pageSize: z.enum(['640x480', '800x600', '800x600-portal', '800x600-noportal', '1024x768-portal', '1024x768-noportal', '240xvar', '490xvar', 'custom']).optional()
      .describe('A standard page\'s Page Size choice (App Designer\'s list); width/height set a Custom size instead.'),
    pageType: z.number().int().min(0).max(11).optional().describe('Page Type: 0 Standard, 1 Subpage, 2 Secondary, 3 Popup, 4 Header, 5 Side Page 1, ' +
      '6 Footer, 7 Layout, 8 Search, 9 Prompt, 10 Master&Detail Target, 11 Side Page 2. The type sets the page size as App Designer does.'),
    okCancel: z.boolean().optional().describe('Secondary page: OK & Cancel buttons.'),
    closeBox: z.boolean().optional().describe('Secondary page: Close Box.'),
    disableModal: z.boolean().optional().describe('Secondary page: Disable Display in Modal Window When Not Launched by DoModal PeopleCode.'),
    fluidPage: z.boolean().optional().describe('Fluid Page.'),
    styleClasses: z.string().max(100).optional().describe('Fluid tab: Style Classes; "" for none.'),
    small: z.string().max(100).optional().describe('Fluid tab: Small form-factor style class override.'),
    medium: z.string().max(100).optional().describe('Fluid tab: Medium override.'),
    large: z.string().max(100).optional().describe('Fluid tab: Large override.'),
    extraLarge: z.string().max(100).optional().describe('Fluid tab: Extra Large override.'),
    suppressClasses: z.boolean().optional().describe('Fluid tab: Suppress System-Specific Style Classes.')
  })
]);

const useFlags = {
  key: z.boolean().optional(), dupOrder: z.boolean().optional(), altSearch: z.boolean().optional(), descending: z.boolean().optional(),
  searchKey: z.boolean().optional(), searchEdit: z.boolean().optional(), listBox: z.boolean().optional(), fromSearch: z.boolean().optional(),
  throughSearch: z.boolean().optional(), defaultSearch: z.boolean().optional(), disableAdvancedSearch: z.boolean().optional(),
  allowSearchEvents: z.boolean().optional(), auditAdd: z.boolean().optional(), auditChange: z.boolean().optional(),
  auditDelete: z.boolean().optional(), systemMaintained: z.boolean().optional(), doNotTrace: z.boolean().optional(),
  smartPrompt: z.boolean().optional(), smartDropDown: z.boolean().optional(), inMemory: z.boolean().optional()
};

const recordOperation = z.discriminatedUnion('op', [
  z.object({ op: z.literal('insert_field'), field: z.string(), after: z.string().optional().describe('Insert after this field; at the end when absent.') }),
  z.object({ op: z.literal('insert_subrecord'), subrecord: z.string(), after: z.string().optional() }),
  z.object({ op: z.literal('remove_field'), field: z.string() }),
  z.object({ op: z.literal('move_field'), field: z.string(), after: z.string().optional().describe('Move after this field; first when absent.') }),
  z.object({ op: z.literal('set_use'), field: z.string(), ...useFlags }),
  z.object({
    op: z.literal('set_edits'), field: z.string(), required: z.boolean().optional(),
    edit: z.enum(['none', 'prompt', 'promptNoEdit', 'yesNo', 'translate']).optional(), promptTable: z.string().optional()
  }),
  z.object({
    op: z.literal('set_default'), field: z.string(), constant: z.string().optional(),
    record: z.string().optional(), defaultField: z.string().optional(), clear: z.boolean().optional()
  }),
  z.object({ op: z.literal('set_label'), field: z.string(), labelId: z.string() }),
  z.object({
    op: z.literal('set_properties'), description: z.string().optional(), definition: z.string().optional(), ownerId: z.string().optional(),
    setControlField: z.string().optional(), parentRecord: z.string().optional(), relatedLanguageRecord: z.string().optional(),
    querySecurityRecord: z.string().optional(), analyticDeleteRecord: z.string().optional(), toolsTable: z.boolean().optional(),
    managed: z.boolean().optional(), auditRecord: z.string().optional(), recUse: z.number().int().optional(),
    timestampField: z.string().optional(), systemIdField: z.string().optional()
  }),
  z.object({
    op: z.literal('set_type'), recordType: z.number().int().optional().describe('0 SQL Table, 1 SQL View, 2 Derived/Work, 5 Dynamic View, 7 Temporary Table'),
    sqlTableName: z.string().optional(), buildSequence: z.number().int().optional(), viewSql: z.string().optional()
  })
]);

const FIELD_TYPES: Record<string, FieldType> = {
  character: FieldType.Character, longCharacter: FieldType.LongCharacter, number: FieldType.Number, signedNumber: FieldType.SignedNumber,
  date: FieldType.Date, time: FieldType.Time, dateTime: FieldType.DateTime, imageReference: FieldType.ImageReference
};

export function registerPeopleSoftWriteTools(server: McpServer, workspace: Workspace, host: McpWriteHost): void {
  const done = (gate: Gate, key: DefinitionKey, result: Record<string, unknown>, peopleCode?: PeopleCodeSaveResult) => {
    host.saved(gate.provider.id, key, peopleCode);
    return jsonResult({ connection: { id: gate.provider.id, name: gate.provider.displayName }, definition: displayName(key), saved: true, ...result });
  };

  server.registerTool('psft_save_peoplecode', {
    title: 'Save PeopleCode',
    description:
      'Compile and save a PeopleCode program to the database, as App Designer does: Record PeopleCode (type 8; parts ' +
      'RECORD, FIELD, EVENT), Component PeopleCode (46: COMPONENT, MARKET, EVENT; 47: COMPONENT, MARKET, RECORD, EVENT; ' +
      '48: COMPONENT, MARKET, RECORD, FIELD, EVENT; created when new) or an Application Class (type 58; parts PACKAGE[, SUBPACKAGE...], CLASS, OnExecute). ' +
      'Saving an Application Class that does not exist yet creates it in its package. Read the current source with ' +
      'psft_get_peoplecode first and send the whole program. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), type: z.number().int(), parts: z.array(z.string()).min(1), source: z.string() }),
    annotations: WRITE
  }, async ({ connection, type, parts, source }) => {
    const key = keyFromInput(type, parts);
    const saved = [DefinitionType.RecordPeopleCode, DefinitionType.ApplicationClassPeopleCode, DefinitionType.ComponentPeopleCode,
      DefinitionType.ComponentRecordPeopleCode, DefinitionType.ComponentRecordFieldPeopleCode, DefinitionType.PagePeopleCode];
    if (!saved.includes(key.type)) {
      throw new Error('Only Record PeopleCode (8), Component PeopleCode (46, 47, 48), Page PeopleCode (44) and Application Classes (58) are saved here.');
    }
    const gate = await writable(workspace, host, connection, key.parts[0]);
    if (!workspace.isPeopleCodeWritable(gate.provider.id, key)) throw new Error(`${displayName(key)} cannot be saved on ${gate.provider.displayName}.`);
    if (workspace.configFor(gate.provider.id)?.peoplecodeSaveMode === 'save-only') {
      throw new Error('Save mode is "Save only", which is not available: set "Compile and save" in PeopleSoft Studio Settings.');
    }
    const edit = await gate.provider.readPeopleCodeForEdit(key);
    const exists = edit !== undefined || await gate.provider.hasPeopleCode(key);
    if (!edit && exists) throw new Error(`${displayName(key)} cannot be opened for editing on ${gate.provider.displayName}.`);
    const createClass = !edit && key.type === DefinitionType.ApplicationClassPeopleCode;
    await approve(host, gate, key, `${edit ? 'save' : 'create'} PeopleCode ${displayName(key)}`, textChangeSummary(edit?.text ?? '', source));
    const result = await gate.provider.savePeopleCode(key, {
      source, openedFingerprint: edit?.fingerprint ?? 'absent', operatorId: gate.operatorId, ...(createClass ? { createClass: true } : {})
    });
    return done(gate, key, { kind: result.kind, version: result.version, storedSource: result.storedSource }, result);
  });

  server.registerTool('psft_save_text_definition', {
    title: 'Save an SQL, HTML or style sheet definition',
    description:
      'Save the text of an SQL definition (type 30, a plain SQL object), an HTML definition (51) or a freeform style sheet (50); ' +
      'one that does not exist is created. HTML and style sheets take an optional new description (at most 30). ' + GATES,
    inputSchema: z.object({
      connection: z.string().min(1), type: z.union([z.literal(30), z.literal(50), z.literal(51)]), name: z.string().min(1),
      text: z.string(), description: z.string().max(30).optional()
    }),
    annotations: WRITE
  }, async ({ connection, type, name, text, description }) => {
    // Keyed as the editors key them: an HTML definition by name and content type 4 (the type it is saved as).
    const key: DefinitionKey = type === DefinitionType.HtmlDefinition
      ? { type: DefinitionType.HtmlDefinition, parts: [name.trim().toUpperCase(), '4'] }
      : { type: type as DefinitionType, parts: [name.trim().toUpperCase()] };
    const gate = await writable(workspace, host, connection, key.parts[0]);
    if (!workspace.isSqlWritable(gate.provider.id, key)) throw new Error(`${displayName(key)} cannot be saved on ${gate.provider.displayName}.`);
    const p = gate.provider;
    if (key.type === DefinitionType.SqlDefinition) {
      const edit = await p.readSqlForEdit(key);
      if (!edit && await p.sqlIdTaken(key.parts[0])) throw new Error(`${key.parts[0]} is not a plain SQL definition; it is saved with its record or program.`);
      await approve(host, gate, key, `${edit ? 'save' : 'create'} SQL ${key.parts[0]}`, textChangeSummary(edit?.text ?? '', text));
      const r = await p.saveSqlDefinition({ sqlId: key.parts[0], text, operatorId: gate.operatorId, ...(edit ? { openedVersion: edit.version } : {}) });
      return done(gate, key, { version: r.version, created: r.created });
    }
    const edit = key.type === DefinitionType.StyleSheet ? await p.readStyleSheetForEdit(key) : await p.readHtmlForEdit(key);
    if (edit === 'classic') throw new Error(`${key.parts[0]} is a classic style sheet; only freeform style sheets are saved.`);
    const what = key.type === DefinitionType.StyleSheet ? 'style sheet' : 'HTML';
    await approve(host, gate, key, `${edit ? 'save' : 'create'} ${what} ${key.parts[0]}`,
      textChangeSummary(edit?.text ?? '', text) + (description !== undefined ? `\nDescription: ${description}` : ''));
    const request = { name: key.parts[0], text, operatorId: gate.operatorId, ...(edit ? { openedVersion: edit.version } : {}),
      ...(description !== undefined ? { description } : {}) };
    const r = key.type === DefinitionType.StyleSheet ? await p.saveStyleSheet(request) : await p.saveHtmlDefinition(request);
    return done(gate, key, { version: r.version, created: r.created });
  });

  server.registerTool('psft_get_page_layout', {
    title: 'Read a page layout',
    description:
      'A page as the Page Designer sees it: each control with its id (PNLFLDID, what psft_edit_page takes), type, ' +
      'rectangle in pixels (right/bottom 0 = auto-sized), label, record field and use, plus the page properties and size.',
    inputSchema: z.object({ connection: z.string().min(1), page: z.string().min(1) }),
    annotations: READ_ONLY
  }, async ({ connection, page }) => {
    const provider = await requireProvider(workspace, connection);
    if (!(provider instanceof DatabaseProvider)) throw new Error(`${provider.displayName} is not a database connection.`);
    const { layout } = await provider.readPageLayout({ type: DefinitionType.Page, parts: [page.trim().toUpperCase()] });
    return jsonResult(pageLayoutForAgent(layout));
  });

  server.registerTool('psft_edit_page', {
    title: 'Edit a page',
    description:
      'Apply operations to a page and save it as App Designer does: add a control (Frame, Group Box, Horizontal Rule, ' +
      'Static Text, or a Check Box / Drop Down / Edit Box / Push Button on a record field), move, resize, relabel, ' +
      'set Display Only / Invisible, delete (by the ids psft_get_page_layout gives), and set the page Description, ' +
      'Comments, size, Owner ID, style sheet, background, deferred processing, Adjust Layout for Hidden Fields, popup menu, ' +
      'the page type with a secondary page\'s OK & Cancel, Close Box and Disable Modal, ' +
      'Fluid Page, and the Fluid tab\'s style classes and Suppress System-Specific Style Classes. Coordinates are pixels from the page\'s top-left. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), page: z.string().min(1), operations: z.array(pageOperation).min(1) }),
    annotations: WRITE
  }, async ({ connection, page, operations }) => {
    const key: DefinitionKey = { type: DefinitionType.Page, parts: [page.trim().toUpperCase()] };
    const gate = await writable(workspace, host, connection, key.parts[0]);
    const { layout } = await gate.provider.readPageLayout(key);
    const { controls, properties } = applyPageOperations(layout, operations as PageOperation[]);
    await approve(host, gate, key, `edit page ${key.parts[0]}`,
      `${operations.length} change${operations.length === 1 ? '' : 's'}:\n${operations.map((o) => describeOperation(o)).join('\n')}`);
    const r = await gate.provider.savePage({ pnlName: key.parts[0], openedVersion: layout.version, operatorId: gate.operatorId, controls, properties });
    return done(gate, key, { version: r.version, controls: r.fieldCount, inserted: r.inserted, updated: r.updated, deleted: r.deleted });
  });

  server.registerTool('psft_edit_record', {
    title: 'Edit a record',
    description:
      'Apply operations to a record definition and save it as App Designer does: insert, remove or move fields ' +
      '(by name), insert a subrecord, set a field\'s Use (key, search key, list box ...), Edits (required, prompt ' +
      'table, translate, yes/no), default, label; set Record Properties or the record type. The rules App Designer ' +
      'keeps (Search Key needs Key, observed type changes only ...) are enforced. Read it with psft_get_definition ' +
      '(type 0) first. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), record: z.string().min(1), operations: z.array(recordOperation).min(1) }),
    annotations: WRITE
  }, async ({ connection, record, operations }) => {
    const key: DefinitionKey = { type: DefinitionType.Record, parts: [record.trim().toUpperCase()] };
    const gate = await writable(workspace, host, connection, key.parts[0]);
    const layout = await gate.provider.readRecordLayout(key);
    if (!layout) throw new Error(`There is no record named ${key.parts[0]} on ${gate.provider.displayName}.`);
    const refusal = layoutEditRefusal(layout);
    if (refusal) throw new Error(refusal);
    const state = applyRecordOperations({
      recname: layout.name, recordType: layout.recordType, openedVersion: layout.version,
      fields: layout.fields.map((f) => ({ name: f.name, useEdit: f.useEdit, useEdit2: f.useEdit2 ?? 0, isNew: false, ...(f.isSubrecord ? { isSubrecord: true } : {}) }))
    }, layout.recordType, operations as RecordOperation[]);
    await approve(host, gate, key, `edit record ${key.parts[0]}`,
      `${operations.length} change${operations.length === 1 ? '' : 's'}:\n${operations.map((o) => describeOperation(o)).join('\n')}`);
    const r = await gate.provider.saveRecord({ edit: state, operatorId: gate.operatorId });
    return done(gate, key, { version: r.version, languageReferrers: r.languageReferrers });
  });

  server.registerTool('psft_delete_record', {
    title: 'Delete a record definition',
    description: 'Delete a record definition from the database, as App Designer\'s Delete does. Cannot be undone from here. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), record: z.string().min(1) }),
    annotations: DESTRUCTIVE
  }, async ({ connection, record }) => {
    const key: DefinitionKey = { type: DefinitionType.Record, parts: [record.trim().toUpperCase()] };
    const gate = await writable(workspace, host, connection, key.parts[0]);
    const layout = await gate.provider.readRecordLayout(key);
    if (!layout || layout.version === 0) throw new Error(`There is no record named ${key.parts[0]} on ${gate.provider.displayName}.`);
    await approve(host, gate, key, `DELETE record ${key.parts[0]}`, `The record definition ${key.parts[0]} (${layout.fields.length} fields) will be deleted.`);
    const r = await gate.provider.deleteRecord({ recname: key.parts[0], openedVersion: layout.version, operatorId: gate.operatorId });
    return done(gate, key, { deleted: true, version: r.version });
  });

  server.registerTool('psft_create_field', {
    title: 'Create a field',
    description: 'Create a field definition (PSDBFIELD) with its default label, as App Designer does. ' + GATES,
    inputSchema: z.object({
      connection: z.string().min(1), name: z.string().min(1),
      type: z.enum(['character', 'longCharacter', 'number', 'signedNumber', 'date', 'time', 'dateTime', 'imageReference']),
      length: z.number().int(), decimalPositions: z.number().int().default(0),
      longName: z.string().min(1).max(30), shortName: z.string().min(1).max(15)
    }),
    annotations: WRITE
  }, async ({ connection, name, type, length, decimalPositions, longName, shortName }) => {
    const field = name.trim().toUpperCase();
    const key: DefinitionKey = { type: DefinitionType.Field, parts: [field] };
    const request = { name: field, type: FIELD_TYPES[type], length, decimalPositions, label: { id: field, longName, shortName } };
    const refusal = fieldCreateRefusal(request);
    if (refusal) throw new Error(refusal);
    const gate = await writable(workspace, host, connection, field);
    await approve(host, gate, key, `create field ${field}`, `${type}, length ${length}${decimalPositions ? `, ${decimalPositions} decimals` : ''}; label "${longName}" / "${shortName}".`);
    const r = await gate.provider.createField({ ...request, operatorId: gate.operatorId });
    return done(gate, key, { version: r.version });
  });

  server.registerTool('psft_edit_field', {
    title: 'Edit a field',
    description:
      'Change a field definition: its length / decimal positions, Description, and labels (send the whole list as it ' +
      'is to be: id, longName, shortName, isDefault -- exactly one default). Records holding the field take its new ' +
      'version, as App Designer does. ' + GATES,
    inputSchema: z.object({
      connection: z.string().min(1), name: z.string().min(1), length: z.number().int().optional(), decimalPositions: z.number().int().optional(),
      description: z.string().optional(),
      labels: z.array(z.object({ id: z.string().min(1), longName: z.string().max(30), shortName: z.string().max(15), isDefault: z.boolean() })).optional()
    }),
    annotations: WRITE
  }, async ({ connection, name, length, decimalPositions, description, labels }) => {
    const key: DefinitionKey = { type: DefinitionType.Field, parts: [name.trim().toUpperCase()] };
    const gate = await writable(workspace, host, connection, key.parts[0]);
    const field = await gate.provider.readField(key);
    if (!field || field.version === undefined) throw new Error(`There is no field named ${key.parts[0]} on ${gate.provider.displayName}.`);
    const change = {
      ...(length !== undefined ? { length } : {}), ...(decimalPositions !== undefined ? { decimalPositions } : {}),
      ...(description !== undefined ? { description } : {}), ...(labels ? { labels: labels as FieldLabelEdit[] } : {})
    };
    if (Object.keys(change).length === 0) throw new Error('Nothing to change: give length, decimalPositions, description or labels.');
    await approve(host, gate, key, `edit field ${key.parts[0]}`, describeOperation({ op: 'change', ...change }));
    const r = await gate.provider.saveField({ name: key.parts[0], openedVersion: field.version, operatorId: gate.operatorId, ...change });
    return done(gate, key, { version: r.version, records: r.records });
  });

  server.registerTool('psft_edit_translate', {
    title: 'Edit a translate value',
    description: 'Add, change or delete a field\'s translate value (PSXLATITEM), as App Designer\'s Translates tab does. ' + GATES,
    inputSchema: z.object({
      connection: z.string().min(1), field: z.string().min(1), action: z.enum(['add', 'change', 'delete']),
      value: z.string().min(1), effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      status: z.enum(['A', 'I']).default('A'), longName: z.string().max(30).optional(), shortName: z.string().max(10).optional()
    }),
    annotations: WRITE
  }, async ({ connection, field, action, value, effectiveDate, status, longName, shortName }) => {
    const name = field.trim().toUpperCase();
    const key: DefinitionKey = { type: DefinitionType.Field, parts: [name] };
    const gate = await writable(workspace, host, connection, name);
    let change: TranslateChange;
    if (action === 'delete') change = { kind: 'delete', value, effectiveDate };
    else {
      if (!longName || !shortName) throw new Error('add and change need longName and shortName.');
      change = { kind: action, item: { value, effectiveDate, status, longName, shortName } };
    }
    await approve(host, gate, key, `${action} translate value ${value} of ${name}`, describeOperation({ op: action, value, effectiveDate, status, longName, shortName }));
    await gate.provider.saveTranslate(name, change, gate.operatorId);
    return done(gate, key, { action, value });
  });

  server.registerTool('psft_create_project', {
    title: 'Create a project',
    description: 'Create an empty App Designer project. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), project: z.string().min(1) }),
    annotations: WRITE
  }, async ({ connection, project }) => {
    const key: DefinitionKey = { type: DefinitionType.Project, parts: [project.trim().toUpperCase()] };
    const gate = await writable(workspace, host, connection, key.parts[0]);
    await approve(host, gate, key, `create project ${key.parts[0]}`, `A new, empty project ${key.parts[0]}.`);
    const r = await gate.provider.createProject({ project: key.parts[0], operatorId: gate.operatorId });
    return done(gate, key, { version: r.version });
  });

  server.registerTool('psft_add_to_project', {
    title: 'Add definitions to a project',
    description: 'Add definitions (type + key parts, as psft_search_definitions gives them) to a project as items. ' + GATES,
    inputSchema: z.object({
      connection: z.string().min(1), project: z.string().min(1),
      items: z.array(z.object({ type: z.number().int(), parts: z.array(z.string()).min(1) })).min(1)
    }),
    annotations: WRITE
  }, async ({ connection, project, items }) => {
    const key: DefinitionKey = { type: DefinitionType.Project, parts: [project.trim().toUpperCase()] };
    const gate = await writable(workspace, host, connection, key.parts[0]);
    const add = items.map((i) => keyFromInput(i.type, i.parts));
    const openedVersion = await gate.provider.readProjectVersion(key.parts[0]);
    if (openedVersion === undefined) throw new Error(`There is no project named ${key.parts[0]} on ${gate.provider.displayName}.`);
    await approve(host, gate, key, `add ${add.length} item${add.length === 1 ? '' : 's'} to project ${key.parts[0]}`, add.map((k) => `  ${displayName(k)}`).join('\n'));
    const r = await gate.provider.saveProject({ project: key.parts[0], operatorId: gate.operatorId, openedVersion, add });
    return done(gate, key, { version: r.version, added: r.added.length });
  });

  server.registerTool('psft_create_package', {
    title: 'Create an Application Package',
    description: 'Create an empty Application Package; add classes to it with psft_save_peoplecode (type 58). ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), name: z.string().min(1) }),
    annotations: WRITE
  }, async ({ connection, name }) => {
    const key: DefinitionKey = { type: DefinitionType.ApplicationPackage, parts: [name.trim().toUpperCase()] };
    const gate = await writable(workspace, host, connection, key.parts[0]);
    await approve(host, gate, key, `create Application Package ${key.parts[0]}`, `A new, empty package ${key.parts[0]}.`);
    const r = await gate.provider.createPackage({ name: key.parts[0], operatorId: gate.operatorId });
    return done(gate, key, { version: r.version });
  });
}
