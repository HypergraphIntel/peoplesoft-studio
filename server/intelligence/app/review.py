"""The verification workflow (docs/intelligence/VERIFICATION_MODEL.md): which status changes a review may make.

Pure: given the finding's status, its evidence and the request, the decision and why.
Counting submissions never verifies anything: corroboration needs independent support.
"""

from __future__ import annotations

from dataclasses import dataclass

COMPUTED = ("observed", "reproduced")
STATUSES = COMPUTED + ("corroborated", "verified", "published", "rejected", "superseded", "conflicting", "withdrawn", "revoked")

# from -> to -> the role it needs
TRANSITIONS: dict[str, dict[str, str]] = {
    "observed": {"corroborated": "reviewer", "rejected": "reviewer", "conflicting": "reviewer", "superseded": "reviewer"},
    "reproduced": {"corroborated": "reviewer", "rejected": "reviewer", "conflicting": "reviewer", "superseded": "reviewer"},
    "corroborated": {"verified": "reviewer", "rejected": "reviewer", "conflicting": "reviewer", "superseded": "reviewer"},
    "conflicting": {"corroborated": "reviewer", "rejected": "reviewer", "superseded": "reviewer"},
    "verified": {"published": "admin", "rejected": "reviewer", "conflicting": "reviewer", "superseded": "reviewer"},
    "published": {"revoked": "admin", "superseded": "admin"},
}


@dataclass
class Evidence:
    """What independence is judged on: one entry per observation."""

    methods: list[str]
    contributors: list[str]
    releases: list[str]


@dataclass
class Decision:
    allowed: bool
    role: str | None
    reasons: list[str]


def decide(status: str, to: str, ev: Evidence, *, criteria: str, rationale: str, releases: list[str] | None, superseded_by: str | None) -> Decision:
    reasons: list[str] = []
    role = TRANSITIONS.get(status, {}).get(to)
    if role is None:
        return Decision(False, None, [f"A finding that is {status} cannot become {to}."])
    if not rationale.strip():
        reasons.append("A review states its rationale.")
    if to == "corroborated":
        # Independent support: another method or another contributor -- never a re-run of the same experiment.
        if len(set(ev.methods)) < 2 and len(set(ev.contributors)) < 2:
            reasons.append("Corroboration needs independent support: observations by at least two methods or from at least two contributors.")
    if to == "verified":
        if not criteria.strip():
            reasons.append("Verification states the acceptance criteria it was checked against.")
        if not releases:
            reasons.append("Verification names the PeopleTools releases it holds on.")
        elif not set(releases) <= set(ev.releases):
            reasons.append(f"Verified releases must be observed releases ({', '.join(sorted(set(ev.releases)))}).")
    if to == "superseded" and not superseded_by:
        reasons.append("Superseding names the finding that replaces it.")
    return Decision(not reasons, role, reasons)
