/**
 * Full-population audit of FetchValue's dedicated Record.X shadow cache.
 *
 * The encoder checks the general DependencyScope Record pool before the
 * FetchValue-only cache. This read-only diagnostic counts whether the shadow
 * cache ever supplies a reference after the general lookup has missed.
 *
 * It uses only the completed local HCDEV snapshot and does not alter encoder
 * decisions or emitted bytes.
 */

import {
  DependencyLookupTraceEvent,
  encodeProgram
} from '../../../src/peoplecode/encoder';

import {
  getSnapshotDefinition,
  listSnapshotDefinitionIds
} from '../snapshot/reader';

import {
  openSnapshotDatabase
} from '../snapshot/store';

interface DefinitionAudit {
  definitionId: number;
  displayName: string;
  sourceText: string;
  events: DependencyLookupTraceEvent[];
  encodeError?: string;
}

interface CallSpan {
  name: string;
  start: number;
  end: number;
  ancestors: string[];
}

/**
 * Length-preserving mask used only for conservative call-nesting analysis.
 * This is deliberately not a PeopleCode parser: it removes the constructs
 * that can contain call-like text, then the balanced-parenthesis scan below
 * records identifier(...) spans.
 */
function maskCommentsAndStrings(source: string): string {
  let masked = '';
  let i = 0;

  while (i < source.length) {
    const delimited = source.startsWith('/*', i)
      ? '*/'
      : source.startsWith('<*', i)
        ? '*>'
        : source.startsWith('/+', i)
          ? '+/'
          : undefined;

    if (delimited !== undefined) {
      const end = source.indexOf(delimited, i + 2);
      const stop = end === -1 ? source.length : end + 2;
      masked += ' '.repeat(stop - i);
      i = stop;
      continue;
    }

    if (source[i] === '"' || source[i] === "'") {
      const quote = source[i];
      let j = i + 1;
      while (j < source.length) {
        if (source[j] !== quote) {
          j++;
          continue;
        }
        if (source[j + 1] === quote) {
          j += 2;
          continue;
        }
        j++;
        break;
      }
      masked += ' '.repeat(j - i);
      i = j;
      continue;
    }

    if (
      (i === 0 || !/[A-Za-z0-9_]/.test(source[i - 1])) &&
      /^(?:rem|remark)\b/i.test(source.slice(i))
    ) {
      const semi = source.indexOf(';', i);
      const stop = semi === -1 ? source.length : semi + 1;
      masked += ' '.repeat(stop - i);
      i = stop;
      continue;
    }

    masked += source[i];
    i++;
  }

  return masked;
}

function findCallSpans(source: string): CallSpan[] {
  const masked = maskCommentsAndStrings(source);
  const calls: CallSpan[] = [];
  const stack: Array<{
    name?: string;
    start: number;
    ancestors: string[];
  }> = [];
  const token = /[A-Za-z_][A-Za-z0-9_]*|[()]/g;
  let pendingName: { name: string; end: number } | undefined;
  let match: RegExpExecArray | null;

  while ((match = token.exec(masked)) !== null) {
    const value = match[0];
    const offset = match.index;

    if (/^[A-Za-z_]/.test(value)) {
      pendingName = { name: value, end: token.lastIndex };
      continue;
    }

    if (value === '(') {
      const name =
        pendingName !== undefined &&
        /^\s*$/.test(masked.slice(pendingName.end, offset))
          ? pendingName.name
          : undefined;
      stack.push({
        name,
        start: offset,
        ancestors: stack
          .map(frame => frame.name)
          .filter((ancestor): ancestor is string => ancestor !== undefined)
      });
      pendingName = undefined;
      continue;
    }

    const frame = stack.pop();
    if (frame?.name !== undefined) {
      calls.push({
        name: frame.name,
        start: frame.start,
        end: offset,
        ancestors: frame.ancestors
      });
    }
    pendingName = undefined;
  }

  return calls;
}

const isLookup = (
  event: DependencyLookupTraceEvent
): boolean => event.action === 'LOOKUP';

const isHit = (
  event: DependencyLookupTraceEvent
): boolean => isLookup(event) && event.reference !== undefined;

function sourceWindow(source: string, offset: number): string {
  const start = Math.max(0, offset - 70);
  const end = Math.min(source.length, offset + 90);

  return source
    .slice(start, end)
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function main(): void {
  const db = openSnapshotDatabase();
  const audits: DefinitionAudit[] = [];

  for (const definitionId of listSnapshotDefinitionIds(db)) {
    const definition = getSnapshotDefinition(db, definitionId);

    if (!/\bFetchValue\s*\(/i.test(definition.sourceText)) {
      continue;
    }

    const events: DependencyLookupTraceEvent[] = [];
    let encodeError: string | undefined;

    try {
      encodeProgram(definition.sourceText, {
        owner: {
          recordName: definition.objectvalue1.trim(),
          fieldName: definition.objectvalue2.trim()
        },
        dependencyLookupTrace: event => events.push(event)
      });
    } catch (error) {
      encodeError = error instanceof Error ? error.message : String(error);
    }

    audits.push({
      definitionId,
      displayName: definition.displayName,
      sourceText: definition.sourceText,
      events,
      encodeError
    });
  }

  db.close();

  const events = audits.flatMap(audit => audit.events);
  const scopeLookups = events.filter(
    event =>
      event.mechanism === 'dependency-scope-record' && isLookup(event)
  );
  const scopeStores = events.filter(
    event =>
      event.mechanism === 'dependency-scope-record' &&
      event.action === 'STORE'
  );
  const shadowLookups = events.filter(
    event =>
      event.mechanism === 'fetchvalue-shadow-record' && isLookup(event)
  );
  const shadowStores = events.filter(
    event =>
      event.mechanism === 'fetchvalue-shadow-record' &&
      event.action === 'STORE'
  );
  const shadowHits = shadowLookups.filter(isHit);

  const storeKey = (event: DependencyLookupTraceEvent): string =>
    `${event.sourceOffset}:${event.controlGroup}:` +
    `${event.recordName.toLowerCase()}:${event.reference?.sequence ?? '?'}`;

  const shadowOnlyStores = audits.flatMap(audit => {
    const scopeStoreKeys = new Set(
      audit.events
        .filter(
          event =>
            event.mechanism === 'dependency-scope-record' &&
            event.action === 'STORE'
        )
        .map(storeKey)
    );

    return audit.events
      .filter(
        event =>
          event.mechanism === 'fetchvalue-shadow-record' &&
          event.action === 'STORE' &&
          !scopeStoreKeys.has(storeKey(event))
      )
      .map(event => ({ audit, event }));
  });

  const encodeErrors = audits.filter(audit => audit.encodeError !== undefined);

  const staticFetchValueCalls = audits.flatMap(audit => {
    const masked = maskCommentsAndStrings(audit.sourceText);
    return findCallSpans(audit.sourceText)
      .filter(call => /^FetchValue$/i.test(call.name))
      .map(call => ({
        audit,
        call,
        hasExplicitRecord: /\bRecord\s*\.\s*[A-Za-z_]/i.test(
          masked.slice(call.start + 1, call.end)
        ),
        suppressionAncestor: call.ancestors.find(ancestor =>
          /^(?:PriorValue|RowScrollSelect(?:New)?|ScrollSelect)$/i.test(
            ancestor
          )
        )
      }));
  });

  const explicitRecordCalls = staticFetchValueCalls.filter(
    item => item.hasExplicitRecord
  );
  const suppressionNestedExplicitRecordCalls = explicitRecordCalls.filter(
    item => item.suppressionAncestor !== undefined
  );

  const unavailableExplicitRecordCalls = encodeErrors.flatMap(audit => {
    const offsetMatch = /source offset (\d+)/i.exec(audit.encodeError ?? '');
    const failureOffset = offsetMatch === null
      ? audit.sourceText.length
      : Number(offsetMatch[1]);

    return staticFetchValueCalls.filter(
      item =>
        item.audit === audit &&
        item.hasExplicitRecord &&
        item.call.start > failureOffset
    );
  });

  const definitionsWithShadowHits = audits.filter(audit =>
    audit.events.some(
      event =>
        event.mechanism === 'fetchvalue-shadow-record' && isHit(event)
    )
  );

  console.log(
    `Processed ${audits.length} FetchValue definitions ` +
      `(${encodeErrors.length} encode errors).\n`
  );
  console.log(`DependencyScope stores: ${scopeStores.length}`);
  console.log('--- FetchValue Record.X lookup provenance ---');
  console.log(
    `DependencyScope lookups: ${scopeLookups.length} ` +
      `(${scopeLookups.filter(isHit).length} hits, ` +
      `${scopeLookups.filter(event => !isHit(event)).length} misses/closed)`
  );
  console.log(
    `FetchValue shadow lookups reached after scope miss: ${shadowLookups.length} ` +
      `(${shadowHits.length} hits, ${shadowLookups.length - shadowHits.length} misses)`
  );
  console.log(`FetchValue shadow stores: ${shadowStores.length}`);
  console.log(`Shadow-only stores: ${shadowOnlyStores.length}`);
  console.log(
    `Definitions with a shadow-only hit: ${definitionsWithShadowHits.length}`
  );
  console.log('\n--- Static coverage boundary ---');
  console.log(
    `FetchValue calls: ${staticFetchValueCalls.length} ` +
      `(${explicitRecordCalls.length} containing explicit Record.X)`
  );
  console.log(
    'Explicit-Record FetchValue calls nested in a general-write ' +
      `suppression context: ${suppressionNestedExplicitRecordCalls.length}`
  );
  console.log(
    'Explicit-Record FetchValue calls after an encode failure: ' +
      unavailableExplicitRecordCalls.length
  );

  for (const item of suppressionNestedExplicitRecordCalls) {
    console.log(
      `  def ${item.audit.definitionId} (${item.audit.displayName}) ` +
        `inside ${item.suppressionAncestor} at ${item.call.start}`
    );
    console.log(`    ${sourceWindow(item.audit.sourceText, item.call.start)}`);
  }

  for (const item of unavailableExplicitRecordCalls) {
    console.log(
      `  def ${item.audit.definitionId} (${item.audit.displayName}) ` +
        `at ${item.call.start}`
    );
    console.log(`    ${sourceWindow(item.audit.sourceText, item.call.start)}`);
  }

  if (shadowOnlyStores.length > 0) {
    console.log('\n--- Shadow-only stores (potential future read candidates) ---');
    for (const { audit, event } of shadowOnlyStores) {
      console.log(
        `def ${audit.definitionId} (${audit.displayName}) ` +
          `Record.${event.recordName} group=${event.controlGroup} ` +
          `depth=${event.controlDepth} sequence=${event.reference!.sequence}`
      );
      console.log(`  ${sourceWindow(audit.sourceText, event.sourceOffset)}`);
    }
  }

  if (encodeErrors.length > 0) {
    console.log('\n--- Encode errors (evidence unavailable after failure point) ---');
    for (const audit of encodeErrors) {
      console.log(
        `def ${audit.definitionId} (${audit.displayName}): ${audit.encodeError}`
      );
    }
  }

  if (definitionsWithShadowHits.length === 0) {
    console.log(
      '\nNo generated FetchValue Record.X decision in the complete local ' +
        'population depends on the shadow cache.'
    );
    return;
  }

  console.log('\n--- Shadow-only hits ---');
  for (const audit of definitionsWithShadowHits) {
    for (const event of audit.events) {
      if (
        event.mechanism !== 'fetchvalue-shadow-record' ||
        !isHit(event)
      ) {
        continue;
      }

      console.log(
        `def ${audit.definitionId} (${audit.displayName}) ` +
          `Record.${event.recordName} group=${event.controlGroup} ` +
          `depth=${event.controlDepth} sequence=${event.reference!.sequence}`
      );
      console.log(`  ${sourceWindow(audit.sourceText, event.sourceOffset)}`);
    }
  }
}

main();
