from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest

from conftest import BUILDER, CONTRACT_MODULE, Chain, COMPLETED, OPEN, OTHER_BUILDER, Revert, STRANGER, SUBMITTED


VECTORS = json.loads((Path(__file__).parents[2] / "shared" / "evidence-vectors.json").read_text(encoding="utf-8"))
INVALID_URLS = VECTORS["invalid"]
VALID_URLS = VECTORS["valid"]
URL_PARITY_VECTORS = VECTORS["urlParity"]
COMMIT = "0123456789abcdef0123456789abcdef01234567"


def unchanged(chain, project_id):
    milestone = chain.milestone(project_id, 0)
    return (
        milestone.state,
        milestone.submission_count,
        milestone.current_submission_id,
        len(chain.contract.submissions),
        dict(chain.contract.submission_nonces),
        dict(chain.contract.submission_action_keys),
    )


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


def test_valid_public_https_urls_are_accepted(chain, valid_milestones, valid_evidence):
    github_project = chain.create_project(valid_milestones, nonce="github-project")
    github_digest = chain.submit(github_project, evidence=valid_evidence, nonce="github-submit")

    deployment_milestones = deepcopy(valid_milestones)
    deployment_milestones[0]["allowed_sources"] = ["DEPLOYMENT"]
    vercel_project = chain.create_project(deployment_milestones, nonce="vercel-project")
    vercel_evidence = [["DEPLOYMENT", VALID_URLS[1], "milestoneproof.vercel.app", "mvp-2026-08-23", 0]]
    vercel_digest = chain.submit(vercel_project, evidence=vercel_evidence, nonce="vercel-submit")

    assert github_digest == chain.milestone(github_project, 0).current_submission_id
    assert vercel_digest == chain.milestone(vercel_project, 0).current_submission_id

    for index, url in enumerate(VALID_URLS[2:], start=2):
        project_id = chain.create_project(valid_milestones, nonce=f"public-project-{index}")
        evidence = deepcopy(valid_evidence)
        evidence[0][1] = url
        assert chain.submit(project_id, evidence=evidence, nonce=f"public-submit-{index}") == chain.milestone(project_id, 0).current_submission_id


@pytest.mark.parametrize("vector", URL_PARITY_VECTORS, ids=lambda vector: vector["url"])
def test_url_parity_vectors_match_the_contract_policy(vector):
    url = vector["url"]
    if vector["valid"]:
        CONTRACT_MODULE._validate_public_evidence_url(url)
    else:
        with pytest.raises(Revert, match="unsafe evidence URL"):
            CONTRACT_MODULE._validate_public_evidence_url(url)


def test_wrong_builder_cannot_submit_without_mutation(chain, open_project, valid_evidence):
    before = unchanged(chain, open_project)

    with pytest.raises(Revert, match="builder only"):
        chain.submit(open_project, evidence=valid_evidence, nonce="stranger-submit", sender=STRANGER)

    assert unchanged(chain, open_project) == before


@pytest.mark.parametrize(
    ("evidence", "error"),
    [
        ([], "evidence is required"),
        ([["REPOSITORY", VALID_URLS[0], "repo", "short", 0]], "full git commit is required"),
        ([["RELEASE", VALID_URLS[0], "repo", "v1.0.0", 0]], "source kind is not allowed"),
        (
            [
                ["REPOSITORY", VALID_URLS[0], "repo", COMMIT, 0],
                ["REPOSITORY", VALID_URLS[0], "repo", COMMIT, 0],
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
    too_many = [["REPOSITORY", VALID_URLS[0], f"repo-{index}", COMMIT, 0] for index in range(5)]

    with pytest.raises(Revert, match="too many evidence items"):
        chain.submit(open_project, evidence=too_many, nonce="too-many")

    assert unchanged(chain, open_project) == before


def test_distinct_evidence_tuples_with_delimiters_are_not_treated_as_duplicates(chain, valid_milestones):
    deployment_milestones = deepcopy(valid_milestones)
    deployment_milestones[0]["allowed_sources"] = ["DEPLOYMENT"]
    project_id = chain.create_project(deployment_milestones, nonce="delimiter-project")
    delimiter_evidence = [
        ["DEPLOYMENT", VALID_URLS[1], "a:b", "c", 0],
        ["DEPLOYMENT", VALID_URLS[1], "a", "b:c", 0],
    ]

    digest = chain.submit(project_id, evidence=delimiter_evidence, nonce="delimiter-submit")

    assert chain.submission(digest).evidence[1].version_ref == "b:c"


def test_submission_digest_is_length_prefixed_and_domain_bound(chain, valid_milestones):
    first = chain.create_project(valid_milestones, nonce="first-project")
    second = chain.create_project(valid_milestones, nonce="second-project")
    split_one = [["REPOSITORY", VALID_URLS[0], "ab", COMMIT, 0]]
    split_two = [["REPOSITORY", VALID_URLS[0], "a", "b" + COMMIT[1:], 0]]

    first_digest = chain.submit(first, evidence=split_one, nonce="first-submit")
    second_digest = chain.submit(second, evidence=split_two, nonce="second-submit")

    assert first_digest != second_digest


@pytest.mark.parametrize(
    ("chain_id", "contract_address"),
    [
        (62000, "0xc000000000000000000000000000000000000001"),
        (61999, "0xc000000000000000000000000000000000000002"),
    ],
)
def test_canonical_digest_uses_actual_chain_and_contract_domains(valid_milestones, valid_evidence, chain_id, contract_address):
    first = Chain()
    first.set_now(0)
    first.set_chain_id(61999)
    first.set_contract_address("0xc000000000000000000000000000000000000001")
    first_project = first.create_project(valid_milestones, nonce="domain-project")
    first_digest = first.submit(first_project, evidence=valid_evidence, nonce="domain-submit")

    second = Chain()
    second.set_now(0)
    second.set_chain_id(chain_id)
    second.set_contract_address(contract_address)
    second_project = second.create_project(valid_milestones, nonce="domain-project")
    second_digest = second.submit(second_project, evidence=valid_evidence, nonce="domain-submit")

    assert first_digest != second_digest
    assert set(first.contract.submission_action_keys) != set(second.contract.submission_action_keys)


def test_canonical_digest_binds_builder_milestone_and_revision_domains(chain, valid_milestones, valid_evidence):
    first_project = chain.create_project(valid_milestones, nonce="builder-project")
    first_digest = chain.submit(first_project, evidence=valid_evidence, nonce="builder-submit")

    builder_chain = Chain()
    builder_project = builder_chain.create_project(valid_milestones, nonce="builder-project", builder=OTHER_BUILDER)
    builder_digest = builder_chain.submit(builder_project, evidence=valid_evidence, nonce="builder-submit", sender=OTHER_BUILDER)

    milestone_chain = Chain()
    milestone_project = milestone_chain.create_project(valid_milestones, nonce="milestone-project")
    milestone_chain.milestone(milestone_project, 1).allowed_sources = ["REPOSITORY"]
    milestone_chain.milestone(milestone_project, 1).state = OPEN
    milestone_digest = milestone_chain.submit(milestone_project, evidence=valid_evidence, nonce="milestone-submit", milestone_index=1)

    revision_chain = Chain()
    revision_project = revision_chain.create_project(valid_milestones, nonce="revision-project")
    revision_chain.milestone(revision_project, 0).submission_count = 1
    revision_digest = revision_chain.submit(revision_project, evidence=valid_evidence, nonce="revision-submit")

    assert first_digest != builder_digest
    assert first_digest != milestone_digest
    assert first_digest != revision_digest


def test_submission_timestamp_is_captured_once_and_binds_digest_and_action_key(valid_milestones, valid_evidence):
    first = Chain()
    first_project = first.create_project(valid_milestones, nonce="time-project")
    first.set_now(10)
    first_digest = first.submit(first_project, evidence=valid_evidence, nonce="time-submit")

    second = Chain()
    second_project = second.create_project(valid_milestones, nonce="time-project")
    second.set_now(11)
    second_digest = second.submit(second_project, evidence=valid_evidence, nonce="time-submit")

    assert first_digest != second_digest
    assert set(first.contract.submission_action_keys) != set(second.contract.submission_action_keys)
    assert first.submission(first_digest).submitted_at == 10
    assert second.submission(second_digest).submitted_at == 11


@pytest.mark.parametrize(
    ("now", "observed_at", "error"),
    [(10, 10, None), (10, 11, "evidence observation is in the future"), (1_899_999_999, 1_900_000_000, "evidence observation is in the future"), (1_900_000_000, 1_900_000_000, "milestone deadline has passed")],
)
def test_evidence_observation_is_bounded_by_submission_time_and_deadline(chain, open_project, valid_evidence, now, observed_at, error):
    chain.set_now(now)
    evidence = deepcopy(valid_evidence)
    evidence[0][4] = observed_at
    before = unchanged(chain, open_project)

    if error is None:
        digest = chain.submit(open_project, evidence=evidence, nonce="observation-boundary")
        assert chain.submission(digest).submitted_at == now
        return
    with pytest.raises(Revert, match=error):
        chain.submit(open_project, evidence=evidence, nonce="observation-boundary")
    assert unchanged(chain, open_project) == before


def test_uppercase_commit_is_normalized_before_storage_and_hashing(valid_milestones, valid_evidence):
    uppercase = deepcopy(valid_evidence)
    uppercase[0][3] = COMMIT.upper()
    upper_chain = Chain()
    upper_project = upper_chain.create_project(valid_milestones, nonce="upper-project")
    upper_digest = upper_chain.submit(upper_project, evidence=uppercase, nonce="upper-submit")

    lower_chain = Chain()
    lower_project = lower_chain.create_project(valid_milestones, nonce="upper-project")
    lower_digest = lower_chain.submit(lower_project, evidence=valid_evidence, nonce="upper-submit")

    assert upper_chain.submission(upper_digest).evidence[0].version_ref == COMMIT
    assert upper_digest == lower_digest


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
