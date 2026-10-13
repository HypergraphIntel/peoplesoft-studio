"""Administration from the command line (no HTTP endpoint for it in the MVP).

  python -m app.admin init-db
  python -m app.admin issue-token --role contributor|reviewer|admin
  python -m app.admin revoke-token --contributor c-...
  python -m app.admin audit [--limit N]

The database is PSFT_INTEL_DATABASE_URL. An issued token is printed once; only its hash is stored.
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy import select

from . import auth
from .db import ApiToken, Audit, create_schema, make_engine, make_sessionmaker, utcnow
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
    args = p.parse_args(argv)
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
        elif args.cmd == "audit":
            for row in s.execute(select(Audit).order_by(Audit.id.desc()).limit(args.limit)).scalars():
                print(f"{row.at.isoformat()}  {row.actor:<24} {row.action:<18} {row.target or '-':<26} {row.outcome} {row.detail or ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
