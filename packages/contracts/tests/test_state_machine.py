from copy import deepcopy

import genlayer as gl
import pytest

from conftest import (
    APPROVED,
    APPROVED_MILESTONE,
    BUILDER,
    COMPLETED,
    GL,
    OPEN,
    REJECTED,
    REQUEST_MORE_INFO,
    SPONSOR,
    STRANGER,
    SUBMITTED,
    UNRESOLVED,
    Revert,
)


ACTIVE = 0
FAILED = 2
FAILED_MILESTONE = 4
COOLDOWN = 60 * 60
INFO_WINDOW = 72 * 60 * 60
COMMIT_1 = "0123456789abcdef0123456789abcdef01234567"
COMMIT_2 = "1123456789abcdef0123456789abcdef01234567"
COMMIT_3 = "2123456789abcdef0123456789abcdef01234567"


def evidence(commit, observed_at):
    return [[
        "REPOSITORY",
        f"https://github.com/acme/milestoneproof/commit/{commit}",
        "github.com/acme/milestoneproof",
        commit,
        observed_at,
    ]]


def create_one_milestone_project(
    chain, *, deadline=1_900_000_000, nonce="grant-001"
):
    return chain.create_project([{
        "title": "Ship lifecycle",
        "criteria": ["The lifecycle is safely recoverable"],
        "allowed_sources": ["REPOSITORY"],
        "deadline": deadline,
    }], nonce=nonce)


def resolve_as(chain, submission_id, verdict, *, now, sender=SPONSOR):
    for item in chain.submission(submission_id).evidence:
        gl.set_web_response(item.url, "Evidence supports the requested lifecycle verdict.")
    criteria = [verdict == "APPROVED"]
    missing = [0] if verdict == "REQUEST_MORE_INFO" else []
    integrity = [True, True, True, True]
    chain.set_now(now)
    chain.set_verdict(
        verdict=verdict,
        criteria=criteria,
        missing=missing,
        integrity=integrity,
    )
    chain.call("resolve_submission", submission_id, sender=sender)


def snapshot(chain, project_id, submission_ids):
    return deepcopy((
        chain.project(project_id),
        list(chain.contract.milestones[project_id]),
        [chain.submission(submission_id) for submission_id in submission_ids],
        dict(chain.contract.submission_nonces),
        dict(chain.contract.submission_action_keys),
    ))


def test_request_more_info_supplement_creates_a_new_canonical_revision(chain):
    chain.set_now(1_800_000_000)
    project_id = create_one_milestone_project(chain, deadline=1_800_000_150)
    first_id = chain.submit(project_id, evidence(COMMIT_1, 1_800_000_000), "first")
    resolve_as(chain, first_id, "REQUEST_MORE_INFO", now=1_800_000_100)

    chain.set_now(1_800_000_100 + INFO_WINDOW - 1)
    second_id = chain.call(
        "supplement_evidence",
        first_id,
        evidence(COMMIT_2, 1_800_000_200),
        "supplement-2",
        sender=BUILDER,
    )

    milestone = chain.milestone(project_id, 0)
    assert milestone.state == SUBMITTED
    assert milestone.submission_count == 2
    assert milestone.current_submission_id == second_id
    assert chain.project(project_id).status == ACTIVE
    assert chain.project(project_id).current_milestone == 0
    assert chain.submission(first_id).revision == 1
    assert chain.submission(first_id).verdict == REQUEST_MORE_INFO
    assert chain.submission(first_id).resolution_count == 1
    assert chain.submission(second_id).revision == 2
    assert chain.submission(second_id).verdict == 0
    assert [item.version_ref for item in chain.submission(second_id).evidence] == [
        COMMIT_1,
        COMMIT_2,
    ]

    before = snapshot(chain, project_id, [first_id, second_id])
    with pytest.raises(Revert, match="submission is not current"):
        chain.call(
            "supplement_evidence",
            first_id,
            evidence(COMMIT_3, 1_800_000_300),
            "supplement-3",
            sender=BUILDER,
        )
    assert snapshot(chain, project_id, [first_id, second_id]) == before


@pytest.mark.parametrize("request_time", [1_800_000_149, 1_800_000_150])
def test_post_deadline_information_cure_uses_fixed_effective_deadline_and_can_approve(
    chain, request_time
):
    milestone_deadline = 1_800_000_150
    chain.set_now(1_800_000_000)
    project_id = create_one_milestone_project(chain, deadline=milestone_deadline)
    first_id = chain.submit(
        project_id, evidence(COMMIT_1, 1_800_000_000), "first"
    )
    resolve_as(chain, first_id, "REQUEST_MORE_INFO", now=request_time)

    cure_time = milestone_deadline + 1
    chain.set_now(cure_time)
    cure_id = chain.call(
        "supplement_evidence",
        first_id,
        evidence(COMMIT_2, cure_time),
        f"cure-{request_time}",
        sender=BUILDER,
    )

    cure = chain.submission(cure_id)
    assert cure.submitted_at > chain.milestone(project_id, 0).deadline
    assert cure.freshness_deadline == request_time + INFO_WINDOW
    assert cure.submitted_at < cure.freshness_deadline
    assert chain.submission(first_id).freshness_deadline == milestone_deadline
    assert chain.milestone(project_id, 0).submission_count == 2
    assert chain.project(project_id).current_milestone == 0

    resolve_as(chain, cure_id, "APPROVED", now=cure_time + 1)

    assert chain.submission(cure_id).verdict == APPROVED
    assert chain.submission(cure_id).fresh is True
    assert chain.submission(cure_id).resolution_count == 1
    assert chain.milestone(project_id, 0).state == APPROVED_MILESTONE
    assert chain.project(project_id).status == COMPLETED


def test_initial_revision_keeps_the_frozen_milestone_freshness_deadline(chain):
    milestone_deadline = 1_800_000_200
    chain.set_now(1_800_000_000)
    project_id = create_one_milestone_project(chain, deadline=milestone_deadline)
    submission_id = chain.submit(
        project_id, evidence(COMMIT_1, 1_800_000_000), "initial"
    )

    assert chain.submission(submission_id).freshness_deadline == milestone_deadline
    resolve_as(chain, submission_id, "APPROVED", now=milestone_deadline)
    assert chain.submission(submission_id).verdict == APPROVED
    assert chain.project(project_id).status == COMPLETED


def test_deterministic_chronology_rejects_unsafe_effective_deadline_before_nondet(
    chain,
):
    chain.set_now(1_800_000_000)
    project_id = create_one_milestone_project(chain)
    submission_id = chain.submit(
        project_id, evidence(COMMIT_1, 1_800_000_000), "initial"
    )
    chain.submission(submission_id).freshness_deadline = 1_800_000_000
    before = snapshot(chain, project_id, [submission_id])

    def nondet_must_not_run(_prompt):
        raise AssertionError("deterministic chronology must fail before nondet")

    GL.set_prompt_handler(nondet_must_not_run)
    with pytest.raises(Revert, match="submission chronology is invalid"):
        chain.call("resolve_submission", submission_id, sender=SPONSOR)

    assert snapshot(chain, project_id, [submission_id]) == before


@pytest.mark.parametrize("elapsed", [INFO_WINDOW, INFO_WINDOW + 1])
def test_supplement_rejects_the_closed_information_window_without_mutation(chain, elapsed):
    chain.set_now(1_800_000_000)
    project_id = create_one_milestone_project(chain)
    submission_id = chain.submit(project_id, evidence(COMMIT_1, 1_800_000_000), "first")
    resolve_as(chain, submission_id, "REQUEST_MORE_INFO", now=1_800_000_100)
    before = snapshot(chain, project_id, [submission_id])

    chain.set_now(1_800_000_100 + elapsed)
    with pytest.raises(Revert, match="information window has elapsed"):
        chain.call(
            "supplement_evidence",
            submission_id,
            evidence(COMMIT_2, 1_800_000_200),
            "late-supplement",
            sender=BUILDER,
        )

    assert snapshot(chain, project_id, [submission_id]) == before


def test_rejected_submission_can_be_resubmitted_until_attempts_are_exhausted(chain):
    chain.set_now(1_800_000_000)
    project_id = create_one_milestone_project(chain)
    first_id = chain.submit(project_id, evidence(COMMIT_1, 1_800_000_000), "first")
    resolve_as(chain, first_id, "REJECTED", now=1_800_000_100)

    chain.set_now(1_800_000_200)
    second_id = chain.call(
        "resubmit_evidence",
        project_id,
        0,
        evidence(COMMIT_2, 1_800_000_200),
        "second",
        sender=BUILDER,
    )
    assert chain.milestone(project_id, 0).submission_count == 2
    assert chain.milestone(project_id, 0).current_submission_id == second_id
    assert chain.milestone(project_id, 0).state == SUBMITTED
    assert chain.submission(first_id).verdict == REJECTED
    assert chain.submission(second_id).revision == 2

    resolve_as(chain, second_id, "REJECTED", now=1_800_000_300)
    chain.set_now(1_800_000_400)
    third_id = chain.call(
        "resubmit_evidence",
        project_id,
        0,
        evidence(COMMIT_3, 1_800_000_400),
        "third",
        sender=BUILDER,
    )
    resolve_as(chain, third_id, "REJECTED", now=1_800_000_500)

    assert chain.milestone(project_id, 0).submission_count == 3
    assert chain.milestone(project_id, 0).current_submission_id == third_id
    assert chain.milestone(project_id, 0).state == FAILED_MILESTONE
    assert chain.project(project_id).status == FAILED
    assert [chain.submission(item).revision for item in (first_id, second_id, third_id)] == [1, 2, 3]

    before = snapshot(chain, project_id, [first_id, second_id, third_id])
    with pytest.raises(Revert, match="project is not active"):
        chain.call(
            "resubmit_evidence",
            project_id,
            0,
            evidence(COMMIT_1, 1_800_000_500),
            "fourth",
            sender=BUILDER,
        )
    assert snapshot(chain, project_id, [first_id, second_id, third_id]) == before


@pytest.mark.parametrize("verdict", ["REJECTED", "REQUEST_MORE_INFO"])
def test_only_builder_can_create_a_cure_revision_without_mutation(chain, verdict):
    chain.set_now(1_800_000_000)
    project_id = create_one_milestone_project(chain)
    submission_id = chain.submit(
        project_id, evidence(COMMIT_1, 1_800_000_000), "first"
    )
    resolve_as(chain, submission_id, verdict, now=1_800_000_100)
    before = snapshot(chain, project_id, [submission_id])
    chain.set_now(1_800_000_200)

    with pytest.raises(Revert, match="builder only"):
        if verdict == "REJECTED":
            chain.call(
                "resubmit_evidence",
                project_id,
                0,
                evidence(COMMIT_2, 1_800_000_200),
                "unauthorized-cure",
                sender=STRANGER,
            )
        else:
            chain.call(
                "supplement_evidence",
                submission_id,
                evidence(COMMIT_2, 1_800_000_200),
                "unauthorized-cure",
                sender=STRANGER,
            )

    assert snapshot(chain, project_id, [submission_id]) == before


def test_rejected_resubmission_deadline_is_fixed_and_permissionless_expiry_remains_available(chain):
    chain.set_now(1_800_000_000)
    project_id = create_one_milestone_project(chain, deadline=1_800_000_200)
    submission_id = chain.submit(
        project_id, evidence(COMMIT_1, 1_800_000_000), "first"
    )
    resolve_as(chain, submission_id, "REJECTED", now=1_800_000_100)
    before = snapshot(chain, project_id, [submission_id])

    chain.set_now(1_800_000_200)
    with pytest.raises(Revert, match="milestone deadline has passed"):
        chain.call(
            "resubmit_evidence",
            project_id,
            0,
            evidence(COMMIT_2, 1_800_000_200),
            "late-resubmit",
            sender=BUILDER,
        )
    assert snapshot(chain, project_id, [submission_id]) == before

    chain.call("expire_milestone", project_id, 0, sender=STRANGER)
    assert chain.milestone(project_id, 0).state == FAILED_MILESTONE
    assert chain.project(project_id).status == FAILED


def test_unresolved_retry_enforces_cooldown_boundaries_and_uses_semantic_resolution(chain):
    chain.set_now(1_800_000_000)
    project_id = create_one_milestone_project(chain)
    submission_id = chain.submit(project_id, evidence(COMMIT_1, 1_800_000_000), "first")
    resolve_as(chain, submission_id, "UNRESOLVED", now=1_800_000_100)
    submission = chain.submission(submission_id)
    assert submission.verdict == UNRESOLVED
    assert submission.resolution_count == 1
    assert submission.next_retry_at == 1_800_000_100 + COOLDOWN

    before = snapshot(chain, project_id, [submission_id])
    chain.set_now(1_800_000_100 + COOLDOWN - 1)
    with pytest.raises(Revert, match="resolution retry cooldown"):
        chain.call("retry_resolution", submission_id, sender=SPONSOR)
    assert snapshot(chain, project_id, [submission_id]) == before

    chain.set_verdict(
        verdict="APPROVED",
        criteria=[True],
        missing=[],
        integrity=[True, True, True, True],
    )
    chain.set_now(1_800_000_100 + COOLDOWN)
    chain.call("retry_resolution", submission_id, sender=BUILDER)

    submission = chain.submission(submission_id)
    assert submission.verdict == APPROVED
    assert submission.resolution_count == 2
    assert submission.next_retry_at == 0
    assert chain.milestone(project_id, 0).state == APPROVED_MILESTONE
    assert chain.milestone(project_id, 0).submission_count == 1
    assert chain.project(project_id).status == COMPLETED
    assert chain.project(project_id).current_milestone == 0

    before = snapshot(chain, project_id, [submission_id])
    with pytest.raises(Revert, match="project is not active"):
        chain.call("retry_resolution", submission_id, sender=SPONSOR)
    assert snapshot(chain, project_id, [submission_id]) == before


def test_unresolved_resolution_attempt_limit_rejects_a_fourth_attempt_without_mutation(chain):
    chain.set_now(1_800_000_000)
    project_id = create_one_milestone_project(chain)
    submission_id = chain.submit(project_id, evidence(COMMIT_1, 1_800_000_000), "first")
    for attempt_time in (1_800_000_100, 1_800_003_700, 1_800_007_300):
        if attempt_time == 1_800_000_100:
            resolve_as(chain, submission_id, "UNRESOLVED", now=attempt_time)
        else:
            chain.set_now(attempt_time)
            chain.set_verdict(
                verdict="UNRESOLVED",
                criteria=[False],
                missing=[],
                integrity=[True, True, True, True],
            )
            chain.call("retry_resolution", submission_id, sender=SPONSOR)

    assert chain.submission(submission_id).resolution_count == 3
    assert chain.submission(submission_id).verdict == UNRESOLVED
    assert chain.milestone(project_id, 0).state == SUBMITTED
    assert chain.project(project_id).status == ACTIVE
    before = snapshot(chain, project_id, [submission_id])

    chain.set_now(1_800_010_900)
    with pytest.raises(Revert, match="resolution attempts exhausted"):
        chain.call("retry_resolution", submission_id, sender=SPONSOR)
    assert snapshot(chain, project_id, [submission_id]) == before


def test_only_project_parties_can_retry_resolution_without_mutation(chain):
    chain.set_now(1_800_000_000)
    project_id = create_one_milestone_project(chain)
    submission_id = chain.submit(
        project_id, evidence(COMMIT_1, 1_800_000_000), "first"
    )
    resolve_as(chain, submission_id, "UNRESOLVED", now=1_800_000_100)
    before = snapshot(chain, project_id, [submission_id])
    chain.set_now(1_800_000_100 + COOLDOWN)

    with pytest.raises(Revert, match="project party only"):
        chain.call("retry_resolution", submission_id, sender=STRANGER)

    assert snapshot(chain, project_id, [submission_id]) == before


def test_unresolved_near_deadline_cannot_be_expired_before_its_legal_retry(chain):
    chain.set_now(1_800_000_000)
    project_id = create_one_milestone_project(chain, deadline=1_800_000_200)
    submission_id = chain.submit(
        project_id, evidence(COMMIT_1, 1_800_000_000), "first"
    )
    resolve_as(chain, submission_id, "UNRESOLVED", now=1_800_000_150)
    before = snapshot(chain, project_id, [submission_id])

    chain.set_now(1_800_000_200)
    with pytest.raises(Revert, match="milestone cannot be expired"):
        chain.call("expire_milestone", project_id, 0, sender=STRANGER)
    assert snapshot(chain, project_id, [submission_id]) == before

    chain.set_verdict(
        verdict="APPROVED",
        criteria=[True],
        missing=[],
        integrity=[True, True, True, True],
    )
    chain.set_now(1_800_000_150 + COOLDOWN)
    chain.call("retry_resolution", submission_id, sender=BUILDER)
    assert chain.submission(submission_id).resolution_count == 2
    assert chain.milestone(project_id, 0).state == APPROVED_MILESTONE
    assert chain.project(project_id).status == COMPLETED


def test_approval_opens_next_milestone_then_completes_project(chain, valid_milestones):
    chain.set_now(1_800_000_000)
    project_id = chain.create_project(valid_milestones[:2])
    first_id = chain.submit(project_id, evidence(COMMIT_1, 1_800_000_000), "first")
    resolve_as(chain, first_id, "APPROVED", now=1_800_000_100)

    assert chain.milestone(project_id, 0).state == APPROVED_MILESTONE
    assert chain.milestone(project_id, 1).state == OPEN
    assert chain.milestone(project_id, 1).opened_at == 1_800_000_100
    assert chain.project(project_id).status == ACTIVE
    assert chain.project(project_id).current_milestone == 1

    release = [[
        "RELEASE",
        "https://github.com/acme/milestoneproof/releases/tag/v1.0.0",
        "github.com/acme/milestoneproof",
        "v1.0.0",
        1_800_000_100,
    ]]
    chain.set_now(1_800_000_200)
    second_id = chain.submit(project_id, release, "second", milestone_index=1)
    resolve_as(chain, second_id, "APPROVED", now=1_800_000_300)

    assert chain.milestone(project_id, 1).state == APPROVED_MILESTONE
    assert chain.project(project_id).status == COMPLETED
    assert chain.project(project_id).current_milestone == 1
    assert chain.milestone(project_id, 0).submission_count == 1
    assert chain.milestone(project_id, 1).submission_count == 1

    before = snapshot(chain, project_id, [first_id, second_id])
    with pytest.raises(Revert, match="project is not active"):
        chain.call("expire_milestone", project_id, 1, sender=STRANGER)
    assert snapshot(chain, project_id, [first_id, second_id]) == before


def test_open_milestone_expires_permissionlessly_at_deadline_and_replay_is_safe(chain):
    chain.set_now(1_800_000_000)
    project_id = create_one_milestone_project(chain, deadline=1_800_001_000)
    before = snapshot(chain, project_id, [])

    chain.set_now(1_800_000_999)
    with pytest.raises(Revert, match="milestone deadline has not elapsed"):
        chain.call("expire_milestone", project_id, 0, sender=STRANGER)
    assert snapshot(chain, project_id, []) == before

    chain.set_now(1_800_001_000)
    chain.call("expire_milestone", project_id, 0, sender=STRANGER)
    assert chain.milestone(project_id, 0).state == FAILED_MILESTONE
    assert chain.milestone(project_id, 0).submission_count == 0
    assert chain.project(project_id).status == FAILED
    assert chain.project(project_id).current_milestone == 0

    before = snapshot(chain, project_id, [])
    with pytest.raises(Revert, match="project is not active"):
        chain.call("expire_milestone", project_id, 0, sender=STRANGER)
    assert snapshot(chain, project_id, []) == before


def test_information_request_expires_permissionlessly_at_fixed_window(chain):
    chain.set_now(1_800_000_000)
    project_id = create_one_milestone_project(chain, deadline=1_800_000_500)
    submission_id = chain.submit(project_id, evidence(COMMIT_1, 1_800_000_000), "first")
    resolve_as(chain, submission_id, "REQUEST_MORE_INFO", now=1_800_000_100)
    before = snapshot(chain, project_id, [submission_id])

    chain.set_now(1_800_000_100 + INFO_WINDOW - 1)
    with pytest.raises(Revert, match="information window has not elapsed"):
        chain.call("expire_milestone", project_id, 0, sender=STRANGER)
    assert snapshot(chain, project_id, [submission_id]) == before

    chain.set_now(1_800_000_100 + INFO_WINDOW)
    chain.call("expire_milestone", project_id, 0, sender=STRANGER)
    assert chain.submission(submission_id).verdict == REQUEST_MORE_INFO
    assert chain.submission(submission_id).resolution_count == 1
    assert chain.milestone(project_id, 0).state == FAILED_MILESTONE
    assert chain.milestone(project_id, 0).submission_count == 1
    assert chain.project(project_id).status == FAILED
    assert chain.project(project_id).current_milestone == 0

    before = snapshot(chain, project_id, [submission_id])
    with pytest.raises(Revert, match="project is not active"):
        chain.call("expire_milestone", project_id, 0, sender=STRANGER)
    assert snapshot(chain, project_id, [submission_id]) == before


def test_terminal_and_noncurrent_milestones_reject_expiry_without_mutation(chain, valid_milestones):
    chain.set_now(1_800_000_000)
    project_id = chain.create_project(valid_milestones[:2])
    before = snapshot(chain, project_id, [])

    chain.set_now(1_900_100_000)
    with pytest.raises(Revert, match="milestone is not current"):
        chain.call("expire_milestone", project_id, 1, sender=STRANGER)
    assert snapshot(chain, project_id, []) == before


def test_lifecycle_events_are_emitted_only_after_coherent_storage(monkeypatch, chain):
    observed = []
    runtime_emit = GL.Event.emit

    def inspect_then_emit(event):
        name = type(event).name
        payload = event._blob
        if name == "ProjectCreated":
            assert chain.project(payload["project_id"]).status == ACTIVE
            assert chain.contract.project_count == payload["project_id"]
        elif name == "EvidenceSubmitted":
            milestone = chain.milestone(
                payload["project_id"], int(payload["milestone_index"])
            )
            assert milestone.state == SUBMITTED
            assert milestone.current_submission_id == payload["submission_id"]
            assert chain.submission(payload["submission_id"]).revision == payload["revision"]
        elif name == "SubmissionResolved":
            submission = chain.submission(payload["submission_id"])
            assert submission.verdict == payload["verdict"]
            assert submission.resolution_count == payload["resolution_count"]
        elif name == "EvidenceSupplemented":
            milestone = chain.milestone(
                payload["project_id"], int(payload["milestone_index"])
            )
            assert milestone.current_submission_id == payload["submission_id"]
            assert chain.submission(payload["prior_submission_id"]).verdict == REQUEST_MORE_INFO
        elif name == "MilestoneOpened":
            assert chain.milestone(
                payload["project_id"], int(payload["milestone_index"])
            ).state == OPEN
        elif name == "MilestoneExpired":
            assert chain.milestone(
                payload["project_id"], int(payload["milestone_index"])
            ).state == FAILED_MILESTONE
            assert chain.project(payload["project_id"]).status == FAILED
        elif name == "ProjectCompleted":
            assert chain.project(payload["project_id"]).status == COMPLETED
        observed.append(name)
        runtime_emit(event)

    monkeypatch.setattr(GL.Event, "emit", inspect_then_emit)
    chain.set_now(1_800_000_000)

    approved_project = create_one_milestone_project(chain)
    approved_id = chain.submit(
        approved_project, evidence(COMMIT_1, 1_800_000_000), "approved"
    )
    resolve_as(chain, approved_id, "APPROVED", now=1_800_000_100)

    chain.set_now(1_800_001_000)
    supplemented_project = create_one_milestone_project(chain, nonce="event-info")
    info_id = chain.submit(
        supplemented_project,
        evidence(COMMIT_1, 1_800_001_000),
        "info",
    )
    resolve_as(chain, info_id, "REQUEST_MORE_INFO", now=1_800_001_100)
    chain.set_now(1_800_001_200)
    chain.call(
        "supplement_evidence",
        info_id,
        evidence(COMMIT_2, 1_800_001_200),
        "info-supplement",
        sender=BUILDER,
    )

    chain.set_now(1_800_002_000)
    expired_project = create_one_milestone_project(
        chain, deadline=1_800_002_100, nonce="event-expiry"
    )
    chain.set_now(1_800_002_100)
    chain.call("expire_milestone", expired_project, 0, sender=STRANGER)

    assert set(observed) == {
        "ProjectCreated",
        "EvidenceSubmitted",
        "SubmissionResolved",
        "EvidenceSupplemented",
        "MilestoneOpened",
        "MilestoneExpired",
        "ProjectCompleted",
    }
