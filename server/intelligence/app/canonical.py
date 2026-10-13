"""Canonical JSON, fingerprints and digests -- byte for byte the client's.

src/intelligence/fingerprint.ts is the reference; contract/fingerprint-vectors.json
pins it, and tests/test_contract.py proves this module reproduces every vector.

JavaScript's JSON.stringify, which the client hashes, differs from Python's json
in number text (1e-7 vs 1e-07, 2 vs 2.0, 1e16 vs 10000000000000000) and in what
String.prototype.trim removes, so both are implemented here as ECMAScript
defines them.
"""

from __future__ import annotations

import hashlib
import json
import math
import unicodedata
from decimal import Decimal
from typing import Any

# ECMAScript WhiteSpace and LineTerminator code points (what String.prototype.trim removes).
_JS_SPACE = {"\t", "\n", "\v", "\f", "\r", " ", " ", " ", " ", " ", " ", " ", "　", "﻿"} | {
    chr(c) for c in range(0x2000, 0x200B)
}


def js_trim(s: str) -> str:
    start, end = 0, len(s)
    while start < end and (s[start] in _JS_SPACE or unicodedata.category(s[start]) == "Zs"):
        start += 1
    while end > start and (s[end - 1] in _JS_SPACE or unicodedata.category(s[end - 1]) == "Zs"):
        end -= 1
    return s[start:end]


def js_number(x: float | int) -> str:
    """Number::toString (ECMA-262), the text JSON.stringify writes for a number."""
    if isinstance(x, bool):
        raise TypeError("a boolean is not a number")
    if isinstance(x, int):
        if abs(x) <= 2**53:
            return str(x)
        x = float(x)  # beyond JavaScript's exact integers, as the client would see it
    if not math.isfinite(x):
        raise ValueError("a finding holds finite numbers only")
    if x == 0:
        return "0"  # -0 too
    sign = "-" if x < 0 else ""
    sign_bit, digits, exponent = Decimal(repr(abs(x))).as_tuple()
    s = "".join(map(str, digits)).rstrip("0") or "0"
    trailing = len(digits) - len("".join(map(str, digits)).rstrip("0"))
    k = len(s)
    n = exponent + trailing + k  # x = 0.s * 10^n
    if k <= n <= 21:
        out = s + "0" * (n - k)
    elif 0 < n <= 21:
        out = s[:n] + "." + s[n:]
    elif -6 < n <= 0:
        out = "0." + "0" * (-n) + s
    else:
        e = n - 1
        out = (s if k == 1 else s[0] + "." + s[1:]) + "e" + ("+" if e > 0 else "-") + str(abs(e))
    return sign + out


def _canonical(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return json.dumps(js_trim(value), ensure_ascii=False)
    if isinstance(value, (int, float)):
        return js_number(value)
    if isinstance(value, list):
        return "[" + ",".join(_canonical(v) for v in value) + "]"
    if isinstance(value, dict):
        # Keys sorted by UTF-16 code unit, as Array.prototype.sort orders them (the schema keeps keys ASCII).
        keys = sorted(value.keys(), key=lambda k: k.encode("utf-16-be"))
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + _canonical(value[k]) for k in keys if value[k] is not _UNDEFINED) + "}"
    raise TypeError(f"a finding cannot hold a {type(value).__name__}")


_UNDEFINED = object()


def canonical_json(value: Any) -> str:
    return _canonical(value)


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def identity(finding: dict) -> dict:
    return {
        "v": 1,
        "type": finding["type"],
        "subsystem": finding["subject"]["subsystem"],
        "objectType": js_trim(finding["subject"]["objectType"]).lower(),
        "assertion": {"kind": js_trim(finding["assertion"]["kind"]), "facts": finding["assertion"]["facts"]},
    }


def finding_fingerprint(finding: dict) -> str:
    return _sha256(canonical_json(identity(finding)))


def finding_id(fingerprint: str) -> str:
    return f"f-{fingerprint[:24]}"


def observation_canonical(observation: dict) -> str:
    return canonical_json({k: v for k, v in observation.items() if k != "observedAt"})


def observation_digest(observation: dict) -> str:
    return _sha256(observation_canonical(observation))
