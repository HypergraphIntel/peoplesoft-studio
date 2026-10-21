/** Unmodified installed VSIX in a private real VS Code/Xvfb host. HRDMO reads and unsaved lab buffers only. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
const exec = promisify(execFile);
const testEnv = { ...process.env };
for (const key of Object.keys(testEnv)) if (key.startsWith('VSCODE_') || key === 'ELECTRON_RUN_AS_NODE') delete testEnv[key];
delete testEnv.WAYLAND_DISPLAY;
testEnv.XDG_SESSION_TYPE = 'x11';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (!process.env.PSLAB_ACCESSID || !process.env.PSLAB_ACCESSPSWD) throw new Error('Set PSLAB_ACCESSID and PSLAB_ACCESSPSWD for the HRDMO lab.');
const dir = mkdtempSync(path.join(tmpdir(), 'psft-editor-native-'));
const report = path.resolve(process.argv[2] ?? path.join(tmpdir(), 'psft-editor-native-results.json'));
mkdirSync(path.dirname(report), { recursive: true });
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
try {
  const vsix = path.join(dir, 'candidate.vsix');
  await exec(path.join(root, 'node_modules/.bin/vsce'), ['package', '--out', vsix], { cwd: root, maxBuffer: 4e6 });
  const extensions = path.join(dir, 'extensions');
  await exec('code', ['--install-extension', vsix, '--force', '--extensions-dir', extensions, '--user-data-dir', path.join(dir, 'user')], { maxBuffer: 2e6 });
  const candidate = path.join(extensions, readdirSync(extensions).find((x) => x.toLowerCase().startsWith('jarednorris.peoplesoft-studio-')));
  const manifestPath = path.join(candidate, 'package.json');
  const manifestBytes = readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString());
  const bundleHash = hash(path.join(candidate, manifest.main));
  const workerHash = hash(path.join(candidate, 'dist/validateWorker.js'));
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const connection = { name: 'HRDMO editor acceptance', kind: 'oracle', connectString: '127.0.0.1:15210/HRDMO', user: process.env.PSLAB_ACCESSID,
    peoplecodeAccess: 'writable', peoplesoftOperatorId: 'JARED' };
  const input = path.join(dir, 'input.json');
  writeFileSync(input, JSON.stringify({ root, connection, candidate, cdpUrl: `http://127.0.0.1:${port}`, artifactDirectory: path.dirname(report) }));
  const user = path.join(dir, 'user', 'User'); mkdirSync(user, { recursive: true });
  writeFileSync(path.join(user, 'settings.json'), JSON.stringify({ 'files.autoSave': 'off', 'workbench.startupEditor': 'none', 'security.workspace.trust.enabled': false,
    'update.mode': 'none', 'extensions.autoCheckUpdates': false, 'extensions.autoUpdate': false, 'chat.disableAIFeatures': true,
    'peoplesoft.connections': [connection, { ...connection, name: connection.name + ' B' }], 'peoplesoft.mcp.enabled': false, 'peoplesoft.writeNamePrefix': 'ZZ_',
    'peoplesoft.peoplecode.validateAsYouType': false, 'peoplesoft.peoplecode.validationDelay': 100 }));
  const workspace = path.join(dir, 'workspace'); mkdirSync(workspace);
  const driver = path.join(dir, 'test-driver'); mkdirSync(driver);
  writeFileSync(path.join(driver, 'package.json'), JSON.stringify({ name: 'editor-acceptance-driver', publisher: 'psft-tests', version: '0.0.1', engines: { vscode: '^1.90.0' }, main: './driver.cjs' }));
  writeFileSync(path.join(driver, 'driver.cjs'), 'exports.activate = () => {};');
  let failed;
  const host = exec('xvfb-run', ['-a', '-s', '-screen 0 1280x1024x24', '/usr/share/code/code', '--ozone-platform=x11', '--no-sandbox', '--disable-gpu', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--new-window',
    `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1',
    '--user-data-dir', path.join(dir, 'user'), '--extensions-dir', extensions, '--extensionDevelopmentPath', driver,
    '--extensionTestsPath', path.join(root, 'scripts/peoplecode-editor-native.cjs'), workspace],
    { cwd: root, detached: true, maxBuffer: 4e6, env: { ...testEnv, PSFT_DISABLE_MCP: '1', PSFT_EDITOR_INPUT: input, PSFT_EDITOR_RESULT: path.join(dir, 'result.json') } });
  const timer = setTimeout(() => { try { process.kill(-host.child.pid, 'SIGTERM'); } catch {} }, 240000);
  try { await host; } catch (error) { failed = error; } finally { clearTimeout(timer); }
  let results;
  try { results = JSON.parse(readFileSync(path.join(dir, 'result.json'), 'utf8')); } catch {}
  if (results) {
    results.installation = { activation: 'installed', manifestUnmodified: readFileSync(manifestPath).equals(manifestBytes),
      bundleUnmodified: hash(path.join(candidate, manifest.main)) === bundleHash, workerUnmodified: hash(path.join(candidate, 'dist/validateWorker.js')) === workerHash };
    results.passed &&= Object.values(results.installation).every(Boolean);
    results.bundleSha256 = bundleHash; results.workerSha256 = workerHash; results.vsixSha256 = hash(vsix);
    writeFileSync(report, JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2));
  }
  if (failed) { console.error(String(failed.stdout ?? '').slice(-3000), String(failed.stderr ?? '').slice(-1500)); throw new Error('Native editor acceptance failed; see the check output.'); }
  if (!results?.passed) throw new Error('Installed acceptance did not satisfy every check and integrity gate.');
  copyFileSync(vsix, path.join(path.dirname(report), 'peoplesoft-studio-editor-tested.vsix'));
  console.log(`Native editor acceptance report: ${report}`);
} finally { rmSync(dir, { recursive: true, force: true }); }
