import json
import os
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app import auth
from app.main import Settings, create_app

CONTRACT = Path(__file__).resolve().parent.parent / "contract"


@pytest.fixture(scope="session")
def vectors():
    return json.loads((CONTRACT / "fingerprint-vectors.json").read_text(encoding="utf-8"))["vectors"]


def _database_url(tmp_path) -> str:
    # PSFT_INTEL_TEST_DATABASE_URL runs the API tests on PostgreSQL (compose.yaml); otherwise a SQLite file.
    return os.environ.get("PSFT_INTEL_TEST_DATABASE_URL") or f"sqlite:///{tmp_path / 'test.db'}"


@pytest.fixture()
def server(tmp_path):
    url = _database_url(tmp_path)
    app = create_app(Settings(database_url=url, rate_per_minute=1000))
    if url.startswith("postgresql"):
        with app.state.engine.begin() as c:  # each test starts empty
            c.execute(text("TRUNCATE audit, observation, finding, api_token RESTART IDENTITY CASCADE"))
    with app.state.sessions() as s:
        tokens = {role: auth.issue_token(s, role) for role in ("contributor", "reviewer")}
        tokens["contributor2"] = auth.issue_token(s, "contributor")
    client = TestClient(app)
    client.tokens = tokens
    client.headers_for = lambda who: {"Authorization": f"Bearer {tokens[who]}"}
    yield client
    app.state.engine.dispose()


@pytest.fixture()
def finding():
    def make(**changes):
        base = {
            "type": "save-protocol",
            "subject": {"subsystem": "event-mapping", "objectType": "Event Mapping configuration", "tables": ["PSPTCSSRVCONF"]},
            "assertion": {"kind": "row-resave", "facts": {"table": "PSPTCSSRVCONF", "everyRowOnSave": True, "versionCounter": "SCNFM"}},
            "title": "The page re-saves every row", "statement": "Each row is deleted and re-inserted.",
            "confidence": "high", "source": "research-harness",
            "observation": {"observedAt": "2026-10-12T19:50:28.000Z", "method": "pia-capture", "experimentId": "em04",
                            "environment": {"peopleToolsRelease": "8.62.09"}, "observation": "Two rows re-saved."},
        }
        for k, v in changes.items():
            base[k] = v
        return base
    return make
