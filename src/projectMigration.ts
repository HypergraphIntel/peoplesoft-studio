import { DefinitionType, displayName, makeKey, type DefinitionKey, typeLabel } from './model/definitions.js';
import { peopleCodeKeyParts } from './model/appEngine.js';
import { compareProjectItems, projectKeyIdentity, type ProjectItemComparison } from './projectCompare.js';
import type { DefinitionProvider, DefinitionSummary } from './providers/provider.js';

export interface MigrationDependency {
  key: DefinitionKey;
  label: string;
  requiredBy: string[];
  inProject: boolean;
}

export interface MigrationReview {
  format: 'psft-migration-review/1';
  project: string;
  source: string;
  target?: string;
  items: DefinitionSummary[];
  comparisons: ProjectItemComparison[];
  dependencies: MigrationDependency[];
  unresolved: string[];
}

/**
 * Review explicit references in supported models. Never guess references from
 * identifiers in SQL/PeopleCode, or claim this is a complete migration closure.
 */
export async function reviewProjectMigration(source: DefinitionProvider, project: string, target?: DefinitionProvider): Promise<MigrationReview> {
  const items = await source.listProjectItems(project);
  const members = new Set(items.map(item => projectKeyIdentity(item.key)));
  const dependencies = new Map<string, MigrationDependency>();
  const unresolved = new Set<string>();
  const add = (key: DefinitionKey, requiredBy: string) => {
    const id = projectKeyIdentity(key);
    const dependency = dependencies.get(id) ?? { key, label: displayName(key), requiredBy: [], inProject: members.has(id) };
    if (!dependency.requiredBy.includes(requiredBy)) dependency.requiredBy.push(requiredBy);
    dependencies.set(id, dependency);
  };
  const scanned = new Set<string>();
  for (const item of items) {
    const key = item.key;
    const label = displayName(key);
    const id = projectKeyIdentity(key);
    if (scanned.has(id)) continue;
    scanned.add(id);
    try {
      if (key.type === DefinitionType.Record) {
        const record = await source.readRecord(key);
        for (const field of record.fields) {
          add(makeKey(DefinitionType.Field, field.name), label);
          if (field.fromSubrecord) add(makeKey(DefinitionType.Record, field.fromSubrecord), label);
          if (field.editTable) add(makeKey(DefinitionType.Record, field.editTable), label);
        }
        if (record.auditRecord) add(makeKey(DefinitionType.Record, record.auditRecord), label);
        unresolved.add(`${label}: record indexes, associated PeopleCode and SQL dependency coverage is incomplete.`);
      } else if (key.type === DefinitionType.AppEngineProgram || key.type === DefinitionType.AppEngineSection) {
        const programName = key.parts[0];
        const aeId = 'AE:' + programName.toUpperCase();
        if (scanned.has(aeId)) continue;
        scanned.add(aeId);
        if (!source.readAppEngineDocument) {
          unresolved.add(`${label}: this source cannot provide structured AE dependencies.`);
          continue;
        }
        const result = await source.readAppEngineDocument(programName);
        if (!result) throw new Error('App Engine not found');
        const doc = result.doc;
        if (key.type === DefinitionType.AppEngineSection) add(makeKey(DefinitionType.AppEngineProgram, programName), label);
        for (const state of doc.stateRecords) add(makeKey(DefinitionType.Record, state.record), programName);
        for (const table of doc.tempTables) add(makeKey(DefinitionType.Record, table), programName);
        for (const section of doc.sections) {
          add(makeKey(DefinitionType.AppEngineSection, doc.name, section.name), programName);
          for (const variant of section.variants) for (const step of variant.steps) {
            if (step.actions.some(action => action.type === 'P')) {
              const parts = peopleCodeKeyParts(doc.name, section.name, variant, step.name);
              if (parts) add(makeKey(DefinitionType.AppEnginePeopleCode, ...parts), programName);
              else unresolved.add(`${programName}.${section.name}.${step.name}: unknown PeopleCode platform ${variant.dbType}.`);
            }
            if (step.actions.some(action => action.type === 'C')) {
              if (step.dynamic) unresolved.add(`${programName}.${section.name}.${step.name}: dynamic Call Section target is determined at runtime.`);
              else if (step.doProgram && step.doProgram !== doc.name) {
                add(makeKey(DefinitionType.AppEngineProgram, step.doProgram), programName);
                if (step.doSection) add(makeKey(DefinitionType.AppEngineSection, step.doProgram, step.doSection), programName);
              }
            }
          }
        }
        unresolved.add(`${programName}: SQL, PeopleCode, message and Transform dependency coverage is incomplete.`);
      } else if (key.type === DefinitionType.Component) {
        for (const child of await source.listChildren(key)) add(child.key, label);
        unresolved.add(`${label}: search record, component PeopleCode and page dependency coverage is incomplete.`);
      } else if (key.type !== DefinitionType.Field) {
        unresolved.add(`${label}: dependency analysis is not available for ${typeLabel(key.type)}.`);
      }
    } catch (error) {
      unresolved.add(`${label}: dependency read failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    format: 'psft-migration-review/1', project, source: source.displayName, target: target?.displayName,
    items, comparisons: target ? await compareProjectItems(items, source, target) : [],
    dependencies: [...dependencies.values()].sort((a, b) => a.label.localeCompare(b.label)),
    unresolved: [...unresolved].sort()
  };
}

const escape = (text: string) => text.replace(/[\\`*_[\]<>|]/g, c => '\\' + c).replace(/\r?\n/g, ' ');

export function renderMigrationReview(review: MigrationReview): string {
  const lines = [
    `# Migration review: ${escape(review.project)}`, '',
    `Source: ${escape(review.source)}. Target: ${review.target ? escape(review.target) : 'not selected'}.`, '',
    'This is a review of modeled definitions and explicit dependencies. It is not a migration package or a complete dependency closure.',
    '', '## Project members', '', '| Definition | Type | Target comparison | Detail |', '| --- | --- | --- | --- |'
  ];
  for (const item of review.items) {
    const compared = review.comparisons.find(c => projectKeyIdentity(c.key) === projectKeyIdentity(item.key));
    lines.push(`| ${escape(displayName(item.key))} | ${escape(typeLabel(item.key.type))} | ${compared?.outcome ?? 'not compared'} | ${escape(compared?.detail ?? '')} |`);
  }
  lines.push('', '## Explicit dependencies', '', 'Dependencies outside the project may already be delivered in the target. Review before including them.', '',
    '| Definition | Type | Project membership | Required by |', '| --- | --- | --- | --- |');
  for (const dependency of review.dependencies) lines.push(`| ${escape(dependency.label)} | ${escape(typeLabel(dependency.key.type))} | ${dependency.inProject ? 'included' : 'outside project'} | ${escape(dependency.requiredBy.join(', '))} |`);
  lines.push('', '## Unresolved review', '', ...review.unresolved.map(note => '- ' + escape(note)));
  if (!review.unresolved.length) lines.push('No unresolved explicit dependency reads.');
  lines.push('', '## Export and import in Studio', '',
    'Use PeopleSoft: Export Migration Package to save a versioned Studio package. Unsupported definitions block export; they are never silently omitted.',
    'On the target, use PeopleSoft: Import Migration Package to preview creates, updates, unchanged definitions and blockers before applying.',
    'Build required SQL records with Studio and validate runtime behavior. Metadata migration does not move application data.', '');
  return lines.join('\n');
}
