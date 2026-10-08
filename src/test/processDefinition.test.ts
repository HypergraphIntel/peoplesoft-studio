import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderProcessDefinition } from '../model/processDefinition.js';
import { DefinitionType, displayName, makeKey } from '../model/definitions.js';

/** PSXLATITEM's labels for the fields used below, as HRDMO holds them. */
const TRANSLATES = new Map([
  ['PRCSPRIORITY', new Map([['1', 'Low'], ['5', 'Medium'], ['9', 'High']])],
  ['RUNLOCATION', new Map([['0', 'Both'], ['1', 'Client'], ['2', 'Server']])],
  ['APIAWARE', new Map([['0', 'No'], ['1', 'Yes']])],
  ['LOGRQST', new Map([['0', 'No'], ['1', 'Yes']])],
  ['PARMLISTTYPE', new Map([['0', 'None'], ['1', 'Override'], ['2', 'Prepend'], ['3', 'Append']])],
  ['OUTDESTTYPE', new Map([['1', '(None)'], ['6', 'Web']])],
  ['OUTDESTFORMAT', new Map([['0', 'Any'], ['2', 'Acrobat (*.pdf)']])],
  ['OUTDESTSRC', new Map([['0', '(None)']])]
]);

test('a process definition: its settings in PSXLATITEM\'s words, components, groups and description (TL_CAL_GEN on HRDMO)', () => {
  const text = renderProcessDefinition({
    process: {
      PRCSTYPE: 'Application Engine', PRCSNAME: 'TL_CAL_GEN', DESCR: 'Generate Time&Labor Calendars', PRCSPRIORITY: 5, RUNLOCATION: 0,
      APIAWARE: 1, LOGRQST: 1, PRCSCATEGORY: 'Default', PARMLIST: '-R :RUN_CNTL_ID', PARMLISTTYPE: 3, CMDLINE: ' ', CMDLINETYPE: 0,
      OUTDESTTYPE: 6, OUTDESTFORMAT: 2, OUTDESTSRC: 0, RESTARTENABLED: '1', VERSION: 1, DESCRLONG: 'Time and Labor calendar generation process'
    },
    components: [{ PNLGRPNAME: 'TL_RCTRL_CAL_PG' }], groups: [{ PRCSGRP: 'HRALL' }], translates: TRANSLATES
  });
  assert.match(text, /^Process Definition Application Engine \/ TL_CAL_GEN -- Generate Time&Labor Calendars\n/);
  assert.match(text, /Priority: Medium {3}Run location: Both {3}API aware: Yes {3}Log request: Yes {3}Category: Default/);
  assert.match(text, /Parameter list: -R :RUN_CNTL_ID {2}\(Append\)/);
  assert.ok(!text.includes('Command line'));
  assert.match(text, /Output: Web, Acrobat \(\*\.pdf\)/);
  assert.match(text, /Restart enabled/);
  assert.match(text, /Components: TL_RCTRL_CAL_PG\n\n {2}Process groups: HRALL/);
});

test('a process definition is named "NAME (Type)"', () => {
  assert.equal(displayName(makeKey(DefinitionType.ProcessDefinition, 'Application Engine', 'TL_CAL_GEN')), 'TL_CAL_GEN (Application Engine)');
});
