import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { buildAppEngine, type AppEngineRows } from '../model/appEngine.js';
import { renderAppEngineHtml, variantLabel } from '../editors/appEngineHtml.js';

const rows = (name: string) =>
  JSON.parse(readFileSync(path.join('src', 'test', 'fixtures', 'appEngine', `${name}.rows.json`), 'utf8')) as AppEngineRows;

test('sections and steps are labelled section.market.platform.effdt, as App Designer does (MAIN.GBL.default.1900-01-01)', () => {
  assert.equal(variantLabel('MAIN', { market: 'GBL', dbType: ' ', effdt: '1900-01-01', active: true, description: '', autoCommit: 'N', steps: [] }),
    'MAIN.GBL.default.1900-01-01');
  assert.equal(variantLabel('MAIN', { market: 'GBL', dbType: '2', effdt: '2001-01-01', active: true, description: '', autoCommit: 'N', steps: [] }),
    'MAIN.GBL.ORACLE.2001-01-01');
});

test('the Definition view: App Designer\'s boxes for steps and actions (TL_CAL_GEN)', () => {
  const html = renderAppEngineHtml(buildAppEngine(rows('TL_CAL_GEN')), 'HRDMO', 'N', (_s, _v, st) => (st.name === 'Step010' ? 'TLBuildCalendar(&R);' : undefined));
  // Steps: three-digit number, Commit After, Frequency only with a Do Select, On Error, Active.
  assert.match(html, /<span class="seq">001<\/span>.*Commit After:.*Default.*Frequency:.*>1<.*On Error:.*Abort.*Active/);
  assert.match(html, /<span class="seq">002<\/span>.*Frequency:<\/span><span class="val">&nbsp;<\/span>/);
  // Actions with their own settings, as BEN110 shows them in App Designer.
  assert.match(html, /Do Select<\/span>.*ReUse Statement:.*No.*Do Select Type:.*Restartable/);
  assert.match(html, /PeopleCode<\/span>.*On Return:.*Skip Step/);
  assert.match(html, /SQL<\/span>.*ReUse Statement:.*No Rows:.*Continue/);
  assert.match(html, /Call Section<\/span>.*Section:.*LOOP.*Program ID:.*TL_CAL_GEN.*Static/);
  // Program Flow: SQL and PeopleCode inline, the message text.
  assert.ok(html.includes('<pre>TLBuildCalendar(&amp;R);</pre>'));
  assert.ok(html.includes('&ldquo;Completed building calendar %1 at %2&rdquo;'));
  assert.match(html, /script-src 'nonce-N'/);
});
