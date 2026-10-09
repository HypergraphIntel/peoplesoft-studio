import { RecordType } from './record.js';
import {
  insertField, insertSubrecord, moveField, removeField, setDefault, setEdits, setLabel, setRecordProperties, setRecordType, setUse,
  RecordSaveRefusedError, type EditType, type RecordEditState, type RecordPropertyEdits, type RecordTypeEdits, type UseChange
} from './recordEdit.js';

/*
 * Record edits as a list of operations -- what the MCP's psft_edit_record
 * takes -- applied with the record editor's own edit functions
 * (recordEdit.ts), so every rule they keep (Search Key needs Key, which
 * record type changes App Designer has been seen to make, name and length
 * limits ...) holds the same. Fields are named, not numbered.
 */

export type RecordOperation =
  | { op: 'insert_field'; field: string; after?: string }
  | { op: 'insert_subrecord'; subrecord: string; after?: string }
  | { op: 'remove_field'; field: string }
  | { op: 'move_field'; field: string; after?: string }
  | ({ op: 'set_use'; field: string } & UseChange)
  | { op: 'set_edits'; field: string; required?: boolean; edit?: EditType; promptTable?: string }
  | { op: 'set_default'; field: string; constant?: string; record?: string; defaultField?: string; clear?: boolean }
  | { op: 'set_label'; field: string; labelId: string }
  | ({ op: 'set_properties' } & Omit<RecordPropertyEdits, 'inMemory'>)
  | ({ op: 'set_type' } & RecordTypeEdits);

/** The edit state after the operations, in order; throws RecordSaveRefusedError with the first refusal. */
export function applyRecordOperations(state: RecordEditState, storedType: RecordType, operations: readonly RecordOperation[]): RecordEditState {
  let s = state;
  const index = (name: string): number => {
    const n = name.trim().toUpperCase();
    const i = s.fields.findIndex((f) => f.name === n);
    if (i < 0) throw new RecordSaveRefusedError(`${n} is not in ${s.recname}.`);
    return i;
  };
  // Inserted after the named field, or at the end.
  const position = (after: string | undefined) => (after ? index(after) + 1 : s.fields.length);

  for (const o of operations) {
    switch (o.op) {
      case 'insert_field': s = insertField(s, o.field, position(o.after)); break;
      case 'insert_subrecord': s = insertSubrecord(s, o.subrecord, position(o.after)); break;
      case 'remove_field': s = removeField(s, index(o.field)); break;
      case 'move_field': {
        const from = index(o.field);
        // After the named field (first when absent), as the list stands without the moved field.
        let to = o.after ? index(o.after) + 1 : 0;
        if (to > from) to -= 1;
        s = moveField(s, from, to);
        break;
      }
      case 'set_use': { const { op: _op, field, ...change } = o; s = setUse(s, index(field), change); break; }
      case 'set_edits': {
        s = setEdits(s, index(o.field), {
          ...(o.required !== undefined ? { required: o.required } : {}), ...(o.edit !== undefined ? { edit: o.edit } : {}),
          ...(o.promptTable !== undefined ? { promptTable: o.promptTable } : {})
        });
        break;
      }
      case 'set_default': {
        const value = o.clear ? null
          : o.constant !== undefined ? { constant: o.constant }
          : o.record !== undefined && o.defaultField !== undefined ? { record: o.record, field: o.defaultField }
          : undefined;
        if (value === undefined) throw new RecordSaveRefusedError('set_default takes constant, record + defaultField, or clear.');
        s = setDefault(s, index(o.field), value);
        break;
      }
      case 'set_label': s = setLabel(s, index(o.field), o.labelId); break;
      case 'set_properties': { const { op: _op, ...change } = o; s = setRecordProperties(s, change); break; }
      case 'set_type': { const { op: _op, ...change } = o; s = setRecordType(s, storedType, change); break; }
      default:
        throw new RecordSaveRefusedError(`Unknown record operation ${JSON.stringify((o as { op?: unknown }).op)}.`);
    }
  }
  return s;
}
