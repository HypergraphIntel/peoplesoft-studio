import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aeDiff, pageDiff, recordDiff } from '../changeReview/semanticDiff.js';
test('page comparison matches persisted control identity, shows movement and does not infer identity for new temporary controls', () => {
    const before = { controls: [{ pnlFldId: 1, fieldNum: 1, label: 'A' }, { pnlFldId: 2, fieldNum: 2, label: 'B' }] };
    const after = { controls: [{ pnlFldId: 2, fieldNum: 1, label: 'B' }, { pnlFldId: 1, fieldNum: 2, label: 'A changed' }] };
    const diff = pageDiff.compare(before, after);
    assert.equal(diff.filter(d => d.kind === 'MOVE').length, 2);
    assert.ok(diff.some(d => d.path.endsWith('.label')));
    assert.ok(!diff.some(d => d.path.includes('fieldNum')));
    assert.equal(pageDiff.compare({ controls: [] }, { controls: [{ pnlFldId: -1 }] }).at(-1)?.kind, 'AMBIGUOUS');
});
test('AE step execution order is a move using names within a section variant', () => {
    const a = { sections: [{ name: 'MAIN', steps: [{ name: 'First', actions: [{ type: 'SQL', sql: 'SELECT 1' }] }, { name: 'Second', actions: [] }] }] };
    const b = { sections: [{ name: 'MAIN', steps: [{ name: 'Second', actions: [] }, { name: 'First', actions: [{ type: 'SQL', sql: 'SELECT 2' }] }] }] };
    const diff = aeDiff.compare(a, b);
    assert.equal(diff.filter(d => d.kind === 'MOVE').length, 2);
    assert.ok(diff.some(d => d.path.endsWith('.sql')));
});
test('record comparison preserves field order and identifies metadata changes by field name', () => {
    const diff = recordDiff.compare({ fields: [{ name: 'A', key: true }, { name: 'B', key: false }] }, { fields: [{ name: 'B', key: true }, { name: 'A', key: true }] });
    assert.equal(diff.filter(d => d.kind === 'MOVE').length, 2);
    assert.ok(diff.some(d => d.path.endsWith('.key')));
});
