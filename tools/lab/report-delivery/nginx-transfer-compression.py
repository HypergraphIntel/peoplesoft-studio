#!/usr/bin/env python3
"""Narrow, reversible SchedulerTransfer interoperability trial. Run on gundam-server-01 as root."""
from pathlib import Path
import hashlib, subprocess, datetime, shutil, sys
config=Path('/etc/nginx/sites-available/com.chickenkiller.deathstar.hcm')
expected='1210ea78a426c437382b9dc0db1135689d8689077779cababf1012311f10b4d5'
if hashlib.sha256(config.read_bytes()).hexdigest()!=expected:
    sys.exit('Configuration changed since patch preparation; refusing to overwrite.')
original=config.read_bytes()
text=original.decode()
start=text.index('    location / {')
end=text.index('\n    }',start)+6
block=text[start:end]
trial=block.replace('    location / {','    # Native Distribution Agent consumes plain XML transfer acknowledgements.\n    location = /SchedulerTransfer/HCMDMO {\n        gzip off;',1)
backup=config.with_name(config.name+'.psft-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'.bak')
shutil.copy2(str(config),str(backup))
config.write_text(text[:start]+trial+'\n\n'+text[start:])
try:
    subprocess.check_call(['/usr/bin/nginx','-t'])
    subprocess.check_call(['/usr/bin/systemctl','reload','nginx'])
except BaseException:
    config.write_bytes(original)
    subprocess.call(['/usr/bin/nginx','-t'])
    subprocess.call(['/usr/bin/systemctl','reload','nginx'])
    raise
print('Transfer compression trial active. Original backup:', backup)
