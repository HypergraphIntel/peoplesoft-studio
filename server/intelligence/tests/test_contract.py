"""The server computes the client's identities and accepts what the client accepts."""

import copy

import pytest

from app import contract
from app.canonical import canonical_json, finding_fingerprint, finding_id, identity, js_number, js_trim, observation_canonical, observation_digest


def test_every_vector_byte_for_byte(vectors):
    assert len(vectors) >= 7
    for v in vectors:
        value, issues = contract.validate(v["input"])
        assert issues == [], (v["name"], issues)
        assert canonical_json(identity(value)) == v["identityCanonical"], v["name"]
        assert finding_fingerprint(value) == v["fingerprint"], v["name"]
        assert finding_id(v["fingerprint"]) == v["id"], v["name"]
        assert observation_canonical(value["observation"]) == v["observationCanonical"], v["name"]
        assert observation_digest(value["observation"]) == v["observationDigest"], v["name"]


@pytest.mark.parametrize("x,text", [(0, "0"), (-0.0, "0"), (2.0, "2"), (0.1, "0.1"), (1.5, "1.5"), (1e21, "1e+21"), (1.5e-7, "1.5e-7"),
                                     (1e-7, "1e-7"), (0.000001, "0.000001"), (1e16, "10000000000000000"), (123456789012345680000, "123456789012345680000"),
                                     (-12, "-12"), (2**53, "9007199254740992"), (2**53 + 3, "9007199254740996"), (5e-324, "5e-324"), (1.7976931348623157e308, "1.7976931348623157e+308")])
def test_numbers_as_javascript_writes_them(x, text):
    assert js_number(x) == text


def test_trim_as_javascript_trims():
    assert js_trim("\ufeff\u00a0 x \u3000\n") == "x"
    assert js_trim("\x1cx\x1f") == "\x1cx\x1f"  # Python's strip() would remove these; JavaScript's trim does not


def test_the_schema_is_strict(vectors, finding):
    good = finding()
    assert contract.validate(good)[1] == []
    cases = [
        ({**good, "peopleCode": "Local string &x;"}, "$"),
        ({**good, "observation": {**good["observation"], "connectString": "x"}}, "$.observation"),
        ({**good, "observation": {**good["observation"], "environment": {"peopleToolsRelease": "8.62", "database": "HRDMO"}}}, "$.observation.environment"),
        ({**good, "observation": {**good["observation"], "environment": {"peopleToolsRelease": "latest"}}}, "$.observation.environment.peopleToolsRelease"),
        ({**good, "assertion": {"kind": "x", "facts": {}}}, "$.assertion.facts"),
        ({**good, "type": "rumour"}, "$.type"),
        ({**good, "title": "   "}, "$.title"),
        ({**good, "statement": "x" * 4001}, "$.statement"),
    ]
    for value, path in cases:
        _, issues = contract.validate(value)
        assert any(i["path"] == path for i in issues), (path, issues)
        assert all("HRDMO" not in i["message"] and "Local string" not in i["message"] for i in issues), "values are never echoed"
    many = copy.deepcopy(good)
    many["assertion"]["facts"] = {f"k{i}": i for i in range(65)}
    assert contract.validate(many)[1]
