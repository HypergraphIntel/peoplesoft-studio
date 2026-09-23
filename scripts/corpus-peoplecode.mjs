#!/usr/bin/env node

import oracledb from 'oracledb';

import {
  encodeProgram
} from '../dist-test/peoplecode/encoder.js';

import decoderPkg from '../dist-test/peoplecode/decoder.js';
import progtextPkg from '../dist-test/peoplecode/progtext.js';

import {
  compareBuffers
} from '../dist-test/peoplecode/corpus/binaryDiff.js';

import {
  sourcesMatch
} from '../dist-test/peoplecode/corpus/sourceNormalize.js';

import {
  classifyResult
} from '../dist-test/peoplecode/corpus/classify.js';

const {
  decodeProgram
} = decoderPkg;

const {
  NameTable
} = progtextPkg;


const KEY_COUNT = 7;

function parseArgs(argv) {
  const args = {
    limit: undefined,
    offset: 0,
    verbose: false
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--limit':
        args.limit = Number.parseInt(argv[++i], 10);
        break;

      case '--offset':
        args.offset = Number.parseInt(argv[++i], 10);
        break;

      case '--verbose':
        args.verbose = true;
        break;

      case '--help':
      case '-h':
        console.log(`
PeopleCode corpus inventory

Usage:
  node scripts/corpus-peoplecode.mjs [options]

Options:
  --limit <n>    Number of definitions to inspect (default: 10)
  --offset <n>   Definition offset (default: 0)
  --help         Show this help
`);
        process.exit(0);
    }
  }

  if (
    args.limit !== undefined &&
    (!Number.isInteger(args.limit) || args.limit < 1)
  ) {
    throw new Error('--limit must be a positive integer');
  }

  if (!Number.isInteger(args.offset) || args.offset < 0) {
    throw new Error('--offset must be zero or a positive integer');
  }

  return args;
}

function getConnectionConfig() {
  const connectString = process.env.PS_CONNECT_STRING;
  const user = process.env.PS_USER;
  const password = process.env.PS_PASSWORD;

  const missing = [];

  if (!connectString) {
    missing.push('PS_CONNECT_STRING');
  }

  if (!user) {
    missing.push('PS_USER');
  }

  if (!password) {
    missing.push('PS_PASSWORD');
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}`
    );
  }

  return {
    user,
    password,
    connectString
  };
}

function keyColumnNames() {
  const columns = [];

  for (let i = 1; i <= KEY_COUNT; i++) {
    columns.push(`OBJECTID${i}`);
    columns.push(`OBJECTVALUE${i}`);
  }

  return columns;
}

function definitionKey(row) {
  const key = {};

  for (let i = 1; i <= KEY_COUNT; i++) {
    key[`OBJECTID${i}`] = row[`OBJECTID${i}`];
    key[`OBJECTVALUE${i}`] = row[`OBJECTVALUE${i}`];
  }

  return key;
}

function keyDescription(key) {
  const parts = [];

  for (let i = 1; i <= KEY_COUNT; i++) {
    const objectId = key[`OBJECTID${i}`];
    const objectValue = key[`OBJECTVALUE${i}`];

    if (
      objectId !== null &&
      objectId !== undefined &&
      objectValue !== null &&
      objectValue !== undefined &&
      String(objectValue).length > 0
    ) {
      parts.push(`${objectId}=${objectValue}`);
    }
  }

  return parts.join(', ');
}

function buildKeyPredicate(key, binds) {
  const predicates = [];

  for (let i = 1; i <= KEY_COUNT; i++) {
    const objectIdColumn = `OBJECTID${i}`;
    const objectValueColumn = `OBJECTVALUE${i}`;

    const objectId = key[objectIdColumn];
    const objectValue = key[objectValueColumn];

    const idBind = `id${i}`;
    const valueBind = `value${i}`;

    if (objectId === null || objectId === undefined) {
      predicates.push(`${objectIdColumn} IS NULL`);
    } else {
      predicates.push(`${objectIdColumn} = :${idBind}`);
      binds[idBind] = objectId;
    }

    if (objectValue === null || objectValue === undefined) {
      predicates.push(`${objectValueColumn} IS NULL`);
    } else {
      predicates.push(`${objectValueColumn} = :${valueBind}`);
      binds[valueBind] = objectValue;
    }
  }

  return predicates.join('\n      AND ');
}

async function lobToBuffer(value) {
  if (value === null || value === undefined) {
    return Buffer.alloc(0);
  }

  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (typeof value === 'string') {
    return Buffer.from(value, 'binary');
  }

  const chunks = [];

  for await (const chunk of value) {
    chunks.push(
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk)
    );
  }

  return Buffer.concat(chunks);
}

async function lobToString(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }

  const chunks = [];

  for await (const chunk of value) {
    chunks.push(
      typeof chunk === 'string'
        ? chunk
        : Buffer.from(chunk).toString('utf8')
    );
  }

  return chunks.join('');
}

async function discoverDefinitions(connection, args) {
  const columns = keyColumnNames().join(',\n          ');

  const binds = {
    offset: args.offset
  };

  if (args.limit !== undefined) {
    binds.endRow = args.offset + args.limit;
  }

  const rowLimitClause =
    args.limit !== undefined
      ? 'AND rn <= :endRow'
      : '';

  const sql = `
    SELECT *
    FROM (
      SELECT
        ${columns},
        ROW_NUMBER() OVER (
          ORDER BY ${keyColumnNames().join(', ')}
        ) AS RN
      FROM (
        SELECT DISTINCT
          ${columns}
        FROM SYSADM.PSPCMTXT
      )
    )
    WHERE RN > :offset
      ${rowLimitClause}
    ORDER BY RN
  `;

  const result = await connection.execute(
    sql,
    binds,
    {
      outFormat: oracledb.OUT_FORMAT_OBJECT
    }
  );

  return result.rows ?? [];
}

async function captureSource(connection, key) {
  const binds = {};
  const predicate = buildKeyPredicate(key, binds);

  const result = await connection.execute(
    `
      SELECT
        PROGSEQ,
        PCTEXT
      FROM SYSADM.PSPCMTXT
      WHERE ${predicate}
      ORDER BY PROGSEQ
    `,
    binds,
    {
      outFormat: oracledb.OUT_FORMAT_OBJECT
    }
  );

  const parts = [];

  for (const row of result.rows ?? []) {
    parts.push(await lobToString(row.PCTEXT));
  }

  return {
    rows: result.rows?.length ?? 0,
    source: parts.join('')
  };
}

async function captureProgram(connection, key) {
  const binds = {};
  const predicate = buildKeyPredicate(key, binds);

  const result = await connection.execute(
    `
      SELECT
        PROGSEQ,
        PROGTXT
      FROM SYSADM.PSPCMPROG
      WHERE ${predicate}
      ORDER BY PROGSEQ
    `,
    binds,
    {
      outFormat: oracledb.OUT_FORMAT_OBJECT
    }
  );

  const chunks = [];

  for (const row of result.rows ?? []) {
    chunks.push(await lobToBuffer(row.PROGTXT));
  }

  return {
    rows: result.rows?.length ?? 0,
    program: Buffer.concat(chunks)
  };
}

async function captureNames(connection, key) {
  const binds = {};
  const predicate = buildKeyPredicate(key, binds);

  const result = await connection.execute(
    `
      SELECT *
      FROM SYSADM.PSPCMNAME
      WHERE ${predicate}
      ORDER BY NAMENUM
    `,
    binds,
    {
      outFormat: oracledb.OUT_FORMAT_OBJECT
    }
  );

  return result.rows ?? [];
}

async function captureDefinition(connection, row) {
  const key = definitionKey(row);

  const source = await captureSource(connection, key);
  const program = await captureProgram(connection, key);
  const names = await captureNames(connection, key);

  return {
    key,
    sourceRows: source.rows,
    source: source.source,
    programRows: program.rows,
    program: program.program,
    names
  };
}

function errorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function sourceContext(source, offset, radius = 80) {
  if (
    !Number.isInteger(offset) ||
    offset < 0
  ) {
    return undefined;
  }

  const start = Math.max(0, offset - radius);
  const end = Math.min(source.length, offset + radius);

  return source
    .slice(start, end)
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

function sourceAtOffset(source, offset) {
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset >= source.length
  ) {
    return '';
  }

  return source.slice(offset);
}

function failureConstruct(source, offset) {
  const tail = sourceAtOffset(source, offset);

  if (!tail) {
    return 'EOF';
  }

  if (tail.startsWith('/*')) {
    return 'BLOCK_COMMENT';
  }

  if (tail.startsWith('//')) {
    return 'LINE_COMMENT';
  }

  const word = /^[A-Za-z_%][A-Za-z0-9_%]*/.exec(tail);

  if (word) {
    return word[0];
  }

  return tail.slice(0, 16);
}

function errorSourceOffset(error) {
  const message = errorMessage(error);

  const match = message.match(
    /source offset\s+(\d+)/i
  );

  if (!match) {
    return undefined;
  }

  return Number.parseInt(match[1], 10);
}

function validateDefinition(capture) {

  const encodeContext = {
    owner: {
      recordName: String(
        capture.key.OBJECTVALUE1 ?? ''
      ).trim(),
      fieldName: String(
        capture.key.OBJECTVALUE2 ?? ''
      ).trim()
    }
  };

  const decode = {
    success: false
  };

  const sourceEncode = {
    success: false
  };

  const semanticRoundTrip = {
    success: false
  };

  /*
   * TEST A
   *
   * PSPCMTXT -> encoder -> PSPCMPROG
   */
  try {
    const encoded = encodeProgram(
      capture.source,
      encodeContext
    );

    const diff = compareBuffers(
      capture.program,
      encoded
    );

    // Diagnostic only: compare the statement streams after
    // the 37-byte PSPCMPROG header.
    const bodyDiff = compareBuffers(
      capture.program.subarray(37),
      encoded.subarray(37)
    );

    if (!bodyDiff.exact) {
      diff.bodyFirstDifference =
        bodyDiff.firstDifference === undefined
          ? undefined
          : bodyDiff.firstDifference + 37;

      diff.bodyExpectedWindow = bodyDiff.expectedWindow;
      diff.bodyActualWindow = bodyDiff.actualWindow;
    }

    sourceEncode.success = true;
    sourceEncode.exactProgramMatch = diff.exact;
    sourceEncode.generatedLength = encoded.length;
    sourceEncode.diff = diff;
  } catch (error) {
    sourceEncode.error = errorMessage(error);

    const offset = errorSourceOffset(error);

    if (offset !== undefined) {
      sourceEncode.errorOffset = offset;
      sourceEncode.errorContext = sourceContext(
        capture.source,
        offset
      );
    }
    sourceEncode.failureConstruct = failureConstruct(
      capture.source,
      offset
    );

  }

  /*
   * Decode the real PeopleTools program.
   *
   * For this first arbitrary-corpus pass we are intentionally
   * exercising ordinary/event PeopleCode.
   *
   * Application Class owner detection comes later.
   */
  let decodedSource;
  let decodedCommentOpcodes;

  try {
    const names = new NameTable();

    for (const row of capture.names) {
      const recname = String(row.RECNAME ?? '').trim();
      const refname = String(row.REFNAME ?? '').trim();

      let name;

      if (recname && refname) {
        name = `${recname}.${refname}`;
      } else if (refname) {
        name = refname;
      } else {
        name = recname;
      }

      names.add(row.NAMENUM, name);
    }

    const decoded = decodeProgram(
      capture.program,
      names,
      {
        mode: 'auto'
      }
    );

    decodedSource = decoded.text;
    decodedCommentOpcodes = decoded.tokens
      .map(token => token.opcode)
      .filter(opcode => opcode === 0x24 || opcode === 0x4e);

    decode.success = true;
    decode.decodedSource = decodedSource;
    decode.normalizedSourceMatch = sourcesMatch(
      capture.source,
      decodedSource
    );
  } catch (error) {
    decode.error = errorMessage(error);
  }

  /*
   * TEST B
   *
   * PSPCMPROG -> decoder -> PeopleCode -> encoder -> PSPCMPROG
   *
   * This is deliberately semantic.
   *
   * We do NOT use ProgramImage.replay() here.
   */
  if (decodedSource !== undefined) {
    try {
      const encoded = encodeProgram(
        decodedSource,
        {
          ...encodeContext,
          commentOpcodes: decodedCommentOpcodes
        }
      );

      const diff = compareBuffers(
        capture.program,
        encoded
      );

      // Diagnostic comparison excluding the 36-byte PSPCMPROG header.
      // The normal full-buffer comparison above remains authoritative.
      const bodyDiff = compareBuffers(
        capture.program.subarray(37),
        encoded.subarray(37)
      );

      if (!bodyDiff.exact) {
        console.log(
          `  RT BODY DIFF @ ${bodyDiff.firstDifference}`
        );

        if (bodyDiff.expectedWindow) {
          console.log(
            `  stored body ${bodyDiff.expectedWindow}`
          );
        }

        if (bodyDiff.actualWindow) {
          console.log(
            `  gen body    ${bodyDiff.actualWindow}`
          );
        }
      }

      if (!bodyDiff.exact) {
        diff.bodyFirstDifference =
          bodyDiff.firstDifference === undefined
            ? undefined
            : bodyDiff.firstDifference + 37;

        diff.bodyExpectedWindow = bodyDiff.expectedWindow;
        diff.bodyActualWindow = bodyDiff.actualWindow;
      }

      if (!bodyDiff.exact) {
        diff.bodyFirstDifference =
          bodyDiff.firstDifference === undefined
            ? undefined
            : bodyDiff.firstDifference + 36;

        diff.bodyExpectedWindow = bodyDiff.expectedWindow;
        diff.bodyActualWindow = bodyDiff.actualWindow;
      }

      semanticRoundTrip.success = true;
      semanticRoundTrip.exactProgramMatch = diff.exact;
      semanticRoundTrip.generatedLength = encoded.length;
      semanticRoundTrip.diff = diff;
    } catch (error) {
      semanticRoundTrip.error = errorMessage(error);

      const offset = errorSourceOffset(error);

      if (offset !== undefined) {
        semanticRoundTrip.errorOffset = offset;
        semanticRoundTrip.errorContext = sourceContext(
          decodedSource,
          offset
        );
        semanticRoundTrip.failureConstruct = failureConstruct(
          decodedSource,
          offset
        );
        
      }
    }
  }

  const classification = classifyResult({
    decode,
    sourceEncode,
    semanticRoundTrip
  });

  return {
    decode,
    sourceEncode,
    semanticRoundTrip,
    classification
  };
}

function printDefinition(index, total, capture, validation) {
  console.log('');
  console.log(
    `[${index}/${total}] ${keyDescription(capture.key)}`
  );

  console.log(
    `  PSPCMTXT  rows=${capture.sourceRows}` +
    ` chars=${capture.source.length}`
  );

  console.log(
    `  PSPCMPROG rows=${capture.programRows}` +
    ` bytes=${capture.program.length}`
  );

  console.log(
    `  PSPCMNAME rows=${capture.names.length}`
  );

  if (capture.program.length > 0) {
    const previewLength = Math.min(
      capture.program.length,
      24
    );

    console.log(
      `  program   ${capture.program
        .subarray(0, previewLength)
        .toString('hex')
        .match(/.{1,2}/g)
        ?.join(' ')}${
          capture.program.length > previewLength
            ? ' ...'
            : ''
        }`
    );
    console.log(
      `  decode    ${
        validation.decode.success
          ? validation.decode.normalizedSourceMatch
            ? 'SOURCE MATCH'
            : 'SOURCE MISMATCH'
          : `ERROR: ${validation.decode.error}`
      }`
    );

    console.log(
      `  source→bin ${
        validation.sourceEncode.success
          ? validation.sourceEncode.exactProgramMatch
            ? 'EXACT'
            : `MISMATCH @ ${
                validation.sourceEncode.diff?.firstDifference
              }`
          : `ERROR: ${validation.sourceEncode.error}`
      }`
    );
    if (
      validation.sourceEncode.success &&
      !validation.sourceEncode.exactProgramMatch &&
      validation.sourceEncode.diff
    ) {
      const diff = validation.sourceEncode.diff;

      console.log(
        `  bin sizes  stored=${diff.expectedLength} generated=${diff.actualLength}`
      );

      if (diff.expectedWindow) {
        console.log(
          `  stored bin ${diff.expectedWindow}`
        );
      }

      if (diff.actualWindow) {
        console.log(
          `  gen bin    ${diff.actualWindow}`
        );
      }

      if (diff.bodyFirstDifference !== undefined) {
        console.log(
          `  body diff  @ ${diff.bodyFirstDifference}`
        );

        if (diff.bodyExpectedWindow) {
          console.log(
            `  stored body ${diff.bodyExpectedWindow}`
          );
        }

        if (diff.bodyActualWindow) {
          console.log(
            `  gen body    ${diff.bodyActualWindow}`
          );
        }
      }
    }
    if (validation.sourceEncode.errorContext) {
      console.log(
        `  source ctx ${validation.sourceEncode.errorContext}`
      );
      if (validation.sourceEncode.failureConstruct) {
        console.log(
          `  construct  ${validation.sourceEncode.failureConstruct}`
        );
      }
    }

    console.log(
      `  roundtrip ${
        validation.semanticRoundTrip.success
          ? validation.semanticRoundTrip.exactProgramMatch
            ? 'EXACT'
            : `MISMATCH @ ${
                validation.semanticRoundTrip.diff?.firstDifference
              }`
          : validation.semanticRoundTrip.error
            ? `ERROR: ${validation.semanticRoundTrip.error}`
            : 'NOT ATTEMPTED'
      }`
    );

    if (
      validation.semanticRoundTrip.success &&
      !validation.semanticRoundTrip.exactProgramMatch &&
      validation.semanticRoundTrip.diff
    ) {
      const diff = validation.semanticRoundTrip.diff;

      console.log(
        `  rt sizes   stored=${diff.expectedLength} generated=${diff.actualLength}`
      );

      if (diff.expectedWindow) {
        console.log(
          `  stored rt  ${diff.expectedWindow}`
        );
      }

      if (diff.actualWindow) {
        console.log(
          `  gen rt     ${diff.actualWindow}`
        );
      }
    }

    if (validation.semanticRoundTrip.errorContext) {
      console.log(
        `  decode ctx ${validation.semanticRoundTrip.errorContext}`
      );
    }
    console.log(
      `  result     ${validation.classification}`
    );
 
    if (globalThis.__corpusVerbose) {
      console.log('');
      console.log('  ----- VERBOSE SOURCE -----');
      console.log(capture.source);

      console.log('  ----- VERBOSE PSPCMPROG HEX -----');
      console.log(
        capture.program
          .toString('hex')
          .match(/.{1,2}/g)
          ?.join(' ') ?? ''
      );

      console.log('  ----- VERBOSE DECODED SOURCE -----');
      console.log(
        validation.decode.decodedSource ??
        `decode unavailable: ${validation.decode.error ?? 'unknown error'}`
      );

      console.log('  ----- PSPCMNAME -----');
      console.dir(capture.names, {
        depth: null,
        colors: false,
        maxArrayLength: null
      });
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = getConnectionConfig();

  globalThis.__corpusVerbose = args.verbose;

  console.log('PeopleCode Corpus Inventory');
  console.log('---------------------------');
  console.log(`Database: ${config.connectString}`);
  console.log(`Limit:    ${args.limit}`);
  console.log(`Offset:   ${args.offset}`);
  console.log('');

  let connection;

  try {
    connection = await oracledb.getConnection(config);

    console.log('Connected read-only workflow.');

    const definitions = await discoverDefinitions(
      connection,
      args
    );

    console.log(
      `Discovered ${definitions.length} definition(s).`
    );

    let sourceDefinitions = 0;
    let compiledDefinitions = 0;
    let totalProgramBytes = 0;
    let totalNameRows = 0;

    let decodeSuccesses = 0;
    let sourceMatches = 0;
    let sourceEncodeExact = 0;
    let semanticRoundTripExact = 0;

    const classifications = new Map();

    for (let i = 0; i < definitions.length; i++) {
      const capture = await captureDefinition(
        connection,
        definitions[i]
      );

      const validation = validateDefinition(capture);

      printDefinition(
        i + 1,
        definitions.length,
        capture,
        validation
      );

      if (validation.decode.success) {
        decodeSuccesses++;
      }

      if (validation.decode.normalizedSourceMatch) {
        sourceMatches++;
      }

      if (validation.sourceEncode.exactProgramMatch) {
        sourceEncodeExact++;
      }

      if (validation.semanticRoundTrip.exactProgramMatch) {
        semanticRoundTripExact++;
      }

      classifications.set(
        validation.classification,
        (classifications.get(validation.classification) ?? 0) + 1
      );

      if (capture.source.length > 0) {
        sourceDefinitions++;
      }

      if (capture.program.length > 0) {
        compiledDefinitions++;
      }

      totalProgramBytes += capture.program.length;
      totalNameRows += capture.names.length;
    }

    console.log('');
    console.log('Summary');
    console.log('-------');
    console.log(
      `Definitions:       ${definitions.length}`
    );
    console.log(
      `With source:       ${sourceDefinitions}`
    );
    console.log(
      `With PSPCMPROG:    ${compiledDefinitions}`
    );
    console.log(
      `Program bytes:     ${totalProgramBytes}`
    );
    console.log(
      `PSPCMNAME rows:    ${totalNameRows}`
    );
    console.log('');
    console.log('Validation');
    console.log('----------');
    console.log(
      `Decode success:     ${decodeSuccesses}`
    );
    console.log(
      `Source matches:     ${sourceMatches}`
    );
    console.log(
      `Source encode exact:${sourceEncodeExact}`
    );
    console.log(
      `Round-trip exact:   ${semanticRoundTripExact}`
    );

    console.log('');
    console.log('Classifications');
    console.log('---------------');

    for (
      const [classification, count]
      of [...classifications.entries()]
        .sort((a, b) => b[1] - a[1])
    ) {
      console.log(
        `${classification.padEnd(28)} ${count}`
      );
    }

  } finally {
    if (connection) {
      await connection.close();
    }
  }
}

main().catch(error => {
  console.error('');
  console.error('Corpus inventory failed.');
  console.error(
    error instanceof Error
      ? error.stack ?? error.message
      : error
  );

  process.exitCode = 1;
});
