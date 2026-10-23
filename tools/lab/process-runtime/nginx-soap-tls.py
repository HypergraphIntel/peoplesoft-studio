#!/usr/bin/env python3
"""Route only the native SOAP connector over verified backend TLS. Requires root; never changes IB security.

  sudo python3 nginx-soap-tls.py inspect [CA_PEM]
      Changes nothing. Prints the live config's SHA-256, its locations, whether the connector route already exists,
      and the backend listener's certificate chain; saves the chain's issuing CA to /tmp/psft-hrdmo-root.pem and
      verifies the backend certificate (chain and host name) against it. When the backend sends only its own
      certificate, pass the issuing CA exported from psapp01 as CA_PEM.
  sudo python3 nginx-soap-tls.py apply CONFIG_SHA256 CA_SHA256
      Applies the route only if the config and CA still have the hashes inspect printed: backup, dedicated CA file,
      nginx -t, reload; anything failing restores the original config and removes the CA file.
  sudo python3 nginx-soap-tls.py rollback BACKUP
      Restores a backup apply printed, removes the dedicated CA file, nginx -t, reload.
"""
from pathlib import Path
import hashlib, subprocess, shutil, datetime, re, sys

config = Path('/etc/nginx/sites-available/com.chickenkiller.deathstar.hcm')
ca = Path('/tmp/psft-hrdmo-root.pem')
ca_target = Path('/etc/nginx/psft-hrdmo-runtime-ca.pem')
backend, backend_name = '192.168.122.151:8113', 'psapp01.deathstar.chickenkiller.com'
connector = 'location = /PSIGW/PeopleSoftServiceListeningConnector {'
sha = lambda data: hashlib.sha256(data).hexdigest()


def reload_checked():
    subprocess.check_call(['/usr/bin/nginx', '-t'])
    subprocess.check_call(['/usr/bin/systemctl', 'reload', 'nginx'])


def inspect(supplied_ca=None):
    text = config.read_text()
    print('config', config, 'sha256', sha(config.read_bytes()))
    for line in text.splitlines():
        if re.match(r'\s*location\b', line): print('  ', line.strip())
    print('connector route present:', connector in text)
    print('dedicated CA file present:', ca_target.exists())
    shown = subprocess.run(['openssl', 's_client', '-connect', backend, '-servername', backend_name, '-showcerts'],
                           input=b'', capture_output=True, timeout=30).stdout.decode(errors='replace')
    chain = re.findall(r'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----\n', shown, re.S)
    if not chain: raise SystemExit(f'Backend {backend} sent no certificate.')
    if supplied_ca:
        anchor = re.findall(r'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----\n', Path(supplied_ca).read_text(), re.S)
        if len(anchor) != 1: raise SystemExit(f'{supplied_ca} must hold exactly one certificate.')
        if anchor[0] not in chain: chain += anchor
    if len(chain) < 2:
        raise SystemExit(f'Backend {backend} sent {len(chain)} certificate(s); export its issuing CA and run: inspect CA_PEM')
    for i, pem in enumerate(chain):
        subject = subprocess.run(['openssl', 'x509', '-noout', '-subject', '-issuer', '-enddate'], input=pem.encode(), capture_output=True).stdout.decode()
        print(f'chain[{i}]', ' | '.join(subject.split('\n')).strip(' |'))
    leaf, untrusted = Path('/tmp/psft-hrdmo-leaf.pem'), Path('/tmp/psft-hrdmo-untrusted.pem')
    # Sticky /tmp (protected_regular) refuses to let root reopen another user's leftover file, so replace each one.
    for path, pem in ((ca, chain[-1]), (leaf, chain[0]), (untrusted, ''.join(chain[1:-1]))):
        path.unlink(missing_ok=True); path.write_text(pem)
    verify = ['openssl', 'verify', '-CAfile', str(ca), '-verify_hostname', backend_name]
    if len(chain) > 2: verify += ['-untrusted', str(untrusted)]
    verified = subprocess.run(verify + [str(leaf)], capture_output=True, text=True)
    if verified.returncode != 0: raise SystemExit('verification FAILED: ' + (verified.stderr or verified.stdout).strip())
    print(verified.stdout.strip())
    print('CA saved to', ca, 'sha256', sha(ca.read_bytes()))
    print('If the route is absent, the CA verifies and the config is as expected, run:')
    print(f'  sudo python3 {sys.argv[0]} apply {sha(config.read_bytes())} {sha(ca.read_bytes())}')


def apply(expected, expected_ca):
    original = config.read_bytes()
    if sha(original) != expected: raise SystemExit('Nginx config changed since inspect; inspect again before applying.')
    if sha(ca.read_bytes()) != expected_ca: raise SystemExit('The CA file differs from the inspected certificate.')
    text = original.decode()
    if connector in text: raise SystemExit('The connector route already exists; nothing to do.')
    if ca_target.exists(): raise SystemExit('Dedicated runtime CA file already exists; inspect before replacing.')
    start = text.index('    location / {'); end = text.index('\n    }', start) + 6
    block = text[start:end].replace('    location / {', '    # PROCESSREQUEST must reach Integration Gateway over native TLS.\n    ' + connector, 1)
    if 'proxy_pass http://hcm_servers;' not in block: raise SystemExit('The default location no longer proxies to hcm_servers; inspect before applying.')
    block = block.replace('proxy_pass http://hcm_servers;', f'''proxy_pass https://{backend};
        proxy_ssl_server_name on;
        proxy_ssl_name {backend_name};
        proxy_ssl_verify on;
        proxy_ssl_verify_depth 2;
        proxy_ssl_trusted_certificate {ca_target};''', 1)
    backup = config.with_name(config.name + '.runtime-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S') + '.bak')
    shutil.copy2(config, backup); ca_target.write_bytes(ca.read_bytes()); ca_target.chmod(0o644)
    try:
        config.write_text(text[:start] + block + '\n\n' + text[start:])
        reload_checked()
    except BaseException:
        config.write_bytes(original); ca_target.unlink(missing_ok=True)
        subprocess.call(['/usr/bin/nginx', '-t']); subprocess.call(['/usr/bin/systemctl', 'reload', 'nginx']); raise
    print('SOAP connector uses verified backend TLS. Backup:', backup)


def rollback(backup):
    shutil.copy2(Path(backup), config); ca_target.unlink(missing_ok=True); reload_checked()
    print('Restored', backup)


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    if mode == 'inspect' and len(sys.argv) in (2, 3): inspect(*sys.argv[2:])
    elif mode == 'apply' and len(sys.argv) == 4: apply(sys.argv[2], sys.argv[3])
    elif mode == 'rollback' and len(sys.argv) == 3: rollback(sys.argv[2])
    else: raise SystemExit(__doc__)
