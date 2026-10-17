import { capabilityCatalog } from '../mcp/capabilityCatalog.js';
import type { SpecObject } from './model.js';

/*
 * Whether Studio can build a spec object, decided from the capability catalog
 * (src/mcp/capabilityCatalog.ts) -- never from what the agent claims. An
 * object without a route stays in the spec: the developer builds it by hand
 * from the spec's details, and the request shows it as a manual step.
 */

export type Route =
  | { route: 'TOOLS'; operation: string; tools: string[] }
  | { route: 'MANUAL'; reason: string }
  | { route: 'NONE'; reason: string };

const OPERATION = { create: 'create', modify: 'edit', reuse: 'read' } as const;

export function routeFor(definitionType: number | null, action: SpecObject['action'], writeHostAvailable: boolean): Route {
  if (action === 'reuse') return { route: 'NONE', reason: 'An existing definition the build uses; nothing to build.' };
  if (definitionType === null) return { route: 'MANUAL', reason: 'Not a definition Studio models; configure it by hand (online or in App Designer).' };
  const entry = capabilityCatalog({ kind: 'definition', type: definitionType }, writeHostAvailable).entries[0] as
    { label: string; operations: Record<string, { status: string; tools: string[] }> } | undefined;
  if (!entry) return { route: 'MANUAL', reason: `Definition type ${definitionType} is not in Studio's catalog; build it by hand.` };
  const op = OPERATION[action], route = entry.operations[op];
  if (!route || route.status !== 'BOUNDED' || !route.tools.length) {
    return { route: 'MANUAL', reason: `Studio has no MCP ${op} route for ${entry.label} yet; build it in App Designer from the spec's details.` };
  }
  return { route: 'TOOLS', operation: op, tools: route.tools };
}
