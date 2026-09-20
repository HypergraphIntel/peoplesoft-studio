import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OracleProvider } from '../providers/oracle.js';

/**
 * These run without a database. They cover the part of connect() that happens
 * before the network: loading node-oracledb and applying its settings.
 *
 * That is where a real failure lived. A dynamic import of a CommonJS module
 * yields a sealed namespace object, so setting `outFormat` threw
 * "Cannot assign to property 'outFormat' of [object Module]" before any
 * connection was attempted — every connection failed, with an error that said
 * nothing about databases.
 */

/** Port 1 refuses immediately, so the attempt fails without a timeout wait. */
const UNREACHABLE = 'localhost:1/NOSUCHDB';

function provider() {
  return new OracleProvider({
    name: 'TEST', connectString: UNREACHABLE, user: 'SYSADM', password: 'x'
  });
}

test('loading the driver and applying its settings does not throw', async () => {
  const p = provider();
  await assert.rejects(() => p.connect(), (err: Error) => {
    assert.ok(!/Cannot assign to property/.test(err.message),
      `connect() failed while configuring the driver, not while connecting: ${err.message}`);
    assert.ok(!(err instanceof TypeError),
      `connect() threw a TypeError before reaching the database: ${err.message}`);
    return true;
  });
});

test('an unreachable database reports a connection failure naming the target', async () => {
  const p = provider();
  await assert.rejects(() => p.connect(), (err: Error) => {
    assert.match(err.message, /Could not connect to localhost:1\/NOSUCHDB/);
    return true;
  });
});

test('a failed connection leaves the provider disconnected and retryable', async () => {
  const p = provider();
  await assert.rejects(() => p.connect());
  assert.equal(p.isConnected, false);
  // A second attempt must retry rather than report success from the first.
  await assert.rejects(() => p.connect());
});

test('disposing a provider that never connected is harmless', async () => {
  await provider().dispose();
});

test('operations before connecting say so rather than failing obscurely', async () => {
  await assert.rejects(() => provider().listProjects(), /is not connected/);
});
