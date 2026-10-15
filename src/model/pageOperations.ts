import type { PageLayout } from './pageLayout.js';
import { FIELD_USE_DISPLAY_ONLY, FIELD_USE_INVISIBLE } from './pageLayout.js';
import { pageUseRefusal } from './pageUse.js';
import { NEW_CONTROL_FIELDTYPE, NEW_CONTROL_FIELDUSE, NEW_CONTROL_SIZE, type NewControlKind } from '../providers/pageControlTemplates.js';
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
  | { op: 'add'; kind: NewControlKind; left: number; top: number; width?: number; height?: number; record?: string; field?: string; label?: string;
      page?: string; intoGrid?: number; treeLevels?: Array<{ record: string; field: string }>; model?: string; collection?: string; axes?: Array<{ field: string; axis: number }>;
      groupBoxType?: number }
  | { op: 'move'; id: number; left: number; top: number }
  | { op: 'resize'; id: number; width: number; height: number }
  | { op: 'set_label'; id: number; text?: string; labelType?: number }
  | { op: 'set_use'; id: number; displayOnly?: boolean; invisible?: boolean }
  | { op: 'delete'; id: number }
  /** A Scroll Bar's, Grid's or Scroll Area's own Occurs Level (1-3): the controls after it in tab order are at it. */
  | { op: 'set_occurs_level'; id: number; level: number }
  /** A Horizontal Rule's Set to Level: the controls after it are at `level`; null clears it (the rule then takes the running level). */
  | { op: 'set_level'; id: number; level: number | null }
  /** The tab order (the Order tab): every stored control's id, first to last; added controls go where App Designer puts them. */
  | { op: 'set_order'; order: number[] }
  | { op: 'set_properties'; description?: string; comments?: string; width?: number; height?: number;
      ownerId?: string; styleSheet?: string; background?: string; deferProc?: boolean; adjustLayout?: boolean; popupMenu?: string;
      pageType?: number; pageSize?: string; okCancel?: boolean; closeBox?: boolean; disableModal?: boolean;
      fluidPage?: boolean; styleClasses?: string; small?: string; medium?: string; large?: string; extraLarge?: string; suppressClasses?: boolean };

export class PageOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PageOperationError';
  }
}

/** The controls and properties a savePage request carries after applying the operations, in order. */
export function applyPageOperations(layout: PageLayout, operations: readonly PageOperation[]): { controls: EditedControl[]; properties: EditedPageProperties; order?: number[] } {
  const controls: EditedControl[] = layout.controls.map((c) => ({ pnlFldId: c.pnlFldId, ...c.columns, fieldType: c.type,
    // A scroll's own Occurs Level and a Set to Level rule's choice; the save assigns the rest from the tab order.
    ...(SCROLL_TYPES.has(c.type) || (c.type === 23 && (c.columns.fieldUse & 0x2)) ? { occursLevel: c.level } : {}) }));
  let order: number[] | undefined;
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
          // A grid column keeps App Designer's size type with its width (gd-column, ag-fresh: 0).
          fieldSizeType: sized && !z.width && o.intoGrid === undefined ? 2 : z.fieldSizeType, lblType: z.lblType, lblText: o.label ?? '',
          // The kind's own use bits, as App Designer drops it: a Static Image display only (in01), a Scroll Bar or Secondary Page
          // invisible (lv03, sp-fresh), a Grid 0x1000 (gd-fresh), an Analytic Grid display only (ag-fresh).
          fieldUse: NEW_CONTROL_FIELDUSE[o.kind] ?? 0, secureInvisible: (NEW_CONTROL_FIELDUSE[o.kind] ?? 0) & 0x2 ? 1 : 0,
          // A Group Box's Fluid Group Box Type (PSPNLFIELDEXT.GRPBOXTYPE): 21 Related Content marks a drop zone (model/dropZones.ts).
          ...(o.kind === 'groupBox' && o.groupBoxType !== undefined ? { groupBoxType: whole(o.groupBoxType, 'groupBoxType') } : {}),
          add: { kind: o.kind, recName: (o.record ?? '').trim().toUpperCase(), fieldName: (o.field ?? '').trim().toUpperCase(),
            ...(o.page ? { subPage: o.page.trim().toUpperCase() } : {}),
            // A grid added earlier in these operations is named by its negative position (-1 the first added control).
            ...(o.intoGrid !== undefined ? { intoGrid: whole(o.intoGrid, 'intoGrid') } : {}),
            ...(o.treeLevels ? { treeLevels: o.treeLevels.map((l) => ({ recName: l.record.trim().toUpperCase(), fieldName: l.field.trim().toUpperCase() })) } : {}),
            ...(o.kind === 'analyticGrid' ? { analytic: { model: (o.model ?? '').trim().toUpperCase(), collection: (o.collection ?? '').trim().toUpperCase(),
              ...(o.axes ? { axes: o.axes.map((x) => ({ fieldName: x.field.trim().toUpperCase(), axis: x.axis })) } : {}) } } : {}) }
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
        const refusal = pageUseRefusal(c.add ? NEW_CONTROL_FIELDTYPE[c.add.kind] : c.fieldType, c.fieldUse, c.secureInvisible);
        if (refusal) throw new PageOperationError(refusal);
        break;
      }
      case 'delete': {
        const c = find(o.id);
        controls.splice(controls.indexOf(c), 1);
        if (order) order = order.filter((id) => id !== o.id);
        break;
      }
      case 'set_occurs_level': {
        const c = find(o.id);
        if (!SCROLL_TYPES.has(Number(c.fieldType))) throw new PageOperationError(`Control ${o.id} is not a Scroll Bar, Grid or Scroll Area.`);
        if (!Number.isInteger(o.level) || o.level < 1 || o.level > 3) throw new PageOperationError('Level number must be between 1 and 3.');
        c.occursLevel = o.level;
        break;
      }
      case 'set_level': {
        const c = find(o.id);
        if (c.fieldType !== 23) throw new PageOperationError(`Control ${o.id} is not a Horizontal Rule.`);
        if (o.level === null) { c.fieldUse &= ~0x2; c.secureInvisible = 0; delete c.occursLevel; break; }
        if (!Number.isInteger(o.level) || o.level < 0 || o.level > 2) throw new PageOperationError('A rule sets the level to 0, 1 or 2.');
        // Set to Level: FIELDUSE 0x2 with SECUREINVISIBLE 1, the level as the rule's OCCURSLEVEL and PT_NUMFLD1 (lv06).
        c.fieldUse |= 0x2; c.secureInvisible = 1; c.occursLevel = o.level; c.setLevel = o.level;
        break;
      }
      case 'set_order': {
        const stored = layout.controls.map((x) => x.pnlFldId).filter((id) => controls.some((x) => x.pnlFldId === id));
        if (o.order.length !== stored.length || new Set(o.order).size !== o.order.length || o.order.some((id) => !stored.includes(id))) {
          throw new PageOperationError(`set_order lists every control on the page once, by id: ${stored.join(', ')}.`);
        }
        order = [...o.order];
        break;
      }
      case 'set_properties': {
        if (o.description !== undefined) properties.description = o.description;
        if (o.comments !== undefined) properties.comments = o.comments;
        for (const k of ['ownerId', 'styleSheet', 'background', 'popupMenu'] as const) if (o[k] !== undefined) properties[k] = o[k];
        if (o.deferProc !== undefined) properties.deferProc = o.deferProc;
        if (o.adjustLayout !== undefined) properties.adjustLayout = o.adjustLayout;
        for (const k of ['okCancel', 'closeBox', 'disableModal'] as const) if (o[k] !== undefined) properties[k] = o[k];
        if (o.pageType !== undefined) properties.pageType = o.pageType;
        if (o.pageSize !== undefined) properties.pageSize = o.pageSize;
        if (o.fluidPage !== undefined) properties.fluidPage = o.fluidPage;
        if (o.suppressClasses !== undefined) properties.suppressClasses = o.suppressClasses;
        for (const k of ['styleClasses', 'small', 'medium', 'large', 'extraLarge'] as const) if (o[k] !== undefined) properties.fluid = { ...properties.fluid, [k]: o[k] };
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
  return { controls, properties, ...(order ? { order } : {}) };
}

const SCROLL_TYPES = new Set([10, 19, 27, 32]);

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
      displayOnly: c.displayOnly, invisible: c.invisible,
      ...(c.type === 0 ? { useNote: 'Static Text does not support Display Only or Invisible.' } : {})
    }))
  };
}
