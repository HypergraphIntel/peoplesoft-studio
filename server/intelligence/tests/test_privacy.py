"""The client's privacy cases (src/test/intelligence.test.ts), on the server's port of the rules."""

import pytest

from app.privacy import classify, scan_finding

CASES = [
    ("See https://hcm.example.edu/psp/HCMDMO", "URL"),
    ("Mail jane.doe@example.edu about it", "e-mail address"),
    ("Captured from /home/jared/lab/delta.json", "absolute file path"),
    ("Captured from C:\\PT8.62\\bin", "absolute file path"),
    ("The app server at 10.20.30.40 answered", "IP address"),
    ("Connect to dbhost:1521/HRDMO first", "connect string"),
    ("The host psoft.internal answered", "host name"),
    ("Signed on with password=Hunter2", "credential"),
    ("Token " + "A" * 70, "opaque token"),
]


@pytest.mark.parametrize("text,rule", CASES)
def test_refused(finding, text, rule):
    f = finding()
    f["observation"]["observation"] = text
    violations = scan_finding(f)
    assert any(v["rule"] == rule for v in violations), violations
    assert all(set(v) == {"path", "rule"} for v in violations), "a violation is a path and a rule, never the value"


def test_technical_text_passes(finding):
    f = finding(statement="HRMS 9.20.00.000 on 8.62.09: JOB.CO and PSPTCSSRVCONF.VERSION; hash T6Lgaueh9pJxTyXQS/5qOXLuZvM= (PT_RCF:ServiceInterface).")
    assert scan_finding(f) == []
    f["observation"]["evidence"] = [{"kind": "commit", "ref": "aa9469a"}, {"kind": "repo-path", "ref": "docs/CUSTOMIZATION.md"}]
    assert scan_finding(f) == []
    f["observation"]["evidence"] = [{"kind": "repo-path", "ref": "../outside/file"}]
    assert scan_finding(f)[0]["rule"].startswith("repository paths are relative")


def test_classification():
    assert classify([{"environment": {"peopleToolsRelease": "8.62"}}]) == "public-technical"
    assert classify([{"experimentId": "em04", "environment": {"peopleToolsRelease": "8.62"}}]) == "internal"
