from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest

from conftest import BUILDER, COMPLETED, OPEN, Revert, STRANGER, SUBMITTED


VECTORS = json.loads((Path(__file__).parents[2] / "shared" / "evidence-vectors.json").read_text(encoding="utf-8"))
INVALID_URLS = VECTORS["invalid"]
VALID_URLS = VECTORS["valid"]
COMMIT = "0123456789abcdef0123456789abcdef01234567"


def unchanged(chain, project_id):
    milestone = chain.milestone(project_id, 0)
    return (milestone.state, milestone.submission_count, milestone.current_submission_id, len(chain.contract.submissions))


def test_builder_submits_canonical_evidence_and_locks_milestone(chain, open_project, valid_evidence):
    digest = chain.submit(open_project, evidence=valid_evidence, nonce="submit-001")

    milestone = chain.milestone(open_project, 0)
    submission = chain.submission(digest)
    assert digest == milestone.current_submission_id
    assert milestone.state == SUBMITTED
    assert milestone.submission_count == 1
    assert submission.project_id == open_project
    assert submission.milestone_index == 0
    assert submission.revision == 1
    assert submission.verdict == 0
    assert submission.builder == BUILDER
    assert submission.digest == digest
    assert [
        [item.source_kind, item.url, item.subject_ref, item.version_ref, item.observed_at]
        for item in submission.evidence
    ] == valid_evidence


@pytest.mark.parametrize("url", INVALID_URLS)
def test_unsafe_evidence_url_reverts_without_mutation(chain, open_project, valid_evidence, url):
    before = unchanged(chain, open_project)
    invalid_evidence = deepcopy(valid_evidence)
    invalid_evidence[0][1] = url

    with pytest.raises(Revert, match="unsafe evidence URL"):
        chain.submit(open_project, evidence=invalid_evidence, nonce="unsafe-url")

    assert unchanged(chain, open_project) == before


def test_valid_github_and_vercel_https_urls_are_accepted(chain, valid_milestones, valid_evidence):
    github_project = chain.create_project(valid_milestones, nonce="github-project")
    github_digest = chain.submit(github_project, evidence=valid_evidence, nonce="github-submit")

    deployment_milestones = deepcopy(valid_milestones)
    deployment_milestones[0]["allowed_sources"] = ["DEPLOYMENT"]
    vercel_project = chain.create_project(deployment_milestones, nonce="vercel-project")
    vercel_evidence = [["DEPLOYMENT", VALID_URLS[1], "milestoneproof.vercel.app", "mvp-2026-08-23", 1_800_000_000]]
    vercel_digest = chain.submit(vercel_project, evidence=vercel_evidence, nonce="vercel-submit")

    assert github_digest == chain.milestone(github_project, 0).current_submission_id
    assert vercel_digest == chain.milestone(vercel_project, 0).current_submission_id


def test_wrong_builder_cannot_submit_without_mutation(chain, open_project, valid_evidence):
    before = unchanged(chain, open_project)

    with pytest.raises(Revert, match="builder only"):
        chain.submit(open_project, evidence=valid_evidence, nonce="stranger-submit", sender=STRANGER)

    assert unchanged(chain, open_project) == before


@pytest.mark.parametrize(
    ("evidence", "error"),
    [
        ([], "evidence is required"),
        ([["REPOSITORY", VALID_URLS[0], "repo", "short", 1_800_000_000]], "full git commit is required"),
        ([["RELEASE", VALID_URLS[0], "repo", "v1.0.0", 1_800_000_000]], "source kind is not allowed"),
        (
            [
                ["REPOSITORY", VALID_URLS[0], "repo", COMMIT, 1_800_000_000],
                ["REPOSITORY", VALID_URLS[0], "repo", COMMIT, 1_800_000_001],
            ],
            "duplicate evidence reference",
        ),
        ([["REPOSITORY", VALID_URLS[0], "repo", COMMIT, -1]], "evidence predates milestone"),
    ],
)
def test_invalid_evidence_binding_reverts_without_mutation(chain, open_project, evidence, error):
    before = unchanged(chain, open_project)

    with pytest.raises(Revert, match=error):
        chain.submit(open_project, evidence=evidence, nonce="bad-binding")

    assert unchanged(chain, open_project) == before


def test_rejects_more_than_four_evidence_items_without_mutation(chain, open_project, valid_evidence):
    before = unchanged(chain, open_project)
    too_many = [["REPOSITORY", VALID_URLS[0], f"repo-{index}", COMMIT, 1_800_000_000] for index in range(5)]

    with pytest.raises(Revert, match="too many evidence items"):
        chain.submit(open_project, evidence=too_many, nonce="too-many")

    assert unchanged(chain, open_project) == before


def test_distinct_evidence_tuples_with_delimiters_are_not_treated_as_duplicates(chain, valid_milestones):
    deployment_milestones = deepcopy(valid_milestones)
    deployment_milestones[0]["allowed_sources"] = ["DEPLOYMENT"]
    project_id = chain.create_project(deployment_milestones, nonce="delimiter-project")
    delimiter_evidence = [
        ["DEPLOYMENT", VALID_URLS[1], "a:b", "c", 1_800_000_000],
        ["DEPLOYMENT", VALID_URLS[1], "a", "b:c", 1_800_000_000],
    ]

    digest = chain.submit(project_id, evidence=delimiter_evidence, nonce="delimiter-submit")

    assert chain.submission(digest).evidence[1].version_ref == "b:c"


def test_submission_digest_is_length_prefixed_and_domain_bound(chain, valid_milestones):
    first = chain.create_project(valid_milestones, nonce="first-project")
    second = chain.create_project(valid_milestones, nonce="second-project")
    split_one = [["REPOSITORY", VALID_URLS[0], "ab", COMMIT, 1_800_000_000]]
    split_two = [["REPOSITORY", VALID_URLS[0], "a", "b" + COMMIT[1:], 1_800_000_000]]

    first_digest = chain.submit(first, evidence=split_one, nonce="first-submit")
    second_digest = chain.submit(second, evidence=split_two, nonce="second-submit")

    assert first_digest != second_digest


def test_reused_builder_nonce_reverts_before_mutating_another_open_milestone(chain, valid_milestones, valid_evidence):
    first = chain.create_project(valid_milestones, nonce="first-project")
    second = chain.create_project(valid_milestones, nonce="second-project")
    chain.submit(first, evidence=valid_evidence, nonce="replayed-nonce")
    before = unchanged(chain, second)

    with pytest.raises(Revert, match="nonce already used"):
        chain.submit(second, evidence=valid_evidence, nonce="replayed-nonce")

    assert unchanged(chain, second) == before


def test_identical_submission_action_reverts_without_mutation(chain, open_project, valid_evidence):
    chain.submit(open_project, evidence=valid_evidence, nonce="first-action")
    chain.milestone(open_project, 0).state = OPEN
    before = unchanged(chain, open_project)

    with pytest.raises(Revert, match="submission already exists"):
        chain.submit(open_project, evidence=valid_evidence, nonce="second-action")

    assert unchanged(chain, open_project) == before


@pytest.mark.parametrize(
    ("project_id", "milestone_index", "expected"),
    [(1, 1, "milestone is not open"), (999, 0, "project not found"), (1, 99, "milestone not found")],
)
def test_locked_or_missing_milestone_reverts_without_mutation(chain, open_project, valid_evidence, project_id, milestone_index, expected):
    before = unchanged(chain, open_project)

    with pytest.raises(Revert, match=expected):
        chain.submit(project_id, evidence=valid_evidence, nonce="bad-target", milestone_index=milestone_index)

    assert unchanged(chain, open_project) == before


def test_second_open_submission_reverts_without_mutation(chain, open_project, valid_evidence):
    chain.submit(open_project, evidence=valid_evidence, nonce="first-submit")
    before = unchanged(chain, open_project)

    with pytest.raises(Revert, match="milestone is not open"):
        chain.submit(open_project, evidence=valid_evidence, nonce="second-submit")

    assert unchanged(chain, open_project) == before


def test_expired_deadline_reverts_without_mutation(chain, open_project, valid_evidence):
    deadline = int(chain.milestone(open_project, 0).deadline)
    chain.set_now(deadline)
    before = unchanged(chain, open_project)

    with pytest.raises(Revert, match="milestone deadline has passed"):
        chain.submit(open_project, evidence=valid_evidence, nonce="expired-submit")

    assert unchanged(chain, open_project) == before


def test_terminal_project_reverts_without_mutation(chain, open_project, valid_evidence):
    chain.project(open_project).status = COMPLETED
    before = unchanged(chain, open_project)

    with pytest.raises(Revert, match="project is not active"):
        chain.submit(open_project, evidence=valid_evidence, nonce="terminal-submit")

    assert unchanged(chain, open_project) == before
