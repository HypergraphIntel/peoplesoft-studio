/*
 * Keeps a component's Component Interface source -- what App Designer reads to
 * make an interface on it (src/model/ciSource.ts) -- beside a capture, as
 * results/<CASE>/ci-source.json, so the tests replay App Designer's
 * defaulting and edits offline. READ ONLY.
 *
 *   npx tsx tools/lab/ci-source-capture.mts CASE COMPONENT [MARKET]
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseProvider } from '../../src/providers/database';

const [caseName, component, market = 'GBL'] = process.argv.slice(2);
if (!caseName || !component) { console.error('usage: ci-source-capture.mts CASE COMPONENT [MARKET]'); process.exit(2); }
const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
const p = new DatabaseProvider({ name: 'LAB', platform: 'oracle', connectString, user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();
try {
  const data = await p.readCiSourceData(component, market);
  const file = join(process.cwd(), 'tools/corpus/save-protocol/results', caseName, 'ci-source.json');
  writeFileSync(file, JSON.stringify(data));
  console.log(`${file}: ${Object.keys(data.pageFields).length} pages, ${Object.keys(data.recordFields).length} records`);
} finally {
  await p.dispose();
}
