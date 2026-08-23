from copy import deepcopy

import genlayer as gl
import pytest

from conftest import BUILDER, Revert, SPONSOR, STRANGER, ZERO_ADDRESS


ACTIVE = 0
LOCKED = 0
OPEN = 1


class DirectIndexOnlyArray(gl.DynArray):
    def __init__(self, values):
        super().__init__(values)
        self.index_reads = []

    def __reversed__(self):
        raise AssertionError("actor pagination must not reverse the full index")

    def __getitem__(self, index):
        self.index_reads.append(index)
        return super().__getitem__(index)


def test_contract_starts_empty(chain):
    assert chain.contract.get_config() == [0, 3, 3, 4, 3, 72 * 60 * 60]
    assert chain.contract.get_project_count() == 0


def test_runtime_message_sender_accessor_tracks_writes(chain):
    replacement = gl.Address("0x4000000000000000000000000000000000000004")
    another = gl.Address("0x5000000000000000000000000000000000000005")

    assert gl.message.sender_address == gl.Address("0x1000000000000000000000000000000000000001")

    gl.message.sender_address = replacement

    assert gl.message.sender_address == replacement

    gl.set_sender(another)

    assert gl.message.sender_address == another


def test_runtime_message_raw_datetime_accessor_tracks_writes(chain):
    assert gl.message_raw["datetime"] == "1970-01-01T00:00:00Z"

    gl.message_raw["datetime"] = "2030-03-17T17:48:43Z"

    assert gl.message_raw["datetime"] == "2030-03-17T17:48:43Z"

    gl.set_now(1_900_000_456)

    assert gl.message_raw["datetime"] == "2030-03-17T17:54:16Z"


def test_sponsor_creates_frozen_three_milestone_project(chain, valid_milestones):
    project_id = chain.call(
        "create_project",
        BUILDER,
        "Release grant",
        "Ship a verified MVP",
        valid_milestones,
        "grant-001",
        sender=SPONSOR,
    )

    assert int(project_id) == 1
    assert chain.project(1).sponsor == SPONSOR
    assert chain.project(1).builder == BUILDER
    assert chain.project(1).status == ACTIVE
    assert chain.milestone(1, 0).state == OPEN
    assert chain.milestone(1, 1).state == LOCKED
    assert chain.milestone(1, 2).state == LOCKED


def test_created_project_and_milestone_views_have_versioned_frozen_shapes(chain, valid_milestones):
    chain.create_project(valid_milestones)

    assert chain.call("get_project", 1) == [
        1,
        1,
        SPONSOR,
        BUILDER,
        "Release grant",
        "Ship a verified MVP",
        ACTIVE,
        0,
        0,
        3,
    ]
    assert chain.call("get_milestone", 1, 0) == [
        1,
        1,
        0,
        "Ship contract shell",
        ["Contract returns the frozen config"],
        ["REPOSITORY"],
        1_900_000_000,
        OPEN,
        0,
        0,
        0,
    ]


def test_reused_sponsor_nonce_reverts(chain, valid_milestones):
    chain.create_project(valid_milestones, nonce="grant-001")

    with pytest.raises(Revert, match="nonce already used"):
        chain.create_project(valid_milestones, nonce="grant-001")


def test_sponsor_nonce_domain_does_not_block_another_sponsor(chain, valid_milestones):
    chain.create_project(valid_milestones, nonce="grant-001", sender=SPONSOR)

    second_project_id = chain.create_project(valid_milestones, nonce="grant-001", sender=STRANGER)

    assert int(second_project_id) == 2
    assert chain.project(2).sponsor == STRANGER


@pytest.mark.parametrize(
    ("builder", "sender", "error"),
    [
        (ZERO_ADDRESS, SPONSOR, "builder is required"),
        (SPONSOR, SPONSOR, "sponsor cannot be builder"),
    ],
)
def test_create_project_rejects_invalid_builder(chain, valid_milestones, builder, sender, error):
    with pytest.raises(Revert, match=error):
        chain.call(
            "create_project",
            builder,
            "Release grant",
            "Ship a verified MVP",
            valid_milestones,
            "grant-001",
            sender=sender,
        )


@pytest.mark.parametrize(
    ("title", "description", "nonce", "error"),
    [
        ("", "Ship a verified MVP", "grant-001", "project title is required"),
        ("x" * 121, "Ship a verified MVP", "grant-001", "project title too long"),
        ("Release grant", "", "grant-001", "project description is required"),
        ("Release grant", "x" * 2001, "grant-001", "project description too long"),
        ("Release grant", "Ship a verified MVP", "", "client nonce is required"),
        ("Release grant", "Ship a verified MVP", "x" * 129, "client nonce too long"),
    ],
)
def test_create_project_rejects_invalid_project_fields(
    chain, valid_milestones, title, description, nonce, error
):
    with pytest.raises(Revert, match=error):
        chain.call("create_project", BUILDER, title, description, valid_milestones, nonce)


@pytest.mark.parametrize(
    ("milestones", "error"),
    [
        ([], "at least one milestone is required"),
        ([{"title": "One", "criteria": ["A"], "allowed_sources": ["REPOSITORY"], "deadline": 1}] * 4, "too many milestones"),
        ([{"title": "One", "criteria": ["A"], "allowed_sources": ["REPOSITORY"], "deadline": 0}], "deadline must be in the future"),
        ([{"title": "One", "criteria": ["A"], "allowed_sources": ["REPOSITORY"], "deadline": 1_899_999_998}], "deadline must be in the future"),
        ([{"title": "One", "criteria": [], "allowed_sources": ["REPOSITORY"], "deadline": 1}], "criterion is required"),
    ],
)
def test_create_project_rejects_invalid_milestone_definitions(chain, milestones, error):
    gl.set_now(1_900_000_000)

    with pytest.raises(Revert, match=error):
        chain.create_project(milestones)


def test_create_project_rejects_invalid_source_kind_before_mutating_registry(chain, valid_milestones):
    invalid_milestones = deepcopy(valid_milestones)
    invalid_milestones[1]["allowed_sources"] = ["INTERNAL_API"]

    with pytest.raises(Revert, match="invalid allowed source"):
        chain.create_project(invalid_milestones, nonce="grant-001")

    assert chain.call("get_project_count") == 0
    assert chain.call("get_sponsor_project_count", SPONSOR) == 0
    assert chain.call("get_builder_project_count", BUILDER) == 0
    assert chain.create_project(valid_milestones, nonce="grant-001") == 1


def test_creation_copies_milestone_definitions_so_inputs_cannot_mutate_records(chain, valid_milestones):
    input_milestones = deepcopy(valid_milestones)
    chain.create_project(input_milestones)

    input_milestones[0]["criteria"][0] = "Rewritten after creation"
    input_milestones[0]["allowed_sources"][0] = "CI"
    input_milestones[0]["title"] = "Rewritten title"

    assert chain.call("get_milestone", 1, 0) == [
        1,
        1,
        0,
        "Ship contract shell",
        ["Contract returns the frozen config"],
        ["REPOSITORY"],
        1_900_000_000,
        OPEN,
        0,
        0,
        0,
    ]


def test_actor_project_indexes_are_newest_first_and_page_capped(chain, valid_milestones):
    chain.create_project(valid_milestones, nonce="grant-001", sender=SPONSOR)
    chain.create_project(valid_milestones, nonce="grant-002", sender=SPONSOR)
    chain.create_project(valid_milestones, nonce="grant-003", sender=STRANGER)

    assert chain.call("get_sponsor_project_count", SPONSOR) == 2
    assert chain.call("get_builder_project_count", BUILDER) == 3
    assert chain.call("get_sponsor_project_ids", SPONSOR, 0, 50) == [2, 1]
    assert chain.call("get_builder_project_ids", BUILDER, 1, 2) == [2, 1]
    with pytest.raises(Revert, match="page size must be between 1 and 50"):
        chain.call("get_sponsor_project_ids", SPONSOR, 0, 51)


def test_actor_project_page_reads_only_requested_reverse_region(chain):
    actor_projects = DirectIndexOnlyArray([1, 2, 3, 4, 5])
    chain.contract.sponsor_project_ids[SPONSOR] = actor_projects

    assert chain.call("get_sponsor_project_ids", SPONSOR, 1, 2) == [4, 3]
    assert actor_projects.index_reads == [3, 2]


def test_unknown_mutation_method_does_not_exist(chain):
    with pytest.raises(AttributeError):
        chain.call("set_project_title", 1, "rewritten", sender=SPONSOR)
