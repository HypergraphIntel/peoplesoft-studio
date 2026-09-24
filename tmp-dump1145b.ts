import Database from 'better-sqlite3';
import { encodeProgram } from './src/peoplecode/encoder';

const db = new Database('./tools/corpus/hcdev-snapshot.sqlite', { readonly: true });
const row = db.prepare('SELECT source_text, stored_program FROM snapshot_definition WHERE definition_id = ? ORDER BY snapshot_id DESC LIMIT 1').get(1145) as any;
const source = row.source_text as string;
const stored = row.stored_program as Buffer;
const generated = encodeProgram(source);

function annotated(buf: Buffer, start: number, len: number) {
  for (let row = start; row < start+len; row += 16) {
    const bytes = buf.subarray(row, row+16);
    console.log(row.toString().padStart(6), bytes.toString('hex').match(/../g)!.join(' '));
  }
}
console.log('--- stored 1850-1980 ---');
annotated(stored, 1850, 130);
console.log('--- generated 1850-1980 ---');
annotated(generated, 1850, 130);
