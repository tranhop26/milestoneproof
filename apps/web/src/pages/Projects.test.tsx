import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ProjectView } from "@milestoneproof/shared"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import type { MilestoneProofContract } from "../lib/contract"
import type { Eip1193Provider } from "../lib/genlayer"
import { WalletProvider } from "../lib/wallet"
import { Projects } from "./Projects"

const CONTRACT = "0xc000000000000000000000000000000000000001" as const
const ACTOR = "0x1000000000000000000000000000000000000001"
const SPONSOR = "0x2000000000000000000000000000000000000002"
const BUILDER = "0x3000000000000000000000000000000000000003"

function project(id: string, overrides: Partial<ProjectView> = {}): ProjectView {
  return {
    schemaVersion: 1,
    id,
    sponsor: SPONSOR,
    builder: BUILDER,
    title: `Project ${id}`,
    description: `Authoritative description ${id}`,
    status: "ACTIVE",
    currentMilestone: 0,
    createdAt: "1800000000",
    milestoneCount: 3,
    ...overrides,
  }
}

function contract(): MilestoneProofContract {
  const projects = new Map([
    ["5", project("5", { sponsor: ACTOR, title: "Sponsor project", currentMilestone: 1 })],
    ["3", project("3", { sponsor: ACTOR, title: "Indexed in both roles", status: "COMPLETED", currentMilestone: 2 })],
    ["4", project("4", { builder: ACTOR, title: "Builder project", status: "FAILED" })],
  ])
  return {
    address: CONTRACT,
    reads: {
      config: vi.fn(),
      project: vi.fn(async (id) => projects.get(id) ?? project(id)),
      milestone: vi.fn(),
      submission: vi.fn(),
      actorProjects: vi.fn(async (_actor, role) => role === "sponsor" ? ["5", "3"] : ["4", "3"]),
    },
    writes: {
      createProject: vi.fn(), submitEvidence: vi.fn(), resolveSubmission: vi.fn(),
      resubmitEvidence: vi.fn(), supplementEvidence: vi.fn(), retryResolution: vi.fn(),
      expireMilestone: vi.fn(), waitForFinalized: vi.fn(),
    },
  }
}

function provider(account: string, chainId = "0xf22f"): Eip1193Provider {
  return { request: vi.fn(async ({ method }) => method === "eth_chainId" ? chainId : [account]) }
}

function renderProjects(contractOverride = contract(), walletProvider: Eip1193Provider | null = null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <WalletProvider provider={walletProvider}>
          <Projects contract={contractOverride} />
        </WalletProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("Projects", () => {
  it("explains that the connected wallet controls the authoritative index", () => {
    const adapter = contract()
    renderProjects(adapter)

    expect(screen.getByRole("heading", { name: "Your projects" })).toBeInTheDocument()
    expect(screen.getByText(/indexed by your connected wallet/i)).toBeInTheDocument()
    expect(adapter.reads.actorProjects).not.toHaveBeenCalled()
  })

  it("shows wrong-network guidance and does not read actor indexes", async () => {
    const adapter = contract()
    renderProjects(adapter, provider(ACTOR, "0x1"))

    expect(await screen.findByText("WRONG_NETWORK")).toBeInTheDocument()
    expect(screen.getByText("Switch to GenLayer Studionet to load your projects.")).toBeInTheDocument()
    expect(adapter.reads.actorProjects).not.toHaveBeenCalled()
  })

  it("renders deduplicated contract projects and filters them by role", async () => {
    const adapter = contract()
    renderProjects(adapter, provider(ACTOR))

    expect(await screen.findByRole("heading", { name: "Sponsor project" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Indexed in both roles" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Builder project" })).toBeInTheDocument()
    expect(screen.getAllByRole("link", { name: /open project/i })).toHaveLength(3)
    expect(screen.getByText("Milestone 2 of 3")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Sponsor" }))
    expect(screen.getByRole("heading", { name: "Sponsor project" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Indexed in both roles" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Builder project" })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Builder" }))
    expect(screen.queryByRole("heading", { name: "Sponsor project" })).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Indexed in both roles" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Builder project" })).toBeInTheDocument()
  })

  it("shows a truthful empty state when both actor indexes are empty", async () => {
    const adapter = contract()
    vi.mocked(adapter.reads.actorProjects).mockResolvedValue([])
    renderProjects(adapter, provider(ACTOR))

    expect(await screen.findByRole("heading", { name: "No indexed projects" })).toBeInTheDocument()
    expect(screen.getByText(/contract returned no sponsor or builder projects/i)).toBeInTheDocument()
  })

  it("fails closed when an authoritative index read fails", async () => {
    const adapter = contract()
    vi.mocked(adapter.reads.actorProjects).mockRejectedValue(new Error("RPC unavailable"))
    renderProjects(adapter, provider(ACTOR))

    expect(await screen.findByRole("alert")).toHaveTextContent("RPC unavailable")
    expect(screen.getByRole("button", { name: "Retry contract read" })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /open project/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Retry contract read" }))
    await waitFor(() => expect(adapter.reads.actorProjects).toHaveBeenCalledTimes(4))
  })
})
