/*
 * Drop Zones (docs/CUSTOMIZATION.md): places on a delivered page where a
 * custom subpage can be inserted at runtime, configured with PeopleTools'
 * Configure Drop Zones page (PORTAL_ADMIN.PTCS_SUBPAGE_COMP) instead of
 * modifying the page.
 *
 * What makes a drop zone, as Configure Drop Zones itself finds them
 * (PTCS_SUBPNL_WRK.SEARCH_BTN FieldFormula, GetDZConfigForComponent): a
 * subpage control placing the stub subpage named by PSOPTIONS.PTSTUBSUBPAGE
 * (PT_ERCSUBPAGE_STUB), whose preceding control (FIELDNUM - 1) is a group box
 * of type 21 (PSPNLFIELDEXT.GRPBOXTYPE). The group box is the drop zone: its
 * label names it and its position identifies it. They are searched for on a
 * component's pages and, recursively, the subpages and secondary pages they
 * place. HRDMO: 2162 of 2163 stub placements on 1109 pages are valid.
 *
 * A configured drop zone is Related Content: a service named after the custom
 * subpage (PSPTCSSRVDEFN, URL type UESP), configured on the component's content
 * reference -- or on PT_DZ_UNREGCOMP/<component> when it is not registered --
 * with a PTCS_MENUFIELD map to the drop zone's field name.
 */

/** PSPNLFIELDEXT.GRPBOXTYPE of a group box that marks a drop zone. */
export const DROP_ZONE_GROUP_BOX_TYPE = 21;
/** The portal Configure Drop Zones uses for a component that is not registered as a content reference. */
export const UNREGISTERED_COMPONENT_PORTAL = 'PT_DZ_UNREGCOMP';
/** PSPTCSSRVDEFN.PTCS_SERVICEURLTYP of a drop-zone (embedded subpage) service. */
export const DROP_ZONE_SERVICE_URL_TYPE = 'UESP';

export interface DropZone {
  component: string;
  market: string;
  /** The page the drop zone shows on: the component's page, or the secondary page that holds it. */
  page: string;
  /** The page or subpage the group box is defined on. */
  container: string;
  /** The group box's PNLFLDID and FIELDNUM (its tab order) on the container. */
  groupBoxId: number;
  tabOrder: number;
  level: number;
  record: string;
  field: string;
  /** The group box's label (its text, or its message-catalog text), else REC.FIELD, else the field id. */
  label: string;
  /** "level.record.field.pnlfldid", as Configure Drop Zones keys the drop zone (PTCS_PNLFLDNAME). */
  fieldName: string;
  /** "<component page>.<pnlfldid>.", the drop zone's page-field id. */
  fieldId: string;
  /** The custom subpage configured into it, when one is. */
  subpage?: string;
}

export interface DropZoneDiscovery {
  state: 'VERIFIED_AVAILABLE' | 'VERIFIED_UNAVAILABLE' | 'INDETERMINATE';
  evidence: string[];
  dropZones: DropZone[];
  /** PSOPTIONS.PTSTUBSUBPAGE on this database. */
  stubSubpage: string;
}

/** The key Configure Drop Zones stores for a drop zone: level.record.field.pnlfldid (blank record/field stay empty). */
export const dropZoneFieldName = (level: number, record: string, field: string, groupBoxId: number): string =>
  `${level}.${record.trim()}.${field.trim()}.${groupBoxId}`;

/** A drop zone's label as the Configure Drop Zones grid shows it. */
export function dropZoneLabel(text: string, record: string, field: string, fieldId: string): string {
  if (text.trim()) return text.trim();
  if (record.trim() && field.trim()) return `${record.trim()}.${field.trim()}`;
  return fieldId;
}

/** The discovery's verdict for a component or page, with its evidence. */
export function dropZoneDiscoveryFor(subject: string, zones: DropZone[], stubSubpage: string): DropZoneDiscovery {
  if (!stubSubpage) {
    return { state: 'INDETERMINATE', dropZones: [], stubSubpage, evidence: ['PSOPTIONS names no stub subpage (PTSTUBSUBPAGE): this PeopleTools release may not have Drop Zones.'] };
  }
  if (!zones.length) {
    return {
      state: 'VERIFIED_UNAVAILABLE', dropZones: [], stubSubpage,
      evidence: [`${subject} has no drop zone: no ${stubSubpage} subpage after a drop-zone group box on its pages, their subpages or secondary pages.`,
        'Adding a drop zone to a delivered page is itself a delivered-object customization.']
    };
  }
  const configured = zones.filter((z) => z.subpage).length;
  const pages = new Set(zones.map((z) => z.page)).size;
  return {
    state: 'VERIFIED_AVAILABLE', dropZones: zones, stubSubpage,
    evidence: [
      `${zones.length} drop zone${zones.length === 1 ? '' : 's'} on ${pages} page${pages === 1 ? '' : 's'} of ${subject}.`,
      configured ? `${configured} configured with a custom subpage.` : 'None configured with a custom subpage yet.'
    ]
  };
}
