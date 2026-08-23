from __future__ import annotations

import genlayer as gl
from genlayer import u256


class MilestoneProof(gl.Contract):
    project_count: u256

    def __init__(self):
        self.project_count = u256(0)

    @gl.public.view
    def get_config(self) -> list:
        return [0, 3, 3, 4, 3, 72 * 60 * 60]

    @gl.public.view
    def get_project_count(self) -> u256:
        return self.project_count
