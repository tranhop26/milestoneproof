import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { MilestoneView, ProjectView } from "@milestoneproof/shared"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import type { MilestoneProofContract } from "../lib/contract"
import type { Eip1193Provider } from "../lib/genlayer"
import { WalletProvider } from "../lib/wallet"
import { ProjectWorkspace } from "./ProjectWorkspace"

const CONTRACT = "0xc000000000000000000000000000000000000001" as const
const SPONSOR = "0x1000000000000000000000000000000000000001"
const BUILDER = "0x2000000000000000000000000000000000000002"
const STRANGER = "0x3000000000000000000000000000000000000003"
const TX_HASH = `0x${"c".repeat(64)}` as `0x${string}`

function contract(milestoneOverrides: Partial<MilestoneView> = {}): MilestoneProofContract {
  return {
    address: CONTRACT,
    reads: {
      config: vi.fn(),
      project: vi.fn(async (): Promise<ProjectView> => ({
        schemaVersion: 1,
        id: "7",
        sponsor: SPONSOR,
        builder: BUILDER,
        title: "Compiler release",
        description: "Ship a verified compiler release",
        status: "ACTIVE",
        currentMilestone: 1,
        createdAt: "1800000000",
        milestoneCount: 3,
      })),
      milestone: vi.fn(async (_projectId, index): Promise<MilestoneView> => ({
        schemaVersion: 1,
        projectId: "7",
        index,
        title: ["Contract", "Release", "Deployment"][index],
        criteria: [["Contract tests pass"], ["Release is tagged"], ["Deployment is public"]][index],
        allowedSources: [["REPOSITORY"], ["RELEASE"], ["DEPLOYMENT"]][index] as never,
        deadline: String(1_900_000_000 + index),
        status: ["APPROVED", "SUBMITTED", "LOCKED"][index] as never,
        openedAt: index < 2 ? "1800000000" : "0",
        submissionCount: index === 1 ? 1 : 0,
        currentSubmissionId: index === 1 ? "88" : "0",
        ...milestoneOverrides,
      })),
      submission: vi.fn(),
      actorProjects: vi.fn(),
    },
    writes: {
      createProject: vi.fn(),
      submitEvidence: vi.fn(),
      resolveSubmission: vi.fn(),
      resubmitEvidence: vi.fn(),
      supplementEvidence: vi.fn(),
      retryResolution: vi.fn(),
      expireMilestone: vi.fn(),
      waitForFinalized: vi.fn(),
    },
  }
}

function provider(account: string, chainId = "0xf22f"): Eip1193Provider {
  return { request: vi.fn(async ({ method }) => method === "eth_chainId" ? chainId : [account]) }
}

function renderWorkspace(contractOverride = contract(), walletProvider: Eip1193Provider | null = null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/projects/7"]} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <WalletProvider provider={walletProvider}>
          <Routes>
            <Route element={<ProjectWorkspace contract={contractOverride} />} path="/projects/:projectId" />
          </Routes>
        </WalletProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("ProjectWorkspace", () => {
  it("renders authoritative project parties, contract, and milestone states", async () => {
    renderWorkspace()

    expect(await screen.findByRole("heading", { name: "Compiler release" })).toBeInTheDocument()
    expect(screen.getByText(SPONSOR)).toBeInTheDocument()
    expect(screen.getByText(BUILDER)).toBeInTheDocument()
    expect(screen.getByText(CONTRACT)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "View contract on explorer" })).toHaveAttribute("href", expect.stringContaining(CONTRACT))
    const milestoneNodes = screen.getAllByRole("listitem")
    expect(milestoneNodes[0]).toHaveTextContent("ContractApproved")
    expect(milestoneNodes[1]).toHaveTextContent("ReleaseSubmitted")
    expect(milestoneNodes[2]).toHaveTextContent("DeploymentLocked")
  })

  it("shows all authoritative workspace tabs and never fabricates empty activity", async () => {
    renderWorkspace()
    await screen.findByRole("heading", { name: "Compiler release" })

    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Evidence" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Submissions" })).toBeInTheDocument()
    const activity = screen.getByRole("tab", { name: "On-chain activity" })
    await userEvent.click(activity)
    expect(screen.getByText("No on-chain activity is available from contract reads yet.")).toBeInTheDocument()
    expect(screen.queryByText(/mock|sample transaction/i)).not.toBeInTheDocument()
  })

  it("lets only the builder edit evidence for an OPEN current milestone", async () => {
    const openMilestone = contract({ status: "OPEN", currentSubmissionId: "0", submissionCount: 0 })
    renderWorkspace(openMilestone, provider(BUILDER))
    await screen.findByRole("heading", { name: "Compiler release" })
    await userEvent.click(screen.getByRole("tab", { name: "Evidence" }))
    expect(screen.getByRole("button", { name: "Submit evidence" })).toBeInTheDocument()
  })

  it("keeps a non-builder read-only on OPEN milestone evidence", async () => {
    const openMilestone = contract({ status: "OPEN", currentSubmissionId: "0", submissionCount: 0 })
    renderWorkspace(openMilestone, provider(SPONSOR))
    await screen.findByRole("heading", { name: "Compiler release" })
    await userEvent.click(screen.getByRole("tab", { name: "Evidence" }))
    expect(screen.getByText("Only the frozen builder can submit evidence for this open milestone.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Submit evidence" })).not.toBeInTheDocument()
  })

  it.each([BUILDER, STRANGER])("shows wrong-network guidance and suppresses OPEN milestone writes for %s", async (account) => {
    const openMilestone = contract({ status: "OPEN", currentSubmissionId: "0", submissionCount: 0, deadline: "1700000000" })
    renderWorkspace(openMilestone, provider(account, "0x1"))
    await screen.findByRole("heading", { name: "Compiler release" })
    await userEvent.click(screen.getByRole("tab", { name: "Evidence" }))

    expect(screen.getByText("WRONG_NETWORK")).toBeInTheDocument()
    expect(screen.getByText("Switch to GenLayer Studionet to continue.")).toBeInTheDocument()
    expect(screen.queryByText("Only the frozen builder can submit evidence for this open milestone.")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Submit evidence" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Expire milestone" })).not.toBeInTheDocument()
  })

  it("lets an unrelated connected wallet expire the current OPEN milestone after its deadline", async () => {
    let expired = false
    const adapter = contract({ status: "OPEN", currentSubmissionId: "0", submissionCount: 0, deadline: "1700000000" })
    vi.mocked(adapter.reads.project).mockImplementation(async () => ({
      schemaVersion: 1, id: "7", sponsor: SPONSOR, builder: BUILDER, title: "Compiler release", description: "Ship a verified compiler release", status: expired ? "FAILED" : "ACTIVE", currentMilestone: 1, createdAt: "1800000000", milestoneCount: 3,
    }))
    vi.mocked(adapter.reads.milestone).mockImplementation(async (_projectId, index) => ({
      schemaVersion: 1, projectId: "7", index, title: ["Contract", "Release", "Deployment"][index], criteria: [["Contract tests pass"], ["Release is tagged"], ["Deployment is public"]][index], allowedSources: ["REPOSITORY"], deadline: "1700000000", status: index === 1 ? expired ? "FAILED" : "OPEN" : index === 0 ? "APPROVED" : "LOCKED", openedAt: index < 2 ? "1600000000" : "0", submissionCount: 0, currentSubmissionId: "0",
    }))
    vi.mocked(adapter.writes.expireMilestone).mockImplementation(async () => { expired = true; return TX_HASH })
    vi.mocked(adapter.writes.waitForFinalized).mockResolvedValue({ executionSucceeded: true })
    renderWorkspace(adapter, provider(STRANGER))
    await screen.findByRole("heading", { name: "Compiler release" })
    await userEvent.click(screen.getByRole("tab", { name: "Evidence" }))

    await userEvent.click(screen.getByRole("button", { name: "Expire milestone" }))

    await waitFor(() => expect(adapter.writes.expireMilestone).toHaveBeenCalledWith("7", 1))
    expect(await screen.findByRole("region", { name: "Execution status" })).toHaveTextContent(
      "Authoritative contract readback confirmed.",
    )
    await userEvent.click(screen.getByRole("tab", { name: "On-chain activity" }))
    expect(await screen.findByText("Authoritative contract readback confirmed.")).toBeInTheDocument()
  })
})
