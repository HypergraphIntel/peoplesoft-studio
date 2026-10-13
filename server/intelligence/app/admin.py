"""Administration from the command line (no HTTP endpoint for it in the MVP).

  python -m app.admin init-db
  python -m app.admin issue-token --role contributor|reviewer|admin
  python -m app.admin revoke-token --contributor c-...
  python -m app.admin audit [--limit N]
  python -m app.admin generate-key --out signing-key.pem       (keep it offline; prints the public key and key id)
  python -m app.admin build-bundle --key signing-key.pem [--days 30]

The database is PSFT_INTEL_DATABASE_URL. An issued token is printed once; only its hash is stored.
"""

from __future__ import annotations

import argparse
import base64
import os
import sys
from datetime import datetime

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat, PublicFormat
from sqlalchemy import select

from . import auth
from .bundle import build_bundle, finding_entry, key_id, load_private_key, sign, verify
from .db import ApiToken, Audit, Bundle, Finding, create_schema, make_engine, make_sessionmaker, utcnow
from .main import Settings


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="python -m app.admin")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init-db")
    t = sub.add_parser("issue-token")
    t.add_argument("--role", required=True, choices=auth.ROLES)
    r = sub.add_parser("revoke-token")
    r.add_argument("--contributor", required=True)
    a = sub.add_parser("audit")
    a.add_argument("--limit", type=int, default=50)
    g = sub.add_parser("generate-key")
    g.add_argument("--out", required=True)
    b = sub.add_parser("build-bundle")
    b.add_argument("--key", required=True)
    b.add_argument("--days", type=int, default=30)
    args = p.parse_args(argv)
    if args.cmd == "generate-key":
        key = Ed25519PrivateKey.generate()
        fd = os.open(args.out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as fh:
            fh.write(key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()))
        raw = key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
        print(f"key id {key_id(key.public_key())}\npublic key (base64, raw Ed25519) {base64.b64encode(raw).decode()}")
        return 0
    engine = make_engine(Settings().database_url)
    create_schema(engine)
    Sessions = make_sessionmaker(engine)
    with Sessions() as s:
        if args.cmd == "init-db":
            print("schema ready")
        elif args.cmd == "issue-token":
            print(auth.issue_token(s, args.role))
            s.add(Audit(actor="admin-cli", action="issue-token", target=None, outcome="ok", detail=args.role))
            s.commit()
        elif args.cmd == "revoke-token":
            rows = s.execute(select(ApiToken).where(ApiToken.contributor == args.contributor, ApiToken.revoked_at.is_(None))).scalars().all()
            for row in rows:
                row.revoked_at = utcnow()
            s.add(Audit(actor="admin-cli", action="revoke-token", target=args.contributor, outcome=f"{len(rows)} revoked"))
            s.commit()
            print(f"{len(rows)} token(s) revoked")
        elif args.cmd == "build-bundle":
            with open(args.key, "rb") as fh:
                key = load_private_key(fh.read())
            published = s.execute(select(Finding).where(Finding.status == "published").order_by(Finding.id)).scalars().all()
            revoked = [f.id for f in s.execute(select(Finding).where(Finding.status == "revoked")).scalars()]
            last = s.execute(select(Bundle.version).order_by(Bundle.version.desc()).limit(1)).scalar_one_or_none() or 0
            issued = utcnow()
            envelope = sign(build_bundle(last + 1, [finding_entry(f) for f in published], revoked, issued, args.days), key)
            assert verify(envelope, key.public_key())
            bundle = envelope["bundle"]
            s.add(Bundle(version=bundle["version"], issued_at=issued, expires_at=datetime.fromisoformat(bundle["expiresAt"].replace("Z", "+00:00")),
                         key_id=envelope["keyId"], findings=len(published), envelope=envelope))
            s.add(Audit(actor="admin-cli", action="build-bundle", target=str(bundle["version"]), outcome="ok", detail=f"{len(published)} published, {len(revoked)} revoked, key {envelope['keyId']}"))
            s.commit()
            print(f"bundle {bundle['version']}: {len(published)} finding(s), {len(revoked)} revoked, key {envelope['keyId']}, expires {bundle['expiresAt']}")
        elif args.cmd == "audit":
            for row in s.execute(select(Audit).order_by(Audit.id.desc()).limit(args.limit)).scalars():
                print(f"{row.at.isoformat()}  {row.actor:<24} {row.action:<18} {row.target or '-':<26} {row.outcome} {row.detail or ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
