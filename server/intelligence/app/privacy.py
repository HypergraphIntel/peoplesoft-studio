"""The deny-by-default privacy scan, re-run on the server: a client's checks are not trusted.

A port of src/intelligence/privacy.ts, rule for rule (tests/test_privacy.py runs the
client's cases). A violation names the field and the rule, never the value.
"""

from __future__ import annotations

import re
from typing import Any, Iterator

_TLDS = "com|net|org|edu|gov|mil|int|io|co|us|uk|ca|au|de|fr|in|cn|jp|local|localdomain|internal|intra|lan|corp|home|cloud|biz|info|me|dev|app|xyz|online|site|tech"

_IPV4 = re.compile(r"(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])")
_IPV6 = re.compile(r"\b([0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b", re.I)


def _has_ip(s: str) -> bool:
    for m in _IPV4.finditer(s):
        octets = m.groups()
        if all(int(o) <= 255 and not (len(o) > 1 and o.startswith("0")) for o in octets):
            return True
    return bool(_IPV6.search(s))


_RULES: list[tuple[str, Any]] = [
    ("URL", re.compile(r"\b[a-z][a-z0-9+.-]*://\S+", re.I).search),
    ("e-mail address", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}").search),
    ("absolute file path", re.compile(r"(^|[\s\"'(=,])(/(home|Users|root|etc|var|tmp|opt|mnt|srv|usr|private)/|~/|[A-Za-z]:[\\/]|\\\\[A-Za-z0-9])").search),
    ("IP address", _has_ip),
    ("connect string", lambda s: bool(re.search(r"\b[A-Za-z0-9.-]+:\d{2,5}/[A-Za-z0-9_.]+", s) or re.search(r"\(DESCRIPTION\s*=", s, re.I))),
    # Lower-case top-level domains only: PeopleSoft's dotted names (JOB.CO) are upper case.
    ("host name", re.compile(rf"\b[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.({_TLDS})\b").search),
    ("credential", lambda s: bool(
        re.search(r"\b(password|passwd|pwd|pswd|secret|token|api[_-]?key|access[_-]?key|accesspswd|bearer|authorization)\b\s*[:=]", s, re.I)
        or re.search(r"\bBearer\s+[A-Za-z0-9._~+/-]{16,}", s))),
    ("opaque token", re.compile(r"[A-Za-z0-9+/_=-]{64,}").search),
]

_COMMIT = re.compile(r"^[0-9a-f]{7,40}$")
_EVIDENCE_REF = re.compile(r"\.evidence\[\d+\]\.ref$")


def _strings(value: Any, path: str) -> Iterator[tuple[str, str]]:
    if isinstance(value, str):
        yield path, value
    elif isinstance(value, list):
        for i, v in enumerate(value):
            yield from _strings(v, f"{path}[{i}]")
    elif isinstance(value, dict):
        for k, v in value.items():
            yield f"{path}.{k} (key)", k
            yield from _strings(v, f"{path}.{k}")


def scan_finding(finding: dict) -> list[dict]:
    out: list[dict] = []
    for path, text in _strings(finding, "$"):
        if _EVIDENCE_REF.search(path) and _COMMIT.match(text):
            continue
        for rule, test in _RULES:
            if test(text):
                out.append({"path": path, "rule": rule})
    for i, e in enumerate(finding.get("observation", {}).get("evidence", []) or []):
        ref = e.get("ref", "")
        if e.get("kind") == "repo-path" and (re.match(r"^[\\/]", ref) or re.search(r"(^|[\\/])\.\.([\\/]|$)", ref) or re.match(r"^[A-Za-z]:", ref)):
            out.append({"path": f"$.observation.evidence[{i}].ref", "rule": "repository paths are relative, inside the repository"})
    seen: set[tuple[str, str]] = set()
    unique = []
    for v in out:
        key = (v["path"], v["rule"])
        if key not in seen:
            seen.add(key)
            unique.append(v)
    return unique


def classify(observations: list[dict]) -> str:
    for o in observations:
        if o.get("experimentId") or o.get("runId") or (o.get("environment") or {}).get("appRelease"):
            return "internal"
        if any(e.get("kind") in ("capture-case", "repo-path") for e in o.get("evidence") or []):
            return "internal"
    return "public-technical"
