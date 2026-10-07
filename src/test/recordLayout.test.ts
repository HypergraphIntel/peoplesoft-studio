import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FieldType, RecordType } from '../model/record.js';
import { defaultText, editsRows, formatText, lengthText, typeAbbreviation, useRows, type RecordLayout, type RecordLayoutField } from '../model/recordLayout.js';
import { renderRecordHtml } from '../editors/recordHtml.js';

const field = (over: Partial<RecordLayoutField>): RecordLayoutField => ({
  fieldNum: 1, name: 'OPRID2', isSubrecord: false, type: FieldType.Character, length: 30, decimalPositions: 0, format: 0,
  shortName: 'User ID', longName: 'User ID', useEdit: 0, hasPeopleCode: false, editTable: '', defaultRecord: '', defaultField: '', ...over
});

test('the Field display columns read as App Designer shows them', () => {
  const f = field({});
  assert.deepEqual([typeAbbreviation(f), lengthText(f), formatText(f)], ['Char', '30', 'Upper']);
  assert.equal(lengthText(field({ type: FieldType.Number, length: 12, decimalPositions: 2 })), '12.2');
  // Every field shows its length, as PSOPRDEFN does in App Designer.
  assert.equal(lengthText(field({ type: FieldType.Date, length: 10 })), '10');
  assert.equal(lengthText(field({ type: FieldType.DateTime, length: 26 })), '26');
  assert.equal(lengthText(field({ type: FieldType.LongCharacter, length: 0 })), '0');
  assert.equal(formatText(field({ type: FieldType.Number, format: 0 })), '');
  assert.equal(formatText(field({ format: 6 })), 'Mixed');
  assert.equal(formatText(field({ type: FieldType.Number, format: 7 })), 'Raw B');
  assert.equal(formatText(field({ type: FieldType.DateTime, format: 12 })), 'Scnds');
  assert.equal(formatText(field({ format: 8 })), '8');
  const sub = field({ name: 'ABS_H_D_NLDSBR', isSubrecord: true, type: undefined, length: undefined });
  assert.deepEqual([typeAbbreviation(sub), lengthText(sub), formatText(sub)], ['SRec', '', '']);
});

const layout: RecordLayout = {
  name: 'ZZ_REC', description: 'Scratch', recordType: RecordType.Table, sqlTableName: '', version: 3,
  fields: [field({}), field({ fieldNum: 2, name: 'SUB_SBR', isSubrecord: true, type: undefined, length: undefined })]
};

test('the page has the Record Fields and Record Type tabs; read-only, it offers no editing', () => {
  const html = renderRecordHtml(layout, 'HRDMO', 'n');
  for (const s of ['Record Fields', 'Record Type', '<th>Field Name</th>', '<th>Short Name</th>', '<th>Long Name</th>',
    '>OPRID2<', '>Upper<', '>SRec<', 'Non-Standard SQL', 'SQL Table', 'Temporary Table']) {
    assert.ok(html.includes(s), s);
  }
  assert.ok(html.includes('<div class="radio on"><span class="dot"></span>SQL Table</div>'));
  assert.ok(html.includes('data-editable="0"') && !html.includes('data-act="insert"') && !html.includes('draggable'));
  assert.ok(html.includes('Double-click a field for its PeopleCode'));
  assert.ok(html.includes(`script-src 'nonce-n'`) && html.includes('<script nonce="n">'));
});

test('editable, the page offers the toolbar, dragging and the Use toggles', () => {
  const html = renderRecordHtml(layout, 'HRDMO', 'n', { editable: true });
  assert.ok(html.includes('data-editable="1"') && html.includes('data-act="insert"') && html.includes('draggable="true"'));
  assert.ok(html.includes('data-act="key" data-i="0"') && html.includes('data-act="listBox" data-i="0"'));
});

test('fields with Record Field PeopleCode are bold, as in App Designer', () => {
  const html = renderRecordHtml({ ...layout, fields: [field({ hasPeopleCode: true }), field({ fieldNum: 2, name: 'PLAIN' })] }, 'X', 'n');
  assert.ok(html.includes('<td class="name pc">OPRID2</td>'));
  assert.ok(html.includes('<td class="name">PLAIN</td>'));
});

test('an unknown stored record type is said, not mapped', () => {
  const html = renderRecordHtml({ ...layout, recordType: 4 as RecordType }, 'X', 'n');
  assert.ok(html.includes('Stored record type 4 is not one of these.'));
  assert.ok(!html.includes('radio on'));
});

test('view text is shown on the Record Type tab, escaped', () => {
  const html = renderRecordHtml({ ...layout, recordType: RecordType.View, viewSql: 'SELECT A FROM B WHERE X < 1' }, 'X', 'n');
  assert.ok(html.includes('SELECT A FROM B WHERE X &lt; 1'));
});

test('the Use display reads like App Designer\'s for ABS_HIST_DET and PSOPRDEFN', () => {
  // ABS_HIST_DET: EMPLID .. COMMENT_DT are keys 1-5, BEGIN_DT and COMMENT_DT descending; a subrecord row is blank.
  const abs = useRows([
    field({ name: 'EMPLID', useEdit: 0x804101 }), field({ name: 'EMPL_RCD', useEdit: 0x800001 }),
    field({ name: 'BEGIN_DT', useEdit: 0x800141 }), field({ name: 'ABS_H_D_NLDSBR', isSubrecord: true, useEdit: 0 }),
    field({ name: 'COMMENTS', useEdit: 0x800000 })
  ]);
  assert.deepEqual(abs.map((u) => [u.key, u.order, u.dir, u.list]), [
    ['Key', '1', 'Asc', 'No'], ['Key', '2', 'Asc', 'No'], ['Key', '3', 'Desc', 'No'], ['', '', '', ''], ['', '', '', 'No']
  ]);
  // PSOPRDEFN: OPRID key and list item; USERIDALIAS alternate key, ascending, list item.
  const opr = useRows([field({ useEdit: 33 }), field({ useEdit: 0x800030 })]);
  assert.deepEqual(opr.map((u) => [u.key, u.order, u.dir, u.list]), [['Key', '1', 'Asc', 'Yes'], ['Alt', '', 'Asc', 'Yes']]);
  // ZZ_PCODE_LAB_R1 after r08: KEY a descending key, C01 a duplicate order key, second in the key index.
  const r1 = useRows([field({ useEdit: 0x800841 }), field({ useEdit: 0x800002 })]);
  assert.deepEqual(r1.map((u) => [u.key, u.order, u.dir]), [['Key', '1', 'Desc'], ['Dup', '2', 'Asc']]);
});

test('defaults read as App Designer shows them', () => {
  assert.equal(defaultText(field({ defaultField: 'ENG' })), "'ENG'");
  assert.equal(defaultText(field({ defaultField: '%Date' })), '%Date');
  assert.equal(defaultText(field({ defaultRecord: 'INSTALLATION', defaultField: 'COUNTRY' })), 'INSTALLATION.COUNTRY');
  assert.equal(defaultText(field({})), '');
});

test('the Edits display reads like App Designer\'s for PSOPRDEFN', () => {
  const rows = editsRows([
    field({ name: 'OPRCLASS', useEdit: 16384, editTable: 'PSCLASSDEFN' }),
    field({ name: 'LANGUAGE_CD', useEdit: 512 }),
    field({ name: 'LASTPSWDCHANGE', type: FieldType.Date, useEdit: 256 }),
    field({ name: 'OPRID', useEdit: 33, hasPeopleCode: true })
  ]);
  assert.deepEqual(rows.map((r) => [r.required, r.edit, r.promptTable, r.event]), [
    ['No', 'Prompt', 'PSCLASSDEFN', 'No'], ['No', 'Xlat', '', 'No'], ['Yes', '', '', 'No'], ['No', '', '', 'Yes']
  ]);
});

test('Record Field Properties: confirmed checks have a state, the rest are unknown, unexplained bits are listed', async () => {
  const { recordFieldProperties } = await import('../model/recordLayout.js');
  // ZZ_PCODE_LAB_C01 as App Designer showed it: nothing set, default label, System Default page control.
  const c01 = recordFieldProperties(field({ name: 'ZZ_PCODE_LAB_C01', useEdit: 0x800000, useEdit2: 0, labelId: '', defGuiControl: 99 }));
  assert.equal(c01.edit, 'No Edit');
  assert.equal(c01.keys.find((k) => k.label === 'Key')!.state, false);
  assert.equal(c01.keys.find((k) => k.label === 'Search Key')!.state, false);
  assert.equal(c01.keys.find((k) => k.label === 'Search Edit')!.state, false);
  assert.equal(c01.other.find((k) => k.label === 'Auto-Update')!.state, false);
  // In Memory is USEEDIT2 0x80000 (r67, r72), changeable only under Selective Fields.
  assert.equal(c01.other.find((k) => k.label === 'In Memory')!.state, false);
  assert.equal(c01.other.find((k) => k.label === 'In Memory')!.flag, undefined);
  const held = recordFieldProperties(field({ useEdit: 0x800000, useEdit2: 0x880000 }), true).other.find((k) => k.label === 'In Memory')!;
  assert.deepEqual([held.state, held.flag], [true, 'inMemory']);
  // r19: the record's Timestamp Field carries Auto-Update (0x4000000).
  assert.equal(recordFieldProperties(field({ useEdit: 0x4800000 })).other.find((k) => k.label === 'Auto-Update')!.state, true);
  assert.equal(c01.label, '*** Use Default Label ***');
  assert.equal(c01.pageControl, 'System Default');
  assert.equal(c01.edit, 'No Edit');
  assert.deepEqual(c01.unexplained, { useEdit: 0, useEdit2: 0 });
  // PSOPRDEFN: OPRCLASS prompts PSCLASSDEFN; LANGUAGE_CD defaults 'ENG' with a translate edit; EMPLID on
  // ABS_HIST_DET carries the 0x4000 prompt plus 0x100 required.
  const oprclass = recordFieldProperties(field({ useEdit: 16384, editTable: 'PSCLASSDEFN' }));
  assert.deepEqual([oprclass.edit, oprclass.promptTable], ['Prompt Table Edit', 'PSCLASSDEFN']);
  const lang = recordFieldProperties(field({ useEdit: 512, defaultField: 'ENG' }));
  assert.deepEqual([lang.edit, lang.defaultConstant, lang.defaultRecord], ['Translate Table Edit', 'ENG', '']);
  // r15: Prompt Table with No Edit is EDITTABLE alone; Yes/No is 0x2000.
  assert.equal(recordFieldProperties(field({ useEdit: 0x800000, editTable: 'PSOPRDEFN' })).edit, 'Prompt Table with No Edit');
  assert.equal(recordFieldProperties(field({ useEdit: 0x802000 })).edit, 'Yes/No Table Edit');
  const smart = recordFieldProperties(field({ useEdit: 0x804000, useEdit2: 0x3000000, editTable: 'PSOPRDEFN' }));
  assert.deepEqual(smart.other.filter((c) => c.state === true).map((c) => c.label), ['Smart Drop-Down', 'Smart Prompt']);
  assert.deepEqual(smart.unexplained, { useEdit: 0, useEdit2: 0 });
  const emplid = recordFieldProperties(field({ useEdit: 0x804101, editTable: 'PERSON' }));
  assert.deepEqual([emplid.required, emplid.keys[0].state, emplid.edit], [true, true, 'Prompt Table Edit']);
  // r08 / r09 on ZZ_PCODE_LAB_R1: one setting per field.
  const shown = (useEdit: number) => {
    const v = recordFieldProperties(field({ useEdit }));
    return [...v.keys, ...v.audit, ...v.other].filter((c) => c.state === true).map((c) => c.label);
  };
  assert.deepEqual(shown(0x800841), ['Key', 'Descending Key', 'Search Key']);
  assert.deepEqual(shown(0x800002), ['Duplicate Order Key']);
  assert.deepEqual(shown(0x840000), ['From Search Field']);
  assert.deepEqual(shown(0x880000), ['Through Search Field']);
  assert.deepEqual(shown(0x800008), ['Field Add']);
  assert.deepEqual(shown(0x800080), ['Field Change']);
  assert.deepEqual(shown(0x800400), ['Field Delete']);
  assert.deepEqual(shown(0x800004), ['System Maintained']);
  // r11-r14 / r10.
  assert.deepEqual(shown(0x10800841), ['Key', 'Descending Key', 'Search Key', 'Search Edit']);
  assert.deepEqual(shown(0x1800000), ['Default Search Field']);
  assert.deepEqual(shown(0xa00000), ['Disable Advanced Search Options']);
  assert.deepEqual(shown(0x8800000), ['Allow Search Events for Prompt Dialogs']);
  const trace = recordFieldProperties(field({ useEdit: 0x800000, useEdit2: 0x800000 }));
  assert.equal(trace.other.find((c) => c.label === 'Do Not Trace Value')!.state, true);
  assert.deepEqual(trace.unexplained, { useEdit: 0, useEdit2: 0 });
  // A bit no check accounts for is shown, not hidden behind an unticked box.
  assert.deepEqual(recordFieldProperties(field({ useEdit: 0x1000 | 0x800000, useEdit2: 5 })).unexplained, { useEdit: 0x1000, useEdit2: 5 });
});

test('the page carries the field menu, the dialog and each field\'s properties, escaped', () => {
  const html = renderRecordHtml({ ...layout, fields: [field({ name: 'A</script><b>' })] }, 'X', 'n');
  assert.ok(html.includes('id="menu"') && html.includes('id="dialog"') && html.includes('<script type="application/json" id="fields">'));
  assert.ok(!html.includes('A</script><b>'), 'a field value cannot end the data block');
});

test('the page carries Record Properties and offers the build script for an SQL Table', () => {
  const props = { description: 'D', definition: 'Long </script>', ownerId: 'O', lastUpdated: '', lastUpdatedBy: '', setControlField: '',
    parentRecord: 'P', relatedLanguageRecord: '', querySecurityRecord: '', analyticDeleteRecord: '', auditRecord: '',
    systemIdField: '', timestampField: '', auxFlagMask: 0x10000, recUse: 0, optTrigFlag: 'N' };
  const html = renderRecordHtml({ ...layout, properties: props }, 'X', 'n');
  assert.ok(html.includes('<script type="application/json" id="record">') && !html.includes('Long </script>'));
  assert.ok(html.includes('data-act="build"'));
  assert.ok(!renderRecordHtml({ ...layout, recordType: RecordType.View }, 'X', 'n').includes('data-act="build"'));
});

test('a duplicate order key reads "Dup", ordered and Asc, as App Designer shows ACA_RES_F_TBL', () => {
  // ATTACHSYSFILENAME USEEDIT 8388609 (Key), EMPLID 8388610 (Duplicate Order Key): Key / Dup, Ordr 1 / 2, Dir Asc / Asc.
  const rows = useRows([field({ name: 'ATTACHSYSFILENAME', useEdit: 8388609 }), field({ name: 'EMPLID', useEdit: 8388610 })]);
  assert.deepEqual(rows.map((r) => [r.key, r.order, r.dir, r.list]), [['Key', '1', 'Asc', 'No'], ['Dup', '2', 'Asc', 'No']]);
});
