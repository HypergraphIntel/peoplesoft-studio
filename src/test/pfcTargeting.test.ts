import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTarget, describeTarget, headerLevel, listsUsed, targetOf, withApplyLevel, withTarget, type TargetedConfiguration } from '../model/pfcTargeting.js';
import { PFC_TARGETING_TABLES, checkConfiguration, normalizeConfiguration, planPfcRows, type PfcColumns } from '../providers/pfcWriter.js';

/*
 * Who a Page and Field Configurator configuration applies to
 * (model/pfcTargeting.ts), on the shapes Oracle's configurations on HRDMO
 * have: JOB_DATA_FL at header level, everyone but two roles; EE_HR_PROC_FL per
 * sequence, a single role each; PERSONAL_DATA's masking per sequence, selected
 * users.
 */

const JOB_DATA_FL: TargetedConfiguration = {
  header: { DESCR: 'Job Data', EOCC_APPLY_LVL: 'H' },
  sequences: [{ SEQUENCE_NBR: 1, EOCC_SEQUENCE_NBR: 1 }],
  excludedRoles: [{ ROLENAME: 'HR Admin Approver Fluid' }, { ROLENAME: 'HR Admin Correction Apvr Fluid' }]
};
const PERSONAL_DATA: TargetedConfiguration = {
  header: { DESCR: 'Mask', EOCC_APPLY_LVL: 'S' },
  sequences: [{ SEQUENCE_NBR: 1, EOCC_SEQUENCE_NBR: 1, EOCC_APPLY_TO: 'U' }, { SEQUENCE_NBR: 2, EOCC_SEQUENCE_NBR: 2, EOCC_APPLY_TO: 'U' }],
  seqUsers: [{ SEQUENCE_NBR: 1, EOCC_SEQUENCE_NBR: 1, OPRID: 'SQUILLIGAN' }, { SEQUENCE_NBR: 2, EOCC_SEQUENCE_NBR: 2, OPRID: 'CBLUM' }]
};

test('who a configuration applies to, read as the page shows it', () => {
  assert.equal(headerLevel(JOB_DATA_FL), true);
  assert.equal(headerLevel({ header: {}, sequences: [] }), true, 'H is the record default');
  assert.deepEqual(targetOf(JOB_DATA_FL), { applyTo: 'A', roles: [], excludedRoles: ['HR Admin Approver Fluid', 'HR Admin Correction Apvr Fluid'], users: [], excludedUsers: [] });
  assert.equal(describeTarget(targetOf(JOB_DATA_FL)), 'Everyone, except roles HR Admin Approver Fluid, HR Admin Correction Apvr Fluid');
  assert.equal(headerLevel(PERSONAL_DATA), false);
  assert.deepEqual(targetOf(PERSONAL_DATA, PERSONAL_DATA.sequences[1]).users, ['CBLUM']);
  assert.equal(describeTarget(targetOf(PERSONAL_DATA, PERSONAL_DATA.sequences[0])), 'Users SQUILLIGAN');
});

test('setting a sequence\'s target writes its Apply To, role and the lists it uses; other sequences and unused lists stay', () => {
  const seq = PERSONAL_DATA.sequences[0];
  const single = withTarget(PERSONAL_DATA, seq, { applyTo: 'R', role: 'PAR Requestor', roles: [], excludedRoles: [], users: [], excludedUsers: ['SQUILLIGAN'] });
  assert.deepEqual([single.sequences[0].EOCC_APPLY_TO, single.sequences[0].ROLENAME], ['R', 'PAR Requestor']);
  assert.deepEqual(single.seqExcludedUsers, [{ SEQUENCE_NBR: 1, EOCC_SEQUENCE_NBR: 1, OPRID: 'SQUILLIGAN' }]);
  assert.deepEqual(single.seqUsers, PERSONAL_DATA.seqUsers, 'the selected-users list is only hidden, as the page hides it');
  assert.deepEqual(single.sequences[1], PERSONAL_DATA.sequences[1]);
  const header = withTarget(JOB_DATA_FL, undefined, { applyTo: 'S', roles: ['Manager'], excludedRoles: [], users: [], excludedUsers: [] });
  assert.deepEqual(header.roles, [{ ROLENAME: 'Manager' }]);
  assert.equal(header.header.ROLENAME, '');
  assert.deepEqual(header.excludedRoles, JOB_DATA_FL.excludedRoles);
  assert.equal(withApplyLevel(JOB_DATA_FL, 'S').header.EOCC_APPLY_LVL, 'S');
});

test('a target is checked: a single role names one; lists name each once', () => {
  assert.deepEqual(listsUsed('A'), ['excludedRoles', 'excludedUsers']);
  assert.deepEqual(listsUsed('U'), ['users']);
  assert.equal(checkTarget({ applyTo: 'R', roles: [], excludedRoles: [], users: [], excludedUsers: [] }).length, 1);
  assert.equal(checkTarget({ applyTo: 'U', roles: [], excludedRoles: [], users: ['A', 'A'], excludedUsers: [] }).length, 1);
  assert.equal(describeTarget({ applyTo: 'S', roles: [], excludedRoles: [], users: [], excludedUsers: [] }), 'Specific roles: none listed (no one)');
});

test('the writer saves a target\'s rows into its tables, after the sequence, and checks them', () => {
  const cols = (names: string[]) => names.map((name) => ({ name, type: /NBR/.test(name) ? 'NUMBER' : 'VARCHAR2' }));
  const keys = ['PNLGRPNAME', 'MARKET', 'EOCC_CONFIG_TYPE'];
  const seqList = (field: string) => cols([...keys, 'EOCC_SEQUENCE_NBR', 'SEQUENCE_NBR', field]);
  const columns: PfcColumns = {
    header: cols([...keys, 'DESCR', 'EFF_STATUS', 'EOCC_APPLY_LVL', 'EOCC_APPLY_TO', 'ROLENAME']),
    sequences: cols([...keys, 'EOCC_SEQUENCE_NBR', 'SEQUENCE_NBR', 'STATUS', 'EOCC_APPLY_TO', 'ROLENAME']),
    criteria: [], pages: [], fields: cols([...keys, 'SEQUENCE_NBR', 'EOCC_SEQUENCE_NBR', 'RECNAME', 'FIELDNAME', 'OCCURSLEVEL', 'RECNAME1', 'FIELDNAME1']),
    seqUsers: seqList('OPRID'), seqExcludedUsers: seqList('OPRID'), seqRoles: seqList('ROLENAME'), seqExcludedRoles: seqList('ROLENAME'),
    users: cols([...keys, 'OPRID']), excludedUsers: cols([...keys, 'OPRID']), roles: cols([...keys, 'ROLENAME']), excludedRoles: cols([...keys, 'ROLENAME'])
  };
  assert.equal(PFC_TARGETING_TABLES.length, 8);
  const base = { header: { DESCR: 'X', EFF_STATUS: 'A', EOCC_APPLY_LVL: 'S' }, sequences: [{ SEQUENCE_NBR: 1, EOCC_SEQUENCE_NBR: 1, STATUS: 'A', EOCC_APPLY_TO: 'A' }] };
  const stored = normalizeConfiguration(columns, 'C', 'GBL', 'STD', base);
  const next = normalizeConfiguration(columns, 'C', 'GBL', 'STD', withTarget(base, base.sequences[0], { applyTo: 'S', roles: ['Manager', 'Employee'], excludedRoles: [], users: [], excludedUsers: ['PS'] }));
  const plan = planPfcRows(columns, stored, next);
  const tables = plan.statements.map((st) => /^(INSERT INTO|DELETE FROM|UPDATE) (\w+)/.exec(st.sql)!.slice(1).join(' '));
  assert.deepEqual(tables, ['DELETE FROM PS_EOCC_CONFIG_SEQ', 'INSERT INTO PS_EOCC_CONFIG_SEQ', 'INSERT INTO PS_EOCC_SEQ_EXLST', 'INSERT INTO PS_EOCC_SEQ_INCROL', 'INSERT INTO PS_EOCC_SEQ_INCROL']);
  assert.deepEqual(checkConfiguration(next).errors, []);
  // A single role must be named; a list row must belong to a sequence.
  const noRole = normalizeConfiguration(columns, 'C', 'GBL', 'STD', { ...base, sequences: [{ ...base.sequences[0], EOCC_APPLY_TO: 'R' }] });
  assert.match(checkConfiguration(noRole).errors.join(), /single role but names none/);
  const orphan = normalizeConfiguration(columns, 'C', 'GBL', 'STD', { ...base, seqUsers: [{ SEQUENCE_NBR: 9, EOCC_SEQUENCE_NBR: 9, OPRID: 'PS' }] });
  assert.match(checkConfiguration(orphan).errors.join(), /seqUsers: a row for sequence 9\/9/);
  const nobody = normalizeConfiguration(columns, 'C', 'GBL', 'STD', { ...base, sequences: [{ ...base.sequences[0], EOCC_APPLY_TO: 'U' }] });
  assert.match(checkConfiguration(nobody).warnings.join(), /selected users but lists none/);
});
