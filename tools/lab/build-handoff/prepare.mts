/** Prepare two complete, unapproved synthetic requests. Read-only HRDMO preflight; no approval or PeopleSoft writes. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { DatabaseProvider } from '../../../src/providers/database.js';
import { BuildRequestStore } from '../../../src/buildRequest/store.js';
import { isApproved, type BuildSpec } from '../../../src/buildRequest/model.js';
import { makeKey, DefinitionType } from '../../../src/model/definitions.js';
import { sample } from '../request-file/sample.mjs';

const root = process.argv[2];
assert.ok(root && path.isAbsolute(root), 'Pass the active installed Build Requests storage directory explicitly.');
const store = new BuildRequestStore(root);
const p = new DatabaseProvider({ name: 'HRDMO handoff preflight', platform: 'oracle', connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo',
  user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
const prepared: object[] = [];
try {
  await p.connect();
  const existing = await store.list();
  for (const [agent, prefix] of [['codex', 'ZZ_BC_'], ['claude', 'ZZ_BL_']] as const) {
    const title = `Installed ${agent === 'codex' ? 'Codex' : 'Claude'} build handoff — synthetic CSV`;
    const prior = existing.find(r => r.title === title);
    if (prior) { prepared.push({ agent, requestId: prior.id, title, prefix, specRevision: prior.spec?.revision, approved: isApproved(prior), reused: true }); continue; }
    const program = prefix + 'EXPORT', project = prefix + 'PRJ';
    assert.equal(await p.readRecordLayout(makeKey(DefinitionType.Record, prefix + 'AET')), undefined, 'Lab record name already exists.');
    assert.equal(await p.readSqlForMigration(makeKey(DefinitionType.SqlDefinition, prefix + 'ROWS', '0')), undefined, 'Lab SQL name already exists.');
    assert.equal(await p.readAppEngineDocument(program), undefined, 'Lab AE name already exists.');
    assert.equal(await p.readProjectVersion(project), undefined, 'Lab project name already exists.');
    const processes = await p.search({ type: DefinitionType.ProcessDefinition, namePattern: program, limit: 1000 });
    assert.ok(!processes.some(r => r.key.parts.includes(program)), 'Lab Process Definition name already exists.');
    const fixture = await sample();
    const replace = (text: string) => text.replaceAll('ZZ_RF_', prefix);
    const runtime = `Native scheduler prerequisite for ${program}\n\nCreate Process Definition Application Engine / ${program}, after the AE exists. Read psft_process_reference first; perform a rollback-only dry run before requesting the ordinary create confirmation.\nProperties DESCR = Synthetic handoff CSV, RESTARTENABLED = 0. Other properties use the calibrated Add-mode defaults (Server run location, API aware, log request, Default category). Components [AE_REQUEST], process groups [TLSALL]. Reuse these existing component/group associations without security grants, server overrides, recurrence, command overrides or trace changes. This process creation retains legacy per-write confirmation; it is not a reviewed creation adapter.\n\nAfter approved metadata apply/readback and this separately confirmed process creation, use the existing native Submit AE Process Requests page and new JARED / ${prefix}ACC01 run control. Execute ${program} once, blank recurrence, no tracing. Record the actual instance/status/output path and compare the output with expected.csv. Restore frequency Once. Never manufacture output or claim runtime from metadata readback.\n`;
    const spec = JSON.parse(replace(JSON.stringify(fixture.spec))) as BuildSpec;
    spec.summary += ` This request verifies the installed ${agent} build-phase terminal handoff; the Process Definition prerequisite is explicitly included below.`;
    spec.objects.push({ ref: 'scheduler', definitionType: DefinitionType.ProcessDefinition, kind: 'Process Definition', action: 'create', name: program,
      purpose: 'Expose this new lab AE on the existing native request page for one acceptance run.', dependsOn: ['export'], sources: ['runtime.md'], details: runtime });
    spec.testPlan += '\n\n' + runtime;
    spec.assumptions.push('The project contains the new Record/SQL/AE/section/PeopleCode only; the Process Definition remains a separate scheduler prerequisite, outside reviewed project creation membership.');
    const requirements = replace(fixture.requirements) + '\n\n' + runtime;
    const request = await store.create({ title, kind: 'ae-outbound-file', connection: 'oracle:HRDMO', project, narrative: requirements });
    for (const filename of ['requirements.md', 'rows.sql', 'export.peoplecode', 'expected.csv']) {
      const text = filename === 'requirements.md' ? requirements : replace(await readFile(new URL('../request-file/' + filename, import.meta.url), 'utf8'));
      await store.attach(request.id, filename, Buffer.from(text));
    }
    await store.attach(request.id, 'runtime.md', Buffer.from(runtime));
    const proposed = await store.proposeSpec(request.id, spec);
    assert.equal(isApproved(proposed), false);
    prepared.push({ agent, requestId: proposed.id, title, prefix, program, project, specRevision: proposed.spec!.revision, specHash: proposed.spec!.hash,
      approved: false, attachments: proposed.attachments.map(a => ({ name: a.name, sha256: a.sha256 })) });
  }
  const report = { preparedAt: new Date().toISOString(), scope: 'Two fully specified synthetic HRDMO requests; store-seeded, no approvals or PeopleSoft writes', requests: prepared };
  await writeFile('/tmp/psft-build-handoff-acceptance.json', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
} finally { await p.dispose(); }
