import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { MilestoneView, ProjectView } from "@milestoneproof/shared"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import type { MilestoneProofContract } from "../lib/contract"
import { WalletProvider } from "../lib/wallet"
import { ProjectWorkspace } from "./ProjectWorkspace"

const CONTRACT = "0xc000000000000000000000000000000000000001" as const
const SPONSOR = "0x1000000000000000000000000000000000000001"
const BUILDER = "0x2000000000000000000000000000000000000002"

function contract(): MilestoneProofContract {
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
      })),
      submission: vi.fn(),
      actorProjects: vi.fn(),
    },
    writes: {
      createProject: vi.fn(),
      waitForFinalized: vi.fn(),
    },
  }
}

function renderWorkspace() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/projects/7"]} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <WalletProvider provider={null}>
          <Routes>
            <Route element={<ProjectWorkspace contract={contract()} />} path="/projects/:projectId" />
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
})
