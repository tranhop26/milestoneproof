import pytest

from conftest import BUILDER, GL, Revert, SPONSOR, STRANGER


COMMIT = "0123456789abcdef0123456789abcdef01234567"


def test_detail_views_reject_missing_ids(chain, valid_milestones):
    chain.create_project(valid_milestones)

    with pytest.raises(Revert, match="project not found"):
        chain.call("get_project", 999)
    with pytest.raises(Revert, match="project not found"):
        chain.call("get_milestone", 999, 0)
    with pytest.raises(Revert, match="milestone not found"):
        chain.call("get_milestone", 1, 99)
    with pytest.raises(Revert, match="submission not found"):
        chain.call("get_submission", 999)


@pytest.mark.parametrize("method", ["get_sponsor_project_ids", "get_builder_project_ids"])
@pytest.mark.parametrize("limit", [0, 51])
def test_actor_index_views_reject_out_of_bounds_page_sizes(chain, method, limit):
    with pytest.raises(Revert, match="page size must be between 1 and 50"):
        chain.call(method, SPONSOR, 0, limit)


def test_actor_index_views_are_newest_first_with_stable_offset_pagination(chain, valid_milestones):
    chain.create_project(valid_milestones, nonce="one", sender=SPONSOR)
    chain.create_project(valid_milestones, nonce="two", sender=SPONSOR)
    chain.create_project(valid_milestones, nonce="three", sender=STRANGER)

    assert chain.call("get_sponsor_project_ids", SPONSOR, 0, 1) == [2]
    assert chain.call("get_sponsor_project_ids", SPONSOR, 1, 50) == [1]
    assert chain.call("get_builder_project_ids", BUILDER, 0, 2) == [3, 2]
    assert chain.call("get_builder_project_ids", BUILDER, 2, 50) == [1]
    assert chain.call("get_builder_project_ids", BUILDER, 3, 50) == []


def test_versioned_detail_views_have_exact_bounded_field_shapes(chain, valid_milestones):
    project_id = chain.create_project(valid_milestones)
    submission_id = chain.submit(project_id, [[
        "REPOSITORY",
        f"https://github.com/acme/milestoneproof/commit/{COMMIT}",
        "github.com/acme/milestoneproof",
        COMMIT,
        0,
    ]], "submission")

    project = chain.call("get_project", project_id)
    milestone = chain.call("get_milestone", project_id, 0)
    submission = chain.call("get_submission", submission_id)

    assert len(project) == 10
    assert project[0] == 1
    assert [type(value) for value in project] == [
        int,
        GL.u256,
        type(SPONSOR),
        type(BUILDER),
        str,
        str,
        GL.u8,
        GL.u8,
        GL.u64,
        GL.u8,
    ]

    assert len(milestone) == 11
    assert milestone[0] == 1
    assert [type(value) for value in milestone] == [
        int,
        GL.u256,
        GL.u8,
        str,
        list,
        list,
        GL.u64,
        GL.u8,
        GL.u64,
        GL.u8,
        GL.u256,
    ]
    assert len(milestone[4]) <= 10
    assert len(milestone[5]) <= 4

    assert len(submission) == 20
    assert submission[0] == 1
    assert [type(value) for value in submission] == [
        int,
        GL.u256,
        GL.u256,
        GL.u8,
        GL.u8,
        GL.u8,
        type(BUILDER),
        GL.u64,
        list,
        GL.u256,
        list,
        list,
        bool,
        bool,
        bool,
        bool,
        str,
        GL.u64,
        GL.u8,
        GL.u64,
    ]
    assert len(submission[8]) == 1
    assert len(submission[8]) <= 4
    assert len(submission[8][0]) == 5
    assert [type(value) for value in submission[8][0]] == [
        str,
        str,
        str,
        str,
        GL.u64,
    ]
    assert submission[9] == submission_id
    assert submission[18] == 0
    assert submission[19] == 0
