import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectTransaction } from './fixtures/projectTransaction.js';
import { ADAPTER_TYPES } from '../db/connection.js';
import { createProjectWithItems } from '../providers/projectWriter.js';
import { readProjectCreationSnapshot, projectCreationItems } from '../providers/projectSnapshot.js';
import { hash } from '../changeReview/model.js';

test('new project and proposed membership preview roll back together; actual creation requires live members and one commit', async () => {
    const f = projectTransaction(), project = 'ZZ_PROJECT', items = [{ type: 0, parts: ['ZZ_STATE_AET'] }, { type: 30, parts: ['ZZ_ROWS', '0'] }];
    const read = () => readProjectCreationSnapshot(f.connection, ADAPTER_TYPES, project);
    assert.equal((await read()).value, null);
    let after: Awaited<ReturnType<typeof read>>;
    await createProjectWithItems(f.connection, { project, operatorId: 'JARED', items, proposed: items, dryRun: true }, async () => { after = await read(); });
    assert.deepEqual(f.state(), f.initial); assert.equal(f.counts().commits, 0);
    assert.deepEqual(projectCreationItems(after!.value, project), items);
    await assert.rejects(createProjectWithItems(f.connection, { project, operatorId: 'JARED', items }, async () => {}), /does not exist/);
    assert.deepEqual(f.state(), f.initial); assert.equal(f.counts().commits, 0);
    await assert.rejects(createProjectWithItems(f.connection, { project, operatorId: 'JARED', items, proposed: items }, async () => {}), /rollback preview/);
    f.definitionsExist(true);
    await assert.rejects(createProjectWithItems(f.connection, { project, operatorId: 'JARED', items }, async () => { throw new Error('after-image mismatch'); }), /after-image mismatch/);
    assert.deepEqual(f.state(), f.initial); assert.equal(f.counts().commits, 0);
    await createProjectWithItems(f.connection, { project, operatorId: 'JARED', items }, async () => { assert.equal((await read()).hash, hash(after!.value)); });
    assert.equal(f.counts().commits, 1);
    assert.equal((await read()).hash, after!.hash);
    assert.ok(f.queries.filter(q => q.startsWith('SELECT ')).every(q => !/SELECT .*\bTGTOPR(?:ID|ACCT)\b/.test(q)));
    const tampered = structuredClone(after!.value) as any;
    tampered.tables.PSPROJECTITEM[0].TAKEACTION = 0;
    assert.throws(() => projectCreationItems(tampered, project), /calibrated typed layout/);
});

test('project creation refuses orphan items without claiming an absent scope', async () => {
    const f = projectTransaction();
    f.editCommitted(t => t.PSPROJECTITEM.push({ PROJECTNAME: 'ZZ_ORPHAN', OBJECTTYPE: 0 }));
    await assert.rejects(readProjectCreationSnapshot(f.connection, ADAPTER_TYPES, 'ZZ_ORPHAN'), /Incomplete|orphaned/);
    assert.equal(f.counts().commits, 0);
});
