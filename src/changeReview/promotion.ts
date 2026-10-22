import { exportMigrationPackage, previewMigrationImport, type MigrationImportPlan, type StudioMigrationPackage } from '../migrationPackage.js';
import { databaseMigrationTarget } from '../providers/migrationTarget.js';
import type { DatabaseProvider } from '../providers/database.js';
import { stageMigrationImport } from './migration.js';
import type { ReviewService } from './service.js';
import type { ChangeSet } from './model.js';

export interface PromotionResult {
  package: StudioMigrationPackage;
  plan: MigrationImportPlan;
  /** The Change Set staged on the target; undefined when the preview is blocked or the target already matches. */
  staged?: ChangeSet;
}

/**
 * Promote a project from one environment to another: export it from the source (read only), refuse a target that is
 * the same environment, preview the import against the target, and -- when nothing blocks -- stage every changed
 * definition and the project membership into Change Review on the target and validate them. Nothing is written: the
 * developer approves and applies there, and the applied promotion has the migration's undo and redo.
 */
export async function promoteProject(service: ReviewService, source: DatabaseProvider, project: string, target: DatabaseProvider, operatorId: string): Promise<PromotionResult> {
  const [from, to] = [await source.environmentFingerprint(), await target.environmentFingerprint()];
  if (from === to) throw new Error(`${source.displayName} and ${target.displayName} are the same environment; promotion needs a different target.`);
  const pkg = await exportMigrationPackage(source, project);
  const backend = await databaseMigrationTarget(target, operatorId);
  const plan = await previewMigrationImport(pkg, backend);
  if (plan.blockers.length) return { package: pkg, plan };
  const staged = await stageMigrationImport(service, target.id, pkg, plan, backend, target);
  if (!staged) return { package: pkg, plan };
  return { package: pkg, plan, staged: await service.validate(staged.id) };
}
