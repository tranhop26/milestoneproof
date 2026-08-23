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


class Chain:
    def __init__(self) -> None:
        GL.clear_runtime()
        GL.set_sender(SPONSOR)
        self.contract = CONTRACT_MODULE.MilestoneProof()

    def call(self, method: str, *args, sender=SPONSOR):
        GL.set_sender(sender)
        return getattr(self.contract, method)(*args)


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
        }
    ]
