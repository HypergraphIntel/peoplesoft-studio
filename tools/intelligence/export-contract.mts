/*
 * Writes the client / server contract (src/intelligence/contract.ts) to
 * server/intelligence/contract/: the finding input JSON Schema and the
 * fingerprint test vectors. Run after changing the schema or the
 * fingerprint; src/test/intelligence.test.ts fails while they differ.
 *
 *   npx tsx tools/intelligence/export-contract.mts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { contractVectors, findingInputJsonSchema } from '../../src/intelligence/contract';

const dir = path.join('server', 'intelligence', 'contract');
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'finding-input.schema.json'), `${JSON.stringify(findingInputJsonSchema(), null, 2)}\n`);
writeFileSync(path.join(dir, 'fingerprint-vectors.json'), `${JSON.stringify({ format: 'psft-fingerprint-vectors/1', vectors: contractVectors() }, null, 2)}\n`);
console.log(`wrote ${dir}/finding-input.schema.json and fingerprint-vectors.json`);
