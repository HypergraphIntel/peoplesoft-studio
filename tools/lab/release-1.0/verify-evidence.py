"""Bind the recorded acceptance matrix to one unchanged VSIX and source freeze."""
import argparse
import hashlib
import json
import subprocess
import zipfile
from datetime import datetime, timezone
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('vsix', type=Path)
parser.add_argument('--source-freeze', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[3]
results = root / 'tools/lab/results/release-1.0'
read = lambda name: json.loads((results / name).read_text())
sha = lambda value: hashlib.sha256(value).hexdigest()
artifact_hash = sha(args.vsix.read_bytes())
with zipfile.ZipFile(args.vsix) as archive:
    manifest = json.loads(archive.read('extension/package.json'))
    assert manifest['version'] == '0.9.8'
    assert manifest['publisher'] == 'JaredNorris'
    assert manifest['name'] == 'peoplesoft-studio'
    worker_hash = sha(archive.read('extension/dist/validateWorker.js'))
    bundle_hash = sha(archive.read('extension/dist/extension.js'))
    assert b'CORE_READY' in archive.read('extension/dist/extension.js')
    assert not any(name.endswith('.vsix') for name in archive.namelist())
    for grammar in manifest['contributes']['grammars']:
        content = json.loads(archive.read('extension/' + grammar['path'].removeprefix('./')))
        assert content['scopeName'] == grammar['scopeName']
    for language in manifest['contributes']['languages']:
        config = json.loads(archive.read('extension/' + language['configuration'].removeprefix('./')))
        if language['id'] == 'psft-sql':
            assert config['comments']['lineComment'] == '--'

checks = []
for name in ['linux-upgrade', 'windows-upgrade', 'linux-fresh-install', 'windows-fresh-install', 'query-installed', 'peoplecode-editor-installed']:
    report = read(name + '.json')
    assert report['passed'] is True, name
    assert report.get('candidateSha256', report.get('vsixSha256')) == artifact_hash, name
    if 'phases' in report:
        expected = ['fresh'] if 'fresh-install' in name else ['seed', 'upgrade', 'reload', 'final']
        assert [phase['phase'] for phase in report['phases']] == expected, name
        for phase in report['phases']:
            assert phase['passed'] is True
            assert all(phase['integrity'][key] is True for key in ['manifestUnmodified', 'bundleUnmodified', 'workerUnmodified'])
            assert phase['environment']['toolsRelease'] == '8.62'
            assert phase['environment']['patchLevel'] == 9
            assert phase['architecture'] == 'x64'
            assert phase['platform'] == ('win32' if name.startswith('windows') else 'linux')
        count = sum(len(phase['checks']) for phase in report['phases'])
    else:
        assert report['workerSha256'] == worker_hash
        assert report['bundleSha256'] == bundle_hash
        assert all(report['installation'][key] is True for key in ['manifestUnmodified', 'bundleUnmodified', 'workerUnmodified'])
        count = len(report['checks'])
    if name == 'query-installed':
        assert report['cleanupVerified'] is True
    if name == 'peoplecode-editor-installed':
        assert report['databaseUnchanged'] is True
    checks.append({'report': name + '.json', 'checks': count, 'passed': True})

compiler = read('compiler-qualification.json')
assert compiler['passed'] and compiler['baselineDefinitions'] == 430
assert compiler['candidateWorkerSha256'] == compiler['releasedWorkerSha256'] == worker_hash
assert not compiler['compilerSourceChangesSincePublished097']
crash = read('recovery-crash-native.json')
assert crash['passed'] and crash['cleanupVerified']
assert {item['mode'] for item in crash['checks']} == {'before-commit', 'after-commit'}
assert all(item['actualSignal'] == 'SIGKILL' and item['noReplay'] and item['stableNativeTokenDuringRecovery'] for item in crash['checks'])
cleanup = read('native-cleanup.json')
assert cleanup['passed'] and all(value == 0 for value in cleanup['counts'].values())
local = read('local-verification.json')
assert local['failed'] == 0 and local['passed'] == 2240 and local['skipped'] == 1 and local['productionMcpFixtureChecks'] == 70
ci = read('ci.json')
assert ci['headSha'] == args.source_freeze and ci['conclusion'] == 'success'
assert {job['name'] for job in ci['jobs']} == {f'verify ({os}, {node})' for os in ['ubuntu-latest', 'windows-latest'] for node in [22, 24]}
assert all(job['conclusion'] == 'success' for job in ci['jobs'])
paths = ['package.json', 'package-lock.json', 'README.md', 'CHANGELOG.md', 'language-configuration.json', 'sql-language-configuration.json', 'src', 'media', 'resources', 'syntaxes', 'esbuild.mjs']
changed = subprocess.check_output(['git', 'diff', '--name-only', args.source_freeze, '--', *paths], cwd=root, text=True).splitlines()
assert not changed, changed
report = {
    'at': datetime.now(timezone.utc).isoformat(),
    'status': 'CORE_READY', 'version': manifest['version'], 'target': '1.0',
    'published': False, 'sourceFreeze': args.source_freeze,
    'profile': {'database': 'Oracle', 'peopleTools': '8.62.09', 'clients': ['Linux x64', 'Windows x64']},
    'artifact': args.vsix.name, 'vsixSha256': artifact_hash,
    'bundleSha256': bundle_hash, 'workerSha256': worker_hash,
    'installedChecks': sum(item['checks'] for item in checks), 'acceptance': checks,
    'nativeCleanupVerified': True, 'localTestsPassed': local['passed'], 'existingTestsSkipped': 1,
    'protectedExact': 430, 'targetedExact': [27362, 28098, 19282],
    'nativeCrashBoundaries': ['before-commit', 'after-commit'],
    'ci': ci['url'], 'ciJobsPassed': len(ci['jobs']),
    'limits': ['Bounded core only; native/installed reports retain their own approval and scope categories.', 'Run and Monitor native acceptance remains preview and Low priority.', '1.5/2.0 expansion targets remain outside this qualification.'],
    'passed': True,
}
(results / 'qualification.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
