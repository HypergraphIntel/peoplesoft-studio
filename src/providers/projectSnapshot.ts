import type { DbConnection, DbTypes } from '../db/connection.js';
import { canonical, hash, privacy, type Json } from '../changeReview/model.js';
import { NEW_PROJECT_VALUES } from './projectWriter.js';
import { DefinitionType, type DefinitionKey } from '../model/definitions.js';
import { itemKeyColumns, projectItemFor, PROJECT_ITEM_DEFAULTS } from '../model/projectItems.js';
import type { NativeRow } from './structuredSnapshot.js';

interface ProjectSnapshot { scope: 'project-create/1'; tables: { PSPROJECTDEFN: NativeRow[]; PSPROJECTITEM: NativeRow[] } }
const omitted = new Set(['TGTOPRID', 'TGTOPRACCT']);
const compare = (a: NativeRow, b: NativeRow) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0;
const stamps = new Set(['VERSION', 'LASTUPDDTTM', 'LASTUPDOPRID']);
export function projectReviewName(key: Json): string {
    if (typeof key !== 'string' || !/^[A-Z][A-Z0-9_]{0,29}$/.test(key)) throw new Error('Invalid project review name.');
    return key;
}

/** Fixed noncredential project scope. Target credentials are never selected or restored. */
export async function readProjectCreationSnapshot(c: DbConnection, types: DbTypes, project: string) {
    projectReviewName(project);
    const raw: Record<string, NativeRow[]> = {}, tables: Record<string, NativeRow[]> = {};
    for (const table of ['PSPROJECTDEFN', 'PSPROJECTITEM']) {
        const columns = await c.catalog.columns(c, table);
        const allowed = table === 'PSPROJECTDEFN'
            ? new Set(['PROJECTNAME', ...stamps, ...Object.keys(NEW_PROJECT_VALUES)])
            : new Set(['PROJECTNAME', 'OBJECTTYPE', ...Object.keys(PROJECT_ITEM_DEFAULTS), ...columns.filter(col => /^OBJECT(?:ID|VALUE)[1-7]$/.test(col.name)).map(col => col.name)]);
        if (!columns.length || columns.some(col => !allowed.has(col.name) || /TIME ZONE/.test(col.dataType))) throw new Error('Unsupported native project snapshot schema.');
        const required = table === 'PSPROJECTDEFN' ? ['PROJECTNAME', ...stamps, ...Object.keys(NEW_PROJECT_VALUES).filter(k => !omitted.has(k))]
            : ['PROJECTNAME', 'OBJECTTYPE', ...Object.keys(PROJECT_ITEM_DEFAULTS), ...[1, 2, 3, 4].flatMap(n => ['OBJECTID' + n, 'OBJECTVALUE' + n])];
        if (required.some(name => !columns.some(col => col.name === name))) throw new Error('Incomplete native project snapshot schema.');
        const selected = columns.filter(col => !omitted.has(col.name));
        const projection = selected.map(col => /^(DATE|TIMESTAMP)/.test(col.dataType)
            ? `TO_CHAR(CAST(${col.name} AS TIMESTAMP(9)), 'YYYY-MM-DD"T"HH24:MI:SS.FF9') AS ${col.name}` : col.name).join(', ');
        const fetchInfo = Object.fromEntries(selected.filter(col => /CLOB/.test(col.dataType)).map(col => [col.name, { type: types.STRING }]));
        const result = (await c.execute<NativeRow>(`SELECT ${projection} FROM ${table} WHERE PROJECTNAME = :p`, { p: project }, { outFormat: types.OUT_FORMAT_OBJECT, fetchInfo })).rows ?? [];
        raw[table] = result.map(row => Object.fromEntries(selected.map(col => {
            const value = row[col.name];
            if (!(col.name in row) || value !== null && typeof value !== 'string' && (typeof value !== 'number' || !Number.isSafeInteger(value))) throw new Error('Incomplete project snapshot column: ' + col.name);
            return [col.name, value];
        }))).sort(compare);
        if (raw[table].some(row => row.PROJECTNAME !== project)) throw new Error('Project snapshot contains another project.');
        tables[table] = raw[table].map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !stamps.has(key))))
            .sort(compare);
    }
    if (!tables.PSPROJECTDEFN.length) {
        if (tables.PSPROJECTITEM.length) throw new Error('Creation review refuses orphaned project items.');
        return { value: null, token: hash(raw), hash: hash(null) };
    }
    if (tables.PSPROJECTDEFN.length !== 1) throw new Error('Project snapshot needs one native header.');
    const value = { scope: 'project-create/1', tables } as unknown as Json;
    privacy(value);
    if (Buffer.byteLength(canonical(value)) > 8 * 1024 * 1024) throw new Error('Project snapshot exceeds 8 MiB.');
    return { value, token: hash(raw), hash: hash(value) };
}

/** Bounded inverse of the calibrated item layouts; unknown columns/statuses cannot be replayed. */
export function projectCreationItems(value: Json, project: string): DefinitionKey[] {
    const s = value as unknown as ProjectSnapshot;
    if (!s || s.scope !== 'project-create/1' || Object.keys(s).sort().join(',') !== 'scope,tables' || !s.tables || Object.keys(s.tables).sort().join(',') !== 'PSPROJECTDEFN,PSPROJECTITEM'
        || !Array.isArray(s.tables.PSPROJECTDEFN) || s.tables.PSPROJECTDEFN.length !== 1 || s.tables.PSPROJECTDEFN[0].PROJECTNAME !== project || !Array.isArray(s.tables.PSPROJECTITEM)) throw new Error('Incomplete project creation checkpoint.');
    return s.tables.PSPROJECTITEM.map(row => {
        const type = Number(row.OBJECTTYPE), length = type === DefinitionType.AppEnginePeopleCode ? 4 : [DefinitionType.AppEngineSection, DefinitionType.SqlDefinition].includes(type) ? 2 : 1;
        if (![DefinitionType.Record, DefinitionType.Field, DefinitionType.SqlDefinition, DefinitionType.AppEngineProgram, DefinitionType.AppEngineSection, DefinitionType.AppEnginePeopleCode].includes(type)) throw new Error('Unsupported project creation member.');
        const key: DefinitionKey = { type, parts: Array.from({ length }, (_, i) => String(row['OBJECTVALUE' + (i + 1)]).trimEnd()) };
        const slots = Object.keys(row).filter(k => /^OBJECTVALUE\d+$/.test(k)).length;
        const expected = { PROJECTNAME: project, OBJECTTYPE: type, ...itemKeyColumns(projectItemFor(key), slots), ...PROJECT_ITEM_DEFAULTS };
        if (canonical(row) !== canonical(expected)) throw new Error('Project member differs from its calibrated typed layout.');
        return key;
    });
}
