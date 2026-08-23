from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from ipaddress import ip_address
from urllib.parse import urlsplit

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
MAX_EVIDENCE_URL_LENGTH = 2_000
MAX_SUBJECT_REF_LENGTH = 255
MAX_VERSION_REF_LENGTH = 255
ALLOWED_SOURCE_KINDS = ("REPOSITORY", "RELEASE", "CI", "DEPLOYMENT")
COMMIT_SOURCE_KINDS = ("REPOSITORY", "CI")

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
    builder: gl.Address
    submitted_at: u64
    evidence: DynArray[Evidence]
    digest: u256


class MilestoneProof(gl.Contract):
    project_count: u256
    projects: TreeMap
    milestones: TreeMap
    sponsor_project_ids: TreeMap
    builder_project_ids: TreeMap
    sponsor_nonces: TreeMap
    submissions: TreeMap
    submission_nonces: TreeMap
    submission_action_keys: TreeMap

    def __init__(self):
        self.project_count = u256(0)
        self.projects = TreeMap()
        self.milestones = TreeMap()
        self.sponsor_project_ids = TreeMap()
        self.builder_project_ids = TreeMap()
        self.sponsor_nonces = TreeMap()
        self.submissions = TreeMap()
        self.submission_nonces = TreeMap()
        self.submission_action_keys = TreeMap()

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

    @gl.public.write
    def submit_evidence(self, project_id: u256, milestone_index: u8, evidence: list, client_nonce: str) -> u256:
        return self._submit_evidence(project_id, milestone_index, evidence, client_nonce)

    @gl.public.write
    def resubmit_evidence(self, project_id: u256, milestone_index: u8, evidence: list, client_nonce: str) -> u256:
        raise gl.UserError("resubmission is not available")

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

    def _submit_evidence(self, project_id: u256, milestone_index: u8, evidence: list, client_nonce: str) -> u256:
        builder = gl.message.sender_address
        submitted_at = u64(gl.message_raw.datetime)
        project = self._project_or_revert(project_id)
        milestone = self._milestone_or_revert(project_id, milestone_index)
        if project.status != ACTIVE:
            raise gl.UserError("project is not active")
        if builder != project.builder:
            raise gl.UserError("builder only")
        if milestone.state != OPEN:
            raise gl.UserError("milestone is not open")
        if submitted_at >= milestone.deadline:
            raise gl.UserError("milestone deadline has passed")
        if int(milestone.submission_count) >= MAX_SUBMISSION_ATTEMPTS:
            raise gl.UserError("submission attempts exhausted")
        self._validate_required_text(client_nonce, MAX_CLIENT_NONCE_LENGTH, "client nonce")
        nonce_key = self._submission_nonce_key(builder, client_nonce)
        if self.submission_nonces.get(nonce_key, False):
            raise gl.UserError("nonce already used")

        frozen_evidence = self._freeze_evidence(evidence, milestone, submitted_at)
        action_key = self._submission_action_key(project_id, milestone_index, builder, submitted_at, frozen_evidence)
        if self.submission_action_keys.get(action_key, False):
            raise gl.UserError("submission already exists")

        revision = u8(int(milestone.submission_count) + 1)
        digest = self._canonical_evidence_digest(project_id, milestone_index, revision, builder, submitted_at, frozen_evidence)
        if self.submissions.get(digest) is not None:
            raise gl.UserError("submission already exists")

        self.submissions[digest] = Submission(project_id, milestone_index, revision, NONE, builder, submitted_at, frozen_evidence, digest)
        self.submission_nonces[nonce_key] = True
        self.submission_action_keys[action_key] = True
        milestone.submission_count = revision
        milestone.current_submission_id = digest
        milestone.state = SUBMITTED
        return digest

    def _freeze_evidence(self, evidence: list, milestone: Milestone, submitted_at: u64) -> DynArray[Evidence]:
        if not isinstance(evidence, list) or not evidence:
            raise gl.UserError("evidence is required")
        if len(evidence) > MAX_EVIDENCE_ITEMS:
            raise gl.UserError("too many evidence items")

        frozen_evidence = DynArray()
        seen = TreeMap()
        for item in evidence:
            if not isinstance(item, list) or len(item) != 5:
                raise gl.UserError("evidence item must have five fields")
            source_kind, url, subject_ref, version_ref, observed_at = item
            if source_kind not in milestone.allowed_sources:
                raise gl.UserError("source kind is not allowed")
            self._validate_required_text(source_kind, MAX_SOURCE_LENGTH, "source kind")
            self._validate_url(url)
            self._validate_required_text(subject_ref, MAX_SUBJECT_REF_LENGTH, "subject reference")
            self._validate_required_text(version_ref, MAX_VERSION_REF_LENGTH, "version reference")
            canonical_version_ref = version_ref.lower() if source_kind in COMMIT_SOURCE_KINDS else version_ref
            if source_kind in COMMIT_SOURCE_KINDS and not self._is_full_git_commit(canonical_version_ref):
                raise gl.UserError("full git commit is required")
            if not isinstance(observed_at, int) or isinstance(observed_at, bool) or observed_at < milestone.opened_at:
                raise gl.UserError("evidence predates milestone")
            if observed_at > submitted_at:
                raise gl.UserError("evidence observation is in the future")
            tuple_key = self._length_prefixed([source_kind, subject_ref, canonical_version_ref])
            if seen.get(tuple_key, False):
                raise gl.UserError("duplicate evidence reference")
            seen[tuple_key] = True
            frozen_evidence.append(Evidence(source_kind, url, subject_ref, canonical_version_ref, u64(observed_at)))
        return frozen_evidence

    def _validate_url(self, url: str) -> None:
        if not isinstance(url, str) or not url or len(url) > MAX_EVIDENCE_URL_LENGTH or "\\" in url or any(ord(character) <= 32 or ord(character) >= 127 for character in url):
            raise gl.UserError("unsafe evidence URL")
        try:
            parsed = urlsplit(url)
            host = parsed.hostname
            port = parsed.port
        except ValueError:
            raise gl.UserError("unsafe evidence URL")
        if parsed.scheme != "https" or not parsed.netloc or not host or "@" in parsed.netloc or parsed.fragment or port not in (None, 443):
            raise gl.UserError("unsafe evidence URL")
        normalized_host = host.lower().rstrip(".")
        if not normalized_host or self._reserved_host(normalized_host):
            raise gl.UserError("unsafe evidence URL")
        try:
            numeric_host = ip_address(normalized_host)
        except ValueError:
            if self._looks_numeric_host(normalized_host) or not self._is_public_dns_name(normalized_host):
                raise gl.UserError("unsafe evidence URL")
            return
        if not numeric_host.is_global:
            raise gl.UserError("unsafe evidence URL")

    def _reserved_host(self, host: str) -> bool:
        if host in ("localhost", "metadata.google.internal", "metadata.azure.internal"):
            return True
        return host.endswith((".localhost", ".local", ".test", ".invalid", ".example", ".nip.io", ".sslip.io", ".xip.io", ".localtest.me", ".traefik.me"))

    def _looks_numeric_host(self, host: str) -> bool:
        return bool(host) and all(character.isdigit() or character == "." for character in host)

    def _is_public_dns_name(self, host: str) -> bool:
        labels = host.split(".")
        if len(labels) < 2:
            return False
        for label in labels:
            if not label or len(label) > 63 or label[0] == "-" or label[-1] == "-":
                return False
            if not all(character.isascii() and (character.isalnum() or character == "-") for character in label):
                return False
        return True

    def _is_full_git_commit(self, version_ref: str) -> bool:
        return len(version_ref) == 40 and all(character in "0123456789abcdef" for character in version_ref)

    def _canonical_evidence_digest(self, project_id: u256, milestone_index: u8, revision: u8, builder: gl.Address, submitted_at: u64, evidence: DynArray[Evidence]) -> u256:
        payload = self._canonical_payload(project_id, milestone_index, revision, builder, submitted_at, evidence)
        return u256(int(sha256(payload.encode("utf-8")).hexdigest(), 16))

    def _submission_action_key(self, project_id: u256, milestone_index: u8, builder: gl.Address, submitted_at: u64, evidence: DynArray[Evidence]) -> str:
        payload = self._canonical_payload(project_id, milestone_index, u8(0), builder, submitted_at, evidence)
        return sha256(payload.encode("utf-8")).hexdigest()

    def _canonical_payload(self, project_id: u256, milestone_index: u8, revision: u8, builder: gl.Address, submitted_at: u64, evidence: DynArray[Evidence]) -> str:
        fields = [str(gl.message.chain_id), str(gl.message.contract_address), str(project_id), str(milestone_index), str(revision), str(builder), str(submitted_at), str(len(evidence))]
        for item in evidence:
            fields.extend([item.source_kind, item.url, item.subject_ref, item.version_ref, str(item.observed_at)])
        return self._length_prefixed(fields)

    def _length_prefixed(self, fields: list[str]) -> str:
        return "".join(f"{len(field.encode('utf-8'))}:{field}" for field in fields)

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

    def _submission_nonce_key(self, builder: gl.Address, client_nonce: str) -> str:
        return f"{builder}:{client_nonce}"
