from __future__ import annotations

from dataclasses import dataclass

import genlayer as gl
from genlayer import DynArray, TreeMap, u8, u64, u256


SCHEMA_VERSION = 1
MAX_MILESTONES = 3
MAX_SUBMISSION_ATTEMPTS = 3
MAX_EVIDENCE_ITEMS = 4
MAX_RESOLUTION_ATTEMPTS = 3
INFO_WINDOW_SECONDS = 72 * 60 * 60
MAX_PAGE_SIZE = 50
MAX_PROJECT_TITLE_LENGTH = 120
MAX_PROJECT_DESCRIPTION_LENGTH = 2_000
MAX_MILESTONE_TITLE_LENGTH = 120
MAX_CRITERIA_PER_MILESTONE = 10
MAX_CRITERION_LENGTH = 500
MAX_ALLOWED_SOURCES = 4
MAX_SOURCE_LENGTH = 32
MAX_CLIENT_NONCE_LENGTH = 128
ALLOWED_SOURCE_KINDS = ("REPOSITORY", "RELEASE", "CI", "DEPLOYMENT")

ZERO_ADDRESS = gl.Address("0x0000000000000000000000000000000000000000")

ACTIVE = u8(0)
COMPLETED = u8(1)
FAILED = u8(2)

LOCKED = u8(0)
OPEN = u8(1)
SUBMITTED = u8(2)
APPROVED_MILESTONE = u8(3)
FAILED_MILESTONE = u8(4)

NONE = u8(0)
APPROVED = u8(1)
REJECTED = u8(2)
REQUEST_MORE_INFO = u8(3)
UNRESOLVED = u8(4)


@gl.allow_storage
@dataclass
class Project:
    sponsor: gl.Address
    builder: gl.Address
    title: str
    description: str
    status: u8
    current_milestone: u8
    created_at: u64
    milestone_count: u8


@gl.allow_storage
@dataclass
class Milestone:
    title: str
    criteria: DynArray[str]
    allowed_sources: DynArray[str]
    deadline: u64
    state: u8
    opened_at: u64
    submission_count: u8
    current_submission_id: u256


@gl.allow_storage
@dataclass
class Evidence:
    source_kind: str
    url: str
    subject_ref: str
    version_ref: str
    observed_at: u64


@gl.allow_storage
@dataclass
class Submission:
    project_id: u256
    milestone_index: u8
    revision: u8
    verdict: u8


class MilestoneProof(gl.Contract):
    project_count: u256
    projects: TreeMap
    milestones: TreeMap
    sponsor_project_ids: TreeMap
    builder_project_ids: TreeMap
    sponsor_nonces: TreeMap

    def __init__(self):
        self.project_count = u256(0)
        self.projects = TreeMap()
        self.milestones = TreeMap()
        self.sponsor_project_ids = TreeMap()
        self.builder_project_ids = TreeMap()
        self.sponsor_nonces = TreeMap()

    @gl.public.view
    def get_config(self) -> list:
        return [0, MAX_MILESTONES, MAX_SUBMISSION_ATTEMPTS, MAX_EVIDENCE_ITEMS, MAX_RESOLUTION_ATTEMPTS, INFO_WINDOW_SECONDS]

    @gl.public.view
    def get_project_count(self) -> u256:
        return self.project_count

    @gl.public.write
    def create_project(self, builder: gl.Address, title: str, description: str, milestones: list, client_nonce: str) -> u256:
        sponsor = gl.message.sender_address
        self._validate_project_input(sponsor, builder, title, description, milestones, client_nonce)
        nonce_key = self._sponsor_nonce_key(sponsor, client_nonce)
        if self.sponsor_nonces.get(nonce_key, False):
            raise gl.UserError("nonce already used")

        now = u64(gl.message_raw.datetime)
        frozen_milestones = DynArray()
        for index, definition in enumerate(milestones):
            frozen_milestones.append(self._freeze_milestone(definition, index, now))

        project_id = u256(int(self.project_count) + 1)
        self.projects[project_id] = Project(sponsor, builder, title, description, ACTIVE, u8(0), now, u8(len(frozen_milestones)))
        self.milestones[project_id] = frozen_milestones
        self._append_project_id(self.sponsor_project_ids, sponsor, project_id)
        self._append_project_id(self.builder_project_ids, builder, project_id)
        self.sponsor_nonces[nonce_key] = True
        self.project_count = project_id
        return project_id

    @gl.public.view
    def get_project(self, project_id: u256) -> list:
        project = self._project_or_revert(project_id)
        return [SCHEMA_VERSION, project_id, project.sponsor, project.builder, project.title, project.description, project.status, project.current_milestone, project.created_at, project.milestone_count]

    @gl.public.view
    def get_milestone(self, project_id: u256, index: u8) -> list:
        self._project_or_revert(project_id)
        milestone = self._milestone_or_revert(project_id, index)
        return [SCHEMA_VERSION, project_id, index, milestone.title, list(milestone.criteria), list(milestone.allowed_sources), milestone.deadline, milestone.state, milestone.opened_at, milestone.submission_count, milestone.current_submission_id]

    @gl.public.view
    def get_sponsor_project_count(self, sponsor: gl.Address) -> u256:
        return u256(len(self.sponsor_project_ids.get(sponsor, DynArray())))

    @gl.public.view
    def get_builder_project_count(self, builder: gl.Address) -> u256:
        return u256(len(self.builder_project_ids.get(builder, DynArray())))

    @gl.public.view
    def get_sponsor_project_ids(self, sponsor: gl.Address, offset: u256, limit: u8) -> list:
        return self._project_id_page(self.sponsor_project_ids.get(sponsor, DynArray()), offset, limit)

    @gl.public.view
    def get_builder_project_ids(self, builder: gl.Address, offset: u256, limit: u8) -> list:
        return self._project_id_page(self.builder_project_ids.get(builder, DynArray()), offset, limit)

    def _validate_project_input(self, sponsor: gl.Address, builder: gl.Address, title: str, description: str, milestones: list, client_nonce: str) -> None:
        if sponsor == ZERO_ADDRESS:
            raise gl.UserError("sponsor is required")
        if builder == ZERO_ADDRESS:
            raise gl.UserError("builder is required")
        if builder == sponsor:
            raise gl.UserError("sponsor cannot be builder")
        self._validate_required_text(title, MAX_PROJECT_TITLE_LENGTH, "project title")
        self._validate_required_text(description, MAX_PROJECT_DESCRIPTION_LENGTH, "project description")
        self._validate_required_text(client_nonce, MAX_CLIENT_NONCE_LENGTH, "client nonce")
        if not isinstance(milestones, list):
            raise gl.UserError("milestones must be a list")
        if not milestones:
            raise gl.UserError("at least one milestone is required")
        if len(milestones) > MAX_MILESTONES:
            raise gl.UserError("too many milestones")
        for definition in milestones:
            self._validate_milestone_definition(definition)

    def _validate_milestone_definition(self, definition: dict) -> None:
        if not isinstance(definition, dict):
            raise gl.UserError("milestone must be an object")
        self._validate_required_text(definition.get("title"), MAX_MILESTONE_TITLE_LENGTH, "milestone title")
        criteria = definition.get("criteria")
        if not isinstance(criteria, list) or not criteria:
            raise gl.UserError("criterion is required")
        if len(criteria) > MAX_CRITERIA_PER_MILESTONE:
            raise gl.UserError("too many criteria")
        for criterion in criteria:
            self._validate_required_text(criterion, MAX_CRITERION_LENGTH, "criterion")
        allowed_sources = definition.get("allowed_sources")
        if not isinstance(allowed_sources, list) or not allowed_sources:
            raise gl.UserError("allowed source is required")
        if len(allowed_sources) > MAX_ALLOWED_SOURCES:
            raise gl.UserError("too many allowed sources")
        for source in allowed_sources:
            self._validate_required_text(source, MAX_SOURCE_LENGTH, "allowed source")
            if source not in ALLOWED_SOURCE_KINDS:
                raise gl.UserError("invalid allowed source")
        deadline = definition.get("deadline")
        if not isinstance(deadline, int) or deadline <= gl.message_raw.datetime:
            raise gl.UserError("deadline must be in the future")

    def _freeze_milestone(self, definition: dict, index: int, now: u64) -> Milestone:
        criteria = DynArray()
        criteria.extend(definition["criteria"])
        allowed_sources = DynArray()
        allowed_sources.extend(definition["allowed_sources"])
        state = OPEN if index == 0 else LOCKED
        return Milestone(definition["title"], criteria, allowed_sources, u64(definition["deadline"]), state, now if state == OPEN else u64(0), u8(0), u256(0))

    def _validate_required_text(self, value: str, maximum: int, field: str) -> None:
        if not isinstance(value, str) or not value:
            raise gl.UserError(f"{field} is required")
        if len(value) > maximum:
            raise gl.UserError(f"{field} too long")

    def _project_or_revert(self, project_id: u256) -> Project:
        project = self.projects.get(project_id)
        if project is None:
            raise gl.UserError("project not found")
        return project

    def _milestone_or_revert(self, project_id: u256, index: u8) -> Milestone:
        project_milestones = self.milestones[project_id]
        if int(index) < 0 or int(index) >= len(project_milestones):
            raise gl.UserError("milestone not found")
        return project_milestones[int(index)]

    def _append_project_id(self, index: TreeMap, actor: gl.Address, project_id: u256) -> None:
        actor_projects = index.get(actor)
        if actor_projects is None:
            actor_projects = DynArray()
            index[actor] = actor_projects
        actor_projects.append(project_id)

    def _project_id_page(self, project_ids: DynArray, offset: u256, limit: u8) -> list:
        if int(limit) < 1 or int(limit) > MAX_PAGE_SIZE:
            raise gl.UserError("page size must be between 1 and 50")
        if int(offset) < 0:
            raise gl.UserError("page offset must be non-negative")
        total = len(project_ids)
        start = int(offset)
        stop = min(start + int(limit), total)
        page = []
        for position in range(start, stop):
            page.append(project_ids[total - position - 1])
        return page

    def _sponsor_nonce_key(self, sponsor: gl.Address, client_nonce: str) -> str:
        return f"{sponsor}:{client_nonce}"
