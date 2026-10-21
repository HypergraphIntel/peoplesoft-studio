import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineCallsAt, callSnippetText, INLINE_CALL_SNIPPETS } from '../peoplecode/inlineCalls.js';

function preview(marked:string) {
  const offset=marked.indexOf('|'), source=marked.replace('|','');
  const calls=inlineCallsAt(source,offset);
  return {source,offset,calls,accepted:(i=0)=>source.slice(0,calls[i].start)+calls[i].text+source.slice(calls[i].end)};
}
test('CreateSQL displays the complete call and accepts editable arguments without duplicating auto-closing punctuation',()=>{
  for(const source of ['   CreateSQL(|)','   CreateSQL(|);','   CreateSQ|','   CreateSQL|()']) {
    const p=preview(source);assert.equal(p.calls.length,1);assert.equal(p.accepted(),'   CreateSQL(sqlText, bindValues);');
    assert.match(p.calls[0].snippet,/\$\{1:sqlText\}/);assert.match(p.calls[0].snippet,/\$\{2:, bindValues\}/);
  }
});
test('assignment and Return previews complete the line; nested calls preserve the containing expression',()=>{
  assert.equal(preview('Local SQL &sql = CreateSQL(|);').accepted(),'Local SQL &sql = CreateSQL(sqlText, bindValues);');
  assert.equal(preview('Return Substring(|);').accepted(),'Return Substring(source, start, length);');
  assert.equal(preview('&x = Wrapper(CreateSQL(|), &other);').accepted(),'&x = Wrapper(CreateSQL(sqlText, bindValues), &other);');
  assert.equal(preview('CreateSQL(|).Fetch(&row);').accepted(),'CreateSQL(sqlText, bindValues).Fetch(&row);');
});
test('authored arguments, comments, strings, declarations and member methods are not replaced',()=>{
  for(const text of ['CreateSQL(&authored|);','CreateSQL(|&authored);','CreateSQL(|, &authored);','CreateSQL(|\n   SQL.EXISTING\n);','CreateSQL(|\n);','CreateSQL|(SQL.EXISTING);','// CreateSQL(|)',
    '/* previous line\n CreateSQL(|)', '/+ CreateSQL(|)', '<* outer <* nested *> CreateSQL(|)',
    'Rem previous line\n CreateSQL(|)', '"text CreateSQL(|)', "'text CreateSQL(|)",
    '&object.CreateSQL(|)', '&object. CreateSQL(|)', '&object.\nCreateSQL(|)', 'method CreateSQL(|)', 'Declare Function CreateSQL(|)', 'Unknown(|)'])assert.deepEqual(preview(text).calls,[],text);
});
test('closed comments and quoted Unicode before a real call retain exact UTF-16 replacement offsets',()=>{
  const p=preview('/* 😀 */ MessageBox("😀", 0);\n   CreateSQL(|)');
  assert.equal(p.accepted(),'/* 😀 */ MessageBox("😀", 0);\n   CreateSQL(sqlText, bindValues);');
  assert.equal(preview('Rem not code; CreateSQL(|)').accepted(),'Rem not code; CreateSQL(sqlText, bindValues)');
});
test('call previews use curated syntax and optional editable segments, never documentation bracket notation',()=>{
  for(const snippet of Object.values(INLINE_CALL_SNIPPETS)) {
    const text=callSnippetText(snippet);assert.ok(!/[\[\]{}$]/.test(text),text);assert.ok(text.endsWith(')'),text);
  }
  assert.deepEqual(inlineCallsAt('CreateSQL(',500),[]);assert.deepEqual(preview('Cr|').calls,[]);
});
