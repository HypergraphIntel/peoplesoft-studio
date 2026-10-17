import { DefinitionType } from './definitions.js';

/*
 * Which definition types the MCP places into projects (Settings > Project Contents).
 * Some organizations never migrate menus, Portal Registry structures, or permission
 * lists and roles in projects: they maintain them in each environment, or move them
 * another way. The MCP still creates such definitions; it just leaves them out of a
 * project, and says which setting did. A developer adding one in the Studio UI is
 * not gated.
 */

export interface ProjectInclusion {
  /** peoplesoft.projects.includeMenus */
  menus: boolean;
  /** peoplesoft.projects.includePortalRegistry: content references and folders. */
  portalRegistry: boolean;
  /** peoplesoft.projects.includeSecurity: permission lists and roles. */
  security: boolean;
}

export const INCLUDE_ALL: ProjectInclusion = { menus: true, portalRegistry: true, security: true };

const GATED: ReadonlyArray<{ types: readonly DefinitionType[]; on: keyof ProjectInclusion; setting: string; label: string }> = [
  { types: [DefinitionType.Menu], on: 'menus', setting: 'peoplesoft.projects.includeMenus', label: 'Include menus in projects' },
  { types: [DefinitionType.PortalRegistry], on: 'portalRegistry', setting: 'peoplesoft.projects.includePortalRegistry',
    label: 'Include Portal Registry structures in projects' },
  { types: [DefinitionType.PermissionList, DefinitionType.Role], on: 'security', setting: 'peoplesoft.projects.includeSecurity',
    label: 'Include permission lists and roles in projects' }
];

/** Why a definition of this type is left out of projects, or undefined when it goes in. */
export function projectExclusion(type: DefinitionType, inclusion: ProjectInclusion): string | undefined {
  const gate = GATED.find((g) => g.types.includes(type));
  return gate && !inclusion[gate.on]
    ? `Settings > Project Contents: "${gate.label}" is off (${gate.setting}); the definition is created but not placed in projects.`
    : undefined;
}
