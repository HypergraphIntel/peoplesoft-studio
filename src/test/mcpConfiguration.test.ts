import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MCP_PORT, mcpPortError, planMcpReconfiguration
} from '../mcp/configuration.js';

/*
 * `peoplesoft.mcp.enabled` / `peoplesoft.mcp.port`: what the controller does
 * when either changes. The controller itself needs the extension host; its
 * decisions are made here.
 */

test('the default port is 7337 and valid', () => {
  assert.equal(DEFAULT_MCP_PORT, 7337);
  assert.equal(mcpPortError(DEFAULT_MCP_PORT), undefined);
});

test('ports outside 1024-65535, or not whole numbers, are rejected', () => {
  assert.equal(mcpPortError(1024), undefined);
  assert.equal(mcpPortError(65535), undefined);
  assert.equal(mcpPortError(80), 'Port must be between 1024 and 65535.');
  assert.equal(mcpPortError(65536), 'Port must be between 1024 and 65535.');
  assert.equal(mcpPortError(7337.5), 'Port must be a whole number.');
  assert.equal(mcpPortError('7337'), 'Port must be a whole number.');
  assert.equal(mcpPortError(Number.NaN), 'Port must be a whole number.');
});

const on = (port = 7337) => ({ enabled: true, port });
const off = (port = 7337) => ({ enabled: false, port });

test('disabling stops the server in any state but disabled', () => {
  assert.equal(planMcpReconfiguration('running', 7337, off()), 'stop');
  assert.equal(planMcpReconfiguration('stopped', undefined, off()), 'stop');
  assert.equal(planMcpReconfiguration('error', undefined, off()), 'stop');
  assert.equal(planMcpReconfiguration('disabled', undefined, off(8000)), 'none');
});

test('enabling starts the server', () => {
  assert.equal(planMcpReconfiguration('disabled', undefined, on()), 'start');
});

test('a new port restarts a running server; the same port leaves it alone', () => {
  assert.equal(planMcpReconfiguration('running', 7337, on(8123)), 'restart');
  assert.equal(planMcpReconfiguration('running', 7337, on(7337)), 'none');
});

test('a server the user stopped stays stopped; only its URL follows the port', () => {
  assert.equal(planMcpReconfiguration('stopped', undefined, on(8123)), 'update-url');
});

test('a failed server is retried, so choosing a free port recovers from a port in use', () => {
  assert.equal(planMcpReconfiguration('error', undefined, on(8123)), 'start');
});

test('a change mid-start waits for the start to finish', () => {
  assert.equal(planMcpReconfiguration('starting', undefined, on(8123)), 'none');
});
