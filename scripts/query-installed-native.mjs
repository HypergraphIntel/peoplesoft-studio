/** Package and install an unmodified candidate into an isolated real VS Code host. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
const exec = promisify(execFile), root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (!process.env.PSLAB_ACCESSID || !process.env.PSLAB_ACCESSPSWD) throw Error('Set the HRDMO lab credentials in the environment.');
const dir = mkdtempSync(path.join(os.tmpdir(), 'psft-query-installed-'));
const report = path.resolve(process.argv[2] ?? 'tools/lab/results/query-installed-2026-10-21.json');
mkdirSync(path.dirname(report), { recursive: true });
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const port = async () => { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; };
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('VSCODE_') || key === 'ELECTRON_RUN_AS_NODE' || key === 'PSFT_DISABLE_MCP') delete env[key];
delete env.WAYLAND_DISPLAY; env.XDG_SESSION_TYPE = 'x11';
const vsix = path.join(dir, 'candidate.vsix'), extensions = path.join(dir, 'extensions'), user = path.join(dir, 'user');
console.log('Packaging Query acceptance candidate: ' + dir);
await exec(path.join(root, 'node_modules/.bin/vsce'), ['package', '--out', vsix], { cwd: root, maxBuffer: 4e6, env });
await exec('code', ['--install-extension', vsix, '--force', '--extensions-dir', extensions, '--user-data-dir', user], { maxBuffer: 2e6, env });
const candidate = path.join(extensions, readdirSync(extensions).find(x => x.toLowerCase().startsWith('jarednorris.peoplesoft-studio-')));
const manifestPath = path.join(candidate, 'package.json'), manifestBytes = readFileSync(manifestPath);
const bundleHash = hash(path.join(candidate, 'dist/extension.js')), workerHash = hash(path.join(candidate, 'dist/validateWorker.js'));
if (bundleHash !== hash(path.join(root, 'dist/extension.js'))) throw Error('Installed bundle differs from the current source build.');
const cdpPort = await port(), mcpPort = await port();
const connection = { name: 'HRDMO Query acceptance', kind: 'oracle', connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/HRDMO', user: process.env.PSLAB_ACCESSID, peoplecodeAccess: 'writable', peoplesoftOperatorId: process.env.PSLAB_OPERATOR ?? 'JARED' };
mkdirSync(path.join(user, 'User'), { recursive: true });
writeFileSync(path.join(user, 'User/settings.json'), JSON.stringify({ 'files.autoSave': 'off', 'workbench.startupEditor': 'none', 'security.workspace.trust.enabled': false,
  'update.mode': 'none', 'extensions.autoCheckUpdates': false, 'extensions.autoUpdate': false, 'chat.disableAIFeatures': true,
  'peoplesoft.connections': [connection], 'peoplesoft.mcp.enabled': true, 'peoplesoft.mcp.port': mcpPort, 'peoplesoft.mcp.writes': 'confirm',
  'peoplesoft.writeNamePrefix': 'ZZ_BQUI_', 'window.dialogStyle': 'custom', 'peoplesoft.peoplecode.validateAsYouType': false }));
const workspace = path.join(dir, 'workspace'), driver = path.join(dir, 'driver'); mkdirSync(workspace); mkdirSync(driver);
writeFileSync(path.join(driver, 'package.json'), JSON.stringify({ name: 'query-acceptance-driver', publisher: 'psft-tests', version: '0.0.1', engines: { vscode: '^1.90.0' }, activationEvents: ['onStartupFinished'], main: './driver.cjs' }));
// A normal host is required: --extensionTestsPath deliberately refuses modal dialogs.
writeFileSync(path.join(driver, 'driver.cjs'), `exports.activate=()=>{void require(${JSON.stringify(path.join(root, 'scripts/query-installed-native.cjs'))}).run().catch(e=>console.error(e)).finally(()=>require('vscode').commands.executeCommand('workbench.action.quit'))};`);
const input = path.join(dir, 'input.json'), resultFile = path.join(dir, 'result.json');
writeFileSync(input, JSON.stringify({ root, connection, candidate, cdpUrl: `http://127.0.0.1:${cdpPort}`, mcpUrl: `http://127.0.0.1:${mcpPort}/mcp`, artifactDirectory: path.dirname(report), storage: path.join(user, 'User/globalStorage/jarednorris.peoplesoft-studio') }), { mode: 0o600 });
const host = exec('xvfb-run', ['-a', '-s', '-screen 0 1600x1100x24', '/usr/share/code/code', '--ozone-platform=x11', '--no-sandbox', '--disable-gpu', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--new-window',
  `--remote-debugging-port=${cdpPort}`, '--remote-debugging-address=127.0.0.1', '--user-data-dir', user, '--extensions-dir', extensions, '--extensionDevelopmentPath', driver,
  workspace], { cwd: root, detached: true, maxBuffer: 4e6, env: { ...env, PSFT_QUERY_INPUT: input, PSFT_QUERY_RESULT: resultFile } });
const timer = setTimeout(() => { try { process.kill(-host.child.pid, 'SIGTERM'); } catch {} }, 600000);
let failed; try { await host; } catch (e) { failed = e; } finally { clearTimeout(timer); }
let results; try { results = JSON.parse(readFileSync(resultFile, 'utf8')); } catch {}
if (results) {
  results.installation = { activation: 'installed', manifestUnmodified: readFileSync(manifestPath).equals(manifestBytes), bundleUnmodified: hash(path.join(candidate, 'dist/extension.js')) === bundleHash, workerUnmodified: hash(path.join(candidate, 'dist/validateWorker.js')) === workerHash };
  results.passed &&= Object.values(results.installation).every(Boolean);
  Object.assign(results, { bundleSha256: bundleHash, workerSha256: workerHash, vsixSha256: hash(vsix), candidateVsix: vsix });
  writeFileSync(report, JSON.stringify(results, null, 2) + '\n'); console.log(JSON.stringify(results, null, 2));
}
if (failed) { console.error(String(failed.stdout ?? '').slice(-5000), String(failed.stderr ?? '').slice(-2500)); throw Error('Installed Query acceptance failed; see ' + dir); }
if (!results?.passed) throw Error('Installed Query acceptance lacks complete evidence: ' + dir);
copyFileSync(vsix, '/tmp/peoplesoft-studio-query-tested.vsix');
console.log('Installed Query acceptance passed: ' + report);
