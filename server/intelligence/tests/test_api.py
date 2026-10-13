"""The API: authentication and roles, the local store's outcomes, evidence visibility, limits, the audit."""

from sqlalchemy import select

from app.db import Audit
from app.main import Settings, create_app

POST = "/api/v1/findings"


def test_health_is_public(server):
    assert server.get("/api/v1/health").json() == {"status": "ok", "schema": "psft-finding/1"}


def test_a_token_is_required(server, finding):
    assert server.post(POST, json=finding()).status_code == 401
    assert server.post(POST, json=finding(), headers={"Authorization": "Bearer psfti_nope"}).status_code == 401
    r = server.post(POST, json=finding(), headers={"Authorization": "Bearer psfti_nope"})
    assert r.headers["content-type"].startswith("application/problem+json")


def test_outcomes_match_the_local_store(server, finding, vectors):
    h = server.headers_for("contributor")
    created = server.post(POST, json=vectors[0]["input"], headers=h)
    assert created.status_code == 201
    body = created.json()
    assert body["outcome"] == "created"
    assert body["finding"]["id"] == vectors[0]["id"], "the server's id is the client's"
    assert body["finding"]["status"] == "observed"
    # The same claim reworded and reordered, same evidence at another time: a duplicate, nothing changes.
    again = server.post(POST, json={**vectors[1]["input"], "title": "reworded", "observation": {**vectors[1]["input"]["observation"], "observedAt": "2027-01-01T00:00:00Z"}}, headers=h)
    assert (again.status_code, again.json()["outcome"]) == (200, "duplicate")
    assert again.json()["finding"]["title"] == vectors[0]["input"]["title"]
    # A second run: merged and reproduced; releases widen.
    run2 = {**vectors[0]["input"], "observation": {**vectors[0]["input"]["observation"], "runId": "run-2", "environment": {"peopleToolsRelease": "8.61.05"}}}
    merged = server.post(POST, json=run2, headers=h).json()
    assert merged["outcome"] == "merged"
    assert merged["finding"]["status"] == "reproduced"
    assert merged["finding"]["compatibility"]["observedReleases"] == ["8.61.05", "8.62.09"]
    assert len(merged["finding"]["observations"]) == 2


def test_others_evidence_is_summarized(server, finding):
    a = server.post(POST, json=finding(), headers=server.headers_for("contributor")).json()["finding"]["id"]
    other = finding()
    other["observation"] = {**other["observation"], "runId": "theirs", "experimentId": "their-lab-case"}
    server.post(POST, json=other, headers=server.headers_for("contributor2"))
    seen = server.get(f"/api/v1/findings/{a}", headers=server.headers_for("contributor")).json()["observations"]
    mine = [o for o in seen if o["yours"]]
    theirs = [o for o in seen if not o["yours"]]
    assert mine[0]["experimentId"] == "em04"
    assert set(theirs[0]) == {"method", "release", "digest", "receivedAt", "yours"}, "where another contributor's evidence came from is not shown"
    reviewer = server.get(f"/api/v1/findings/{a}", headers=server.headers_for("reviewer")).json()["observations"]
    assert {o.get("experimentId") for o in reviewer} == {"em04", "their-lab-case"}
    assert server.get("/api/v1/findings/f-000000000000000000000000", headers=server.headers_for("contributor")).status_code == 404
    assert server.get("/api/v1/findings/../etc", headers=server.headers_for("contributor")).status_code == 404


def test_refusals_name_fields_and_rules_never_values(server, finding):
    h = server.headers_for("contributor")
    bad = finding()
    bad["observation"] = {**bad["observation"], "database": "HRDMO"}
    r = server.post(POST, json=bad, headers=h)
    assert r.status_code == 422 and "HRDMO" not in r.text
    leak = finding(statement="Signed on with password=Hunter2 at 10.20.30.40")
    r = server.post(POST, json=leak, headers=h)
    assert r.status_code == 422
    assert {v["rule"] for v in r.json()["violations"]} == {"credential", "IP address"}
    assert "Hunter2" not in r.text and "10.20.30.40" not in r.text
    assert server.post(POST, content=b"{not json", headers={**h, "content-type": "application/json"}).status_code == 400
    assert server.post(POST, json=finding(), headers={**h, "PSFT-Finding-Schema": "psft-finding/2"}).status_code == 415


def test_roles_and_pending_pagination(server, finding):
    for i in range(5):
        f = finding(assertion={"kind": "counter-step", "facts": {"n": i}})
        assert server.post(POST, json=f, headers=server.headers_for("contributor")).status_code == 201
    assert server.get("/api/v1/discoveries/pending", headers=server.headers_for("contributor")).status_code == 403
    seen, cursor = [], None
    while True:
        r = server.get("/api/v1/discoveries/pending", params={"limit": 2, **({"cursor": cursor} if cursor else {})}, headers=server.headers_for("reviewer")).json()
        seen += [x["id"] for x in r["items"]]
        cursor = r["next"]
        if not cursor:
            break
    assert len(seen) == 5 and len(set(seen)) == 5


def test_the_audit_records_actions_never_tokens(server, finding):
    server.post(POST, json=finding(), headers=server.headers_for("contributor"))
    server.post(POST, json=finding(statement="password=Hunter2"), headers=server.headers_for("contributor"))
    server.get("/api/v1/discoveries/pending", headers=server.headers_for("contributor"))
    with server.app.state.sessions() as s:
        rows = s.execute(select(Audit).order_by(Audit.id)).scalars().all()
    outcomes = [(r.action, r.outcome) for r in rows]
    assert ("submit", "created") in outcomes and ("submit", "privacy-refused") in outcomes
    assert any(r.outcome == "forbidden" for r in rows)
    text = repr([(r.actor, r.action, r.target, r.outcome, r.detail) for r in rows])
    assert not any(t in text for t in server.tokens.values()) and "Hunter2" not in text


def test_size_and_rate_limits(tmp_path, finding):
    from fastapi.testclient import TestClient
    from app import auth
    app = create_app(Settings(database_url=f"sqlite:///{tmp_path / 'limits.db'}", rate_per_minute=3, max_body_bytes=2048))
    with app.state.sessions() as s:
        token = auth.issue_token(s, "contributor")
    c = TestClient(app)
    h = {"Authorization": f"Bearer {token}"}
    big = finding(statement="x" * 3000)
    assert c.post(POST, json=big, headers=h).status_code == 413
    codes = [c.post(POST, json=finding(assertion={"kind": "k", "facts": {"i": i}}), headers=h).status_code for i in range(4)]
    assert codes == [201, 201, 201, 429]
    app.state.engine.dispose()


def test_concurrent_submissions_of_one_claim(server, finding):
    """Parallel first submissions race to create; the row lock and the retry make one creation and the rest merges (PostgreSQL)."""
    import os
    from concurrent.futures import ThreadPoolExecutor

    import pytest

    if not os.environ.get("PSFT_INTEL_TEST_DATABASE_URL", "").startswith("postgresql"):
        pytest.skip("needs PostgreSQL (row locks)")
    h = server.headers_for("contributor")

    def submit(i):
        f = finding()
        f["observation"] = {**f["observation"], "runId": f"run-{i}"}
        return server.post(POST, json=f, headers=h).json()["outcome"]

    with ThreadPoolExecutor(max_workers=12) as pool:
        outcomes = list(pool.map(submit, range(12)))
    assert sorted(outcomes) == ["created"] + ["merged"] * 11, outcomes
    fid = server.post(POST, json={**finding(), "observation": {**finding()["observation"], "runId": "run-0"}}, headers=h).json()
    assert fid["outcome"] == "duplicate"
    assert len(fid["finding"]["observations"]) == 12
    assert fid["finding"]["status"] == "reproduced"
