/** Installed Query UI and MCP acceptance. Only unique HRDMO lab queries are written. */
const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const sleep = ms => new Promise(r => setTimeout(r, ms));
exports.run = async () => {
  const input = JSON.parse(fs.readFileSync(process.env.PSFT_QUERY_INPUT, 'utf8'));
  const load = name => require(path.join(input.root, 'dist-test', name + '.js'));
  const { DatabaseProvider } = load('providers/database'), { openDatabase } = load('db/open');
  const { newQueryDocument, applyQueryOp, describeQueryCriteria } = load('model/queryDocument');
  const { querySnapshot } = load('changeReview/query'), { copyQueryDocument } = load('model/queryDocument');
  const { reviewStateToken } = load('changeReview/model'), { QUERY_TABLES } = load('model/querySavePlan');
  const operatorId = input.connection.peoplesoftOperatorId;
  const config = { name: 'Independent Query readback', platform: 'oracle', connectString: input.connection.connectString, user: process.env.PSLAB_ACCESSID, password: process.env.PSLAB_ACCESSPSWD };
  assert.match(config.connectString, /hrdmo/i);
  const reader = new DatabaseProvider(config), pool = await openDatabase('oracle', config), c = await pool.getConnection();
  const prefix = 'ZZ_BQUI_' + randomBytes(4).toString('hex').toUpperCase();
  const names = { aggregate: prefix + '_A', join: prefix + '_J', translate: prefix + '_T', union: prefix + '_U', renamed: prefix + '_R' };
  const results = { checkedAt: new Date().toISOString(), vscode: vscode.version, names, checks: [], cleanupVerified: false, scope: 'Unmodified installed VSIX in isolated VS Code; rendered Query controls and Change Review, actual HRDMO writers, independent database readback; original window unchanged.' };
  let ui, connection, seq = 0, owned = false;
  const checkpoint = operation => fs.writeFileSync(process.env.PSFT_QUERY_RESULT + '.progress', JSON.stringify({ operation, passed: results.checks.length }));
  const check = async (name, fn) => { checkpoint(name); await fn(); results.checks.push({ name, passed: true }); console.log('PASS ' + name); };
  const until = async (fn, timeout = 45000) => { const start = Date.now(); while (Date.now() - start < timeout) { const value = await fn(); if (value) return value; await sleep(90); } throw Error('Timed out: ' + JSON.parse(fs.readFileSync(process.env.PSFT_QUERY_RESULT + '.progress')).operation); };
  const call = async (name, args = {}, allowError = false) => {
    const response = await fetch(input.mcpUrl, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method: 'tools/call', params: { name, arguments: args } }), signal: AbortSignal.timeout(60000) });
    const body = await response.text(), value = JSON.parse(body.startsWith('{') ? body : body.split('\n').find(l => l.startsWith('data:')).slice(5));
    if (value.error || value.result?.isError) { if (allowError) return value; throw Error(JSON.stringify(value.error ?? value.result.content)); }
    assert.equal(allowError, false, 'Expected the MCP call to refuse.'); return JSON.parse(value.result.content[0].text);
  };
  const read = name => reader.readQueryDocument(name, operatorId);
  const page = name => ui.webviewAction(name);
  const query = async (name, payload, rerenders = true) => {
    const before = await until(() => page(name)); await ui.webviewAction(name, 'query', payload);
    if (!rerenders) return page(name);
    const after = await until(async () => { const p = await page(name); return p && p.renderNonce !== before.renderNonce && p.busy !== 'true' && p; });
    assert.equal(after.query.status, '', 'Query operation failed: ' + after.query.status); return after;
  };
  const save = async name => {
    await ui.webviewAction(name, 'click', 'save');
    const p = await until(async () => { const p = await page(name); return p?.query.status === 'Saved and verified.' && p; });
    assert.match(p.query.header, /Editable/); assert.doesNotMatch(p.query.header, /Unsaved/); return read(name);
  };
  const open = async name => {
    await vscode.commands.executeCommand('psft.openDefinition', connection, { type: 10, parts: [name, operatorId] });
    return until(async () => { const p = await page(name); return p?.query.forms.includes('addRecord') && p; });
  };
  const fields = async record => { const r = await reader.readRecordLayout({ type: 0, parts: [record] }); return Object.fromEntries(r.fields.map(f => [f.name, { type: f.type, length: f.length, decimalPositions: f.decimalPositions ?? 0, format: f.format ?? 0, shortName: f.shortName, longName: f.longName, editTable: f.editTable, useEdit: f.useEdit }])); };
  const screenshot = name => ui.screenshot(path.join(input.artifactDirectory, 'query-installed-' + name + '-2026-10-21.png'));
  const assertRun = async name => {
    const stored = await read(name), expected = await reader.runQuery(stored.view, operatorId, {});
    await query(name, { click: '[data-tab="results"]' }, false);
    await ui.webviewAction(name, 'query', { submit: '#run' });
    const p = await until(async () => { const p = await page(name); return /^\d+ rows/.test(p?.query.status ?? '') && p; });
    assert.equal(p.query.sql, expected.sql); assert.match(p.query.results, new RegExp(expected.rows.length + ' rows'));
    assert.ok(expected.columnNames.length, 'Execution must retain native projection names.');
    assert.deepEqual(p.query.resultRows, expected.rows.map(row => expected.columnNames.map(name => String(row[name] ?? ''))), 'Every displayed result cell must match independent native execution.');
    return { sql: expected.sql, rows: expected.rows.length };
  };
  const get = id => call('psft_get_change_set', { changeSetId: id });
  const review = async set => {
    await vscode.commands.executeCommand('psft.changeReview.open', set.id);
    return until(async () => { const p = await ui.webviewAction('PeopleSoft Change Review'); return p?.selectedTitle === set.title && p.reviewToken === reviewStateToken(set) && p.busy !== 'true' && p; });
  };
  const apply = async (set, destructive) => {
    await call('psft_validate_change_set', { changeSetId: set.id }); set = await get(set.id);
    assert.equal(set.status, 'READY_FOR_REVIEW', JSON.stringify(set.objects.map(o => o.validation)));
    let p = await review(set);
    if (destructive) {
      assert.equal(p.checkboxes.find(b => b.id === 'destructive')?.checked, false);
      const baseline = await Promise.all(set.objects.map(async o => ({ key: o.key, value: querySnapshotOrNull(await reader.readQueryDocument(o.key[0], o.key[1])) })));
      await ui.webviewAction('PeopleSoft Change Review', 'click', 'approveAndApply');
      await until(async () => { const p = await ui.webviewAction('PeopleSoft Change Review'); return p?.busy !== 'true' && /destructive|explicit/i.test(p?.text ?? '') && p; });
      const refused = await get(set.id); assert.equal(refused.status, 'READY_FOR_REVIEW'); assert.ok(refused.objects.every(o => o.review === 'PENDING'));
      for (const before of baseline) assert.deepEqual(querySnapshotOrNull(await reader.readQueryDocument(before.key[0], before.key[1])), before.value, 'Missing destructive consent must never write.');
      await review(refused);
      await ui.webviewAction('PeopleSoft Change Review', 'checkbox', 'destructive');
    }
    await ui.webviewAction('PeopleSoft Change Review', 'click', 'approveAndApply');
    return until(async () => { const s = await get(set.id); if (['FAILED', 'CONFLICTED', 'PARTIALLY_APPLIED'].includes(s.status)) throw Error(JSON.stringify(s.journal.slice(-4))); return s.status === 'APPLIED' && s; }, 120000);
  };
  const querySnapshotOrNull = edit => edit ? querySnapshot(edit.view) : null;
  try {
    await reader.connect(); results.environment = await reader.readEnvironment();
    assert.equal((await reader.runReadOnlyQuery("SELECT SYS_CONTEXT('USERENV','DB_NAME') AS DB FROM DUAL", 1)).rows[0].DB, 'HRDMO');
    for (const name of Object.values(names)) assert.equal(await read(name), undefined); owned = true;
    load('providers/writeScope').setWriteNamePrefix(prefix);
    for (const [kind, record, selected] of [['aggregate', 'AAP_YEAR', ['ESTABID', 'FEMALE_GOAL']], ['join', 'AAP_YEAR', ['ESTABID', 'FEMALE_GOAL']], ['translate', 'ESTAB_TBL', ['ESTABID', 'EFF_STATUS']], ['union', 'AAP_TBL', ['ESTABID']]]) {
      const metadata = await fields(record); let view = newQueryDocument(names[kind], operatorId, record, metadata);
      for (const field of selected) view = applyQueryOp(view, { kind: 'select', field, selected: true }, metadata);
      await reader.saveQueryDocument({ view, openedToken: 'absent', operatorId });
    }
    const extension = vscode.extensions.getExtension('JaredNorris.peoplesoft-studio'); assert.equal(extension.extensionPath, input.candidate); await extension.activate();
    ui = await require('./peoplecode-editor-cdp.cjs').connectWorkbench(input.cdpUrl);
    await check('Installed candidate connects to HRDMO and discovers the lifecycle MCP tools', async () => {
      let settled = false; const pending = vscode.commands.executeCommand('psft.connect', input.connection).finally(() => settled = true);
      await until(async () => { if (!settled) await ui.answerPassword(`Password for ${input.connection.user}@${input.connection.connectString}`, process.env.PSLAB_ACCESSPSWD); return settled; }); await pending;
      const connections = await until(async () => { try { return await call('psft_list_connections'); } catch { return false; } });
      connection = connections.connections.find(c => c.connected).id;
      const tools = await fetch(input.mcpUrl, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method: 'tools/list' }) }).then(r => r.text());
      for (const name of ['psft_query_delete', 'psft_query_rename']) assert.ok(tools.includes(name));
    });
    await check('Installed designer opens a Studio-saved query and edits aggregates, HAVING, WHERE and DISTINCT', async () => {
      const name = names.aggregate; let p = await open(name); assert.match(p.query.header, /Editable/);
      await query(name, { values: { 'form[data-aggregate="FEMALE_GOAL"] [name="function"]': 'average' }, submit: 'form[data-aggregate="FEMALE_GOAL"]' });
      await query(name, { click: '[data-tab="criteria"]' }, false);
      for (const [kind, field, operator, value] of [['criteria', 'ESTABID', 'like', '%'], ['having', 'FEMALE_GOAL', 'notLess', '0']]) {
        const section = `[data-criteria="${kind}"][data-sel="1"]`;
        await query(name, { click: section + ' [data-add-row]' }, false);
        await query(name, { values: { [section + ' [name="field"]']: field, [section + ' [name="operator"]']: operator, [section + ' [name="kind"]']: 'constant', [section + ' [name="value"]']: value }, click: section + ' [data-apply-criteria]' });
      }
      await query(name, { click: '[data-tab="fields"]' }, false);
      await query(name, { click: '[data-distinct="1"]' });
      const stored = await save(name), described = describeQueryCriteria(stored.view);
      assert.equal(stored.view.fields.find(f => f.FIELDNAME === 'FEMALE_GOAL').TTLTYPE, 6); assert.equal(stored.view.selects[0].QRYDISTINCT, 'Y');
      assert.equal(described.criteria[0].operator, 'like'); assert.equal(described.having[0].operator, 'notLess');
      results.aggregate = await assertRun(name); await screenshot('aggregate');
    });
    await check('Add Record loads joined-record fields; expression columns save and run through the installed UI', async () => {
      const name = names.join; await open(name);
      await query(name, { values: { '#addRecord [name="record"]': 'AAP_TBL', '#addRecord [name="type"]': 'standard' }, submit: '#addRecord' });
      await query(name, { click: '[data-select="B.DESCR"]' });
      await query(name, { values: { '#expression [name="text"]': 'A.FEMALE_GOAL * 2', '#expression [name="type"]': 'number', '#expression [name="length"]': '7' }, submit: '#expression' });
      const stored = await save(name); assert.equal(stored.view.records.length, 2); assert.ok(stored.view.fields.some(f => f.RECNAME === 'AAP_TBL' && f.FIELDNAME === 'DESCR' && Number(f.COLUMNNUM) > 0)); assert.equal(stored.view.expressions.length, 1);
      results.join = await assertRun(name); await screenshot('join-expression');
    });
    await check('Translate and effective-date controls save, reload and run in the installed designer', async () => {
      const name = names.translate; await open(name);
      await query(name, { values: { 'form[data-translate="EFF_STATUS"] [name="value"]': 'long', 'form[data-translate="EFF_STATUS"] [name="effective"]': 'EFFDT' }, submit: 'form[data-translate="EFF_STATUS"]' });
      let field = (await save(name)).view.fields.find(f => f.FIELDNAME === 'EFF_STATUS'); assert.equal(field.XLATTYPE, 3); assert.equal(field.XLATEXPRTYPE, 2);
      results.translateFieldDate = await assertRun(name);
      await query(name, { click: '[data-tab="fields"]' }, false);
      await query(name, { values: { 'form[data-translate="EFF_STATUS"] [name="value"]': 'short', 'form[data-translate="EFF_STATUS"] [name="effective"]': 'current' }, submit: 'form[data-translate="EFF_STATUS"]' });
      const stored = await save(name); assert.equal(stored.view.fields.find(f => f.FIELDNAME === 'EFF_STATUS').XLATTYPE, 2);
      await query(name, { click: '[data-action="reload"]' });
      results.translate = await assertRun(name); await screenshot('translate');
    });
    await check('Installed criteria editor saves IN and correlated EXISTS subqueries', async () => {
      const name = names.join; await open(name); await query(name, { click: '[data-tab="criteria"]' }, false);
      const section = '[data-criteria="criteria"][data-sel="1"]';
      for (const [field, operator, subquery] of [['ESTABID', 'inList', { record: 'AAP_TBL', field: 'ESTABID' }], ['', 'exists', { record: 'AAP_TBL', field: 'ESTABID', criteria: [{ field: 'ESTABID', operator: 'equal', value: { field: 'A.ESTABID' } }] }]]) {
        await query(name, { click: section + ' [data-add-row]' }, false);
        const last = section + ' tbody tr:last-child';
        await query(name, { values: { [last + ' [name="field"]']: field, [last + ' [name="operator"]']: operator, [last + ' [name="kind"]']: 'subquery', [last + ' [name="value"]']: JSON.stringify(subquery) }, click: section + ' [data-apply-criteria]' });
      }
      const described = describeQueryCriteria((await save(name)).view); assert.ok(described.criteria.some(c => c.operator === 'exists'));
      results.subquery = await assertRun(name); await screenshot('subquery');
    });
    await check('Add Record creates a union; its own field catalog and criteria save and run', async () => {
      const name = names.union; await open(name);
      await query(name, { values: { '#addRecord [name="record"]': 'AAP_YEAR', '#addRecord [name="type"]': 'union' }, submit: '#addRecord' });
      await query(name, { click: '[data-select="B.ESTABID"]' });
      await query(name, { click: '[data-tab="criteria"]' }, false);
      const section = '[data-criteria="criteria"][data-sel="2"]';
      await query(name, { click: section + ' [data-add-row]' }, false);
      await query(name, { values: { [section + ' [name="field"]']: 'B.ESTABID', [section + ' [name="operator"]']: 'like', [section + ' [name="kind"]']: 'constant', [section + ' [name="value"]']: '%' }, click: section + ' [data-apply-criteria]' });
      const stored = await save(name); assert.ok(stored.view.selects.some(s => Number(s.SELECTTYPE) === 3));
      results.union = await assertRun(name); await screenshot('union');
    });
    await check('Undo/redo, dirty drafts and discard preserve the saved native query', async () => {
      const name = names.join; await open(name); const baseline = querySnapshot((await read(name)).view);
      await query(name, { click: '[data-tab="properties"]' }, false);
      await query(name, { values: { 'form#properties [name="description"]': 'Unsaved installed check' }, submit: 'form#properties' });
      assert.match((await page(name)).query.header, /Unsaved/);
      await query(name, { click: '[data-action="undo"]' }); await query(name, { click: '[data-action="redo"]' });
      await ui.webviewAction(name, 'query', { click: '[data-action="reload"]' });
      await until(async () => { const d = await ui.dialogAction(); return d?.text.includes('Discard unsaved Query changes?') && d; }); await ui.dialogAction('click', 'Discard');
      await until(async () => /Editable/.test((await page(name))?.query.header ?? ''));
      assert.deepEqual(querySnapshot((await read(name)).view), baseline);
    });
    // Close designers before lifecycle operations so no stale/dirty editor can obscure readback.
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const original = await read(names.join), originalSnapshot = querySnapshot(original.view);
    let rename;
    await check('MCP rename stages copy plus deletion without writing; stale tokens refuse', async () => {
      await call('psft_query_rename', { connection, name: names.join, owner: operatorId, expectedToken: 'stale', targetName: names.renamed, targetOwner: operatorId }, true);
      const staged = await call('psft_query_rename', { connection, name: names.join, owner: operatorId, expectedToken: original.token, targetName: names.renamed, targetOwner: operatorId });
      assert.equal(staged.status, 'REVIEW_REQUIRED'); rename = await get(staged.changeSetId);
      assert.deepEqual(rename.objects.map(o => o.operation), ['CREATE', 'DELETE']); assert.equal(await read(names.renamed), undefined); assert.deepEqual(querySnapshot((await read(names.join)).view), originalSnapshot);
    });
    await check('Rendered destructive approval applies rename and reviewed undo restores the exact original', async () => {
      rename = await apply(rename, true); assert.ok(rename.objects.every(o => o.application === 'VERIFIED')); assert.equal(await read(names.join), undefined);
      assert.deepEqual(querySnapshot((await read(names.renamed)).view), querySnapshot(copyQueryDocument(original.view, names.renamed, operatorId))); await screenshot('renamed');
      const inverse = await apply(await call('psft_prepare_revert', { changeSetId: rename.id }), true);
      assert.equal(await read(names.renamed), undefined); assert.deepEqual(querySnapshot((await read(names.join)).view), originalSnapshot);
      assert.equal((await get(rename.id)).status, 'REVERTED'); results.rename = { changeSetId: rename.id, inverseSetId: inverse.id }; await screenshot('rename-undone');
    });
    await check('MCP delete stages without writing; rendered approval deletes and reviewed undo recreates exactly', async () => {
      const before = await read(names.aggregate), snapshot = querySnapshot(before.view);
      const staged = await call('psft_query_delete', { connection, name: names.aggregate, owner: operatorId, expectedToken: before.token }); assert.equal(staged.status, 'REVIEW_REQUIRED');
      assert.deepEqual(querySnapshot((await read(names.aggregate)).view), snapshot);
      let deletion = await get(staged.changeSetId); assert.equal(deletion.objects.length, 1); assert.equal(deletion.objects[0].operation, 'DELETE');
      deletion = await apply(deletion, true); assert.equal(await read(names.aggregate), undefined); assert.ok(deletion.objects.every(o => o.application === 'VERIFIED'));
      const inverse = await apply(await call('psft_prepare_revert', { changeSetId: deletion.id }), false);
      assert.deepEqual(querySnapshot((await read(names.aggregate)).view), snapshot); assert.equal((await get(deletion.id)).status, 'REVERTED');
      results.delete = { changeSetId: deletion.id, inverseSetId: inverse.id }; await screenshot('delete-undone');
    });
    results.passed = true;
  } catch (e) { results.error = e.stack ?? String(e); console.error(results.error); results.passed = false; if (ui) await screenshot('failure').catch(() => {}); }
  finally {
    try {
      if (owned) {
        const setDir = path.join(input.storage, 'change-review/sets');
        if (fs.existsSync(setDir)) for (const file of fs.readdirSync(setDir).filter(f => f.endsWith('.json'))) assert.notEqual(JSON.parse(fs.readFileSync(path.join(setDir, file))).value.status, 'APPLYING', 'Refuse cleanup while a writer is active.');
        for (const name of Object.values(names)) {
          for (const table of [...Object.keys(QUERY_TABLES).reverse(), 'PSQRYDEL']) await c.execute(`DELETE FROM ${table} WHERE QRYNAME=:n AND OPRID=:o`, { n: name, o: operatorId });
        }
        await c.commit();
        for (const name of Object.values(names)) for (const table of [...Object.keys(QUERY_TABLES), 'PSQRYDEL']) assert.equal(Number((await c.execute(`SELECT COUNT(*) AS N FROM ${table} WHERE QRYNAME=:n AND OPRID=:o`, { n: name, o: operatorId })).rows[0].N), 0);
        results.cleanupVerified = true;
      }
    } catch (e) { results.passed = false; results.cleanupError = e.stack ?? String(e); }
    results.passed &&= results.cleanupVerified;
    fs.writeFileSync(process.env.PSFT_QUERY_RESULT, JSON.stringify(results, null, 2));
    ui?.close(); await c.close(); await pool.close(); await reader.dispose();
  }
  assert.equal(results.passed, true, results.error ?? results.cleanupError);
};
