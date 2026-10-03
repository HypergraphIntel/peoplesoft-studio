import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';
import { decodeProgram } from '../peoplecode/decoder.js';
import { NameTable } from '../peoplecode/progtext.js';

/*
 * Cycle 149: in an ordinary program a quoted (`MenuName."X"`, 0x48) and an
 * unquoted (`MenuName.X`, 0x21) spelling of one reference share one
 * PSPCMNAME row per allocation unit; the first use in the unit, either
 * spelling, creates it. Different units keep separate rows (805).
 */
const owner = { recordName: 'PY_QCAL_DERIVED', fieldName: 'PY_QCALC_BTN2' };

const keyOf = (r: any): string => `${r.recordName}.${r.fieldName}`.toUpperCase();

const encode = (source: string) => {
  const { program, references } = encodeProgramArtifacts(source, { owner });
  const names = new NameTable();
  references.forEach(r => names.add(r.index + 1, keyOf(r)));
  const decoded = decodeProgram(program, names, { mode: 'auto' });
  assert.deepEqual(encodeProgramArtifacts(decoded.text, { owner }).program, program, 'roundtrip');
  const operands = decoded.tokens
    .filter(t => t.opcode === 0x48 || t.opcode === 0x21)
    .map(t => `${t.opcode.toString(16)} ${names.get(t.nameNum!)} #${t.nameNum}`);
  return { keys: references.map(keyOf), operands };
};

test('quoted first, unquoted later in one allocation unit: one row (23684)', () => {
  const { keys, operands } = encode(`If %Menu = MenuName."MANAGE_PAYROLL_PROCESS_US" Then
   DoModalComponent(MenuName.MANAGE_PAYROLL_PROCESS_US, BarName.INQUIRE, ItemName.PAYROLL_ERROR_MESSAGES, Page.PAYROLL_MESSAGES, "U");
End-If;
`);
  assert.deepEqual(keys, ['PY_QCAL_DERIVED.PY_QCALC_BTN2', 'MENUNAME.MANAGE_PAYROLL_PROCESS_US', 'BARNAME.INQUIRE',
    'ITEMNAME.PAYROLL_ERROR_MESSAGES', 'PAGE.PAYROLL_MESSAGES']);
  assert.deepEqual(operands.slice(0, 2), ['48 MENUNAME.MANAGE_PAYROLL_PROCESS_US #2', '21 MENUNAME.MANAGE_PAYROLL_PROCESS_US #2']);
});

test('unquoted first, quoted later in one allocation unit: one row (22983)', () => {
  const { keys, operands } = encode(`If IsMenuItemAuthorized(MenuName.HGA_EMPLOYEE_FL, BarName.INQUIRE, ItemName.HGA_SS_BAL_FLU, Page.HGA_SS_BAL_FLU, %Action_UpdateDisplay) Then
   &url = GenerateComponentContentURL(%Portal, %Node, MenuName."HGA_EMPLOYEE_FL", %Market, Component.HGA_SS_BAL_FLU, Page.HGA_SS_BAL_FLU, "U");
End-If;
`);
  assert.equal(keys.filter(k => k === 'MENUNAME.HGA_EMPLOYEE_FL').length, 1);
  assert.equal(keys[1], 'MENUNAME.HGA_EMPLOYEE_FL');
  const menu = operands.filter(o => o.includes('MENUNAME.HGA_EMPLOYEE_FL'));
  assert.deepEqual(menu, ['21 MENUNAME.HGA_EMPLOYEE_FL #2', '48 MENUNAME.HGA_EMPLOYEE_FL #2']);
});

test('the same reference in two allocation units keeps two rows (805)', () => {
  const { keys, operands } = encode(`If %PanelGroup <> "PROCESSMONITOR" Then
   Transfer( False, MenuName.APPLICATION_ENGINE, BarName."USE", ItemName."AE_MANAGE_ABENDS", Panel."AE_MANAGE_ABENDS", "U");
End-If;
If %PanelGroup = "AE_TEMPTBL_USE" Then
   Transfer( False, MenuName.APPLICATION_ENGINE, BarName."USE", ItemName.AE_MANAGE_ABENDS, Panel.AE_MANAGE_ABENDS, "U");
End-If;
`);
  assert.equal(keys.filter(k => k === 'ITEMNAME.AE_MANAGE_ABENDS').length, 2);
  assert.equal(keys.filter(k => k === 'PANEL.AE_MANAGE_ABENDS').length, 2);
  const item = operands.filter(o => o.includes('ITEMNAME.AE_MANAGE_ABENDS'));
  assert.deepEqual(item.map(o => o.split(' ')[0]), ['48', '21']);
  assert.notEqual(item[0].split('#')[1], item[1].split('#')[1]);
});

test('MenuName.X and BarName.X never share a row (cross-kind control)', () => {
  const { keys } = encode(`If %Menu = MenuName."SAME" Then
   Transfer( False, MenuName.SAME, BarName.SAME, ItemName."SAME", Page.SAME, "U");
End-If;
`);
  assert.deepEqual(keys.slice(1), ['MENUNAME.SAME', 'BARNAME.SAME', 'ITEMNAME.SAME', 'PAGE.SAME']);
});
