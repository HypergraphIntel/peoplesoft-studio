"""Reviews, publication, knowledge, withdrawal and signed bundles, through the API and the admin CLI."""

import base64
import copy

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from app import admin
from app.bundle import verify

POST = "/api/v1/findings"


def review(server, who, fid, to, **extra):
    return server.post("/api/v1/reviews", json={"findingId": fid, "to": to, "rationale": f"to {to}", **extra}, headers=server.headers_for(who))


def submit(server, who, f):
    return server.post(POST, json=f, headers=server.headers_for(who)).json()


def test_the_lifecycle_to_publication_and_a_signed_bundle(server, finding, tmp_path, monkeypatch, capsys):
    a = submit(server, "contributor", finding())
    fid = a["finding"]["id"]
    # One contributor, one method, however many runs: not corroboration.
    for i in range(3):
        f = finding()
        f["observation"] = {**f["observation"], "runId": f"r{i}"}
        submit(server, "contributor", f)
    r = review(server, "reviewer", fid, "corroborated")
    assert r.status_code == 409 and "independent support" in r.json()["reasons"][0]
    # Another contributor, another method and release: independent.
    other = finding()
    other["observation"] = {**other["observation"], "method": "source-inspection", "experimentId": "src", "environment": {"peopleToolsRelease": "8.61.05"}}
    submit(server, "contributor2", other)
    assert review(server, "contributor", fid, "corroborated").status_code == 403, "contributors do not review"
    assert review(server, "reviewer", fid, "corroborated").json()["status"] == "corroborated"
    assert review(server, "reviewer", fid, "verified", criteria="replayed against em04-em06", releases=["8.60"]).status_code == 409
    v = review(server, "reviewer", fid, "verified", criteria="replayed against em04-em06", releases=["8.62.09"]).json()
    assert v["status"] == "verified" and v["verifiedReleases"] == ["8.62.09"]
    assert review(server, "reviewer", fid, "published").status_code == 403, "publication is an admin's"
    p = review(server, "admin", fid, "published").json()
    assert p["status"] == "published" and "publishedAt" in p
    comp = server.get("/api/v1/knowledge/compatibility", params={"release": "8.62"}).json()
    assert [x["id"] for x in comp["findings"]] == [fid]
    assert server.get("/api/v1/knowledge/compatibility", params={"release": "8.60"}).json()["findings"] == []
    assert server.get("/api/v1/knowledge/compatibility", params={"release": "latest"}).status_code == 422
    assert server.get("/api/v1/knowledge/latest").status_code == 404
    # The admin CLI signs a bundle with an offline key; the server stores and serves the envelope only.
    monkeypatch.setenv("PSFT_INTEL_DATABASE_URL", server.database_url)
    key_file = tmp_path / "signing.pem"
    assert admin.main(["generate-key", "--out", str(key_file)]) == 0
    out = capsys.readouterr().out
    public_b64 = out.split("public key (base64, raw Ed25519) ")[1].strip()
    assert (key_file.stat().st_mode & 0o777) == 0o600
    assert admin.main(["build-bundle", "--key", str(key_file), "--days", "7"]) == 0
    env = server.get("/api/v1/knowledge/latest").json()
    public = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_b64))
    assert env["format"] == "psft-knowledge-envelope/1" and env["bundle"]["version"] == 1
    assert [f["id"] for f in env["bundle"]["findings"]] == [fid]
    assert set(env["bundle"]["findings"][0]) == {"id", "fingerprint", "type", "subject", "assertion", "title", "statement", "verifiedReleases", "knownIncompatible", "publishedAt"}, "no evidence payloads"
    assert verify(env, public)
    tampered = copy.deepcopy(env)
    tampered["bundle"]["findings"][0]["verifiedReleases"] = ["8.62.09", "8.61"]
    assert not verify(tampered, public)
    assert server.get("/api/v1/knowledge/versions").json()["versions"][0]["findings"] == 1
    # Revocation, and the next bundle carries it.
    assert review(server, "admin", fid, "revoked").json()["status"] == "revoked"
    assert admin.main(["build-bundle", "--key", str(key_file)]) == 0
    env2 = server.get("/api/v1/knowledge/latest").json()
    assert env2["bundle"]["version"] == 2 and env2["bundle"]["findings"] == [] and env2["bundle"]["revoked"] == [fid]


def test_withdrawal_removes_the_contributors_evidence_and_tokens(server, finding):
    mine = submit(server, "contributor2", finding(assertion={"kind": "solo", "facts": {"x": 1}}))
    shared = submit(server, "contributor", finding())
    f = finding()
    f["observation"] = {**f["observation"], "runId": "theirs"}
    submit(server, "contributor2", f)
    r = server.delete("/api/v1/contributors/me", headers=server.headers_for("contributor2")).json()
    assert r == {"withdrawn": True, "observations": 2, "findings": 2, "findingsWithdrawn": 1}
    assert server.get(f"/api/v1/findings/{mine['finding']['id']}", headers=server.headers_for("reviewer")).json()["status"] == "withdrawn"
    left = server.get(f"/api/v1/findings/{shared['finding']['id']}", headers=server.headers_for("reviewer")).json()
    assert len(left["observations"]) == 1 and left["status"] == "observed"
    assert server.post(POST, json=finding(), headers=server.headers_for("contributor2")).status_code == 401, "the withdrawn contributor's token is revoked"
