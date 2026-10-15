export interface RecentProject {
  connectionId: string;
  project: string;
}

export const RECENT_PROJECTS_KEY = 'psft.recentProjects';
export const RECENT_PROJECTS_LIMIT = 10;

/** Global state stores plain entries, newest first. Ignore malformed or older state. */
export function deserializeRecentProjects(value: unknown): RecentProject[] {
  if (!Array.isArray(value)) return [];
  const entries: RecentProject[] = [];
  for (const entry of value) {
    if (!entry || typeof entry.connectionId !== 'string' || !entry.connectionId.trim() ||
        typeof entry.project !== 'string' || !entry.project.trim()) continue;
    if (entries.some((e) => e.connectionId === entry.connectionId && e.project === entry.project)) continue;
    entries.push({ connectionId: entry.connectionId, project: entry.project });
    if (entries.length === RECENT_PROJECTS_LIMIT) break;
  }
  return entries;
}

export function addRecentProject(entries: readonly RecentProject[], entry: RecentProject): RecentProject[] {
  return deserializeRecentProjects([entry, ...entries]);
}

export function removeRecentProject(entries: readonly RecentProject[], entry: RecentProject): RecentProject[] {
  return entries.filter((e) => e.connectionId !== entry.connectionId || e.project !== entry.project);
}

export function serializeRecentProjects(entries: readonly RecentProject[]): RecentProject[] {
  return deserializeRecentProjects(entries);
}
