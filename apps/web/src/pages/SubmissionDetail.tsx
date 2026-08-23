import type { EvidenceInput, MilestoneView, ProjectView, SubmissionView } from "@milestoneproof/shared"
import { Check, ExternalLink, History, ShieldCheck, X } from "lucide-react"
import { useState } from "react"
import { Link, useParams } from "react-router-dom"

import { EvidenceEditor, type EvidenceReadbackConfirmation } from "../components/EvidenceEditor"
import { StatusBadge } from "../components/StatusBadge"
import { TransactionPanel } from "../components/TransactionPanel"
import {
  useMilestone,
  useMilestoneActions,
  useMilestoneProofContract,
  useProject,
  useSubmission,
} from "../hooks/useMilestoneProof"
import { STUDIONET_EXPLORER_ADDRESS_URL, type MilestoneProofContract } from "../lib/contract"
import { useWallet } from "../lib/wallet"

const INFO_WINDOW_SECONDS = 72 * 60 * 60

function isSubmissionConfirmation(value: unknown): value is EvidenceReadbackConfirmation {
  return typeof value === "object" && value !== null && "submittedDigest" in value && "submission" in value
}

function AuditPanel({ milestone, submission }: { milestone: MilestoneView, submission: SubmissionView }) {
  const integrity = [
    ["Subject identity", submission.integrity.subjectMatch],
    ["Version binding", submission.integrity.versionMatch],
    ["Freshness", submission.integrity.fresh],
    ["Provenance", submission.integrity.provenanceOk],
  ] as const
  return (
    <div className="audit-grid">
      <section className="audit-card">
        <p className="eyebrow">Criterion coverage</p>
        <ul className="coverage-list">
          {milestone.criteria.map((criterion, index) => {
            const resolved = submission.verdict !== "NONE"
            const met = submission.criteriaMet[index] === true
            return <li key={index}><span>{criterion}</span><strong className={resolved && met ? "audit-pass" : resolved ? "audit-fail" : "audit-pending"}>{resolved && met ? <Check size={13} /> : resolved ? <X size={13} /> : null}{resolved && met ? "Proven" : resolved ? "Missing" : "Pending"}</strong></li>
          })}
        </ul>
      </section>
      <section className="audit-card">
        <p className="eyebrow">Integrity checks</p>
        <div className="integrity-grid">{integrity.map(([label, passed]) => <div key={label}><span>{label}</span><strong className={passed ? "audit-pass" : "audit-fail"}>{passed ? "Pass" : "Fail"}</strong></div>)}</div>
      </section>
      <section className="audit-card audit-rationale">
        <p className="eyebrow">Validator rationale</p>
        <p>{submission.rationale || "No rationale exists before contract resolution."}</p>
      </section>
    </div>
  )
}

function EvidenceReadback({ submission }: { submission: SubmissionView }) {
  return (
    <section className="detail-card">
      <div className="detail-heading"><div><p className="eyebrow">Authoritative evidence</p><h2>{submission.evidence.length} frozen source{submission.evidence.length === 1 ? "" : "s"}</h2></div><span className="revision-chip">Revision {submission.revision}</span></div>
      <div className="evidence-readback-list">
        {submission.evidence.map((item, index) => <article key={`${item.sourceKind}:${item.subjectRef}:${item.versionRef}`}><header><span>0{index + 1}</span><strong>{item.sourceKind}</strong><a aria-label="Open evidence source" href={item.url} rel="noreferrer" target="_blank"><ExternalLink size={14} /></a></header><dl><div><dt>Subject</dt><dd>{item.subjectRef}</dd></div><div><dt>Version</dt><dd>{item.versionRef}</dd></div><div><dt>Observed</dt><dd>{new Date(Number(item.observedAt) * 1_000).toLocaleString()}</dd></div></dl></article>)}
      </div>
    </section>
  )
}

interface SubmissionActionsProps {
  project: ProjectView
  milestone: MilestoneView
  submission: SubmissionView
  now: number
  onAction: ReturnType<typeof useMilestoneActions>
}

function SubmissionActions({ project, milestone, submission, now, onAction }: SubmissionActionsProps) {
  const wallet = useWallet()
  const [actionError, setActionError] = useState("")
  const actor = wallet.account?.toLowerCase()
  const isBuilder = actor === project.builder
  const isParty = isBuilder || actor === project.sponsor
  const retryReady = now >= Number(submission.nextRetryAt)
  const attemptsRemain = milestone.submissionCount < 3
  const beforeDeadline = now < Number(milestone.deadline)
  const canExpire = project.status === "ACTIVE" && (
    (milestone.status === "OPEN" && !beforeDeadline)
    || (submission.verdict === "REJECTED" && !beforeDeadline)
    || (submission.verdict === "REQUEST_MORE_INFO" && now >= Number(submission.resolvedAt) + INFO_WINDOW_SECONDS)
  )

  const run = async (action: Parameters<typeof onAction.mutateAsync>[0]) => {
    setActionError("")
    try { await onAction.mutateAsync(action) } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "The on-chain action failed.")
    }
  }
  const evidenceAction = (kind: "resubmit" | "supplement") => async (evidence: EvidenceInput[]) => {
    const result = await onAction.mutateAsync({ kind, project, milestone, submission, evidence })
    if (!isSubmissionConfirmation(result)) throw new Error("Submission readback was not returned.")
    return result
  }

  return (
    <section className="detail-card action-card">
      <div className="detail-heading"><div><p className="eyebrow">Allowed next action</p><h2>Contract state guard</h2></div>{wallet.status === "DISCONNECTED" || wallet.status === "CONNECTING" ? <StatusBadge status="DISCONNECTED" /> : onAction.transactionState.phase !== "DISCONNECTED" ? <StatusBadge status={onAction.transactionState.phase} /> : <span className="ready-chip">Wallet ready</span>}</div>
      {actionError && <div className="form-alert" role="alert">{actionError}</div>}
      {!isParty && !canExpire && <p className="read-only-note">Connected wallet is read-only for this submission.</p>}
      {submission.verdict === "NONE" && isParty && <button className="primary-button" disabled={onAction.isPending} onClick={() => void run({ kind: "resolve", project, milestone, submission })} type="button">Resolve submission</button>}
      {submission.verdict === "REQUEST_MORE_INFO" && isBuilder && submission.evidence.length < 4 && <EvidenceEditor allowedSources={milestone.allowedSources} disabled={onAction.isPending} maxItems={4 - submission.evidence.length} onSubmit={evidenceAction("supplement")} submitLabel="Supplement evidence" />}
      {submission.verdict === "REQUEST_MORE_INFO" && isBuilder && submission.evidence.length >= 4 && <p className="read-only-note">The four-item evidence limit is exhausted.</p>}
      {submission.verdict === "REQUEST_MORE_INFO" && isParty && !isBuilder && <p className="read-only-note">Waiting for the frozen builder to supplement evidence.</p>}
      {submission.verdict === "UNRESOLVED" && isParty && submission.resolutionCount < 3 && <div className="action-stack"><button className="primary-button" disabled={!retryReady || onAction.isPending} onClick={() => void run({ kind: "retry", project, milestone, submission })} type="button">Retry resolution</button>{!retryReady && <p>Cooldown ends {new Date(Number(submission.nextRetryAt) * 1_000).toLocaleString()}.</p>}</div>}
      {submission.verdict === "UNRESOLVED" && submission.resolutionCount >= 3 && <p className="terminal-note">Resolution attempts are exhausted; retry is suppressed.</p>}
      {submission.verdict === "REJECTED" && isBuilder && attemptsRemain && beforeDeadline && <EvidenceEditor allowedSources={milestone.allowedSources} disabled={onAction.isPending} onSubmit={evidenceAction("resubmit")} submitLabel="Resubmit evidence" />}
      {submission.verdict === "REJECTED" && isParty && !isBuilder && attemptsRemain && beforeDeadline && <p className="read-only-note">Waiting for the frozen builder to submit a new revision.</p>}
      {canExpire && <button className="secondary-button" disabled={onAction.isPending} onClick={() => void run({ kind: "expire", project, milestone, submission })} type="button">Expire milestone</button>}
      {submission.verdict === "APPROVED" && <p className="terminal-note">This submission is terminal; repeat actions are suppressed.</p>}
      {submission.verdict === "REJECTED" && (!attemptsRemain || milestone.status === "FAILED") && <p className="terminal-note">Submission attempts are exhausted; repeat actions are suppressed.</p>}
      {(onAction.isPending || onAction.transactionState.phase !== "DISCONNECTED") && <TransactionPanel state={onAction.transactionState} />}
    </section>
  )
}

export interface SubmissionDetailProps {
  contract?: MilestoneProofContract
  now?: () => number
}

export function SubmissionDetail({ contract: contractOverride, now = () => Date.now() / 1_000 }: SubmissionDetailProps) {
  const { submissionId = "" } = useParams()
  const { contract, configurationError } = useMilestoneProofContract(contractOverride)
  const submissionQuery = useSubmission(contract, submissionId)
  const projectQuery = useProject(contract, submissionQuery.data?.projectId ?? "")
  const milestoneQuery = useMilestone(contract, submissionQuery.data?.projectId ?? "", submissionQuery.data?.milestoneIndex)
  const actions = useMilestoneActions(contract)

  if (configurationError) return <section className="form-alert" role="alert">{configurationError}</section>
  if (submissionQuery.isPending || projectQuery.isPending || milestoneQuery.isPending) return <section aria-live="polite" className="workspace-loading">Loading authoritative submission readback…</section>
  const error = submissionQuery.error || projectQuery.error || milestoneQuery.error
  if (error || !contract || !submissionQuery.data || !projectQuery.data || !milestoneQuery.data) return <section className="form-alert" role="alert">{error instanceof Error ? error.message : "Submission readback failed."}</section>
  const submission = submissionQuery.data
  const project = projectQuery.data
  const milestone = milestoneQuery.data
  return (
    <div className="submission-detail">
      <header className="project-header submission-header"><div><p className="eyebrow">Project #{project.id} · Milestone {milestone.index + 1}</p><div className="project-title-row"><h1>Submission #{submission.id}</h1><StatusBadge status={submission.verdict} /></div><p>{milestone.title}</p></div><div className="submission-identifiers"><span>Revision {submission.revision}</span><code>{submission.digest}</code><Link to={`/projects/${project.id}`}>Back to project</Link><a aria-label="Open contract on explorer" href={`${STUDIONET_EXPLORER_ADDRESS_URL}/${contract.address}`} rel="noreferrer" target="_blank">Contract <ExternalLink size={13} /></a></div></header>
      <section className="revision-bar"><History size={15} /><div><strong>Revision history</strong><span>Current authoritative revision {submission.revision} of {milestone.submissionCount}. Earlier revisions remain immutable by digest.</span></div><ShieldCheck size={16} /></section>
      <EvidenceReadback submission={submission} />
      <AuditPanel milestone={milestone} submission={submission} />
      <SubmissionActions milestone={milestone} now={Math.floor(now())} onAction={actions} project={project} submission={submission} />
    </div>
  )
}
