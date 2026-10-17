import { inflateRawSync } from 'node:zlib';

/*
 * Just enough of a ZIP reader to pull the XML parts out of Office documents
 * (docx, xlsx, pptx) attached to a build request: the central directory,
 * stored and deflated entries. No ZIP64, encryption or multi-disk archives --
 * those are refused, and the attachment keeps only its original file.
 */

/** The most one entry may inflate to: an attachment is a document, not a payload. */
const MAX_ENTRY = 64 * 1024 * 1024;

export function readZip(buf: Buffer): Map<string, () => Buffer> {
  const eocd = findEndOfCentralDirectory(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || at === 0xffffffff) throw new Error('ZIP64 archives are not supported.');
  const entries = new Map<string, () => Buffer>();
  for (let i = 0; i < count; i++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) throw new Error('Corrupt ZIP central directory.');
    const flags = buf.readUInt16LE(at + 8), method = buf.readUInt16LE(at + 10);
    const compressed = buf.readUInt32LE(at + 20), size = buf.readUInt32LE(at + 24);
    const nameLength = buf.readUInt16LE(at + 28), extraLength = buf.readUInt16LE(at + 30), commentLength = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    entries.set(name, () => {
      if (flags & 1) throw new Error(`${name} is encrypted.`);
      if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`Corrupt ZIP entry ${name}.`);
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + compressed);
      if (method === 0) return Buffer.from(data);
      if (method === 8) {
        if (size > MAX_ENTRY) throw new Error(`${name} is too large to extract.`);
        return inflateRawSync(data, { maxOutputLength: MAX_ENTRY });
      }
      throw new Error(`${name} uses unsupported ZIP compression method ${method}.`);
    });
  }
  return entries;
}

function findEndOfCentralDirectory(buf: Buffer): number {
  // The record is 22 bytes plus a comment of at most 65535.
  for (let at = buf.length - 22; at >= Math.max(0, buf.length - 22 - 0xffff); at--) {
    if (buf.readUInt32LE(at) === 0x06054b50) return at;
  }
  throw new Error('Not a ZIP archive.');
}
