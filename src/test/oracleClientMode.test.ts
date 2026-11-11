import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeOracleClient, OpenError, startOracleClient, thickModeFailure } from '../db/oracle.js';
import { oracleClientOptions, validateSetting } from '../settings/settingsModel.js';

/* node-oracledb Thin / Thick mode: one per process (window), chosen by the Oracle settings. */

const driver = (fail?: { code: string; message: string }) => {
  const calls: unknown[] = [];
  return { calls, thin: true, initOracleClient(args?: unknown) { calls.push(args); if (fail) throw Object.assign(new Error(fail.message), { code: fail.code }); } };
};

test('the Oracle settings select Thin or Thick; an Instant Client directory alone still means Thick', () => {
  assert.deepEqual(oracleClientOptions(undefined, '', ''), { mode: 'thin' });
  assert.deepEqual(oracleClientOptions('thin', '', '/etc/tns'), { mode: 'thin', configDir: '/etc/tns' });
  assert.deepEqual(oracleClientOptions('thick', '', ''), { mode: 'thick' }, 'Thick from the system library search path');
  assert.deepEqual(oracleClientOptions(undefined, ' /opt/ic23 ', ''), { mode: 'thick', libDir: '/opt/ic23' }, 'pre-1.0.1 setups stay Thick');
  assert.deepEqual(oracleClientOptions('thin', '/opt/ic23', ''), { mode: 'thin', libDir: '/opt/ic23' }, 'an explicit Thin wins');
  assert.equal(validateSetting('oracle.configDir', 'tns').ok, false);
  assert.deepEqual(validateSetting('oracle.configDir', ' /etc/tns '), { ok: true, value: '/etc/tns' });
  assert.equal(validateSetting('oracle.clientMode', 'thick').ok, true);
  assert.equal(validateSetting('oracle.clientMode', 'fat').ok, false);
});

test('Thick starts node-oracledb with the directories given, and Thin asks nothing of it', () => {
  const d = driver();
  assert.equal(startOracleClient(d as never, { mode: 'thick', libDir: '/opt/ic23', configDir: '/etc/tns' }), 'thick');
  assert.deepEqual(d.calls, [{ libDir: '/opt/ic23', configDir: '/etc/tns' }]);
  const sys = driver();
  startOracleClient(sys as never, { mode: 'thick' });
  assert.deepEqual(sys.calls, [{}], 'no libDir: the system library search path');
  const thin = driver();
  assert.equal(startOracleClient(thin as never, { mode: 'thin', configDir: '/etc/tns' }), 'thin');
  assert.equal(startOracleClient(thin as never, undefined), 'thin');
  assert.deepEqual(thin.calls, []);
  assert.equal(startOracleClient({ ...driver(), thin: false } as never, { mode: 'thin' }), 'thick', 'a window already in Thick mode serves Thin requests with Thick');
});

test('a Thick start that cannot happen says what to do', () => {
  const fail = (code: string, platform: NodeJS.Platform = 'linux') => {
    try { startOracleClient(driver({ code, message: `${code}: driver says no` }) as never, { mode: 'thick', libDir: '/opt/ic23' }); }
    catch (e) { assert.ok(e instanceof OpenError); return (e as Error).message; }
    assert.fail('expected a refusal');
  };
  assert.match(fail('NJS-118'), /already opened an Oracle connection in Thin mode.*Reload the window/);
  assert.match(fail('NJS-090'), /different Instant Client.*Reload the window/);
  assert.match(fail('DPI-1047'), /no 64-bit Oracle Client libraries were found in \/opt\/ic23/);
  // The advice follows the platform (startOracleClient uses the host's; CI runs Linux and Windows).
  assert.match(thickModeFailure(Object.assign(new Error('DPI-1047: x'), { code: 'DPI-1047' }), { mode: 'thick', libDir: '/opt/ic23' }, 'linux'), /found in \/opt\/ic23.*libaio/);
  assert.match(thickModeFailure(Object.assign(new Error('DPI-1047: x'), { code: 'DPI-1047' }), { mode: 'thick' }, 'win32'), /on the system library search path.*Visual Studio redistributable/);
  assert.match(fail('ORA-12345'), /Could not start Oracle Thick mode in \/opt\/ic23/);
  // Linux: libclntsh found in the directory, its own libraries not (Instant Client 23.26 on this host, 2026-11-11).
  const linux = thickModeFailure(Object.assign(new Error('DPI-1047: Cannot locate a 64-bit Oracle Client library: "libnnz.so: cannot open shared object file: No such file or directory"'), { code: 'DPI-1047' }),
    { mode: 'thick', libDir: '/opt/ic23' }, 'linux');
  assert.match(linux, /library search path when VS Code starts.*ldconfig.*LD_LIBRARY_PATH=\/opt\/ic23/);
});

test('connection details name the client in use', () => {
  assert.equal(describeOracleClient({ versionString: '6.10.0' }, 'thin'), 'node-oracledb 6.10.0 Thin');
  assert.equal(describeOracleClient({ versionString: '6.10.0', oracleClientVersionString: '23.6.0.24.10' }, 'thick'), 'node-oracledb 6.10.0 Thick, Oracle Client 23.6.0.24.10');
});
