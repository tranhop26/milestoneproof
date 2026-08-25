from conftest import CONTRACT_MODULE, GL


EXPECTED_PUBLIC_WRITES = {
    "create_project",
    "submit_evidence",
    "resolve_submission",
    "resubmit_evidence",
    "supplement_evidence",
    "retry_resolution",
    "expire_milestone",
}
PROHIBITED_MUTATION_NAMES = (
    "owner",
    "admin",
    "upgrade",
    "replace",
    "set_code",
    "set_criteria",
)
EVENT_NAMES = (
    "ProjectCreated",
    "EvidenceSubmitted",
    "SubmissionResolved",
    "EvidenceSupplemented",
    "MilestoneOpened",
    "MilestoneExpired",
    "ProjectCompleted",
)


def test_frozen_contract_exposes_exactly_the_seven_designed_writes():
    public_writes = {
        name
        for name in dir(CONTRACT_MODULE.MilestoneProof)
        if getattr(
            getattr(CONTRACT_MODULE.MilestoneProof, name),
            "__genlayer_write__",
            False,
        )
    }

    assert public_writes == EXPECTED_PUBLIC_WRITES


def test_frozen_contract_has_no_privileged_recovery_or_criteria_mutation_name():
    public_writes = {
        name.lower()
        for name in dir(CONTRACT_MODULE.MilestoneProof)
        if getattr(
            getattr(CONTRACT_MODULE.MilestoneProof, name),
            "__genlayer_write__",
            False,
        )
    }

    for prohibited in PROHIBITED_MUTATION_NAMES:
        assert all(prohibited not in method for method in public_writes)


def test_events_use_the_pinned_genvm_event_class_api():
    for name in EVENT_NAMES:
        event_class = getattr(CONTRACT_MODULE, name)
        assert issubclass(event_class, GL.Event)
