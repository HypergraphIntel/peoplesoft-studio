import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_SNAPSHOT_TABLES, type NativePageSnapshot } from '../providers/pageSnapshot.js';
import { snapshotPageLayout, pageControlChanges, renderPageComparison } from '../changeReview/pageVisual.js';
import { canonical } from '../changeReview/model.js';

function snapshot(): NativePageSnapshot {
    return { scope: 'page-writer-tables/1', tables: Object.fromEntries(PAGE_SNAPSHOT_TABLES.map(t => [t, t === 'PSPNLDEFN'
        ? [{ PNLNAME: 'ZZ_PAGE', DESCR: 'Lab Page', PNLTYPE: 0, PNLUSE: 11, PANELRIGHT: 600, PANELBOTTOM: 400 }]
        : t === 'PSPNLFIELD' ? [{ PNLNAME: 'ZZ_PAGE', PNLFLDID: 17, FIELDNUM: 1, FIELDTYPE: 0,
            FIELDLEFT: 20, FIELDTOP: 30, FIELDRIGHT: 148, FIELDBOTTOM: 50, FIELDSIZETYPE: 0, LBLTYPE: 1, LBLTEXT: 'Before',
            EDITLBLLEFT: 0, EDITLBLTOP: 0, EDITLBLRIGHT: 0, EDITLBLBOTTOM: 0, FIELDUSE: 0, SECUREINVISIBLE: '0' }]
        : []])) as unknown as NativePageSnapshot['tables'] };
}
test('Page comparison uses persisted control identity and shared designer geometry, preserves snapshots', () => {
    const before = snapshot(), after = structuredClone(before), original = canonical(before);
    Object.assign(after.tables.PSPNLFIELD[0], { FIELDNUM: 8, FIELDLEFT: 28, FIELDTOP: 38, FIELDRIGHT: 188, FIELDBOTTOM: 62, LBLTEXT: 'After', FIELDUSE: 3, SECUREINVISIBLE: '1' });
    const changes = pageControlChanges(before, after);
    assert.equal(changes.length, 1); assert.equal(changes[0].id, 17);
    assert.deepEqual(changes[0].changes, ['Moved', 'Resized', 'Label', 'Hidden', 'Display only']);
    const layout = snapshotPageLayout(after);
    assert.deepEqual(layout.controls[0].rect, { left: 28, top: 38, width: 160, height: 24 });
    const html = renderPageComparison(before, after);
    assert.match(html, /id="proposal-before-c17"/); assert.match(html, /id="proposal-after-c17"/);
    assert.match(html, /data-page-control="17"/); assert.match(html, /u-invisible/);
    assert.match(html, /FIELDNUM/); assert.match(html, /full native diff/);
    assert.doesNotMatch(html, /data-action="(apply|save)"|class="rsz"|data-html=/);
    assert.equal(canonical(before), original);
});
test('Page visual comparison distinguishes auto-sized moves from resizes and excludes storage order changes', () => {
    const before = snapshot(), after = structuredClone(before);
    Object.assign(before.tables.PSPNLFIELD[0], { FIELDRIGHT: 0, FIELDBOTTOM: 0 });
    Object.assign(after.tables.PSPNLFIELD[0], { FIELDRIGHT: 0, FIELDBOTTOM: 0, FIELDLEFT: 28, FIELDTOP: 38 });
    assert.deepEqual(pageControlChanges(before, after)[0].changes, ['Moved']);
    after.tables.PSPNLFIELD = structuredClone(before.tables.PSPNLFIELD).reverse();
    assert.deepEqual(pageControlChanges(before, after), []);
});
test('Page comparison escapes labels and never embeds captured active HTML or editor metadata', () => {
    const before = snapshot(), after = structuredClone(before);
    after.tables.PSPNLFIELD[0].LBLTEXT = '</style><script>alert(1)</script>';
    after.tables.PSPNLHTMLAREA.push({ PNLNAME: 'ZZ_PAGE', PNLFLDID: 17, HTMLAREA: '<img src=x onerror=alert(2)>' });
    const html = renderPageComparison(before, after);
    assert.doesNotMatch(html, /<script>|<img|onerror="|data-html=/);
    assert.match(html, /&lt;script&gt;/);
    assert.equal(snapshotPageLayout(after).controls[0].columns.htmlConstant, '<img src=x onerror=alert(2)>');
});
test('Page history drawings have distinct namespaces and refuse cross-Page or ambiguous identities', () => {
    const a = snapshot(), b = structuredClone(a);
    assert.match(renderPageComparison(a, b, 'history-'), /id="history-after-c17"/);
    b.tables.PSPNLFIELD.push(structuredClone(b.tables.PSPNLFIELD[0]));
    assert.throws(() => snapshotPageLayout(b), /ambiguous/);
    assert.match(renderPageComparison(a, b), /unavailable/);
    b.tables.PSPNLFIELD = [b.tables.PSPNLFIELD[0]]; b.tables.PSPNLFIELD[0].PNLNAME = 'OTHER';
    assert.throws(() => snapshotPageLayout(b), /another Page/);
    assert.match(renderPageComparison(a, b, 'proposal-', 'Ignored', false), /after-state is unknown/);
    assert.throws(() => renderPageComparison(a, b, 'bad"><script>'), /prefix/);
});
test('Page-only properties and extension changes retain an explicit nonvisual review path', () => {
    const a = snapshot(), b = structuredClone(a);
    b.tables.PSPNLDEFN[0].DESCR = 'Changed';
    assert.match(renderPageComparison(a, b), /No control changes/);
    b.tables.PSPNLFIELDEXT.push({ PNLNAME: 'ZZ_PAGE', PNLFLDID: 17, FFSTYLELONG: 'full text' });
    assert.deepEqual(pageControlChanges(a, b)[0].changes, ['Native properties']);
    assert.equal(snapshotPageLayout(b).controls[0].columns.ffStyleLong, 'full text');
});
