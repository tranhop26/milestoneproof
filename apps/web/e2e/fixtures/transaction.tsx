import type { MilestoneView } from "@milestoneproof/shared"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router-dom"
import { useState } from "react"

import { AppShell } from "../../src/components/AppShell"
import { MilestoneRail } from "../../src/components/MilestoneRail"
import { TransactionPanel } from "../../src/components/TransactionPanel"
import {
  createMilestoneProofContract,
  type ContractClient,
  type TransactionHash,
} from "../../src/lib/contract"
import {
  runWriteAndReadback,
  type TransactionState,
} from "../../src/lib/transaction"
import "../../src/index.css"

function randomHex(byteLength: number): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength))
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

const CONTRACT_ADDRESS = randomHex(20)
const BUILDER_ADDRESS = randomHex(20)
const TRANSACTION_HASH = randomHex(32) as TransactionHash

const client: ContractClient = {
  readContract: async () => {
    throw new Error("Readback must not run after failed execution.")
  },
  writeContract: async () => TRANSACTION_HASH,
  waitForTransactionReceipt: async () => {
    const response = await fetch("/__e2e/receipt")
    if (!response.ok) throw new Error("Receipt fixture was not intercepted.")
    return await response.json() as Awaited<ReturnType<ContractClient["waitForTransactionReceipt"]>>
  },
}

const contract = createMilestoneProofContract({
  address: CONTRACT_ADDRESS,
  readClient: client,
  getWriteClient: async () => client,
})

const milestones: MilestoneView[] = [
  {
    schemaVersion: 1,
    projectId: "1",
    index: 0,
    title: "Verify release evidence",
    criteria: ["Repository commit is public and matches the frozen version."],
    allowedSources: ["REPOSITORY"],
    deadline: "1900000000",
    status: "OPEN",
    openedAt: "1800000000",
    submissionCount: 0,
    currentSubmissionId: "0",
  },
  {
    schemaVersion: 1,
    projectId: "1",
    index: 1,
    title: "Confirm deployment",
    criteria: ["Deployment is publicly reachable."],
    allowedSources: ["DEPLOYMENT"],
    deadline: "1900000100",
    status: "LOCKED",
    openedAt: "0",
    submissionCount: 0,
    currentSubmissionId: "0",
  },
]

export function TransactionFixture() {
  const [state, setState] = useState<TransactionState>({
    phase: "PENDING",
    hash: TRANSACTION_HASH,
    message: "Fixture is ready to intercept a finalized receipt.",
  })
  const [readbackCalls, setReadbackCalls] = useState(0)

  const submit = async () => {
    try {
      await runWriteAndReadback({
        assertReady: () => undefined,
        submit: () => contract.writes.createProject({
          builder: BUILDER_ADDRESS,
          title: "Receipt failure fixture",
          description: "Exercise the real contract adapter without a live network.",
          milestones: [{
            title: "Intercept receipt",
            criteria: ["The intercepted receipt rejects execution."],
            allowedSources: ["REPOSITORY"],
            deadline: String(Math.floor(Date.now() / 1_000) + 86_400),
          }],
        }, `fixture:${crypto.randomUUID()}`),
        waitForFinalized: contract.writes.waitForFinalized,
        readback: async () => {
          setReadbackCalls((count) => count + 1)
          return { unreachable: true }
        },
      }, setState)
    } catch {
      // The error is rendered from the lifecycle state by the real transaction panel.
    }
  }

  return (
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AppShell actions={<button className="wallet-button" type="button">0xfixture</button>}>
        <div className="workspace-stack" data-testid="responsive-harness">
          <section className="rail-card">
            <div className="section-label"><span>Contract milestone sequence</span></div>
            <MilestoneRail milestones={milestones} />
          </section>
          <div className="workspace-grid" data-testid="workspace-columns">
            <section className="workspace-card">
              <p className="eyebrow">Browser fixture</p>
              <h1>Contract adapter receipt boundary</h1>
              <p>This test-only page renders the production shell and transaction components.</p>
              <button className="primary-button" onClick={() => void submit()} type="button">
                Submit fixture transaction
              </button>
              <dl>
                <div><dt>Current phase</dt><dd data-testid="fixture-phase">{state.phase}</dd></div>
                <div><dt>Readback calls</dt><dd data-testid="readback-calls">{readbackCalls}</dd></div>
              </dl>
            </section>
            <TransactionPanel state={state} />
          </div>
        </div>
      </AppShell>
    </MemoryRouter>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("Fixture root is missing")
createRoot(root).render(<TransactionFixture />)
