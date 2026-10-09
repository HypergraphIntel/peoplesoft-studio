import type { PageLayout } from './pageLayout.js';
import { FIELD_USE_DISPLAY_ONLY, FIELD_USE_INVISIBLE } from './pageLayout.js';
import { NEW_CONTROL_SIZE, type NewControlKind } from '../providers/pageControlTemplates.js';
import type { EditedControl, EditedPageProperties } from '../providers/pageWriter.js';

/*
 * Page edits as a list of operations -- what the MCP's psft_edit_page takes --
 * turned into the save the Layout editor would send for the same gestures
 * (pageWriter.ts savePage). The geometry rules are the editor's: a move
 * shifts FIELDRIGHT / BOTTOM of a sized control and a stored (absolute) label
 * rectangle by the same amount, leaving an all-zero (relative) or negative
 * (hidden) label alone; a resize sets RIGHT / BOTTOM and FIELDSIZETYPE 2.
 */

export type PageOperation =
  | { op: 'add'; kind: NewControlKind; left: number; top: number; width?: number; height?: number; record?: string; field?: string; label?: string }
  | { op: 'move'; id: number; left: number; top: number }
  | { op: 'resize'; id: number; width: number; height: number }
  | { op: 'set_label'; id: number; text?: string; labelType?: number }
  | { op: 'set_use'; id: number; displayOnly?: boolean; invisible?: boolean }
  | { op: 'delete'; id: number }
  | { op: 'set_properties'; description?: string; comments?: string; width?: number; height?: number };

export class PageOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PageOperationError';
  }
}

/** The controls and properties a savePage request carries after applying the operations, in order. */
export function applyPageOperations(layout: PageLayout, operations: readonly PageOperation[]): { controls: EditedControl[]; properties: EditedPageProperties } {
  const controls: EditedControl[] = layout.controls.map((c) => ({ pnlFldId: c.pnlFldId, ...c.columns }));
  const p = layout.properties;
  const properties: EditedPageProperties = { description: p.description, comments: p.comments };
  let added = 0;
  const find = (id: number): EditedControl => {
    const c = controls.find((x) => x.pnlFldId === id);
    if (!c) throw new PageOperationError(`There is no control with id ${id} on ${layout.name} (psft_get_page_layout lists them).`);
    return c;
  };
  const whole = (n: number, what: string) => {
    if (!Number.isFinite(n)) throw new PageOperationError(`${what} must be a number.`);
    return Math.round(n);
  };

  for (const o of operations) {
    switch (o.op) {
      case 'add': {
        const z = NEW_CONTROL_SIZE[o.kind];
        if (!z) throw new PageOperationError(`Unknown control kind ${String(o.kind)}.`);
        const left = whole(o.left, 'left'), top = whole(o.top, 'top');
        const width = o.width !== undefined ? whole(o.width, 'width') : z.width;
        const height = o.height !== undefined ? whole(o.height, 'height') : z.height;
        const sized = o.width !== undefined || o.height !== undefined;
        controls.push({
          pnlFldId: -(++added), fieldLeft: left, fieldTop: top,
          fieldRight: width ? left + width : 0, fieldBottom: height ? top + height : 0,
          editLblLeft: 0, editLblTop: 0, editLblRight: 0, editLblBottom: 0,
          // An explicit size on an auto-sized kind is a custom size, as a resize makes it.
          fieldSizeType: sized && !z.width ? 2 : z.fieldSizeType, lblType: z.lblType, lblText: o.label ?? '',
          fieldUse: 0, secureInvisible: 0,
          add: { kind: o.kind, recName: (o.record ?? '').trim().toUpperCase(), fieldName: (o.field ?? '').trim().toUpperCase() }
        });
        break;
      }
      case 'move': {
        const c = find(o.id);
        const dx = whole(o.left, 'left') - c.fieldLeft, dy = whole(o.top, 'top') - c.fieldTop;
        c.fieldLeft += dx; c.fieldTop += dy;
        if (c.fieldRight) c.fieldRight += dx;
        if (c.fieldBottom) c.fieldBottom += dy;
        const lr = [c.editLblLeft, c.editLblTop, c.editLblRight, c.editLblBottom];
        if (lr.some((v) => v !== 0) && lr.every((v) => v >= 0)) {
          c.editLblLeft += dx; c.editLblTop += dy; c.editLblRight += dx; c.editLblBottom += dy;
        }
        break;
      }
      case 'resize': {
        const c = find(o.id);
        const w = whole(o.width, 'width'), h = whole(o.height, 'height');
        if (w < 1 || h < 1) throw new PageOperationError('A control is at least 1 x 1.');
        c.fieldRight = c.fieldLeft + w; c.fieldBottom = c.fieldTop + h; c.fieldSizeType = 2;
        break;
      }
      case 'set_label': {
        const c = find(o.id);
        if (o.labelType !== undefined) {
          if (![0, 1, 2, 3].includes(o.labelType)) throw new PageOperationError('labelType is 0 None, 1 Text, 2 RFT Short or 3 RFT Long.');
          c.lblType = o.labelType;
        }
        if (o.text !== undefined) c.lblText = o.text;
        break;
      }
      case 'set_use': {
        const c = find(o.id);
        if (o.displayOnly !== undefined) c.fieldUse = o.displayOnly ? c.fieldUse | FIELD_USE_DISPLAY_ONLY : c.fieldUse & ~FIELD_USE_DISPLAY_ONLY;
        if (o.invisible !== undefined) {
          c.fieldUse = o.invisible ? c.fieldUse | FIELD_USE_INVISIBLE : c.fieldUse & ~FIELD_USE_INVISIBLE;
          c.secureInvisible = o.invisible ? 1 : 0;
        }
        break;
      }
      case 'delete': {
        const c = find(o.id);
        controls.splice(controls.indexOf(c), 1);
        break;
      }
      case 'set_properties': {
        if (o.description !== undefined) properties.description = o.description;
        if (o.comments !== undefined) properties.comments = o.comments;
        if (o.width !== undefined || o.height !== undefined) {
          properties.sizeWidth = whole(o.width ?? properties.sizeWidth ?? p.sizeWidth, 'width');
          properties.sizeHeight = whole(o.height ?? properties.sizeHeight ?? p.sizeHeight, 'height');
        }
        break;
      }
      default:
        throw new PageOperationError(`Unknown page operation ${JSON.stringify((o as { op?: unknown }).op)}.`);
    }
  }
  return { controls, properties };
}

/** A page's layout as plain data for an agent: the controls with their ids, rectangles and settings, and the page's properties. */
export function pageLayoutForAgent(layout: PageLayout): Record<string, unknown> {
  return {
    page: layout.name,
    version: layout.version,
    properties: layout.properties,
    controls: layout.controls.map((c) => ({
      id: c.pnlFldId, order: c.num, level: c.level, type: c.typeName, fieldType: c.type,
      left: c.columns.fieldLeft, top: c.columns.fieldTop, right: c.columns.fieldRight, bottom: c.columns.fieldBottom,
      autoSized: c.columns.fieldRight === 0 && c.columns.fieldBottom === 0,
      labelType: c.columns.lblType, label: c.columns.lblText,
      ...(c.recName ? { record: c.recName } : {}), ...(c.fieldName ? { field: c.fieldName } : {}),
      ...(c.pageFieldName ? { pageFieldName: c.pageFieldName } : {}),
      displayOnly: c.displayOnly, invisible: c.invisible
    }))
  };
}
