import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchText } from '../model/textSearch.js';

test('literal search ignores case by default and returns UTF-16 line positions', () => {
  assert.deepEqual(searchText('  Job job\r\n\r\n😀JOB\nnone\rjob', 'job'), [
    { line: 0, column: 2, context: 'Job job' },
    { line: 0, column: 6, context: 'Job job' },
    { line: 2, column: 2, context: '😀JOB' },
    { line: 4, column: 0, context: 'job' }
  ]);
  assert.deepEqual(searchText('Job job JOB', 'job', { matchCase: true }).map((h) => h.column), [4]);
});

test('whole word excludes adjacent letters, numbers and underscores, including Unicode', () => {
  const text = 'JOB JOB_DATA XJOB JOB2 éJOB JOBé (job)';
  assert.deepEqual(searchText(text, 'job', { wholeWord: true }).map((h) => h.column), [0, 34]);
  assert.equal(searchText(text, 'job', { wholeWord: true, matchCase: true }).length, 1);
  assert.equal(searchText('𐐀JOB JOB𐐀', 'JOB', { wholeWord: true }).length, 0);
});

test('metacharacters and spaces are literal; empty and multiline needles have no hits', () => {
  assert.equal(searchText('a.b axb [x] $&', 'a.b').length, 1);
  assert.equal(searchText('[x] $&', '[x] $&').length, 1);
  assert.equal(searchText('a  b', '  ')[0].column, 1);
  assert.deepEqual(searchText('anything', ''), []);
  assert.deepEqual(searchText('a\nb', 'a\nb'), []);
  assert.deepEqual(searchText('a\r\nb', 'a\r\nb'), []);
  assert.equal(searchText('x'.repeat(300), 'x')[0].context.length, 200);
});

test('case folding preserves offsets after characters whose uppercase expands', () => {
  assert.equal(searchText('ß job', 'JOB')[0].column, 2);
  assert.equal(searchText('İ job', 'JOB')[0].column, 2);
});
