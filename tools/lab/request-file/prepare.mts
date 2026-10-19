/** Bootstrap ONE new synthetic local intake; never approve it, edit prior requests or write PeopleSoft. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { BuildRequestStore } from '../../../src/buildRequest/store.js';
import { isApproved } from '../../../src/buildRequest/model.js';
import { sample } from './sample.mts';
const root = process.argv[2];
assert.ok(root && path.isAbsolute(root), 'Pass the active extension build-requests storage directory explicitly.');
const store = new BuildRequestStore(root), title = 'Synthetic CSV export acceptance';
assert.ok(!(await store.list()).some(r => r.title === title), 'This intake already exists. Reopen it; do not duplicate or rewrite it.');
const fixture = await sample();
const request = await store.create({ title, kind: 'ae-outbound-file', connection: 'oracle:HRDMO', project: 'ZZ_RF_PRJ', narrative: fixture.requirements });
for (const file of ['requirements.md', 'rows.sql', 'export.peoplecode', 'expected.csv']) await store.attach(request.id, file, await readFile(new URL(file, import.meta.url)));
const proposed = await store.proposeSpec(request.id, fixture.spec);
assert.equal(isApproved(proposed), false);
console.log(JSON.stringify({ id: proposed.id, title: proposed.title, specRevision: proposed.spec?.revision, approved: false, attachments: proposed.attachments.map(a => ({ name: a.name, sha256: a.sha256 })) }, null, 2));
