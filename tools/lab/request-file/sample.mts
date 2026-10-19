import { readFile } from 'node:fs/promises';
import type { AeProgramSpec } from '../../../src/model/aeSpec.js';
import type { BuildSpec } from '../../../src/buildRequest/model.js';

/** Synthetic fixture shared by the local intake bootstrap and native acceptance tooling. */
export async function sample() {
    const text = (name: string) => readFile(new URL(name, import.meta.url), 'utf8');
    const [requirements, sql, peopleCode, expected] = await Promise.all(['requirements.md', 'rows.sql', 'export.peoplecode', 'expected.csv'].map(text));
    const ae: AeProgramSpec = { program: 'ZZ_RF_EXPORT', description: 'Synthetic CSV export', disableRestart: true,
        stateRecords: [{ record: 'ZZ_RF_AET', default: true }],
        sections: [{ name: 'MAIN', steps: [{ name: 'Export', onError: 'Abort', actions: [{ type: 'PeopleCode', onReturn: 'Abort', peopleCode }] }] }] };
    const spec: BuildSpec = {
        summary: 'HRDMO synthetic CSV export: create Record, reusable SQL, AE and project together through Change Review; then run natively and compare actual output. No business data, DDL, schedule, security changes or transmission.',
        objects: [
            { ref: 'field-instance', definitionType: 2, kind: 'Field', action: 'reuse', name: 'PROCESS_INSTANCE', purpose: 'Existing Number(10) state field, version 1 at preflight.', dependsOn: [], sources: ['requirements.md'], details: 'Reuse unchanged.' },
            { ref: 'field-description', definitionType: 2, kind: 'Field', action: 'reuse', name: 'DESCR', purpose: 'Existing Character(30) state field, version 1 at preflight.', dependsOn: [], sources: ['requirements.md'], details: 'Reuse unchanged.' },
            { ref: 'state', definitionType: 0, kind: 'Derived/Work Record', action: 'create', name: 'ZZ_RF_AET', purpose: 'Default AE state without a physical table.', dependsOn: ['field-instance', 'field-description'], sources: ['requirements.md'], details: 'RECTYPE 2; PROCESS_INSTANCE then DESCR; no keys/subrecords. Description: Synthetic file state. All other properties use App Designer creation defaults.' },
            { ref: 'rows', definitionType: 30, kind: 'SQL', action: 'create', name: 'ZZ_RF_ROWS', purpose: 'Read four synthetic rows ordered by ID.', dependsOn: [], sources: ['rows.sql'], details: 'No binds or DML.\n```sql\n' + sql + '```' },
            { ref: 'export', definitionType: 33, kind: 'App Engine', action: 'create', name: 'ZZ_RF_EXPORT', purpose: 'Write CSV, count rejected negatives and calculate accepted totals.', dependsOn: ['state', 'rows'], sources: ['requirements.md', 'export.peoplecode', 'expected.csv'], details: 'Complete program specification:\n```json\n' + JSON.stringify(ae, null, 2) + '\n```' },
            { ref: 'project', definitionType: -2, kind: 'Project', action: 'create', name: 'ZZ_RF_PRJ', purpose: 'Package all new metadata and related AE logic.', dependsOn: ['state', 'rows', 'export'], sources: ['requirements.md'], details: 'Explicit members: Record ZZ_RF_AET; SQL ZZ_RF_ROWS type 0; AE ZZ_RF_EXPORT; section ZZ_RF_EXPORT.MAIN; AE PeopleCode MAIN/GBL/default/1900-01-01/Export/OnExecute. Include any generated action SQL shown by native preview. Verify psft_project_related after application; do not modify delivered fields.' }
        ],
        mappings: [{ source: 'rows.sql: ID', target: 'CSV ID', rule: 'Ascending ID; only nonnegative amounts.' }, { source: 'rows.sql: DESCR', target: 'CSV Description', rule: 'Always quote; double embedded quotes.' }, { source: 'rows.sql: AMOUNT', target: 'CSV Amount and trailer total', rule: 'Accept zero/positive, reject negatives. Period and exactly two fractional digits.' }],
        assumptions: ['Synthetic lab only; no real business inputs are needed.', 'Native execution uses the existing authorized Process Scheduler/App Designer connection. Its actual output path and process identity must be recorded.', 'Repeat execution replaces only ZZ_RF_EXPORT.csv in the native process output directory.', 'Creation undo is unsupported; no automatic definition deletion is promised.'],
        testPlan: requirements + '\nExpected output (LF or CRLF only; UTF-8 without BOM):\n```csv\n' + expected + '```\nRun npx tsx tools/lab/request-file/check-output.mts <actual-native-output>. Capture native successful status and the accepted=3 rejected=1 total=30.75 log line. Metadata readback and local fixtures alone do not pass runtime acceptance.'
    };
    return { requirements, sql, peopleCode, expected, ae, spec };
}
