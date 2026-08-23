from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest


TESTS_DIR = Path(__file__).resolve().parent
STUB_PATH = TESTS_DIR / "_stubs" / "genlayer.py"
CONTRACT_PATH = TESTS_DIR.parent / "milestoneproof.py"


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"unable to load module {name} from {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


GL = _load_module("genlayer", STUB_PATH)
sys.modules["genlayer"] = GL
CONTRACT_MODULE = _load_module("milestoneproof", CONTRACT_PATH)

SPONSOR = GL.Address("0x1000000000000000000000000000000000000001")
BUILDER = GL.Address("0x2000000000000000000000000000000000000002")
STRANGER = GL.Address("0x3000000000000000000000000000000000000003")
OTHER_BUILDER = GL.Address("0x4000000000000000000000000000000000000004")
ZERO_ADDRESS = GL.Address("0x0000000000000000000000000000000000000000")
Revert = GL.UserError
COMPLETED = CONTRACT_MODULE.COMPLETED
OPEN = CONTRACT_MODULE.OPEN
SUBMITTED = CONTRACT_MODULE.SUBMITTED


class Chain:
    def __init__(self) -> None:
        GL.clear_runtime()
        self.chain_id = 61999
        self.contract_address = GL.Address("0xc000000000000000000000000000000000000001")
        GL.set_chain_id(self.chain_id)
        GL.set_contract_address(self.contract_address)
        GL.set_sender(SPONSOR)
        self.contract = CONTRACT_MODULE.MilestoneProof()

    def call(self, method: str, *args, sender=SPONSOR):
        GL.set_chain_id(self.chain_id)
        GL.set_contract_address(self.contract_address)
        GL.set_sender(sender)
        return getattr(self.contract, method)(*args)

    def create_project(self, milestones, nonce="grant-001", sender=SPONSOR, builder=BUILDER):
        return self.call(
            "create_project",
            builder,
            "Release grant",
            "Ship a verified MVP",
            milestones,
            nonce,
            sender=sender,
        )

    def project(self, project_id):
        return self.contract.projects[project_id]

    def milestone(self, project_id, index):
        return self.contract.milestones[project_id][index]

    def submission(self, digest):
        return self.contract.submissions[digest]

    def set_now(self, timestamp):
        GL.set_now(timestamp)

    def set_chain_id(self, chain_id):
        self.chain_id = chain_id
        GL.set_chain_id(chain_id)

    def set_contract_address(self, contract_address):
        self.contract_address = GL.Address(contract_address)
        GL.set_contract_address(contract_address)

    def submit(self, project_id, evidence, nonce, milestone_index=0, sender=BUILDER):
        return self.call("submit_evidence", project_id, milestone_index, evidence, nonce, sender=sender)


@pytest.fixture
def chain() -> Chain:
    return Chain()


@pytest.fixture
def valid_milestones():
    return [
        {
            "title": "Ship contract shell",
            "criteria": ["Contract returns the frozen config"],
            "allowed_sources": ["REPOSITORY"],
            "deadline": 1_900_000_000,
        },
        {
            "title": "Publish release",
            "criteria": ["Release has a complete changelog"],
            "allowed_sources": ["RELEASE"],
            "deadline": 1_900_100_000,
        },
        {
            "title": "Deploy MVP",
            "criteria": ["Deployment is publicly reachable"],
            "allowed_sources": ["DEPLOYMENT"],
            "deadline": 1_900_200_000,
        },
    ]


@pytest.fixture
def open_project(chain, valid_milestones):
    return chain.create_project(valid_milestones)


@pytest.fixture
def valid_evidence():
    return [[
        "REPOSITORY",
        "https://github.com/acme/milestoneproof/commit/0123456789abcdef0123456789abcdef01234567",
        "github.com/acme/milestoneproof",
        "0123456789abcdef0123456789abcdef01234567",
        0,
    ]]
