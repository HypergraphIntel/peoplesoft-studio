"""The finding input contract: the JSON Schema exported from the client (contract/).

Validation is strict (the schema's additionalProperties: false everywhere) and runs
after the trimming zod applies on the client, which JSON Schema cannot express.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from jsonschema import Draft202012Validator

from .canonical import js_trim

SCHEMA_ID = "psft-finding/1"
CONTRACT_DIR = Path(__file__).resolve().parent.parent / "contract"

# The fields src/intelligence/schema.ts trims (z.string().trim()).
_TRIMMED = [("subject", "objectType"), ("title",), ("statement",), ("observation", "observation")]


@lru_cache(maxsize=1)
def _validator() -> Draft202012Validator:
    schema = json.loads((CONTRACT_DIR / "finding-input.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def normalize(raw: dict) -> dict:
    """The input as the client's parse leaves it: the trimmed fields trimmed."""
    out = json.loads(json.dumps(raw))
    for path in _TRIMMED:
        node = out
        for key in path[:-1]:
            node = node.get(key) if isinstance(node, dict) else None
            if node is None:
                break
        if isinstance(node, dict) and isinstance(node.get(path[-1]), str):
            node[path[-1]] = js_trim(node[path[-1]])
    return out


def validate(raw: object) -> tuple[dict | None, list[dict]]:
    """(the normalized input, []) when valid; (None, issues) otherwise. Issues name paths, never values."""
    if not isinstance(raw, dict):
        return None, [{"path": "$", "message": "a finding is a JSON object"}]
    value = normalize(raw)
    issues = []
    for e in sorted(_validator().iter_errors(value), key=lambda e: list(e.absolute_path)):
        path = "$" + "".join(f"[{p}]" if isinstance(p, int) else f".{p}" for p in e.absolute_path)
        issues.append({"path": path, "message": f"fails {e.validator}"})
    # A trimmed field must still hold something (zod's min(1) after trim).
    for p in _TRIMMED:
        node = value
        for key in p:
            node = node.get(key) if isinstance(node, dict) else None
        if node == "":
            issues.append({"path": "$." + ".".join(p), "message": "fails minLength"})
    return (None, issues) if issues else (value, [])
