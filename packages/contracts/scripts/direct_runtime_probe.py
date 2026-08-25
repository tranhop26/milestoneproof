from __future__ import annotations

import os
import sys
from pathlib import Path

from gltest.direct import VMContext, create_address, deploy_contract
import gltest.direct.loader as loader


def _inject_message_with_pipe(vm: VMContext) -> None:
    from genlayer.py import calldata
    from genlayer.py.types import Address

    def address(value):
        return str(Address(value)) if isinstance(value, bytes) else str(value)

    encoded = calldata.encode({
        "contract_address": address(vm._contract_address),
        "sender_address": address(vm.sender),
        "origin_address": address(vm.origin),
        "stack": [],
        "value": vm._value,
        "datetime": vm._datetime,
        "is_init": False,
        "chain_id": vm._chain_id,
        "entry_kind": 0,
        "entry_data": b"",
        "entry_stage_data": None,
    })
    read_fd, write_fd = os.pipe()
    os.write(write_fd, encoded)
    os.close(write_fd)
    vm._original_stdin_fd = os.dup(0)
    os.dup2(read_fd, 0)
    os.close(read_fd)


def main() -> None:
    sponsor = create_address("milestoneproof-probe-sponsor")
    builder = create_address("milestoneproof-probe-builder")
    vm = VMContext(_sender=sponsor)
    vm.warp("2030-03-17T17:46:40Z")
    for module_name in list(sys.modules):
        if module_name == "genlayer" or module_name.startswith("genlayer."):
            sys.modules.pop(module_name, None)
    loader._inject_message_to_fd0 = _inject_message_with_pipe
    contract = deploy_contract(
        Path(__file__).resolve().parents[1] / "milestoneproof.py",
        vm,
        sdk_version="v0.3.0-rc7",
    )
    from genlayer import Address

    builder = Address(builder)
    builder_calldata = str(builder)
    project_id = contract.create_project(
        builder_calldata,
        "Runtime probe",
        "Exercise the production SDK storage and timestamp paths.",
        [{
            "title": "Probe",
            "criteria": ["Direct runtime creates and reads a project"],
            "allowed_sources": ["REPOSITORY"],
            "deadline": 2_000_000_000,
        }],
        "runtime-probe-1",
    )
    project = contract.get_project(project_id)
    if int(project[1]) != int(project_id):
        raise AssertionError("project readback mismatch")
    if int(contract.get_builder_project_count(builder_calldata)) != 1:
        raise AssertionError("string address readback mismatch")
    milestone = contract.get_milestone(project_id, 0)
    with vm.prank(builder):
        submission_id = contract.submit_evidence(
            project_id,
            0,
            [[
                "REPOSITORY",
                "https://github.com/genlayerlabs/genlayer-js/commit/573e6bbc9c3aa7d3e40c37505d0a83a1ab1182c1",
                "github.com/genlayerlabs/genlayer-js",
                "573e6bbc9c3aa7d3e40c37505d0a83a1ab1182c1",
                int(milestone[8]),
            ]],
            "runtime-probe-evidence-1",
        )
    submission = contract.get_submission(submission_id)
    if int(submission[1]) != int(submission_id):
        raise AssertionError("submission readback mismatch")
    print(f"Direct runtime project/submission: {int(project_id)}/{int(submission_id)}")


if __name__ == "__main__":
    main()
