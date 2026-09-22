// Offline, strict corpus baseline; never replays opaque bytes or uses stored
// metadata to generate dependencies. Usage: node scripts/validate-database-corpus.mjs
// CAPTURE.jsonl REPORT_PREFIX [LIMIT] [ENCODER_MODULE]
import { createReadStream, writeFileSync, openSync, closeSync, writeSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { decodeProgram } from '../dist-test/peoplecode/decoder.js';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const encoderModule = process.argv[5] ? pathToFileURL(resolve(process.argv[5])).href : new URL('../dist-test/peoplecode/encoder.js', import.meta.url).href;
const { encodeProgramArtifacts, UnsupportedPeopleCodeError } = await import(encoderModule);
import { readProgramLayout } from '../dist-test/peoplecode/programLayout.js';
import { NameTable } from '../dist-test/peoplecode/progtext.js';
import { normalizeSource, binaryDifference, keyColumns, projectNameRows, compareNameRows } from './lib/corpus-validation.mjs';
const [input, prefix, limitArg] = process.argv.slice(2);
if (!input || !prefix) throw new Error('Provide input JSONL and report prefix');
const limit = limitArg ? Number(limitArg) : Infinity;
const report = { input, encoderModule, startedAt: new Date().toISOString(), totals: {}, byOwner: {}, clusters: {}, normalization: 'Whitespace outside tokens and identifier case only; exact literal, numeric and comment content. CRLF normalized to LF.', nameProjection: 'All fourteen key columns and all six name columns compared. Uncalibrated PACKAGE/Declare Function serialization is unrepresentable, not a match.', examples: {} };
const details = openSync(prefix + '.details.jsonl', 'w');
const seen = new Set();
let examined = 0;
const count = (table, name) => table[name] = (table[name] ?? 0) + 1;
const cluster = (category, pattern, key) => {
  const table = report.clusters[category] ??= {};
  const item = table[pattern] ??= { count: 0, examples: [] };
  item.count++;
  if (item.examples.length < 3) item.examples.push(key);
};
try {
  for await (const line of createInterface({ input: createReadStream(input), crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    if (examined >= limit) break;
    examined++;
    const capture = JSON.parse(line);
    const id = JSON.stringify(keyColumns.map(c => capture.key[c]));
    const label = keyColumns.filter(c => c.startsWith('OBJECTVALUE')).map(c => capture.key[c]).filter(v => v !== ' ').join('.');
    const owner = keyColumns.filter(c => c.startsWith('OBJECTID')).map(c => capture.key[c]).join('/');
    const ownerReport = report.byOwner[owner] ??= { firstKey: capture.key, counts: {} };
    const bump = name => { count(report.totals, name); count(ownerReport.counts, name); };
    bump('examined');
    const result = { key: capture.key, owner, source: capture.source, names: capture.names, status: {} };
    const duplicateSeq = rows => new Set(rows.map(r => r.PROGSEQ)).size !== rows.length;
    if (seen.has(id) || duplicateSeq(capture.sourceRows) || duplicateSeq(capture.programRows)
      || new Set(capture.names.map(r => r.NAMENUM)).size !== capture.names.length) {
      bump('ambiguousCorrelations'); result.status.correlation = 'ambiguous';
      writeSync(details, JSON.stringify(result) + '\n'); continue;
    }
    seen.add(id);
    if (!capture.programRows.length) {
      bump('missingCompiledPrograms'); result.status.correlation = 'no compiled rows';
      writeSync(details, JSON.stringify(result) + '\n'); continue;
    }
    bump('resolved');
    const bytes = Buffer.concat(capture.programRows.map(r => Buffer.from(r.hex, 'hex')));
    result.originalLength = bytes.length;
    try { result.layout = readProgramLayout(bytes); }
    catch (error) { result.layoutError = error.message; bump('layoutFailures'); cluster('layout', error.message, label); }
    const table = new NameTable();
    for (const row of capture.names) table.add(row.NAMENUM, [row.RECNAME.trim(), row.REFNAME.trim()].filter(Boolean).join('.'));
    let decoded;
    try {
      decoded = decodeProgram(bytes, table, { mode: 'auto', isApplicationClass: capture.key.OBJECTID1 === 104 });
      bump('decoded');
      result.unknownOpcodes = decoded.unknownOpcodes;
      if (decoded.unknownOpcodes.length) {
        bump('unknownOpcodePrograms');
        for (const opcode of new Set(decoded.unknownOpcodes.map(x => x.opcode))) cluster('unknownOpcode', `0x${opcode.toString(16).padStart(2, '0')}`, label);
      }
      const a = normalizeSource(capture.source), b = normalizeSource(decoded.text);
      const sourceMatch = !decoded.unknownOpcodes.length && JSON.stringify(a) === JSON.stringify(b);
      result.status.source = sourceMatch ? 'normalized-exact' : 'mismatch';
      if (sourceMatch) bump('decodeSourceExact');
      else {
        bump('decodeSourceMismatches');
        result.decodedSource = decoded.text;
        const index = a.findIndex((value, i) => JSON.stringify(value) !== JSON.stringify(b[i]));
        const difference = index < 0 ? Math.min(a.length, b.length) : index;
        result.sourceDifference = { tokenIndex: difference, original: a.slice(Math.max(0, difference - 3), difference + 5), decoded: b.slice(Math.max(0, difference - 3), difference + 5) };
        cluster('sourceDifference', JSON.stringify([a[difference]?.[0], a[difference]?.[1]?.slice(0, 50), b[difference]?.[0], b[difference]?.[1]?.slice(0, 50)]), label);
      }
    } catch (error) { bump('decodeFailures'); result.decodeError = error.message; cluster('decodeFailure', error.message, label); }
    // Context is derived from owning keys, never from captured name rows.
    const context = capture.key.OBJECTID1 === 1 && capture.key.OBJECTID2 === 2
      ? { owner: { recordName: capture.key.OBJECTVALUE1, fieldName: capture.key.OBJECTVALUE2 } } : {};
    let encoded;
    try {
      encoded = encodeProgramArtifacts(capture.source, context);
      bump('encoded');
      result.binary = binaryDifference(bytes, encoded.program, readProgramLayout);
      result.status.binary = result.binary.equal ? 'exact' : 'mismatch';
      if (result.binary.equal) bump('encodeExact');
      else {
        bump('binaryMismatches');
        cluster('binary', result.binary.classification, label);
        for (const section of result.binary.sections) bump('binary' + section[0].toUpperCase() + section.slice(1) + 'Mismatches');
        const difference = result.binary.sectionDifferences.statements;
        if (difference) cluster('statementFirstDifference', `${difference.originalByte?.toString(16)} -> ${difference.generatedByte?.toString(16)}`, label);
      }
      const projected = projectNameRows(encoded.references, capture.key);
      result.references = encoded.references;
      result.nameComparison = compareNameRows(capture.names, projected);
      result.status.names = result.nameComparison.status;
      if (result.nameComparison.status === 'exact') bump('namesExact');
      else { bump('namesMismatches'); cluster('names', result.nameComparison.reason ?? result.nameComparison.column ?? 'row-count', label); }
      if (result.binary.equal && result.nameComparison.status === 'exact') bump('sourceArtifactsExact');
      if (result.binary.equal && result.nameComparison.status !== 'exact') bump('binaryExactNamesNotExact');
    } catch (error) {
      const unsupported = error instanceof UnsupportedPeopleCodeError || /unsupported|not supported/i.test(error.message);
      bump(unsupported ? 'unsupportedSyntax' : 'encodeFailures');
      result.encodeError = { name: error.name, message: error.message, offset: error.offset };
      result.status.binary = unsupported ? 'unsupported' : 'failed';
      const pattern = error.message.replace(/at source offset \d+/g, 'at source offset N');
      cluster(unsupported ? 'unsupported' : 'encodeFailure', pattern, label);
      if (typeof error.offset === 'number') {
        const next = /^\s*(%?\w+|\S)/.exec(capture.source.slice(error.offset))?.[1]?.toLowerCase() ?? '(eof)';
        cluster('unsupportedToken', next, label);
      }
    }
    // Independent second direction: decode -> source -> encode. Unknown bytes
    // are never allowed to count as exact full round trips.
    if (decoded && !decoded.unknownOpcodes.length) {
      try {
        const regenerated = encodeProgramArtifacts(decoded.text, context);
        if (regenerated.program.equals(bytes)) {
          bump('decodedBinaryExact');
          if (compareNameRows(capture.names, projectNameRows(regenerated.references, capture.key)).status === 'exact') bump('decodedArtifactsExact');
        } else {
          bump('decodedBinaryMismatches');
          result.decodedBinary = binaryDifference(bytes, regenerated.program, readProgramLayout);
        }
      } catch { bump('decodedEncodeFailures'); }
    }
    if (!encoded || !result.binary?.equal || result.status.names !== 'exact') {
      for (const [feature, regex] of Object.entries({ applicationClass: /\bclass\b/i, properties: /\bproperty\b/i, '%This': /%This\b/i, '%Session': /%Session\b/i, '%Request': /%Request\b/i, '%Response': /%Response\b/i,
        systemIdentifier: /%\w+/, PageReference: /\bPage\./i, ComponentReference: /\bComponent\./i, MenuReference: /\b(?:Menu|BarItem|ItemName)\./i, MessageReference: /\bMessage\./i,
        AppEngine: /\b(?:CallAppEngine|GetAESection|AppEngine\.)/i, JavaReflection: /\b(?:CreateJavaObject|GetJavaClass|ObjectDoMethod|ObjectGetProperty|ObjectSetProperty)\b/i })) {
        if (regex.test(capture.source)) cluster('featuresInFailures', feature, label);
      }
    }
    writeSync(details, JSON.stringify(result) + '\n');
    if (examined % 1000 === 0) console.log(`Validated ${examined}: ${report.totals.encodeExact ?? 0} binary, ${report.totals.decodeSourceExact ?? 0} source, ${report.totals.namesExact ?? 0} names exact`);
  }
} finally { closeSync(details); }
report.completedAt = new Date().toISOString();
const denominator = report.totals.resolved ?? 0;
report.percentages = Object.fromEntries(['encodeExact', 'decodeSourceExact', 'namesExact', 'sourceArtifactsExact', 'decodedBinaryExact', 'decodedArtifactsExact'].map(k => [k, denominator ? 100 * (report.totals[k] ?? 0) / denominator : 0]));
writeFileSync(prefix + '.summary.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ totals: report.totals, percentages: report.percentages }, null, 2));
