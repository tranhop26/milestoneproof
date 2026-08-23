import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { EvidenceInput, MilestoneView, ProjectView, SubmissionView } from "@milestoneproof/shared"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { PropsWithChildren } from "react"
import { describe, expect, it, vi } from "vitest"

import type { MilestoneProofContract } from "../lib/contract"
import type { Eip1193Provider } from "../lib/genlayer"
import { useWallet, WalletProvider } from "../lib/wallet"
import { useMilestoneActions } from "./useMilestoneProof"

const CONTRACT = "0xc000000000000000000000000000000000000001" as const
const SPONSOR = "0x1000000000000000000000000000000000000001" as const
const BUILDER = "0x2000000000000000000000000000000000000002" as const
const TX_HASH = `0x${"b".repeat(64)}` as `0x${string}`
const NOW = 2_000_000_000
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

describe("useMilestoneActions authoritative gates", () => {
  it("rejects a historical submission before requesting a write", async () => {
    const currentProject = project()
    const currentMilestone = milestone({ currentSubmissionId: "99" })
    const oldSubmission = submission()
    const adapter = contract({ project: () => currentProject, milestone: () => currentMilestone, submission: () => oldSubmission })
    const hook = renderActions(adapter)
    await connected(hook)

    await expect(hook.result.current.actions.mutateAsync({ kind: "resolve", project: currentProject, milestone: currentMilestone, submission: oldSubmission })).rejects.toThrow(/current submission/i)
    expect(adapter.writes.resolveSubmission).not.toHaveBeenCalled()
  })

  it("confirms a new evidence revision only after write, receipt, digest, and evidence readback", async () => {
    let written = false
    const currentProject = project()
    const priorMilestone = milestone()
    const priorSubmission = submission({ verdict: "REQUEST_MORE_INFO", resolvedAt: "1999990000", freshnessDeadline: "2100000000" })
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
