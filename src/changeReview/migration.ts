import { assetRequirements, checkedMigrationAsset, migrationCanonical, migrationHash, parseMigrationPackage, previewMigrationImport,
  type MigrationAsset, type MigrationImportPlan, type MigrationTarget, type StudioMigrationPackage } from '../migrationPackage.js';
import { projectKeyIdentity } from '../projectCompare.js';
import type { DatabaseProvider } from '../providers/database.js';
import type { DefinitionKey } from '../model/definitions.js';
import { hash, type Json } from './model.js';
import type { ReviewService } from './service.js';

export const migrationAdapter = (kind: MigrationAsset['kind']): string => 'migration-' + kind;
export function migrationReviewKey(key: Json): DefinitionKey {
  if (!key || Array.isArray(key) || typeof key !== 'object' || Object.keys(key).sort().join(',') !== 'parts,type' ||
    typeof key.type !== 'number' || !Number.isInteger(key.type) || !Array.isArray(key.parts) || !key.parts.length || key.parts.some(p => typeof p !== 'string' || !p.trim())) throw new Error('Invalid migration definition key.');
  return { type: key.type, parts: key.parts as string[] };
}
export function migrationJson(value: unknown): Json { return JSON.parse(migrationCanonical(value)) as Json; }

/** No writes or approval. Bind staging to the preview, target identity, package and native tokens. */
export async function stageMigrationImport(service: ReviewService, connection: string, pkg: StudioMigrationPackage, plan: MigrationImportPlan, target: MigrationTarget, projectProvider?: DatabaseProvider) {
  parseMigrationPackage(JSON.stringify(pkg));
  if (pkg.checksum !== plan.packageChecksum || plan.blockers.length) throw new Error('Migration is blocked or package differs from preview.');
  const current = await previewMigrationImport(pkg, target);
  if (current.blockers.length || migrationHash(current) !== migrationHash(plan)) throw new Error('Target changed since migration preview.');
  const changed = plan.changes.filter(c => c.action !== 'same');
  const project = projectProvider ? await readMigrationProject(projectProvider, pkg.project) : undefined;
  const members = new Map<string, DefinitionKey>();
  for (const key of [...(project?.value && typeof project.value === 'object' && !Array.isArray(project.value) ? project.value.members as unknown as DefinitionKey[] : []), ...pkg.members]) members.set(projectKeyIdentity(key), key);
  const afterProject = migrationJson({ name: pkg.project, members: [...members.values()].sort((a,b) => projectKeyIdentity(a).localeCompare(projectKeyIdentity(b))) });
  const projectChanged = project !== undefined && hash(project.value) !== hash(afterProject);
  if (!changed.length && !projectChanged) return undefined;
  let set = await service.create('Migrate ' + pkg.project + ' · ' + pkg.checksum.slice(0, 12), connection);
  const objects = new Map<string, string>();
  for (const change of changed) {
    const dependencies = assetRequirements(change.asset).map(projectKeyIdentity).flatMap(id => objects.has(id) ? [objects.get(id)!] : []);
    set = await service.stage(set.id, migrationAdapter(change.asset.kind), migrationJson(change.asset.key), migrationJson(change.asset.data), dependencies, undefined, change.expectedToken);
    const c = set.objects.find(c => c.adapter === migrationAdapter(change.asset.kind) && hash(c.key) === hash(migrationJson(change.asset.key)))!;
    objects.set(projectKeyIdentity(change.asset.key), c.id);
  }
  if (projectChanged) set = await service.stage(set.id, 'migration-project', pkg.project, afterProject, [...objects.values()], undefined, project!.token);
  return set;
}

export function reviewedMigrationAsset(kind: MigrationAsset['kind'], key: Json, data: Json): MigrationAsset {
  return checkedMigrationAsset(kind, migrationReviewKey(key), data);
}

export async function readMigrationProject(provider: DatabaseProvider, name: string, allowDeleted = false) {
  const scope = await provider.readProjectCreationForReview(name,allowDeleted);
  if (scope.value === null) return { value: null, token: scope.token };
  const members = (await provider.listProjectItems(name)).map(i => i.key).sort((a,b) => projectKeyIdentity(a).localeCompare(projectKeyIdentity(b)));
  if ((await provider.readProjectCreationForReview(name,allowDeleted)).token !== scope.token) throw new Error('Project changed while reading migration membership.');
  return { value: migrationJson({ name, members }), token: scope.token };
}
