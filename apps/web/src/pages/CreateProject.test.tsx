import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { MilestoneView, ProjectView } from "@milestoneproof/shared"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import type { MilestoneProofContract } from "../lib/contract"
import type { Eip1193Provider } from "../lib/genlayer"
import { WalletProvider } from "../lib/wallet"
import { CreateProject } from "./CreateProject"

const CONTRACT = "0xc000000000000000000000000000000000000001" as const
const SPONSOR = "0x1000000000000000000000000000000000000001" as const
const BUILDER = "0x2000000000000000000000000000000000000002" as const
const TX_HASH = `0x${"a".repeat(64)}` as `0x${string}`

function connectedProvider({
  account = SPONSOR,
  chainId = "0xf22f",
  rejectMethod,
}: { account?: string | null, chainId?: string, rejectMethod?: string } = {}): Eip1193Provider {
  return {
    request: vi.fn(async ({ method }) => {
      if (method === rejectMethod) throw new Error(`User rejected ${method}`)
      if (method === "eth_accounts") return account ? [account] : []
      if (method === "eth_requestAccounts") return account ? [account] : []
      if (method === "eth_chainId") return chainId
      return undefined
    }),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const FORM_DEADLINE = "2030-03-17T12:00"
const FORM_DEADLINE_SECONDS = String(Math.floor(new Date(FORM_DEADLINE).getTime() / 1_000))

function fakeContract(
  readbackGate = deferred<void>(),
  milestoneOverrides: Partial<MilestoneView> = {},
): MilestoneProofContract {
  return {
    address: CONTRACT,
    reads: {
      config: vi.fn(),
      project: vi.fn(async (): Promise<ProjectView> => {
        await readbackGate.promise
        return {
          schemaVersion: 1,
          id: "42",
          sponsor: SPONSOR,
          builder: BUILDER,
          title: "Public release",
          description: "Ship the release",
          status: "ACTIVE",
          currentMilestone: 0,
          createdAt: "1800000000",
          milestoneCount: 1,
        }
      }),
      milestone: vi.fn(async (): Promise<MilestoneView> => {
        await readbackGate.promise
        return {
          schemaVersion: 1,
          projectId: "42",
          index: 0,
          title: "Release v1",
          criteria: ["Release notes document the delivered scope"],
          allowedSources: ["REPOSITORY"],
          deadline: FORM_DEADLINE_SECONDS,
          status: "OPEN",
          openedAt: "1800000000",
          submissionCount: 0,
          currentSubmissionId: "0",
          ...milestoneOverrides,
        }
      }),
      submission: vi.fn(),
      actorProjects: vi.fn(async () => ["42"]),
    },
    writes: {
      createProject: vi.fn(async () => TX_HASH),
      waitForFinalized: vi.fn(async () => ({ executionSucceeded: true })),
    },
  }
}

function renderCreate(contract: MilestoneProofContract, provider: Eip1193Provider | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/projects/new"]} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <WalletProvider provider={provider}>
          <Routes>
            <Route element={<CreateProject contract={contract} />} path="/projects/new" />
            <Route element={<div>Project readback route</div>} path="/projects/:projectId" />
          </Routes>
        </WalletProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function completeRequiredFields(builder: string = BUILDER) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText("Builder address"), builder)
  await user.type(screen.getByLabelText("Project title"), "Public release")
  await user.type(screen.getByLabelText("Project description"), "Ship the release")
  await user.type(screen.getByLabelText("Milestone 1 title"), "Release v1")
  await user.type(screen.getByLabelText("Milestone 1 acceptance criteria"), "Release notes document the delivered scope")
  await user.type(screen.getByLabelText("Milestone 1 deadline"), FORM_DEADLINE)
  return user
}

describe("CreateProject", () => {
  it("shows a connect-wallet call to action and cannot submit while disconnected", () => {
    const gate = deferred<void>()
    const contract = fakeContract(gate)
    renderCreate(contract, null)

    expect(screen.getByRole("heading", { name: "Connect your sponsor wallet" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument()
    expect(contract.writes.createProject).not.toHaveBeenCalled()
  })

  it("renders an accessible error when the wallet connection request is rejected", async () => {
    const contract = fakeContract()
    renderCreate(contract, connectedProvider({ account: null, rejectMethod: "eth_requestAccounts" }))
    const user = userEvent.setup()

    await user.click(await screen.findByRole("button", { name: "Connect wallet" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("User rejected eth_requestAccounts")
    expect(screen.getByRole("heading", { name: "Connect your sponsor wallet" })).toBeInTheDocument()
  })

  it("renders an accessible error when the Studionet switch request is rejected", async () => {
    const contract = fakeContract()
    renderCreate(contract, connectedProvider({ chainId: "0x1", rejectMethod: "wallet_switchEthereumChain" }))
    const user = userEvent.setup()

    await user.click(await screen.findByRole("button", { name: "Switch network" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("User rejected wallet_switchEthereumChain")
    expect(screen.getByRole("heading", { name: "Switch to GenLayer Studionet" })).toBeInTheDocument()
  })

  it("supports one to three milestone definitions and refuses a fourth", async () => {
    const gate = deferred<void>()
    renderCreate(fakeContract(gate), connectedProvider())
    await screen.findByRole("heading", { name: "Create a frozen project" })
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "Add milestone" }))
    await user.click(screen.getByRole("button", { name: "Add milestone" }))

    expect(screen.getAllByRole("group", { name: /Milestone \d/ })).toHaveLength(3)
    expect(screen.getByRole("button", { name: "Add milestone" })).toBeDisabled()
  })

  it("keeps the wizard in place until execution succeeds and authoritative project readback returns", async () => {
    const gate = deferred<void>()
    const contract = fakeContract(gate)
    renderCreate(contract, connectedProvider())
    await screen.findByRole("heading", { name: "Create a frozen project" })
    const user = await completeRequiredFields()

    await user.click(screen.getByRole("button", { name: "Create project on-chain" }))

    await waitFor(() => expect(contract.writes.createProject).toHaveBeenCalledTimes(1))
    expect(contract.writes.waitForFinalized).toHaveBeenCalledWith(TX_HASH)
    expect(screen.queryByText("Project readback route")).not.toBeInTheDocument()
    expect(screen.getByText("Execution succeeded")).toBeInTheDocument()

    gate.resolve()
    expect(await screen.findByText("Project readback route")).toBeInTheDocument()
  })

  it("rejects a builder equal to the connected sponsor before submitting calldata", async () => {
    const gate = deferred<void>()
    const contract = fakeContract(gate)
    renderCreate(contract, connectedProvider())
    await screen.findByRole("heading", { name: "Create a frozen project" })
    const user = await completeRequiredFields(SPONSOR)

    await user.click(screen.getByRole("button", { name: "Create project on-chain" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Sponsor and builder must be different addresses")
    expect(contract.writes.createProject).not.toHaveBeenCalled()
  })

  it("does not navigate when frozen milestone readback differs from the submitted definition", async () => {
    const gate = deferred<void>()
    gate.resolve()
    const contract = fakeContract(gate, { criteria: ["A different frozen criterion"] })
    renderCreate(contract, connectedProvider())
    await screen.findByRole("heading", { name: "Create a frozen project" })
    const user = await completeRequiredFields()

    await user.click(screen.getByRole("button", { name: "Create project on-chain" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("authoritative readback could not be confirmed")
    expect(contract.reads.milestone).toHaveBeenCalledWith("42", 0)
    expect(screen.queryByText("Project readback route")).not.toBeInTheDocument()
  })
})
