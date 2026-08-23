import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { EvidenceInput, MilestoneView, ProjectView, SubmissionView, Verdict } from "@milestoneproof/shared"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import type { MilestoneProofContract } from "../lib/contract"
import type { Eip1193Provider } from "../lib/genlayer"
import { WalletProvider } from "../lib/wallet"
import { SubmissionDetail } from "./SubmissionDetail"

const CONTRACT = "0xc000000000000000000000000000000000000001" as const
const SPONSOR = "0x1000000000000000000000000000000000000001" as const
const BUILDER = "0x2000000000000000000000000000000000000002" as const
const STRANGER = "0x3000000000000000000000000000000000000003" as const
const TX_HASH = `0x${"a".repeat(64)}` as `0x${string}`
const COMMIT = "0123456789abcdef0123456789abcdef01234567"
const INFO_WINDOW_SECONDS = 72 * 60 * 60

const EVIDENCE: EvidenceInput = {
  sourceKind: "REPOSITORY",
  url: `https://github.com/example/compiler/commit/${COMMIT}`,
  subjectRef: "github.com/example/compiler",
  versionRef: COMMIT,
  observedAt: "1800000100",
}

function project(overrides: Partial<ProjectView> = {}): ProjectView {
  return { schemaVersion: 1, id: "7", sponsor: SPONSOR, builder: BUILDER, title: "Compiler release", description: "Ship a verified compiler release", status: "ACTIVE", currentMilestone: 0, createdAt: "1800000000", milestoneCount: 1, ...overrides }
}

function milestone(overrides: Partial<MilestoneView> = {}): MilestoneView {
  return { schemaVersion: 1, projectId: "7", index: 0, title: "Release", criteria: ["Contract tests pass", "Release is tagged"], allowedSources: ["REPOSITORY", "RELEASE"], deadline: "1900000000", status: "SUBMITTED", openedAt: "1800000000", submissionCount: 1, currentSubmissionId: "88", ...overrides }
}

function submission(verdict: Verdict, overrides: Partial<SubmissionView> = {}): SubmissionView {
  return {
    schemaVersion: 2,
    id: "88",
    projectId: "7",
    milestoneIndex: 0,
    revision: 1,
    verdict,
    builder: BUILDER,
    submittedAt: "1800000200",
    evidence: [EVIDENCE],
    digest: "88",
    criteriaMet: verdict === "NONE" ? [] : [true, false],
    missingCriteria: verdict === "NONE" ? [] : [1],
    integrity: { subjectMatch: true, versionMatch: true, fresh: true, provenanceOk: verdict !== "UNRESOLVED" },
    rationale: verdict === "NONE" ? "" : "The release tag is not independently proven.",
    resolvedAt: verdict === "NONE" ? "0" : "1800000300",
    resolutionCount: verdict === "NONE" ? 0 : 1,
    nextRetryAt: verdict === "UNRESOLVED" ? "1800003900" : "0",
    freshnessDeadline: "1900000000",
    ...overrides,
  }
}

function provider(account: string, chainId = "0xf22f"): Eip1193Provider {
  return { request: vi.fn(async ({ method }) => method === "eth_chainId" ? chainId : [account]) }
}

function fakeContract(view: SubmissionView, milestoneView = milestone(), projectView = project()): MilestoneProofContract {
  return {
    address: CONTRACT,
    reads: {
      config: vi.fn(),
      project: vi.fn(async () => projectView),
      milestone: vi.fn(async () => milestoneView),
      submission: vi.fn(async () => view),
      actorProjects: vi.fn(),
    },
    writes: {
      createProject: vi.fn(),
      submitEvidence: vi.fn(async () => TX_HASH),
      resolveSubmission: vi.fn(async () => TX_HASH),
      resubmitEvidence: vi.fn(async () => TX_HASH),
      supplementEvidence: vi.fn(async () => TX_HASH),
      retryResolution: vi.fn(async () => TX_HASH),
      expireMilestone: vi.fn(async () => TX_HASH),
      waitForFinalized: vi.fn(async () => ({ executionSucceeded: true })),
    },
  }
}

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>
}

function renderDetail(view: SubmissionView, account: string = BUILDER, now = 1_800_000_400, milestoneView?: MilestoneView, projectView?: ProjectView, contractOverride?: MilestoneProofContract, chainId = "0xf22f") {
  const contract = contractOverride ?? fakeContract(view, milestoneView, projectView)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/submissions/88"]} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <WalletProvider provider={provider(account, chainId)}>
          <LocationProbe />
          <Routes><Route element={<SubmissionDetail contract={contract} now={() => now} />} path="/submissions/:submissionId" /></Routes>
        </WalletProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { contract, ...rendered }
}

describe("SubmissionDetail", () => {
  it.each([SPONSOR, BUILDER])("allows project party %s to resolve a NONE submission", async (actor) => {
    renderDetail(submission("NONE"), actor)

    expect(await screen.findByRole("button", { name: "Resolve submission" })).toBeEnabled()
    expect(screen.queryByRole("button", { name: /supplement|retry|resubmit/i })).not.toBeInTheDocument()
  })

  it("keeps a stranger read-only while a resolution action is pending", async () => {
    renderDetail(submission("NONE"), STRANGER)

    expect(await screen.findByText("Connected wallet is read-only for this submission.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Resolve submission" })).not.toBeInTheDocument()
  })

  it.each([
    ["historical revision", milestone({ currentSubmissionId: "99" }), project(), "This route is a historical submission and cannot execute current actions."],
    ["failed project", milestone(), project({ status: "FAILED" }), "Project or milestone is terminal; actions are suppressed."],
    ["failed milestone", milestone({ status: "FAILED" }), project(), "Project or milestone is terminal; actions are suppressed."],
    ["noncurrent milestone", milestone(), project({ currentMilestone: 1, milestoneCount: 2 }), "This milestone is not the project's current milestone."],
  ] as const)("suppresses actions for %s authoritative context", async (_label, milestoneView, projectView, explanation) => {
    renderDetail(submission("NONE"), BUILDER, 1_800_000_400, milestoneView, projectView)

    expect(await screen.findByText(explanation)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Resolve submission" })).not.toBeInTheDocument()
  })

  it("renders contract-backed evidence, criterion coverage, integrity, rationale, revision, and explorer links", async () => {
    renderDetail(submission("REQUEST_MORE_INFO", { revision: 2 }), BUILDER)

    expect(await screen.findByRole("heading", { name: "Submission #88" })).toBeInTheDocument()
    expect(screen.getAllByText("Revision 2")).toHaveLength(2)
    expect(screen.getByRole("link", { name: "Open evidence source" })).toHaveAttribute("href", EVIDENCE.url)
    expect(screen.getByText("Contract tests pass").closest("li")).toHaveTextContent("Proven")
    expect(screen.getByText("Release is tagged").closest("li")).toHaveTextContent("Missing")
    expect(screen.getByText("Provenance").closest("div")).toHaveTextContent("Pass")
    expect(screen.getByText("The release tag is not independently proven.")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Open contract on explorer" })).toHaveAttribute("href", expect.stringContaining(CONTRACT))
  })

  it("offers only a builder supplement for REQUEST_MORE_INFO", async () => {
    renderDetail(submission("REQUEST_MORE_INFO", { resolvedAt: "1800000300", freshnessDeadline: "1800000399" }), BUILDER, 1_800_000_400)

    expect(await screen.findByRole("button", { name: "Supplement evidence" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /resolve|retry|resubmit/i })).not.toBeInTheDocument()
  })

  it("suppresses supplement after the authoritative information window elapses", async () => {
    renderDetail(submission("REQUEST_MORE_INFO", { resolvedAt: "1800000300", freshnessDeadline: "1900000000" }), BUILDER, 1_800_000_300 + INFO_WINDOW_SECONDS)

    expect(await screen.findByText("The information window has elapsed; supplement is suppressed.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Supplement evidence" })).not.toBeInTheDocument()
  })

  it("offers RMI expiry at resolvedAt plus 72 hours even when freshnessDeadline is later", async () => {
    const resolvedAt = 1_800_000_300
    renderDetail(submission("REQUEST_MORE_INFO", { resolvedAt: String(resolvedAt), freshnessDeadline: "1900000000" }), STRANGER, resolvedAt + INFO_WINDOW_SECONDS)

    expect(await screen.findByRole("button", { name: "Expire milestone" })).toBeEnabled()
  })

  it("explains role ownership and exhausted retries instead of exposing invalid actions", async () => {
    const { unmount } = renderDetail(submission("REQUEST_MORE_INFO"), SPONSOR)
    expect(await screen.findByText("Waiting for the frozen builder to supplement evidence.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Supplement evidence" })).not.toBeInTheDocument()
    unmount()

    renderDetail(submission("UNRESOLVED", { resolutionCount: 3 }), BUILDER, 1_900_000_000)
    expect(await screen.findByText("Resolution attempts are exhausted; retry is suppressed.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Retry resolution" })).not.toBeInTheDocument()
  })

  it("enforces UNRESOLVED cooldown and exposes retry to either project party only after it elapses", async () => {
    const view = submission("UNRESOLVED")
    const { unmount } = renderDetail(view, SPONSOR, 1_800_003_800)
    expect(await screen.findByRole("button", { name: "Retry resolution" })).toBeDisabled()
    expect(screen.getByText(/cooldown ends/i)).toBeInTheDocument()
    unmount()

    renderDetail(view, BUILDER, 1_800_003_901)
    expect(await screen.findByRole("button", { name: "Retry resolution" })).toBeEnabled()
  })

  it("offers a rejected submission resubmit only to the builder and suppresses terminal replay actions", async () => {
    const { unmount } = renderDetail(submission("REJECTED"), BUILDER)
    expect(await screen.findByRole("button", { name: "Resubmit evidence" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /resolve|retry|supplement/i })).not.toBeInTheDocument()
    unmount()

    renderDetail(submission("APPROVED", { criteriaMet: [true, true], missingCriteria: [], integrity: { subjectMatch: true, versionMatch: true, fresh: true, provenanceOk: true } }), BUILDER)
    expect(await screen.findByText("This submission is terminal; repeat actions are suppressed.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /resolve|retry|resubmit|supplement/i })).not.toBeInTheDocument()
  })

  it("allows permissionless expiry only when the authoritative deadline has elapsed", async () => {
    renderDetail(submission("REJECTED"), STRANGER, 1_900_000_001)
    expect(await screen.findByRole("button", { name: "Expire milestone" })).toBeEnabled()
  })

  it("does not call readback or show success when FINALIZED execution failed", async () => {
    const { contract } = renderDetail(submission("NONE"), BUILDER)
    vi.mocked(contract.writes.waitForFinalized).mockResolvedValue({ executionSucceeded: false, error: "validator execution reverted" })
    const user = userEvent.setup()

    await user.click(await screen.findByRole("button", { name: "Resolve submission" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("validator execution reverted")
    await waitFor(() => expect(contract.reads.submission).toHaveBeenCalledTimes(2))
    expect(screen.queryByText("Authoritative contract readback confirmed.")).not.toBeInTheDocument()
  })

  it.each([
    ["NONE", "Pending", "Pending"],
    ["UNRESOLVED", "Unresolved", "Unknown"],
  ] as const)("labels %s audit placeholders without claiming failure", async (verdict, criterionLabel, integrityLabel) => {
    renderDetail(submission(verdict), BUILDER)
    const coverage = await screen.findByText("Criterion coverage")
    const coverageCard = coverage.closest("section") as HTMLElement
    const integrity = screen.getByText("Integrity checks").closest("section") as HTMLElement

    expect(within(coverageCard).getAllByText(criterionLabel)).toHaveLength(2)
    expect(within(integrity).getAllByText(integrityLabel)).toHaveLength(4)
    expect(within(integrity).queryByText("Fail")).not.toBeInTheDocument()
  })

  it("shows wrong-network guidance and suppresses writes", async () => {
    renderDetail(submission("NONE"), BUILDER, 1_800_000_400, undefined, undefined, undefined, "0x1")

    expect(await screen.findByText("WRONG_NETWORK")).toBeInTheDocument()
    expect(screen.getByText("Switch to GenLayer Studionet to continue.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Resolve submission" })).not.toBeInTheDocument()
  })

  it.each([
    ["supplement", "REQUEST_MORE_INFO", "Supplement evidence"],
    ["resubmit", "REJECTED", "Resubmit evidence"],
  ] as const)("routes a confirmed %s to the new submission digest", async (kind, verdict, label) => {
    let written = false
    let submitted: EvidenceInput[] = []
    const prior = submission(verdict, { freshnessDeadline: "1900000000" })
    const contract = fakeContract(prior)
    vi.mocked(contract.reads.milestone).mockImplementation(async () => written ? milestone({ currentSubmissionId: "99", submissionCount: 2 }) : milestone())
    vi.mocked(contract.reads.submission).mockImplementation(async (id) => id === "99" ? submission("NONE", { id: "99", digest: "99", revision: 2, evidence: kind === "supplement" ? [...prior.evidence, ...submitted] : submitted }) : prior)
    const write = async (_first: unknown, evidence: EvidenceInput[]) => { submitted = evidence; written = true; return TX_HASH }
    if (kind === "supplement") vi.mocked(contract.writes.supplementEvidence).mockImplementation(write as never)
    else vi.mocked(contract.writes.resubmitEvidence).mockImplementation((async (_projectId: string, _index: number, evidence: EvidenceInput[]) => write(_projectId, evidence)) as never)
    renderDetail(prior, BUILDER, 1_800_000_400, undefined, undefined, contract)
    const user = userEvent.setup()
    await user.selectOptions(await screen.findByLabelText("Evidence 1 source kind"), "RELEASE")
    await user.type(screen.getByLabelText("Evidence 1 URL"), "https://github.com/example/compiler/releases/tag/v2")
    await user.type(screen.getByLabelText("Evidence 1 subject"), "github.com/example/compiler")
    await user.type(screen.getByLabelText("Evidence 1 version"), "v2")
    await user.type(screen.getByLabelText("Evidence 1 observed at"), "2027-01-15T15:01")
    await user.click(screen.getByRole("button", { name: label }))

    expect(await screen.findByTestId("location")).toHaveTextContent("/submissions/99")
  })
})
