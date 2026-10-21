import { queryView, querySnapshot } from '../changeReview/query.js';
import { checkMenuMigrationUpdate } from './menuMigration.js';
import { migrationHash } from '../migrationPackage.js';
import { DatabaseProvider } from './database.js';
import { makeKey } from '../model/definitions.js';
import { portableField, portableFieldProperties, portableRecord, type MigrationTarget } from '../migrationPackage.js';
import { fieldCreateRefusal, fieldPropertiesRefusal } from './fieldWriter.js';
import { compileForSave, prepareSourceForSave } from '../peoplecode/writeback/savePlan.js';
import { writeScopeRefusal } from './writeScope.js';
import { validateAppEngineReferences } from '../model/aeValidation.js';
import { DefinitionType } from '../model/definitions.js';
import type { FieldDefinition } from '../model/fieldDefinition.js';
import { RecordType } from '../model/record.js';
import { projectKeyIdentity } from '../projectCompare.js';
import { projectItemFor } from '../model/projectItems.js';
import { pcmProgKeyParts } from '../model/peopleCodeKeys.js';

/** All mutations use Studio's existing guarded, versioned, verified writers. */
export async function databaseMigrationTarget(provider: DatabaseProvider, operatorId: string): Promise<MigrationTarget> {
  const release = (await provider.readEnvironment()).toolsRelease;
  const identity = async () => provider.platform === 'oracle' ? provider.id + ':' + await provider.changeReviewIdentity() : provider.id;
  const openedIdentity = await identity();
  const guardIdentity = async () => { if (await identity() !== openedIdentity) throw new Error('Migration target database/schema changed; preview again.'); };
  return {
    toolsRelease: release,
    identity: provider.id,
    readIdentity: identity,
    async validateMembers(members) {
      const errors:string[]=[];
      for(const key of members)try{projectItemFor(key);}catch(error){errors.push('Project membership: '+(error instanceof Error?error.message:String(error)));}
      return errors;
    },
    async projectToken(project) {
      const scope = writeScopeRefusal(project); if (scope) throw new Error(scope);
      return String(await provider.readProjectVersion(project) ?? 'absent');
    },
    async validate(asset, token, assets) {
      const errors: string[] = [];
      const scope = writeScopeRefusal(asset.data.name); if (scope) errors.push(scope);
      try {
        if (asset.kind === 'field' && token !== 'absent') {
          const live = await provider.readField(asset.key);
          if (live && live.type !== asset.data.type) errors.push('Migration cannot change a field type.');
          const wanted = new Set((asset.data.translates ?? []).map(t => t.value + '|' + t.effectiveDate));
          for (const t of (await provider.readTranslatesForMigration(asset.data.name)).items)
            if (!wanted.has(t.value + '|' + t.effectiveDate)) errors.push(`Target translate value ${t.value} effective ${t.effectiveDate} is absent from the package; migration never deletes translate values.`);
        } else if (asset.kind === 'field' && token === 'absent') {
          const field = asset.data;
          const refusal = fieldCreateRefusal({ name: field.name, type: field.type, length: field.length,
            decimalPositions: field.decimalPositions, label: field.labels.find(l => l.isDefault)! });
          if (refusal) errors.push(refusal);
        }
        if (asset.kind === 'field') {
          const properties = portableFieldProperties(asset.data), refusal = fieldPropertiesRefusal(asset.data.type, asset.data.length, properties);
          if (refusal) errors.push(refusal);
          else if (properties.formatFamily && !await provider.fieldFormatExists(properties.formatFamily, properties.displayName))
            errors.push(`Format family ${properties.formatFamily} / ${properties.displayName} does not exist in the target.`);
        } else if (asset.kind === 'record') {
          const live = await provider.readRecordLayout(asset.key);
          if (live?.fields.some(f => f.hasPeopleCode && !asset.data.fields.some(wanted => wanted.name === f.name))) errors.push('Migration cannot remove a target record field with associated PeopleCode.');
          // User indexes are created with a new record (ix01); an existing record keeps them only when they already match.
          const liveIndexes = live && live.indexIds?.some(id => /^[A-Z]$/.test(id)) ? await provider.readRecordIndexesForMigration(asset.data.name) : [];
          if (live && (liveIndexes.length || asset.data.indexes?.length)) errors.push(`${asset.data.name} exists in the target with or without user-defined indexes; migration creates indexed records but does not update them yet.`);
          // Saving an existing SubRecord would have to re-expand every record that includes it.
          if (live && (live.recordType === RecordType.Subrecord || asset.data.recordType === RecordType.Subrecord)) errors.push(`${asset.data.name}: migration creates SubRecords but does not update them yet.`);
        } else if(asset.kind==='menu') {
          const live=await provider.readMenuForMigration(asset.data.name);checkMenuMigrationUpdate(live?.data,asset.data);
          if((live?.token??'absent')!==token)throw Error('Menu changed after preview.');
          errors.push(...(await provider.peopleCodeImportProblems(asset.data.bars.flatMap(b=>b.items.map(i=>i.peopleCode??'')).join('\n'))).map(p=>p.message));
          await provider.saveMenuDocument({doc:asset.data,openedToken:live?.writerToken??'absent',operatorId,dryRun:true,verifyRollback:true,expectedSnapshotToken:token});
        } else if (asset.kind === 'query') {
          const result = await provider.saveQueryDocument({ view:queryView(asset.data.view),openedToken:token,operatorId,dryRun:true });
          if (migrationHash(querySnapshot(result.view))!==migrationHash(asset.data.view)) errors.push('Native Query preview differs from migration payload.');
        } else if (asset.kind === 'page') {
          await provider.createPageFromMigration({ data: asset.data, operatorId, dryRun: true, expectedToken: token });
        } else if (asset.kind === 'component') {
          await provider.createComponentFromMigration({ data: asset.data, operatorId, dryRun: true, expectedToken: token });
        } else if (asset.kind === 'package') {
          const live = await provider.readPackageForMigration(asset.data.name);
          for (const path of live?.data.packages ?? []) if (!asset.data.packages.includes(path)) errors.push(`Target subpackage ${asset.data.name}:${path} is absent from the package; migration never deletes subpackages.`);
        } else if (asset.kind === 'peoplecode') {
          const newClass = token === 'absent' && asset.key.type === DefinitionType.ApplicationClassPeopleCode;
          if (newClass) {
            const root = asset.key.parts[0], path = pcmProgKeyParts(asset.key).slice(1, -2).join(':');
            const proposed = assets.find(a => a.kind === 'package' && a.data.name === root);
            const pkg = proposed?.kind === 'package' ? proposed : await provider.readPackageForMigration(root);
            if (!pkg) errors.push(`New class ${asset.key.parts.join(':')} needs its Application Package in the target or the migration.`);
            else if (path && !pkg.data.packages.includes(path)) errors.push(`New class ${asset.key.parts.join(':')} needs subpackage ${root}:${path}.`);
          }
          await provider.validateReviewedPeopleCode(asset.key, asset.data.text, newClass);
          errors.push(...(await provider.peopleCodeImportProblems(asset.data.text)).map(p => p.message));
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
      if (key.type === DefinitionType.SqlDefinition) return !!await provider.readSqlForMigration(key);
      if (key.type===DefinitionType.Query) return !!await provider.readQueryForMigration(key);
      if (key.type === DefinitionType.ComponentInterface) return !!await provider.readProperties(key);
      // Prerequisites need only exist; a classic style sheet or an unmigratable shape still satisfies one.
      return provider.definitionExists(key);
    },
    async read(asset) { return readMigrationAsset(provider, asset.key); },
    async write(asset, token) {
      await guardIdentity();
      if (asset.kind === 'field') {
        const field = asset.data;
        const label = field.labels.find(l => l.isDefault)!;
        let version: number, existing: FieldDefinition | undefined;
        if (token === 'absent') {
          // Created with New Field's defaults; the save below stores every property.
          const request = { name: field.name, type: field.type, length: field.length, decimalPositions: field.decimalPositions, label, operatorId };
          const refusal = fieldCreateRefusal(request);
          if (refusal) throw new Error(refusal);
          version = (await provider.createField(request)).version;
        } else { version = Number(token.split(':')[0]); existing = await provider.readField(asset.key); }
        const core = (f: FieldDefinition) => migrationHash({ ...portableField(f), translates: undefined });
        // An unchanged field definition is not saved again when only its translate values differ.
        if (!existing || core(existing) !== core(field)) await provider.saveField({ name: field.name, openedVersion: version, operatorId, length: field.length,
          decimalPositions: field.decimalPositions, properties: portableFieldProperties(field), description: field.description,
          labels: field.labels.map(l => ({ ...l, isDefault: !!l.isDefault })) });
        const live = new Map((await provider.readTranslatesForMigration(field.name)).items.map(t => [t.value + '|' + t.effectiveDate, t]));
        for (const t of field.translates ?? []) {
          const old = live.get(t.value + '|' + t.effectiveDate);
          live.delete(t.value + '|' + t.effectiveDate);
          if (!old) await provider.saveTranslate(field.name, { kind: 'add', item: t }, operatorId);
          else if (migrationHash(old) !== migrationHash(t)) await provider.saveTranslate(field.name, { kind: 'change', item: t }, operatorId);
        }
        if (live.size) throw new Error(field.name + ': target has translate values absent from the package.');
      } else if (asset.kind === 'record') {
        const existing = await provider.readRecordLayout(asset.key);
        if ((existing ? String(existing.version) : 'absent') !== token) throw new Error(asset.data.name + ': record changed after preview.');
        const data = asset.data;
        await provider.saveRecord({ operatorId, edit: {
          recname: data.name, recordType: data.recordType, openedVersion: existing?.version ?? 0,
          isNew: !existing, properties: data.properties, type: data.type,
          fields: data.fields.map(f => ({ ...f, isNew: !existing?.fields.some(old => old.name === f.name) }))
        }, ...(data.indexes?.length ? { userIndexes: data.indexes } : {}) });
      } else if (asset.kind === 'sql') {
        const live = await provider.readSqlForMigration(asset.key);
        if ((live?.token ?? 'absent') !== token) throw new Error(asset.data.name + ': SQL changed after preview.');
        const { description, definition, ownerId } = asset.data;
        await provider.saveSqlDefinition({ sqlId: asset.data.name, text: asset.data.text,
          openedVersion: live?.version, expectedSnapshotToken: token, metadata: { description, definition, ownerId }, operatorId });
      } else if (asset.kind === 'html' || asset.kind === 'stylesheet') {
        const live = await provider.readContentForMigration(asset.key);
        if ((live?.token ?? 'absent') !== token) throw new Error(asset.data.name + ': content changed after preview.');
        const request = { ...asset.data, operatorId, openedVersion: live?.version, expectedSnapshotToken: token };
        if (asset.kind === 'html') await provider.saveHtmlDefinition(request); else await provider.saveStyleSheet(request);
      } else if(asset.kind==='menu') {
        const live=await provider.readMenuForMigration(asset.data.name);
        await provider.saveMenuDocument({doc:asset.data,openedToken:live?.writerToken??'absent',operatorId,expectedSnapshotToken:token});
      } else if (asset.kind === 'query') {
        await provider.saveQueryDocument({view:queryView(asset.data.view),openedToken:token,operatorId});
      } else if (asset.kind === 'peoplecode') {
        const createClass = token === 'absent' && asset.key.type === DefinitionType.ApplicationClassPeopleCode;
        await provider.savePeopleCode(asset.key, { source: asset.data.text, openedFingerprint: token, operatorId, ...(createClass ? { createClass: true } : {}) });
      } else if (asset.kind === 'page') {
        await provider.createPageFromMigration({ data: asset.data, operatorId, expectedToken: token });
      } else if (asset.kind === 'component') {
        await provider.createComponentFromMigration({ data: asset.data, operatorId, expectedToken: token });
      } else if (asset.kind === 'package') {
        const root = asset.data.name;
        let live = await provider.readPackageForMigration(root);
        if ((live?.token ?? 'absent') !== token) throw new Error(root + ': package changed after preview.');
        if (!live) { await provider.createPackage({ name: root, operatorId }); live = await provider.readPackageForMigration(root); }
        for (const path of asset.data.packages) if (!live!.data.packages.includes(path)) {
          await provider.createSubpackage({ root, path: path.split(':'), openedVersion: live!.version, operatorId });
          live = await provider.readPackageForMigration(root);
        }
        const { description = '', comments = '', ownerId = '' } = asset.data, now = live!.data;
        if (description !== (now.description ?? '') || comments !== (now.comments ?? '') || ownerId !== (now.ownerId ?? ''))
          await provider.savePackageProperties({ root, openedVersion: live!.version, description, comments, ownerId, operatorId });
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
      await guardIdentity();
      let version = await provider.readProjectVersion(project);
      if (String(version ?? 'absent') !== expectedToken) throw new Error('Project changed after migration preview.');
      if (version === undefined) version = (await provider.createProject({ project, operatorId })).version;
      const existing = new Set((await provider.listProjectItems(project)).map(item => projectKeyIdentity(item.key)));
      const missing = members.filter(key => !existing.has(projectKeyIdentity(key)));
      if (missing.length) version = (await provider.saveProject({ project, operatorId, openedVersion: version,
        add: missing.map(key => makeKey(key.type, ...key.parts)) })).version;
      if (await provider.readProjectVersion(project) !== version) throw new Error('Project changed during migration membership verification.');
      const stored = new Set((await provider.listProjectItems(project)).map(item => projectKeyIdentity(item.key)));
      if (members.some(key => !stored.has(projectKeyIdentity(key)))) throw new Error('Project membership readback does not match migration package.');
    }
  };
}

/** Full portable value and native concurrency token, shared by preview and durable review. */
export async function readMigrationAsset(provider: DatabaseProvider, key: import('../model/definitions.js').DefinitionKey) {
  if (key.type === DefinitionType.Field) {
    const field = await provider.readField(key);
    if (!field) return undefined;
    const translates = await provider.readTranslatesForMigration(field.name);
    return { data: portableField({ ...field, translates: translates.items }), token: field.version + ':' + (translates.version ?? 'none') };
  }
  if (key.type === DefinitionType.Record) {
    const record = await provider.readRecordLayout(key);
    if (!record) return undefined;
    const indexes = record.indexIds?.some(id => /^[A-Z]$/.test(id)) ? await provider.readRecordIndexesForMigration(record.name) : [];
    return { data: portableRecord(record, true, indexes), token: String(record.version) };
  }
  if (key.type===DefinitionType.Query) return provider.readQueryForMigration(key);
  if (key.type===DefinitionType.Menu) return provider.readMenuForMigration(key.parts[0]);
  if (key.type === DefinitionType.Page) return provider.readPageForMigration(key.parts[0]);
  if (key.type === DefinitionType.Component) return provider.readComponentForMigration(key.parts[0], (key.parts[1] || 'GBL').trim());
  if (key.type === DefinitionType.ApplicationPackage) { const pkg = await provider.readPackageForMigration(key.parts[0]); return pkg && { data: pkg.data, token: pkg.token }; }
  if (key.type === DefinitionType.SqlDefinition) return provider.readSqlForMigration(key);
  if ([DefinitionType.HtmlDefinition, DefinitionType.StyleSheet].includes(key.type)) return provider.readContentForMigration(key);
  if (key.type === DefinitionType.AppEngineProgram) {
    const ae = await provider.readAppEngineDocument(key.parts[0]);
    return ae ? { data: ae.doc, token: ae.token } : undefined;
  }
  const read = await provider.readPeopleCodeForEdit(key);
  if (!read && await provider.hasPeopleCode(key)) throw new Error('Authoritative PeopleCode source is unavailable.');
  return read ? { data: { name: key.parts[0], text: prepareSourceForSave(read.text) }, token: read.fingerprint } : undefined;
}
