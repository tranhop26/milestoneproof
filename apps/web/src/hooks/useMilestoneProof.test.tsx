import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { EvidenceInput, MilestoneView, ProjectView, SubmissionView } from "@milestoneproof/shared"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { PropsWithChildren } from "react"
import { describe, expect, it, vi } from "vitest"

import type { MilestoneProofContract } from "../lib/contract"
import type { Eip1193Provider } from "../lib/genlayer"
import { useWallet, WalletProvider } from "../lib/wallet"
import {
  queryKeys,
  useActorProjects,
  useMilestoneActions,
  type MilestoneAction,
} from "./useMilestoneProof"

const CONTRACT = "0xc000000000000000000000000000000000000001" as const
const SPONSOR = "0x1000000000000000000000000000000000000001" as const
const BUILDER = "0x2000000000000000000000000000000000000002" as const
const TX_HASH = `0x${"b".repeat(64)}` as `0x${string}`
const NOW = 2_000_000_000
const INFO_WINDOW_SECONDS = 72 * 60 * 60
const EVIDENCE: EvidenceInput = { sourceKind: "RELEASE", url: "https://github.com/example/compiler/releases/tag/v1.0.0", subjectRef: "github.com/example/compiler", versionRef: "v1.0.0", observedAt: "1900000100" }

function project(overrides: Partial<ProjectView> = {}): ProjectView {
  return { schemaVersion: 1, id: "7", sponsor: SPONSOR, builder: BUILDER, title: "Compiler", description: "Ship compiler", status: "ACTIVE", currentMilestone: 0, createdAt: "1800000000", milestoneCount: 2, ...overrides }
}

function milestone(overrides: Partial<MilestoneView> = {}): MilestoneView {
  return { schemaVersion: 1, projectId: "7", index: 0, title: "Release", criteria: ["Release tagged"], allowedSources: ["RELEASE"], deadline: "2100000000", status: "SUBMITTED", openedAt: "1800000000", submissionCount: 1, currentSubmissionId: "88", ...overrides }
}

function submission(overrides: Partial<SubmissionView> = {}): SubmissionView {
  return { schemaVersion: 2, id: "88", projectId: "7", milestoneIndex: 0, revision: 1, verdict: "NONE", builder: BUILDER, submittedAt: "1900000200", evidence: [EVIDENCE], digest: "88", criteriaMet: [], missingCriteria: [], integrity: { subjectMatch: false, versionMatch: false, fresh: false, provenanceOk: false }, rationale: "", resolvedAt: "0", resolutionCount: 0, nextRetryAt: "0", freshnessDeadline: "2100000000", ...overrides }
}

function provider(): Eip1193Provider {
  return { request: vi.fn(async ({ method }) => method === "eth_chainId" ? "0xf22f" : [BUILDER]) }
}

function contract(reads: { project: () => ProjectView, milestone: (index: number) => MilestoneView, submission: (id: string) => SubmissionView }): MilestoneProofContract {
  return {
    address: CONTRACT,
    reads: {
      config: vi.fn(),
      project: vi.fn(async () => reads.project()),
      milestone: vi.fn(async (_projectId, index) => reads.milestone(index)),
      submission: vi.fn(async (id) => reads.submission(id)),
      actorProjects: vi.fn(),
    },
    writes: {
      createProject: vi.fn(), submitEvidence: vi.fn(async () => TX_HASH), resolveSubmission: vi.fn(async () => TX_HASH), resubmitEvidence: vi.fn(async () => TX_HASH), supplementEvidence: vi.fn(async () => TX_HASH), retryResolution: vi.fn(async () => TX_HASH), expireMilestone: vi.fn(async () => TX_HASH), waitForFinalized: vi.fn(async () => ({ executionSucceeded: true })),
    },
  }
}

function renderActions(contractValue: MilestoneProofContract) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={queryClient}><WalletProvider provider={provider()}>{children}</WalletProvider></QueryClientProvider>
  return renderHook(() => ({ actions: useMilestoneActions(contractValue, () => NOW), wallet: useWallet() }), { wrapper })
}

async function connected(hook: ReturnType<typeof renderActions>) {
  await waitFor(() => expect(hook.result.current.wallet.status).toBe("CONNECTED"))
}

function renderActorProjects(contractValue: MilestoneProofContract, actor: string | null, enabled = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return renderHook(() => useActorProjects(contractValue, actor, enabled), { wrapper })
}

describe("useActorProjects", () => {
  it("deduplicates sponsor and builder indexes while preserving role metadata and index order", async () => {
    const projects = new Map([
      ["5", project({ id: "5", title: "Newest sponsored" })],
      ["3", project({ id: "3", title: "Dual role" })],
      ["4", project({ id: "4", title: "Builder project" })],
    ])
    const adapter = contract({
      project: () => project(),
      milestone: () => milestone(),
      submission: () => submission(),
    })
    vi.mocked(adapter.reads.actorProjects).mockImplementation(async (_actor, role) => (
      role === "sponsor" ? ["5", "3"] : ["4", "3"]
    ))
    vi.mocked(adapter.reads.project).mockImplementation(async (id) => projects.get(id)!)

    const hook = renderActorProjects(adapter, SPONSOR)

    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true))
    expect(hook.result.current.data?.map(({ project: entry }) => entry.id)).toEqual(["5", "3", "4"])
    expect(hook.result.current.data?.find(({ project: entry }) => entry.id === "3")?.roles)
      .toEqual(["sponsor", "builder"])
    expect(adapter.reads.project).toHaveBeenCalledTimes(3)
  })

  it("fails closed when either actor index or a project read fails", async () => {
    const indexFailure = contract({ project: () => project(), milestone: () => milestone(), submission: () => submission() })
    vi.mocked(indexFailure.reads.actorProjects).mockImplementation(async (_actor, role) => {
      if (role === "builder") throw new Error("builder index unavailable")
      return ["5"]
    })
    const failedIndexHook = renderActorProjects(indexFailure, SPONSOR)
    await waitFor(() => expect(failedIndexHook.result.current.error).toEqual(new Error("builder index unavailable")))

    const projectFailure = contract({ project: () => project(), milestone: () => milestone(), submission: () => submission() })
    vi.mocked(projectFailure.reads.actorProjects).mockResolvedValue(["5"])
    vi.mocked(projectFailure.reads.project).mockRejectedValue(new Error("project unavailable"))
    const failedProjectHook = renderActorProjects(projectFailure, SPONSOR)
    await waitFor(() => expect(failedProjectHook.result.current.error).toEqual(new Error("project unavailable")))
  })

  it("does not read projects for empty or disabled actor indexes and normalizes cache identity", async () => {
    expect(queryKeys.actorProjectEntries(SPONSOR.toUpperCase())).toEqual(
      queryKeys.actorProjectEntries(SPONSOR.toLowerCase()),
    )
    const adapter = contract({ project: () => project(), milestone: () => milestone(), submission: () => submission() })
    vi.mocked(adapter.reads.actorProjects).mockResolvedValue([])
    const emptyHook = renderActorProjects(adapter, SPONSOR)
    await waitFor(() => expect(emptyHook.result.current.data).toEqual([]))
    expect(adapter.reads.project).not.toHaveBeenCalled()

    const disabledAdapter = contract({ project: () => project(), milestone: () => milestone(), submission: () => submission() })
    const disabledHook = renderActorProjects(disabledAdapter, SPONSOR, false)
    expect(disabledHook.result.current.fetchStatus).toBe("idle")
    expect(disabledAdapter.reads.actorProjects).not.toHaveBeenCalled()
  })
})

describe("useMilestoneActions authoritative gates", () => {
  it.each([
    ["resolve", submission(), submission({ id: "99", digest: "99", revision: 2 })],
    ["resubmit", submission({ verdict: "REJECTED" }), submission({ id: "99", digest: "99", revision: 2, verdict: "REJECTED" })],
    ["supplement", submission({ verdict: "REQUEST_MORE_INFO", resolvedAt: String(NOW - 1) }), submission({ id: "99", digest: "99", revision: 2, verdict: "REQUEST_MORE_INFO", resolvedAt: String(NOW - 1) })],
    ["retry", submission({ verdict: "UNRESOLVED", resolutionCount: 1, nextRetryAt: "0" }), submission({ id: "99", digest: "99", revision: 2, verdict: "UNRESOLVED", resolutionCount: 1, nextRetryAt: "0" })],
    ["expire", submission({ verdict: "REJECTED" }), submission({ id: "99", digest: "99", revision: 2, verdict: "REJECTED" })],
  ] as const)("rejects stale %s action context before requesting a write", async (kind, staleSubmission, authoritativeSubmission) => {
    const currentProject = project()
    const currentMilestone = milestone({ currentSubmissionId: "99", submissionCount: 2, deadline: kind === "expire" ? String(NOW - 1) : "2100000000" })
    const adapter = contract({
      project: () => currentProject,
      milestone: () => currentMilestone,
      submission: (id) => {
        expect(id).toBe("99")
        return authoritativeSubmission
      },
    })
    const hook = renderActions(adapter)
    await connected(hook)
    const base = { project: currentProject, milestone: currentMilestone, submission: staleSubmission }
    const action: MilestoneAction = kind === "resolve" || kind === "retry" || kind === "expire"
      ? { kind, ...base }
      : { kind, ...base, evidence: [EVIDENCE] }

    await expect(hook.result.current.actions.mutateAsync(action)).rejects.toThrow(/authoritative current submission/i)
    expect(adapter.writes.resolveSubmission).not.toHaveBeenCalled()
    expect(adapter.writes.resubmitEvidence).not.toHaveBeenCalled()
    expect(adapter.writes.supplementEvidence).not.toHaveBeenCalled()
    expect(adapter.writes.retryResolution).not.toHaveBeenCalled()
    expect(adapter.writes.expireMilestone).not.toHaveBeenCalled()
  })

  it("rejects submitted expiry without an action submission snapshot", async () => {
    const currentProject = project()
    const currentMilestone = milestone({ deadline: String(NOW - 1) })
    const currentSubmission = submission({ verdict: "REJECTED" })
    const adapter = contract({ project: () => currentProject, milestone: () => currentMilestone, submission: () => currentSubmission })
    const hook = renderActions(adapter)
    await connected(hook)

    await expect(hook.result.current.actions.mutateAsync({ kind: "expire", project: currentProject, milestone: currentMilestone })).rejects.toThrow(/authoritative current submission/i)
    expect(adapter.writes.expireMilestone).not.toHaveBeenCalled()
  })

  it("preserves a valid current UNRESOLVED retry path", async () => {
    let written = false
    const currentProject = project()
    const currentMilestone = milestone()
    const unresolved = submission({ verdict: "UNRESOLVED", resolutionCount: 1, nextRetryAt: "0" })
    const retried = submission({ verdict: "REQUEST_MORE_INFO", resolvedAt: String(NOW), resolutionCount: 2 })
    const adapter = contract({
      project: () => currentProject,
      milestone: () => currentMilestone,
      submission: () => written ? retried : unresolved,
    })
    vi.mocked(adapter.writes.retryResolution).mockImplementation(async () => { written = true; return TX_HASH })
    const hook = renderActions(adapter)
    await connected(hook)

    await act(async () => { await hook.result.current.actions.mutateAsync({ kind: "retry", project: currentProject, milestone: currentMilestone, submission: unresolved }) })

    expect(adapter.writes.retryResolution).toHaveBeenCalledWith("88")
    expect(hook.result.current.actions.transactionState.phase).toBe("READBACK")
  })

  it("confirms a new evidence revision only after write, receipt, digest, and evidence readback", async () => {
    let written = false
    const currentProject = project()
    const priorMilestone = milestone()
    const priorSubmission = submission({ verdict: "REQUEST_MORE_INFO", resolvedAt: "1999990000", freshnessDeadline: String(NOW - 1) })
    const nextSubmission = submission({ id: "99", digest: "99", revision: 2, verdict: "NONE", evidence: [...priorSubmission.evidence, EVIDENCE], resolutionCount: 0 })
    const adapter = contract({
      project: () => currentProject,
      milestone: () => written ? milestone({ currentSubmissionId: "99", submissionCount: 2 }) : priorMilestone,
      submission: (id) => id === "99" ? nextSubmission : priorSubmission,
    })
    vi.mocked(adapter.writes.supplementEvidence).mockImplementation(async () => { written = true; return TX_HASH })
    const hook = renderActions(adapter)
    await connected(hook)

    let result: unknown
    await act(async () => { result = await hook.result.current.actions.mutateAsync({ kind: "supplement", project: currentProject, milestone: priorMilestone, submission: priorSubmission, evidence: [EVIDENCE] }) })

    expect(result).toMatchObject({ submittedDigest: "99", submission: { id: "99", digest: "99" } })
    expect(hook.result.current.actions.transactionState.phase).toBe("READBACK")
  })

  it("uses resolvedAt plus the contract info window instead of freshnessDeadline for RMI expiry", async () => {
    const currentProject = project()
    const currentMilestone = milestone()
    const currentSubmission = submission({
      verdict: "REQUEST_MORE_INFO",
      resolvedAt: String(NOW - INFO_WINDOW_SECONDS + 1),
      freshnessDeadline: String(NOW - 1),
    })
    const adapter = contract({ project: () => currentProject, milestone: () => currentMilestone, submission: () => currentSubmission })
    const hook = renderActions(adapter)
    await connected(hook)

    await expect(hook.result.current.actions.mutateAsync({ kind: "expire", project: currentProject, milestone: currentMilestone, submission: currentSubmission })).rejects.toThrow(/eligible for expiry/i)
    expect(adapter.writes.expireMilestone).not.toHaveBeenCalled()
  })

  it("reads the authoritative current submission and rejects a stale expiry revision before writing", async () => {
    const currentProject = project()
    const currentMilestone = milestone({ currentSubmissionId: "99", submissionCount: 2 })
    const staleSubmission = submission({ verdict: "REJECTED" })
    const currentSubmission = submission({
      id: "99",
      digest: "99",
      revision: 2,
      verdict: "REQUEST_MORE_INFO",
      resolvedAt: String(NOW - 1),
      freshnessDeadline: String(NOW - 1),
    })
    const adapter = contract({
      project: () => currentProject,
      milestone: () => currentMilestone,
      submission: (id) => id === "99" ? currentSubmission : staleSubmission,
    })
    const hook = renderActions(adapter)
    await connected(hook)

    await expect(hook.result.current.actions.mutateAsync({ kind: "expire", project: currentProject, milestone: currentMilestone, submission: staleSubmission })).rejects.toThrow(/authoritative current submission/i)
    expect(adapter.reads.submission).toHaveBeenCalledWith("99")
    expect(adapter.writes.expireMilestone).not.toHaveBeenCalled()
  })

  it.each([
    ["approved advancement", submission({ verdict: "APPROVED", resolutionCount: 1, criteriaMet: [true], integrity: { subjectMatch: true, versionMatch: true, fresh: true, provenanceOk: true } }), project({ currentMilestone: 1 }), milestone({ status: "APPROVED" }), milestone({ index: 1, status: "OPEN", currentSubmissionId: "0", submissionCount: 0 })],
    ["approved completion", submission({ verdict: "APPROVED", resolutionCount: 1, criteriaMet: [true], integrity: { subjectMatch: true, versionMatch: true, fresh: true, provenanceOk: true } }), project({ status: "COMPLETED", milestoneCount: 1 }), milestone({ status: "APPROVED" }), undefined],
    ["terminal rejection", submission({ verdict: "REJECTED", resolutionCount: 1 }), project({ status: "FAILED", milestoneCount: 1 }), milestone({ status: "FAILED", submissionCount: 3 }), undefined],
  ] as const)("confirms %s consequences before READBACK", async (_label, resolved, resolvedProject, resolvedMilestone, nextMilestone) => {
    let written = false
    const initialProject = project({ milestoneCount: resolvedProject.milestoneCount })
    const initialMilestone = milestone({ submissionCount: resolvedMilestone.submissionCount })
    const initialSubmission = submission()
    const adapter = contract({
      project: () => written ? resolvedProject : initialProject,
      milestone: (index) => written && index === 0 ? resolvedMilestone : written && nextMilestone ? nextMilestone : initialMilestone,
      submission: () => written ? resolved : initialSubmission,
    })
    vi.mocked(adapter.writes.resolveSubmission).mockImplementation(async () => { written = true; return TX_HASH })
    const hook = renderActions(adapter)
    await connected(hook)

    await act(async () => { await hook.result.current.actions.mutateAsync({ kind: "resolve", project: initialProject, milestone: initialMilestone, submission: initialSubmission }) })

    expect(hook.result.current.actions.transactionState.phase).toBe("READBACK")
  })

  it("rejects an APPROVED readback whose milestone consequence did not advance", async () => {
    let written = false
    const initialProject = project()
    const initialMilestone = milestone()
    const initialSubmission = submission()
    const approved = submission({ verdict: "APPROVED", resolutionCount: 1, criteriaMet: [true], integrity: { subjectMatch: true, versionMatch: true, fresh: true, provenanceOk: true } })
    const adapter = contract({ project: () => initialProject, milestone: () => initialMilestone, submission: () => written ? approved : initialSubmission })
    vi.mocked(adapter.writes.resolveSubmission).mockImplementation(async () => { written = true; return TX_HASH })
    const hook = renderActions(adapter)
    await connected(hook)

    await act(async () => {
      await expect(hook.result.current.actions.mutateAsync({ kind: "resolve", project: initialProject, milestone: initialMilestone, submission: initialSubmission })).rejects.toThrow(/readback/i)
    })
    await waitFor(() => expect(hook.result.current.actions.transactionState).toMatchObject({ phase: "ERROR", code: "READBACK_FAILED" }))
  })
})
