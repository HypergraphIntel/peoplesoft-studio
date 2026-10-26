import type { ComponentDefinition } from '../model/componentDefinition.js';
import { COMPONENT_TYPES, SEARCH_PAGE_TYPES } from '../model/componentFlags.js';
import type { ComponentFluidEdits, ComponentPropertyEdits } from '../providers/componentWriter.js';

/*
 * A component's stored properties as the component writer takes them, and an
 * agent's partial Fluid tab over them (psft_component_create / _edit). Kept
 * free of the VS Code workspace so the tests can replay captures through it.
 */

/** The stored Use/General properties, as the writer takes them (other tabs absent: left as stored). */
export function storedProperties(d: ComponentDefinition): ComponentPropertyEdits {
  const u = d.properties.use;
  return { description: d.properties.general.description, comments: d.properties.general.comments, searchRecord: u.searchRecord, addSearchRecord: u.addSearchRecord,
    detailPage: u.detailPage, forceSearch: u.forceSearch, actions: { ...u.actions }, disableSave: u.disableSave, includeInNavigation: u.includeInNavigation };
}

/** The stored Fluid tab as the writer takes it (Header Toolbar Actions empty: each one not named is left as stored); a new component's without one. */
export function storedFluid(d: ComponentDefinition | undefined): ComponentFluidEdits {
  const f = d?.properties.fluid;
  const code = (c: { label: string } | { code: number } | undefined, labels: Readonly<Record<number, string>>) =>
    !c ? 0 : 'code' in c ? c.code : Number(Object.entries(labels).find(([, l]) => l === c.label)?.[0] ?? 0);
  return { fluidMode: !!f?.fluidMode, layoutOnly: !!f?.layoutOnly, smallFormFactor: !!f?.smallFormFactor, noSystemHeader: !!f?.noSystemHeader,
    noSystemSide: !!f?.noSystemSide, componentType: code(f?.componentType, COMPONENT_TYPES), searchPageType: code(f?.searchPageType, SEARCH_PAGE_TYPES),
    configurableSearch: !!f?.configurableSearch, headerActions: {}, disableAllActions: !!f?.disableAllActions };
}

export type FluidTabEdit = Partial<Omit<ComponentFluidEdits, 'headerActions'>> & { headerActions?: Partial<Record<string, boolean>> };

/** The settings the edit names over the base; the rest kept. */
export function applyFluid(base: ComponentFluidEdits, edit: FluidTabEdit): ComponentFluidEdits {
  const actions = Object.fromEntries(Object.entries(edit.headerActions ?? {}).filter((e): e is [string, boolean] => e[1] !== undefined));
  const out: ComponentFluidEdits = { ...base, headerActions: { ...base.headerActions, ...actions } };
  for (const [k, v] of Object.entries(edit)) if (v !== undefined && k !== 'headerActions') (out as unknown as Record<string, unknown>)[k] = v;
  return out;
}
