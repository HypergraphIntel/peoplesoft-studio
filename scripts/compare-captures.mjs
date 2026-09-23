import { readFileSync } from 'node:fs';

const [withoutPath, withPath] = process.argv.slice(2);

if (!withoutPath || !withPath) {
  throw new Error(
    'Usage: node scripts/compare-captures.mjs WITHOUT.json WITH.json'
  );
}

function loadCapture(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function programBuffer(capture) {
  return Buffer.concat(
    capture.programRows.map(row =>
      Buffer.from(row.hex, 'hex')
    )
  );
}

function hex(buffer) {
  return [...buffer]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join(' ');
}

function findCommonPrefix(a, b) {
  const limit = Math.min(a.length, b.length);

  let i = 0;

  while (i < limit && a[i] === b[i]) {
    i++;
  }

  return i;
}

function findCommonSuffix(a, b, prefixLength) {
  const maxSuffix = Math.min(
    a.length - prefixLength,
    b.length - prefixLength
  );

  let i = 0;

  while (
    i < maxSuffix &&
    a[a.length - 1 - i] === b[b.length - 1 - i]
  ) {
    i++;
  }

  return i;
}

const withoutCapture = loadCapture(withoutPath);
const withCapture = loadCapture(withPath);

const withoutProgram = programBuffer(withoutCapture);
const withProgram = programBuffer(withCapture);

const prefixLength = findCommonPrefix(
  withoutProgram,
  withProgram
);

const suffixLength = findCommonSuffix(
  withoutProgram,
  withProgram,
  prefixLength
);

const withoutEnd =
  withoutProgram.length - suffixLength;

const withEnd =
  withProgram.length - suffixLength;

const withoutDelta = withoutProgram.subarray(
  prefixLength,
  withoutEnd
);

const withDelta = withProgram.subarray(
  prefixLength,
  withEnd
);

console.log('PeopleCode Capture Comparison');
console.log('-----------------------------');

console.log();
console.log('Source');
console.log('------');
console.log(`WITHOUT (${withoutCapture.source.length} chars):`);
console.log(withoutCapture.source);

console.log();
console.log(`WITH (${withCapture.source.length} chars):`);
console.log(withCapture.source);

console.log();
console.log('PSPCMPROG');
console.log('---------');
console.log(`Without comment: ${withoutProgram.length} bytes`);
console.log(`With comment:    ${withProgram.length} bytes`);
console.log(`Length delta:     ${withProgram.length - withoutProgram.length}`);
console.log(`Common prefix:    ${prefixLength} bytes`);
console.log(`Common suffix:    ${suffixLength} bytes`);

console.log();
console.log(`Without delta (${withoutDelta.length} bytes):`);
console.log(hex(withoutDelta) || '<none>');

console.log();
console.log(`With delta (${withDelta.length} bytes):`);
console.log(hex(withDelta) || '<none>');

console.log();
console.log('PSPCMNAME');
console.log('---------');
console.log(`Without comment: ${withoutCapture.names.length} rows`);
console.log(`With comment:    ${withCapture.names.length} rows`);

console.log();
console.log('WITHOUT names:');
console.dir(withoutCapture.names, { depth: null });

console.log();
console.log('WITH names:');
console.dir(withCapture.names, { depth: null });