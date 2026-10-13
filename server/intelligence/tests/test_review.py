"""The verification workflow's rules, pure (app/review.py)."""

from app.review import Evidence, decide

ONE = Evidence(methods=["pia-capture", "pia-capture"], contributors=["c1", "c1"], releases=["8.62.09", "8.62.09"])
TWO_METHODS = Evidence(methods=["pia-capture", "source-inspection"], contributors=["c1", "c1"], releases=["8.62.09", "8.62.09"])
TWO_PEOPLE = Evidence(methods=["pia-capture", "pia-capture"], contributors=["c1", "c2"], releases=["8.62.09", "8.61.05"])


def test_corroboration_needs_independence_not_counting():
    assert not decide("reproduced", "corroborated", ONE, criteria="", rationale="ten runs agree", releases=None, superseded_by=None).allowed
    assert decide("reproduced", "corroborated", TWO_METHODS, criteria="", rationale="capture and source agree", releases=None, superseded_by=None).allowed
    assert decide("observed", "corroborated", TWO_PEOPLE, criteria="", rationale="two labs", releases=None, superseded_by=None).allowed


def test_verification_names_criteria_and_observed_releases():
    d = decide("corroborated", "verified", TWO_PEOPLE, criteria="", rationale="ok", releases=None, superseded_by=None)
    assert not d.allowed and len(d.reasons) == 2
    assert not decide("corroborated", "verified", TWO_PEOPLE, criteria="replayed", rationale="ok", releases=["8.60"], superseded_by=None).allowed
    assert decide("corroborated", "verified", TWO_PEOPLE, criteria="replayed", rationale="ok", releases=["8.62.09"], superseded_by=None).allowed


def test_roles_and_illegal_moves():
    assert decide("verified", "published", ONE, criteria="", rationale="ok", releases=None, superseded_by=None).role == "admin"
    assert decide("published", "revoked", ONE, criteria="", rationale="wrong on 8.61", releases=None, superseded_by=None).role == "admin"
    for frm, to in [("observed", "verified"), ("observed", "published"), ("rejected", "published"), ("published", "observed"), ("withdrawn", "corroborated")]:
        assert not decide(frm, to, TWO_PEOPLE, criteria="c", rationale="r", releases=["8.62.09"], superseded_by=None).allowed
    assert not decide("observed", "rejected", ONE, criteria="", rationale=" ", releases=None, superseded_by=None).allowed, "a rationale is required"
    assert not decide("observed", "superseded", ONE, criteria="", rationale="r", releases=None, superseded_by=None).allowed
