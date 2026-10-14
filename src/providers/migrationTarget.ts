import { DatabaseProvider } from './database.js';
import { makeKey } from '../model/definitions.js';
import { portableField, portableRecord, type MigrationTarget } from '../migrationPackage.js';
import { fieldCreateRefusal } from './fieldWriter.js';
import { compileForSave, prepareSourceForSave } from '../peoplecode/writeback/savePlan.js';
import { writeScopeRefusal } from './writeScope.js';
import { validateAppEngineReferences } from '../model/aeValidation.js';

/** All mutations use Studio's existing guarded, versioned, verified writers. */
export async function databaseMigrationTarget(provider: DatabaseProvider, operatorId: string): Promise<MigrationTarget> {
  const release = (await provider.readEnvironment()).toolsRelease;
  return {
    toolsRelease: release,
    async projectToken(project) {
      const scope = writeScopeRefusal(project); if (scope) throw new Error(scope);
      return String(await provider.readProjectVersion(project) ?? 'absent');
    },
    async validate(asset, token, assets) {
      const errors: string[] = [];
      const scope = writeScopeRefusal(asset.data.name); if (scope) errors.push(scope);
      try {
        if (asset.kind === 'field' && token === 'absent') {
          const field = asset.data;
          const refusal = fieldCreateRefusal({ name: field.name, type: field.type, length: field.length,
            decimalPositions: field.decimalPositions, format: field.format, label: field.labels.find(l => l.isDefault)! });
          if (refusal) errors.push(refusal);
        } else if (asset.kind === 'ae') {
          const lookup = provider.appEngineReferenceLookup();
          const records = new Map(assets.filter(a => a.kind === 'record').map(a => [a.data.name, a.data]));
          const programs = new Map(assets.filter(a => a.kind === 'ae').map(a => [a.data.name, a.data]));
          const diagnostics = await validateAppEngineReferences(asset.data, {
            recordType: async name => records.get(name)?.recordType ?? await lookup.recordType(name),
            recordFields: async name => records.get(name)?.fields.map(f => f.name) ?? await lookup.recordFields(name),
            programSections: async name => programs.get(name)?.sections.map(s => ({ name: s.name, isPublic: s.isPublic })) ?? await lookup.programSections(name),
            messageExists: lookup.messageExists
          });
          errors.push(...diagnostics.filter(d => d.severity === 'error').map(d => asset.data.name + ': ' + d.message));
          for (const section of asset.data.sections) for (const variant of section.variants) for (const step of variant.steps) {
            for (const action of step.actions) if (action.type === 'P' && action.peopleCode) {
              compileForSave(prepareSourceForSave(action.peopleCode), { applicationClass: false, recordName: '', fieldName: '' }, release);
            }
          }
        }
      } catch (error) { errors.push(asset.data.name + ': ' + (error instanceof Error ? error.message : String(error))); }
      return errors;
    },
    async exists(key) {
      if (key.type === 2) return !!await provider.readField(key);
      if (key.type === 0) return !!await provider.readRecordLayout(key);
      if (key.type === 33) return !!await provider.readAppEngineDocument(key.parts[0]);
      throw new Error('Unsupported migration requirement: ' + key.type);
    },
    async read(asset) {
      if (asset.kind === 'field') {
        const field = await provider.readField(asset.key);
        if (field && field.type !== asset.data.type) throw new Error(asset.data.name + ': target field type differs; migration cannot change a field type.');
        return field ? { data: portableField(field), token: String(field.version) } : undefined;
      }
      if (asset.kind === 'record') {
        const record = await provider.readRecordLayout(asset.key);
        return record ? { data: portableRecord(record), token: String(record.version) } : undefined;
      }
      const ae = await provider.readAppEngineDocument(asset.data.name);
      return ae ? { data: ae.doc, token: ae.token } : undefined;
    },
    async write(asset, token) {
      if (asset.kind === 'field') {
        const field = asset.data;
        const label = field.labels.find(l => l.isDefault)!;
        let version: number;
        if (token === 'absent') {
          const request = { name: field.name, type: field.type, length: field.length, decimalPositions: field.decimalPositions,
            format: field.format, label, operatorId };
          const refusal = fieldCreateRefusal(request);
          if (refusal) throw new Error(refusal);
          version = (await provider.createField(request)).version;
        } else version = Number(token);
        await provider.saveField({ name: field.name, openedVersion: version, operatorId, length: field.length,
          decimalPositions: field.decimalPositions, format: field.format, description: field.description,
          labels: field.labels.map(l => ({ ...l, isDefault: !!l.isDefault })) });
      } else if (asset.kind === 'record') {
        const existing = await provider.readRecordLayout(asset.key);
        if ((existing ? String(existing.version) : 'absent') !== token) throw new Error(asset.data.name + ': record changed after preview.');
        const data = asset.data;
        await provider.saveRecord({ operatorId, edit: {
          recname: data.name, recordType: data.recordType, openedVersion: existing?.version ?? 0,
          isNew: !existing, properties: data.properties, type: data.type,
          fields: data.fields.map(f => ({ ...f, isNew: !existing?.fields.some(old => old.name === f.name) }))
        } });
      } else {
        for (const section of asset.data.sections) for (const variant of section.variants) for (const step of variant.steps) {
          for (const action of step.actions) if (action.type === 'P' && action.peopleCode) {
            compileForSave(prepareSourceForSave(action.peopleCode), { applicationClass: false, recordName: '', fieldName: '' }, release);
          }
        }
        await provider.saveAppEngineDocument({ doc: asset.data, openedToken: token, operatorId });
      }
    },
    async finish(project, members, expectedToken) {
      let version = await provider.readProjectVersion(project);
      if (String(version ?? 'absent') !== expectedToken) throw new Error('Project changed after migration preview.');
      if (version === undefined) version = (await provider.createProject({ project, operatorId })).version;
      await provider.saveProject({ project, operatorId, openedVersion: version, add: members.map(key => makeKey(key.type, ...key.parts)) });
    }
  };
}
