import * as z from 'zod/v4';
import {
  DELIMITER_TYPES, deleteField, deleteSegment, FIELD_TYPES, FileLayoutEditError, FORMAT_NAMES, insertField, insertRecord, insertSegment, moveField, moveSegment,
  segmentEnd, setFieldProperties, setLayoutProperties, setSegmentProperties, stripCharacters, type FileLayoutDocument, type RecordFieldInfo
} from './fileLayoutDocument.js';

/*
 * File Layout edits as operations -- what the designer's Insert menu, property
 * dialogs, Delete and move buttons do (fileLayoutDocument.ts) -- for the MCP and
 * the designer webview, and the layout as a readable view.
 */

const n = (v: unknown) => Number(v ?? 0) || 0;
const s = (v: unknown) => String(v ?? '').trim();
const flag = (v: unknown) => n(v) === 1;

/** A layout as its window shows it: options by their dialog labels, segments as a tree, fields with type names. */
export function fileLayoutView(doc: FileLayoutDocument) {
  const v = doc.v;
  return {
    name: doc.name,
    format: FORMAT_NAMES[n(v.FLDFORMAT)] ?? `Type ${n(v.FLDFORMAT)}`,
    description: s(v.DESCR), comments: v.DESCRLONG === null || v.DESCRLONG === undefined ? '' : String(v.DESCRLONG),
    definitionTag: s(v.FLDTAG), bufferSize: n(v.FLDXMLBUFFSIZE), fileName: s(v.FLDFILENAME), qualifier: s(v.FLDQUALIFIER), delimiter: s(v.FLDDELIMITER),
    implyDecimal: flag(v.FLDIMPLYDECIMAL), excelFormat: flag(v.FLDEXCELFORMAT), qualifierOptional: flag(v.FLDQUALIFIEROPT), convertTabs: flag(v.FLDCONVERTTABS),
    interpretBackslash: flag(v.FLDINTRPBACKSLASH), stripWhiteSpace: flag(v.FLDSTRIPSPACE), backslashQuote: flag(v.FLDEMBQUOTEFMT),
    segments: doc.segments.map((g) => ({
      name: g.name, parent: g.parent || null,
      recordId: s(g.v.FLDSEGID), idStart: n(g.v.FLDSEGIDSTART), idLength: n(g.v.FLDSEGIDLENGTH), idSeqNo: n(g.v.FLDIDSEQNO), maxRecordLength: n(g.v.FLDMAXSEGLEN),
      qualifier: s(g.v.FLDQUALIFIER), delimiterType: DELIMITER_TYPES[n(g.v.FLDDELIMITERTYPE)] ?? `Type ${n(g.v.FLDDELIMITERTYPE)}`, delimiter: String(g.v.FLDDELIMITER ?? ''),
      terminator: s(g.v.PTFLDSEGTERM), tag: s(g.v.FLDTAG), description: s(g.v.DESCR100), fieldsEnd: segmentEnd(g),
      fields: g.fields.map((f) => ({
        name: f.name, type: FIELD_TYPES[n(f.v.FLDFIELDTYPE)] ?? `Type ${n(f.v.FLDFIELDTYPE)}`, start: n(f.v.FLDSTART), length: n(f.v.FLDLENGTH),
        decimals: n(f.v.DECIMAL_POS), qualifier: s(f.v.FLDQUALIFIER), tag: s(f.v.FLDTAG), dateFormat: s(f.v.FLDDATEFMT), dateSeparator: s(f.v.FLDDATESEPARATOR),
        stripCharacters: stripCharacters(f.v.FLDSTRIPCHAR), defaultValue: s(f.v.FLDFIELDDFLT), description: s(f.v.DESCR100),
        trimSpaces: flag(f.v.FLDTRIMSPACES), upperCase: flag(f.v.FLDUPPER), padField: flag(f.v.PTFLDPADFIELD)
      }))
    }))
  };
}

const fieldType = z.enum(['Character', 'Long Character', 'Number', 'Signed Number', 'Date', 'Time', 'Datetime']);
const TYPE_CODE: Record<string, number> = Object.fromEntries(Object.entries(FIELD_TYPES).map(([k, v]) => [v, Number(k)]));

export const layoutProperties = z.object({
  description: z.string().max(30).optional(), comments: z.string().optional(),
  format: z.enum(['FIXED', 'CSV', 'XML']).optional().describe('Choosing CSV sets the definition qualifier " and delimiter , ; XML the delimiter , (as the dialog does).'),
  fileName: z.string().optional(), definitionTag: z.string().optional(), bufferSize: z.number().int().min(0).optional().describe('XML only.'),
  implyDecimal: z.boolean().optional(), excelFormat: z.boolean().optional(), qualifierOptional: z.boolean().optional(), convertTabs: z.boolean().optional(),
  interpretBackslash: z.boolean().optional(), stripWhiteSpace: z.boolean().optional(), backslashQuote: z.boolean().optional()
}).strict();

export const segmentProperties = z.object({
  recordId: z.string().optional().describe('File Record ID: the value identifying this segment\'s lines in a multi-segment file.'),
  idStart: z.number().int().min(0).optional(), idLength: z.number().int().min(0).optional(), idSeqNo: z.number().int().min(0).optional(),
  maxRecordLength: z.number().int().min(0).optional(), qualifier: z.string().max(1).optional().describe('Default Qualifier; every field of the segment takes it.'),
  terminator: z.string().optional(), delimiter: z.enum(['Comma', 'Semicolon', 'Tab', 'Space', 'Other']).optional(), otherDelimiter: z.string().max(1).optional(),
  description: z.string().optional(),
  shiftStarts: z.number().int().optional().describe('App Designer\'s "Increment start positions for all fields?" Yes after setting a record ID: add this to every field\'s start.')
}).strict();

export const fieldProperties = z.object({
  name: z.string().optional(), start: z.number().int().min(0).optional(), length: z.number().int().min(0).optional(), type: fieldType.optional(),
  decimals: z.number().int().min(0).optional(), qualifier: z.string().max(1).optional(), tag: z.string().optional(),
  stripCharacters: z.string().optional(), defaultValue: z.string().optional(), description: z.string().optional(), dateFormat: z.string().optional(),
  dateSeparator: z.string().max(1).optional(), trimSpaces: z.boolean().optional(), upperCase: z.boolean().optional(), padField: z.boolean().optional(),
  propagate: z.number().int().optional().describe('FIXED: move this field\'s start and every later field\'s by this many positions (the dialog\'s Propagate).')
}).strict();

const segRef = z.string().min(1).describe('Segment name.');
export const fileLayoutOperation = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_layout'), properties: layoutProperties }).strict(),
  z.object({ op: z.literal('insert_record'), record: z.string().min(1), parent: segRef.optional().describe('Insert as a child segment of this one.'),
    after: segRef.optional().describe('Place after this sibling segment.') }).strict()
    .describe('Insert > Record: a segment named after the record, every record field at consecutive positions with the record\'s type, length and decimals.'),
  z.object({ op: z.literal('insert_segment'), name: z.string().min(1), parent: segRef.optional(), after: segRef.optional() }).strict()
    .describe('Insert > Segment (or ChildSegment with parent): an empty segment for file fields.'),
  z.object({ op: z.literal('set_segment'), segment: segRef, properties: segmentProperties }).strict(),
  z.object({ op: z.literal('delete_segment'), segment: segRef }).strict().describe('Deletes the segment with its child segments and fields.'),
  z.object({ op: z.literal('move_segment'), segment: segRef, by: z.union([z.literal(-1), z.literal(1)]) }).strict(),
  z.object({ op: z.literal('insert_field'), segment: segRef, name: z.string().min(1), type: fieldType.default('Character'), length: z.number().int().min(0),
    decimals: z.number().int().min(0).default(0), after: z.string().optional().describe('Place after this field (last when omitted).'),
    properties: fieldProperties.optional() }).strict()
    .describe('Insert > FileField: a field not from a record; FIXED: it starts after the segment\'s last position unless properties.start says otherwise.'),
  z.object({ op: z.literal('set_field'), segment: segRef, field: z.string().min(1), properties: fieldProperties }).strict(),
  z.object({ op: z.literal('delete_field'), segment: segRef, field: z.string().min(1) }).strict(),
  z.object({ op: z.literal('move_field'), segment: segRef, field: z.string().min(1), by: z.union([z.literal(-1), z.literal(1)]) }).strict()
]);
export type FileLayoutOperation = z.infer<typeof fileLayoutOperation>;

/** Record fields for insert_record; the caller reads them (PSRECFIELDDB / PSDBFIELD). */
export type RecordLookup = (record: string) => Promise<RecordFieldInfo[]>;

const DELIMITER_CODE: Record<string, number> = { Comma: 0, Semicolon: 1, Tab: 2, Space: 3, Other: 4 };

/** Applies operations in order to the document (changed in place); a record that does not exist is refused. */
export async function applyFileLayoutOperations(doc: FileLayoutDocument, ops: FileLayoutOperation[], records: RecordLookup): Promise<string[]> {
  const done: string[] = [];
  for (const op of ops) {
    switch (op.op) {
      case 'set_layout': {
        const p = op.properties;
        setLayoutProperties(doc, { ...p, format: p.format === undefined ? undefined : ({ FIXED: 0, CSV: 1, XML: 2 } as const)[p.format] });
        done.push(`layout: ${Object.keys(p).join(', ')}`);
        break;
      }
      case 'insert_record': {
        const fields = await records(op.record.trim().toUpperCase());
        if (!fields.length) throw new FileLayoutEditError(`There is no record ${op.record} (or it has no fields).`);
        const seg = insertRecord(doc, op.record, fields, { parent: op.parent, after: op.after });
        done.push(`insert record ${seg.name} (${seg.fields.length} fields)`);
        break;
      }
      case 'insert_segment': insertSegment(doc, op.name, { parent: op.parent, after: op.after }); done.push(`insert segment ${op.name.toUpperCase()}`); break;
      case 'set_segment': {
        const { delimiter, otherDelimiter, ...rest } = op.properties;
        setSegmentProperties(doc, op.segment, { ...rest, ...(delimiter ? { delimiterType: DELIMITER_CODE[delimiter], delimiter: otherDelimiter } : otherDelimiter ? { delimiter: otherDelimiter } : {}) });
        done.push(`segment ${op.segment.toUpperCase()}: ${Object.keys(op.properties).join(', ')}`);
        break;
      }
      case 'delete_segment': deleteSegment(doc, op.segment); done.push(`delete segment ${op.segment.toUpperCase()}`); break;
      case 'move_segment': moveSegment(doc, op.segment, op.by); done.push(`move segment ${op.segment.toUpperCase()} ${op.by < 0 ? 'up' : 'down'}`); break;
      case 'insert_field': {
        const f = insertField(doc, op.segment, op.name, { type: TYPE_CODE[op.type], length: op.length, decimals: op.decimals, after: op.after });
        if (op.properties) setFieldProperties(doc, op.segment, f.name, { ...op.properties, type: op.properties.type ? TYPE_CODE[op.properties.type] : undefined });
        done.push(`insert field ${op.segment.toUpperCase()}.${f.name}`);
        break;
      }
      case 'set_field': {
        const p = op.properties;
        setFieldProperties(doc, op.segment, op.field, { ...p, type: p.type ? TYPE_CODE[p.type] : undefined });
        done.push(`field ${op.segment.toUpperCase()}.${op.field.toUpperCase()}: ${Object.keys(p).join(', ')}`);
        break;
      }
      case 'delete_field': deleteField(doc, op.segment, op.field); done.push(`delete field ${op.segment.toUpperCase()}.${op.field.toUpperCase()}`); break;
      case 'move_field': moveField(doc, op.segment, op.field, op.by); done.push(`move field ${op.segment.toUpperCase()}.${op.field.toUpperCase()} ${op.by < 0 ? 'up' : 'down'}`); break;
    }
  }
  return done;
}
