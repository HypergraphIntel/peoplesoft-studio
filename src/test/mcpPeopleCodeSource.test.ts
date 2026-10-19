import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPeopleCodeSource } from '../mcp/peopleCodeSource.js';
import { DatabaseProvider } from '../providers/database.js';
import { DefinitionType, type DefinitionKey } from '../model/definitions.js';

/*
 * psft_get_peoplecode must return the source a reviewed save is compared
 * against (PSPCMTXT, App Designer's 3-space indentation), not the decoded
 * PSPCMPROG text, or a read-modify-save re-indents every line of the
 * proposal. Seen in the HRDMO native acceptance of Record PeopleCode review.
 */
const key: DefinitionKey = { type: DefinitionType.RecordPeopleCode, parts: ['ZZ_R', 'ZZ_F', 'FieldChange'] };
function database(stored: string | undefined | Error, decoded: string) {
    const p = Object.create(DatabaseProvider.prototype) as DatabaseProvider;
    Object.assign(p, {
        readPeopleCodeForEdit: async () => { if (stored instanceof Error) throw stored; return stored === undefined ? undefined : { text: stored, fingerprint: 'f' }; },
        readText: async () => decoded
    });
    return p;
}
test('a database returns stored PeopleCode source when it has it', async () => {
    assert.equal(await readPeopleCodeSource(database('If &a Then\n   &b = 1;\nEnd-If;\n', 'If &a Then\n  &b = 1;\nEnd-If;\n'), key), 'If &a Then\n   &b = 1;\nEnd-If;\n');
});
test('a program without stored source, or an unreadable one, falls back to the decoded program', async () => {
    assert.equal(await readPeopleCodeSource(database(undefined, 'decoded'), key), 'decoded');
    assert.equal(await readPeopleCodeSource(database(new Error('no PSPCMTXT access'), 'decoded'), key), 'decoded');
});
test('a non-database provider reads its own text', async () => {
    assert.equal(await readPeopleCodeSource({ readText: async () => 'from project file' }, key), 'from project file');
});
