#!/usr/bin/env python3
"""Route only the native SOAP connector over verified backend TLS. Requires root; never changes IB security."""
from pathlib import Path
import hashlib,subprocess,shutil,datetime
config=Path('/etc/nginx/sites-available/com.chickenkiller.deathstar.hcm')
expected='e4ef61710826a62a81d2e445f4469cc94ab0f932b2e4dbc152a7c7ab6ee5f9f0'
ca=Path('/tmp/psft-hrdmo-root.pem')
expected_ca='f4c1dd84c46d5fa8d9419b1c1d99cfa0f241a2dcccf927a777cf3352c8b18a15'
original=config.read_bytes()
if hashlib.sha256(original).hexdigest()!=expected:raise SystemExit('Nginx config changed; inspect again before applying.')
if hashlib.sha256(ca.read_bytes()).hexdigest()!=expected_ca:raise SystemExit('Public backend CA differs from the inspected certificate.')
text=original.decode();start=text.index('    location / {');end=text.index('\n    }',start)+6
block=text[start:end].replace('    location / {','    # PROCESSREQUEST must reach Integration Gateway over native TLS.\n    location = /PSIGW/PeopleSoftServiceListeningConnector {',1)
block=block.replace('proxy_pass http://hcm_servers;','''proxy_pass https://192.168.122.151:8113;
        proxy_ssl_server_name on;
        proxy_ssl_name psapp01.deathstar.chickenkiller.com;
        proxy_ssl_verify on;
        proxy_ssl_verify_depth 2;
        proxy_ssl_trusted_certificate /etc/nginx/psft-hrdmo-runtime-ca.pem;''',1)
backup=config.with_name(config.name+'.runtime-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'.bak')
ca_target=Path('/etc/nginx/psft-hrdmo-runtime-ca.pem')
if ca_target.exists():raise SystemExit('Dedicated runtime CA file already exists; inspect before replacing.')
shutil.copy2(config,backup);ca_target.write_bytes(ca.read_bytes());ca_target.chmod(0o644)
try:
 config.write_text(text[:start]+block+'\n\n'+text[start:])
 subprocess.check_call(['/usr/bin/nginx','-t'])
 subprocess.check_call(['/usr/bin/systemctl','reload','nginx'])
except BaseException:
 config.write_bytes(original);ca_target.unlink(missing_ok=True)
 subprocess.call(['/usr/bin/nginx','-t']);subprocess.call(['/usr/bin/systemctl','reload','nginx']);raise
print('SOAP connector uses verified backend TLS. Backup:',backup)
