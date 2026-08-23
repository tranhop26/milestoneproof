import type { EvidenceInput, MilestoneView, ProjectView } from "@milestoneproof/shared"
import { ExternalLink, FileCheck2, Fingerprint, ShieldCheck } from "lucide-react"
import { useState } from "react"
import { Link, useParams } from "react-router-dom"

import { EvidenceEditor, type EvidenceReadbackConfirmation } from "../components/EvidenceEditor"
import { MilestoneRail } from "../components/MilestoneRail"
import { StatusBadge } from "../components/StatusBadge"
import { TransactionPanel } from "../components/TransactionPanel"
import { useMilestoneActions, useMilestoneProofContract, useMilestones, useProject } from "../hooks/useMilestoneProof"
import { STUDIONET_EXPLORER_ADDRESS_URL, type MilestoneProofContract } from "../lib/contract"
import { useWallet } from "../lib/wallet"

const TABS = ["Overview", "Evidence", "Submissions", "On-chain activity"] as const
type WorkspaceTab = typeof TABS[number]

function AddressRow({ label, address }: { label: string, address: string }) {
  return <div><dt>{label}</dt><dd><span>{address}</span><a aria-label={`Open ${label.toLowerCase()} address on explorer`} href={`${STUDIONET_EXPLORER_ADDRESS_URL}/${address}`} rel="noreferrer" target="_blank"><ExternalLink size={13} /></a></dd></div>
}

function OverviewPanel({ milestones }: { milestones: MilestoneView[] }) {
  return (
    <div className="workspace-grid">
      <section className="workspace-card">
        <p className="eyebrow">Frozen criteria</p>
        <div className="criteria-list">
          {milestones.map((milestone) => <article key={milestone.index}><header><span>0{milestone.index + 1}</span><h3>{milestone.title}</h3><StatusBadge status={milestone.status} /></header><ul>{milestone.criteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul></article>)}
        </div>
      </section>
      <aside className="workspace-card trust-panel"><ShieldCheck size={18} /><h2>Authoritative readback</h2><p>Project state, milestone order, and criteria shown here are parsed directly from the configured Intelligent Contract.</p></aside>
    </div>
  )
}

function WorkspaceContent({ contract, project, now }: { contract: MilestoneProofContract, project: ProjectView, now: () => number }) {
  const milestoneQueries = useMilestones(contract, project)
  const wallet = useWallet()
  const actions = useMilestoneActions(contract, now)
  const [tab, setTab] = useState<WorkspaceTab>("Overview")
  const [actionError, setActionError] = useState("")
  if (milestoneQueries.isPending) return <section aria-live="polite" className="workspace-loading">Loading authoritative milestones…</section>
  if (milestoneQueries.error || !milestoneQueries.data) return <section className="form-alert" role="alert">{milestoneQueries.error instanceof Error ? milestoneQueries.error.message : "Milestone readback failed."}</section>
  const milestones = milestoneQueries.data
  const submissions = milestones.filter(({ currentSubmissionId }) => currentSubmissionId !== "0")
  const currentMilestone = milestones[project.currentMilestone]
  const walletReady = wallet.status === "CONNECTED"
  const wrongNetwork = wallet.status === "WRONG_NETWORK"
  const isBuilder = walletReady && wallet.account?.toLowerCase() === project.builder
  const canExpireOpen = walletReady
    && project.status === "ACTIVE"
    && currentMilestone?.status === "OPEN"
    && Math.floor(now()) >= Number(currentMilestone.deadline)
  const submitEvidence = async (evidence: EvidenceInput[]): Promise<EvidenceReadbackConfirmation> => {
    if (!currentMilestone) throw new Error("The current milestone is unavailable.")
    const result = await actions.mutateAsync({ kind: "submit", project, milestone: currentMilestone, evidence })
    if ("submittedDigest" in result) return result
    throw new Error("Submission readback was not returned.")
  }
  const expireCurrentMilestone = async () => {
    if (!currentMilestone) return
    setActionError("")
    try { await actions.mutateAsync({ kind: "expire", project, milestone: currentMilestone }) } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Milestone expiry failed.")
    }
  }

  return (
    <div className="workspace-stack">
      <header className="project-header">
        <div><p className="eyebrow">Project #{project.id}</p><div className="project-title-row"><h1>{project.title}</h1><StatusBadge status={project.status} /></div><p>{project.description}</p></div>
        <dl className="identity-grid">
          <AddressRow address={project.sponsor} label="Sponsor" />
          <AddressRow address={project.builder} label="Builder" />
          <AddressRow address={contract.address} label="Contract" />
        </dl>
        <a className="secondary-button contract-link" href={`${STUDIONET_EXPLORER_ADDRESS_URL}/${contract.address}`} rel="noreferrer" target="_blank">View contract on explorer <ExternalLink size={14} /></a>
      </header>

      <section className="rail-card"><div className="section-label"><Fingerprint size={15} /><span>Contract milestone sequence</span></div><MilestoneRail milestones={milestones} /></section>

      <div aria-label="Project workspace views" className="workspace-tabs" role="tablist">
        {TABS.map((label) => <button aria-selected={tab === label} className={tab === label ? "workspace-tab active" : "workspace-tab"} key={label} onClick={() => setTab(label)} role="tab" type="button">{label}</button>)}
      </div>

      <section aria-label={`${tab} panel`} className="tab-panel" role="tabpanel">
        {tab === "Overview" && <OverviewPanel milestones={milestones} />}
        {tab === "Evidence" && currentMilestone?.status === "OPEN" && wrongNetwork && <div className="truthful-empty"><span className="wrong-network-chip">WRONG_NETWORK</span><h2>Studionet required</h2><p className="network-guidance">Switch to GenLayer Studionet to continue.</p></div>}
        {tab === "Evidence" && currentMilestone?.status === "OPEN" && !wrongNetwork && isBuilder && <EvidenceEditor allowedSources={currentMilestone.allowedSources} disabled={actions.isPending} onSubmit={submitEvidence} submitLabel="Submit evidence" />}
        {tab === "Evidence" && currentMilestone?.status === "OPEN" && !wrongNetwork && !isBuilder && <div className="truthful-empty"><FileCheck2 size={20} /><h2>Builder action required</h2><p>Only the frozen builder can submit evidence for this open milestone.</p></div>}
        {tab === "Evidence" && canExpireOpen && <div className="permissionless-expiry">{actionError && <div className="form-alert" role="alert">{actionError}</div>}<p>The frozen deadline has elapsed. Any connected Studionet wallet can close this milestone.</p><button className="secondary-button" disabled={actions.isPending} onClick={() => void expireCurrentMilestone()} type="button">Expire milestone</button></div>}
        {tab === "Evidence" && currentMilestone?.status !== "OPEN" && <div className="truthful-empty"><FileCheck2 size={20} /><h2>Evidence belongs to submissions</h2><p>{submissions.length ? "Open a submission to inspect its authoritative evidence readback." : "No milestone currently references an on-chain submission."}</p></div>}
        {tab === "Submissions" && (submissions.length ? <div className="submission-index">{submissions.map((milestone) => <Link className="submission-row" key={milestone.currentSubmissionId} to={`/submissions/${milestone.currentSubmissionId}`}><span>Milestone {milestone.index + 1}</span><strong>Submission #{milestone.currentSubmissionId}</strong><StatusBadge status={milestone.status} /></Link>)}</div> : <div className="truthful-empty"><h2>No submissions yet</h2><p>The contract has not recorded a submission for this project.</p></div>)}
        {tab === "On-chain activity" && (actions.transactionState.phase === "DISCONNECTED" ? <div className="truthful-empty"><h2>No activity feed available</h2><p>No on-chain activity is available from contract reads yet.</p></div> : <TransactionPanel state={actions.transactionState} />)}
      </section>
      {tab !== "On-chain activity" && (actions.isPending || actions.transactionState.phase !== "DISCONNECTED") && (
        <TransactionPanel state={actions.transactionState} />
      )}
    </div>
  )
}

export interface ProjectWorkspaceProps {
  contract?: MilestoneProofContract
  now?: () => number
}

export function ProjectWorkspace({ contract: contractOverride, now = () => Date.now() / 1_000 }: ProjectWorkspaceProps) {
  const { projectId = "" } = useParams()
  const { contract, configurationError } = useMilestoneProofContract(contractOverride)
  const projectQuery = useProject(contract, projectId)

  if (configurationError) return <section className="form-alert" role="alert">{configurationError}</section>
  if (projectQuery.isPending) return <section aria-live="polite" className="workspace-loading">Loading authoritative project readback…</section>
  if (projectQuery.error || !projectQuery.data || !contract) return <section className="form-alert" role="alert">{projectQuery.error instanceof Error ? projectQuery.error.message : "Project readback failed."}</section>
  return <WorkspaceContent contract={contract} now={now} project={projectQuery.data} />
}
