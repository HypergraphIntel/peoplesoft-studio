import {
  changeActionType, deleteAction, deleteSection, deleteStep, findStep, insertAction, insertSection, insertStep, moveStep, pasteStep,
  renameSection, renameStep, setApplicationLibrary, type AeDocument
} from '../model/aeDocument.js';
import { applyOp } from '../model/aeSession.js';
import type { ActionType } from '../model/appEngine.js';

/*
 * Each App Designer save captured on ZZ_AE_LAB01 (docs/APP_ENGINE.md), as
 * the document operation that makes the same edit: applied to the program
 * as it was before the save, it gives the rows App Designer saved. The
 * document tests replay them on the model (aeDocument.test.ts); the lab
 * harness replays them through the writer on a live database
 * (tools/lab/ae-replay.mts).
 */

type Edit = (d: AeDocument) => AeDocument;
const MAIN = 'MAIN';

const prog = (patch: Partial<AeDocument['program']>): Edit => (d) => ({ ...d, program: { ...d.program, ...patch } });
const section = (name: string, patch: object, variant: object = {}): Edit => (d) => {
  const doc = structuredClone(d);
  const s = doc.sections.find((x) => x.name === name)!;
  Object.assign(s, patch);
  Object.assign(s.variants[0], variant);
  return doc;
};
const step = (sec: string, name: string, patch: object): Edit => (d) => {
  const doc = structuredClone(d);
  Object.assign(findStep(doc, { section: sec, step: name }).step, patch);
  return doc;
};
const action = (sec: string, name: string, type: string, patch: object): Edit => (d) => {
  const doc = structuredClone(d);
  Object.assign(findStep(doc, { section: sec, step: name }).step.actions.find((a) => a.type === type)!, patch);
  return doc;
};

/** Structural operations (sections, steps, actions). */
export const STRUCTURE_OPS: Record<string, Edit> = {
  'ax26-insert-step2': (d) => insertStep(d, { section: MAIN, after: 'Step01' }).doc,
  'ao01-insert-middle': (d) => insertStep(d, { section: MAIN, after: 'Init' }).doc,
  'aa01-insert-step': (d) => insertStep(d, { section: MAIN }).doc,
  'ax08-insert-action': (d) => insertAction(d, { section: MAIN, step: 'Step01' }).doc,
  'ax09-insert-2': (d) => insertAction(d, { section: MAIN, step: 'Step01' }).doc,
  'ax13-insert-3': (d) => insertAction(d, { section: MAIN, step: 'Step01' }).doc,
  'ax14-insert-4': (d) => insertAction(d, { section: MAIN, step: 'Step01' }).doc,
  'ax15-insert-5': (d) => insertAction(d, { section: MAIN, step: 'Step01' }).doc,
  'ax16-insert-6': (d) => insertAction(d, { section: MAIN, step: 'Step01' }).doc,
  // App Designer's Insert Action went on to XSLT even in a Standard program; here XSLT is inserted by name.
  'ax17-insert-7': (d) => insertAction(d, { section: MAIN, step: 'Step01', type: 'X' }).doc,
  'ax27-type-to-call': (d) => changeActionType(d, { section: MAIN, step: 'Step02', type: 'S' }, 'C'),
  // A Do When inserted (not saved), its type changed to PeopleCode, then saved.
  'ax31-type-to-pc': (d) => changeActionType(insertAction(d, { section: 'Section2', step: 'Step01', type: 'H' }).doc,
    { section: 'Section2', step: 'Step01', type: 'H' }, 'P'),
  'ad01-delete-pc': (d) => deleteAction(d, { section: MAIN, step: 'Init', type: 'P' }),
  'ad02-delete-sql': (d) => deleteAction(d, { section: MAIN, step: 'Init', type: 'S' }),
  'ao04-delete-step': (d) => deleteStep(d, { section: MAIN, step: 'Init3' }),
  'ao02-cut-paste': (d) => moveStep(d, { section: MAIN, step: 'Step02' }, 'Init'),
  'ao03-copy-paste': (d) => pasteStep(d, findStep(d, { section: MAIN, step: 'Init' }).step, { section: MAIN, after: 'Init2' }).doc,
  'ae10-insert-section': (d) => insertSection(d).doc,
  'ae11-rename-section': (d) => renameSection(d, 'Section2', 'Proc'),
  'ae16-delete-section': (d) => deleteSection(d, 'Proc'),
  'ar01-rename-step': (d) => renameStep(d, { section: MAIN, step: 'Step01' }, 'Init'),
  'ap05-app-library': (d) => setApplicationLibrary(d, true),
  'ap19-app-library-off': (d) => setApplicationLibrary(d, false)
};

/** Property edits. */
export const PROPERTY_OPS: Record<string, Edit> = {
  'ap01-descr': prog({ descr: 'AE lab program', asOfDate: '1900-01-01' }),
  'ap02-comments': prog({ descrlong: 'Lab comments line' }),
  'ap03-owner': prog({ owner: 'HGA' }),
  'ap04-disable-restart': prog({ disableRestart: true }),
  'ap06-batch-only': prog({ recuse: 2 }),
  'ap07-share-online': prog({ recuse: 6 }),
  'ap08-use-delete': prog({ recuse: 14 }),
  'ap09-runtime-abort': prog({ recuse: 15 }),
  'ap10-instances': prog({ tempTableInstances: 3 }),
  'ap16-msgset': prog({ messageSet: 1000 }),
  'ap17-progtype': prog({ programType: '3' }),
  'ap18-progtype-transform': prog({ programType: '4' }),
  'ap20-progtype-std': prog({ programType: '0' }),
  'ap11-state-add': (d) => ({ ...d, stateRecords: [{ record: 'AE_GB_AET', isDefault: true }] }),
  'ap12-state-add2': (d) => ({ ...d, stateRecords: [...d.stateRecords, { record: 'AE_GB_API_AET', isDefault: false }] }),
  'ap13-state-default': (d) => ({ ...d, stateRecords: d.stateRecords.map((s) => ({ ...s, isDefault: s.record === 'AE_GB_API_AET' })) }),
  'ap14-state-remove': (d) => ({ ...d, stateRecords: d.stateRecords.filter((s) => s.record !== 'AE_GB_AET') }),
  'ap15-temp-add': (d) => ({ ...d, tempTables: ['ZZ_PCODE_TMP'] }),
  'as01-descr': section('Section1', {}, { descr: 'Lab section one' }),
  'as02-market': section('Section1', {}, { market: 'GBR' }),
  'as03-platform': section('Section1', {}, { dbType: '2' }),
  'as04-effdt': section('Section1', {}, { effdt: '2001-01-20' }),
  'as05-status': section('Section1', {}, { active: false }),
  'as06-secttype': section('Section1', { type: 'C' }),
  'as07-autocommit': section('Section1', {}, { autoCommit: 'Y' }),
  'as08-access': section('Section1', { isPublic: false }),
  'as09-comment': section('Section1', {}, { descrlong: 'Section comment' }),
  'at01-descr': step('Section1', 'Step01', { descr: 'Lab step one' }),
  'at02-commit-after': step('Section1', 'Step01', { commitAfter: 'Y' }),
  'at03-commit-later': step('Section1', 'Step01', { commitAfter: 'N' }),
  'at04-onerror-ignore': step('Section1', 'Step01', { onError: 'I' }),
  'at05-onerror-suppress': step('Section1', 'Step01', { onError: 'S' }),
  'at06-inactive': step('Section1', 'Step01', { active: false }),
  'at07-comment': step('Section1', 'Step01', { descrlong: 'Step comment' }),
  'ax01-reuse-yes': action(MAIN, 'Step01', 'S', { reuse: 'Y' }),
  'ax02-reuse-bulk': action(MAIN, 'Step01', 'S', { reuse: 'I' }),
  'ax03-norows-break': step(MAIN, 'Step01', { onNoRows: 'B' }),
  'ax04-norows-abort': step(MAIN, 'Step01', { onNoRows: 'A' }),
  'ax05-norows-skip': step(MAIN, 'Step01', { onNoRows: 'S' }),
  'ax06-descr': action(MAIN, 'Step01', 'S', { descr: 'Lab SQL' }),
  'ax07-comment': action(MAIN, 'Step01', 'S', { descrlong: 'Action comment' }),
  'ax20-dst-reselect': action(MAIN, 'Step01', 'D', { doSelectType: 'R' }),
  'ax21-dst-restart': action(MAIN, 'Step01', 'D', { doSelectType: 'Y' }),
  'ax22-onreturn-break': step(MAIN, 'Step01', { onReturn: 'B' }),
  'ax23-onreturn-skip': step(MAIN, 'Step01', { onReturn: 'S' }),
  'ax24-frequency': step(MAIN, 'Step01', { commitFrequency: 100 }),
  'ax25-logmsg': step(MAIN, 'Step01', { messageSet: 1000, messageNumber: 25, messageParms: "%Bind(OPRID), 'x'" }),
  'ax28-call-section': step(MAIN, 'Step02', { doSection: 'Section1' }),
  'ax29-call-external': step(MAIN, 'Step02', { doSection: MAIN, doProgram: 'AEDAEMONMGR' }),
  'ax30-call-dynamic': step(MAIN, 'Step02', { doSection: ' ', doProgram: ' ', dynamic: true }),
  'ax40-xslt-mapper-no': action(MAIN, 'Init', 'X', { reuse: 'I' }),
  'ax41-xslt-mapper-yes': action(MAIN, 'Init', 'X', { reuse: 'N' }),
  'ae18-market-with-actions': section(MAIN, {}, { market: 'GBR' }),
  'ae19-market-back': section(MAIN, {}, { market: 'GBL' })
};

/** SQL text and PeopleCode saves: the text typed in App Designer's editor, stored as an edit stores it (aeSession setAction). */
const text = (sec: string, name: string, type: string, typed: string): Edit => (d) =>
  applyOp(d, { kind: 'setAction', ref: { section: sec, step: name, type: type as ActionType }, patch: type === 'P' ? { peopleCode: typed } : { text: typed } });
export const TEXT_OPS: Record<string, Edit> = {
  'aa02-sql-text': text(MAIN, 'Step01', 'S', 'update PS_ZZ_X set A = 1\n  where B = %Bind(EMPLID)  '),
  'aa04-sql-newlines': text(MAIN, 'Step01', 'S', 'select x\nfrom y\nwhere z = 1'),
  'aa05-sql-indent': text(MAIN, 'Step01', 'S', 'select x\n   from y\n\nwhere z = 1 '),
  'aa06-sql-ws': text(MAIN, 'Step01', 'S', 'a0\n b1\n  c2\n   d3\n    e4\nf5  \ng6\n\nh7\n\t i8'),
  'aa07-sql-ws2': text(MAIN, 'Step01', 'S', '  s1\n\t\tt2\nu3\t\tv3\n   \nw4  x4\n\tz'),
  'aa08-sql-literals': text(MAIN, 'Step01', 'S', `select 'a  b' ,  "d  e"  from x  /* f  g */  where c = '  '`),
  'aa09-sql-quote-nl': text(MAIN, 'Step01', 'S', `select 'x  \n  y' from z  \nwhere 'it''s  ok' = a`),
  'aa10-sql-edges': text(MAIN, 'Step01', 'S', "\n  select 'a\tb'\t\tfrom x\n\n"),
  'ap-pc01-create': text(MAIN, 'Step01', 'P', 'Local string &s = "ae01";'),
  'ap-pc02-update': text(MAIN, 'Step01', 'P', 'Local string &s = "ae02";'),
  'ax43-xslt-text': text(MAIN, 'Init', 'X', '<xsl:stylesheet version="1.0">\r\n  <xsl:template  match="/"/>\r\n</xsl:stylesheet>  ')
};

export const CAPTURE_OPS: Record<string, Edit> = { ...STRUCTURE_OPS, ...PROPERTY_OPS, ...TEXT_OPS };
