import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  ACTION_ORDER, actionSqlId, buildAppEngine, peopleCodeKeyParts, renderAppEngine, unpackPeopleCodeKey, type AppEngineRows
} from '../model/appEngine.js';

/** Rows read from HRDMO by DatabaseProvider.readAppEngineRows (2026-10-07). */
const rows = (name: string) =>
  JSON.parse(readFileSync(path.join('src', 'test', 'fixtures', 'appEngine', `${name}.rows.json`), 'utf8')) as AppEngineRows;

test('TL_CAL_GEN: sections MAIN first, steps by sequence, actions in App Designer\'s order', () => {
  const p = buildAppEngine(rows('TL_CAL_GEN'));
  assert.equal(p.description, 'Build Time Period Calendar');
  assert.deepEqual(p.stateRecords, [{ record: 'TL_TIME_AET', isDefault: true }, { record: 'TL_TA_MAIN_AET', isDefault: false }]);
  assert.deepEqual(p.sections.map((s) => s.name), ['MAIN', 'LOOP']);
  const loop = p.sections[1].variants[0];
  assert.deepEqual(loop.steps.map((s) => [s.name, s.seq]), [['Step010', 1], ['Step020', 2], ['Step030', 3]]);
  assert.deepEqual(loop.steps.map((s) => s.actions.map((a) => a.type).join('')), ['PM', 'HS', 'HS']);
  const main = p.sections[0].variants[0].steps[0];
  assert.deepEqual(main.actions.map((a) => a.type), ['D', 'C']);
  assert.deepEqual(main.call, { section: 'LOOP', program: 'TL_CAL_GEN', dynamic: false });
  assert.deepEqual(loop.steps[0].message, { set: 13500, number: 219, text: 'Completed building calendar %1 at %2' });
  assert.equal(loop.steps[0].actions[1].messageParms, '%Bind(PERIOD_ID), %Bind(TIME_RECORDED)');
  // Every SQL-based action found its text.
  for (const v of p.sections.flatMap((s) => s.variants)) {
    for (const a of v.steps.flatMap((s) => s.actions).filter((x) => x.sqlId)) assert.ok(a.text && a.text.length > 10, a.sqlId);
  }
});

test('PTIAAUTSKEXE: Do While and Do Until hold their SQL, Do Until last', () => {
  const p = buildAppEngine(rows('PTIAAUTSKEXE'));
  const types = p.sections.flatMap((s) => s.variants.flatMap((v) => v.steps.map((st) => st.actions.map((a) => a.type).join(''))));
  assert.ok(types.some((t) => t.includes('W')) && types.some((t) => t.endsWith('N')), types.join(','));
  for (const t of types) {
    const order = [...t].map((c) => ACTION_ORDER.indexOf(c as never));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), t);
  }
});

test('an action\'s SQL definition ID and a PeopleCode action\'s PSPCMPROG key', () => {
  assert.equal(actionSqlId('AEMINITEST', 'MAIN', 'Step01', 'S'), 'AEMINITEST  MAIN    Step01  S');
  assert.equal(actionSqlId('TL_CAL_GEN', 'MAIN', 'Step01', 'D').length, 29);
  assert.deepEqual(peopleCodeKeyParts('TL_CAL_GEN', 'LOOP', { market: 'GBL', dbType: ' ', effdt: '1900-01-01' }, 'Step010'),
    ['TL_CAL_GEN', 'LOOP', 'GBL', 'default', '1900-01-01', 'Step010', 'OnExecute']);
  assert.equal(peopleCodeKeyParts('X', 'S', { market: 'GBL', dbType: '2', effdt: '1900-01-01' }, 'A')?.[3], 'ORACLE');
  // AllBase has no PeopleCode platform name: the action is shown as not read (UPGPT848VA, VACONVERT2).
  assert.equal(peopleCodeKeyParts('X', 'S', { market: 'GBL', dbType: '5', effdt: '1900-01-01' }, 'A'), undefined);
});

test('a project item\'s packed PeopleCode key unpacks to PSPCMPROG\'s seven parts (GP_LANG_INSTALL\'s items)', () => {
  assert.deepEqual(unpackPeopleCodeKey(['GPSC_LNGNR', 'CRNRPKG GBLdefault  1900-01-01', 'Step10', 'OnExecute']),
    ['GPSC_LNGNR', 'CRNRPKG', 'GBL', 'default', '1900-01-01', 'Step10', 'OnExecute']);
  assert.deepEqual(unpackPeopleCodeKey(['PORTALPATHAE', 'FillPathGBLdefault  1900-01-01', 'Step01', 'OnExecute']),
    ['PORTALPATHAE', 'FillPath', 'GBL', 'default', '1900-01-01', 'Step01', 'OnExecute']);
  const seven = ['A', 'MAIN', 'GBL', 'default', '1900-01-01', 'Step01', 'OnExecute'];
  assert.equal(unpackPeopleCodeKey(seven), seven);
});

test('one section renders alone (an App Engine Section project item)', () => {
  const p = buildAppEngine(rows('TL_CAL_GEN'));
  const text = renderAppEngine(p, undefined, 'LOOP');
  assert.ok(text.includes('Section LOOP') && !text.includes('Section MAIN'));
  assert.throws(() => renderAppEngine(p, undefined, 'NOPE'), /no section NOPE/);
});

test('the program renders as Program Flow text, PeopleCode inline', () => {
  const p = buildAppEngine(rows('TL_CAL_GEN'));
  const text = renderAppEngine(p, (_s, _v, step) => (step.name === 'Step010' ? 'TLBuildCalendar(&TL_TIME_AET);' : undefined));
  assert.match(text, /^App Engine Program TL_CAL_GEN -- Build Time Period Calendar\n/);
  assert.match(text, /State records: TL_TIME_AET \(default\), TL_TA_MAIN_AET/);
  assert.match(text, /Section MAIN {2}\[Market GBL, Platform Default, Effective 1900-01-01\]/);
  assert.match(text, / {4}Call Section -- .*\n {6}TL_CAL_GEN\.LOOP\n/);
  assert.match(text, / {4}PeopleCode {2}\(On Return: Skip Step\).*\n {6}TLBuildCalendar\(&TL_TIME_AET\);\n/);
  // The Message Catalog text inline (PSMSGCATDEFN 13500 / 219).
  assert.match(text, / {6}Message 13500, 219: "Completed building calendar %1 at %2" {2}Parameters: %Bind\(PERIOD_ID\), %Bind\(TIME_RECORDED\)/);
  assert.ok(text.indexOf('Section MAIN') < text.indexOf('Section LOOP'));
  assert.ok(!text.includes('[object Object]'));
});

test('PeopleCode project keys unpack to PSPCMPROG parts: App Engine, component record field, Application Class', async () => {
  const { pcmProgKeyParts } = await import('../model/peopleCodeKeys.js');
  const { DefinitionType, makeKey } = await import('../model/definitions.js');
  assert.deepEqual(pcmProgKeyParts(makeKey(DefinitionType.ComponentRecordFieldPeopleCode, 'PSLCMOPTIONS', 'GBL', 'PTUM_OPTWRK', 'PTUMPURGE_DATA    FieldChange')),
    ['PSLCMOPTIONS', 'GBL', 'PTUM_OPTWRK', 'PTUMPURGE_DATA', 'FieldChange']);
  assert.deepEqual(pcmProgKeyParts(makeKey(DefinitionType.ComponentRecordFieldPeopleCode, 'C', 'GBL', 'R', 'F', 'FieldChange')),
    ['C', 'GBL', 'R', 'F', 'FieldChange']);
  assert.deepEqual(pcmProgKeyParts(makeKey(DefinitionType.AppEnginePeopleCode, 'GPSC_LNGNR', 'CRNRPKG GBLdefault  1900-01-01', 'Step10', 'OnExecute')),
    ['GPSC_LNGNR', 'CRNRPKG', 'GBL', 'default', '1900-01-01', 'Step10', 'OnExecute']);
  assert.deepEqual(pcmProgKeyParts(makeKey(DefinitionType.ApplicationClassPeopleCode, 'OU_JET_PACK', 'Layout', 'ComponentRegistry')),
    ['OU_JET_PACK', 'Layout', 'ComponentRegistry', 'OnExecute']);
});
