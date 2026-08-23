import type { MilestoneInput, SourceKind } from "@milestoneproof/shared"
import { AlertCircle, LockKeyhole, Plus, Trash2, Wallet } from "lucide-react"
import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"

import { TransactionPanel } from "../components/TransactionPanel"
import { useCreateProject, useMilestoneProofContract } from "../hooks/useMilestoneProof"
import type { CreateProjectInput, MilestoneProofContract } from "../lib/contract"
import { useWallet } from "../lib/wallet"

const SOURCE_KINDS: SourceKind[] = ["REPOSITORY", "RELEASE", "CI", "DEPLOYMENT"]

interface MilestoneDraft {
  title: string
  criteria: string
  allowedSource: SourceKind
  deadline: string
}

function emptyMilestone(): MilestoneDraft {
  return { title: "", criteria: "", allowedSource: "REPOSITORY", deadline: "" }
}

function toMilestoneInput(draft: MilestoneDraft): MilestoneInput {
  const timestamp = new Date(draft.deadline).getTime()
  return {
    title: draft.title,
    criteria: draft.criteria.split("\n").map((criterion) => criterion.trim()).filter(Boolean),
    allowedSources: [draft.allowedSource],
    deadline: Number.isFinite(timestamp) ? String(Math.floor(timestamp / 1_000)) : "0",
  }
}

export interface CreateProjectProps {
  contract?: MilestoneProofContract
}

export function CreateProject({ contract: contractOverride }: CreateProjectProps) {
  const wallet = useWallet()
  const navigate = useNavigate()
  const { contract, configurationError } = useMilestoneProofContract(contractOverride)
  const createProject = useCreateProject(contract)
  const [builder, setBuilder] = useState("")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([emptyMilestone()])
  const [formError, setFormError] = useState("")

  const updateMilestone = (index: number, patch: Partial<MilestoneDraft>) => {
    setMilestones((current) => current.map((milestone, position) => (
      position === index ? { ...milestone, ...patch } : milestone
    )))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setFormError("")
    const input: CreateProjectInput = {
      builder,
      title,
      description,
      milestones: milestones.map(toMilestoneInput),
    }
    try {
      const project = await createProject.mutateAsync(input)
      navigate(`/projects/${project.id}`)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The project transaction failed.")
    }
  }

  if (wallet.status === "DISCONNECTED" || wallet.status === "CONNECTING") {
    return (
      <section className="connection-gate">
        <span className="gate-icon"><Wallet aria-hidden="true" size={22} /></span>
        <p className="eyebrow">Sponsor authorization</p>
        <h1>Connect your sponsor wallet</h1>
        <p>The connected address becomes the immutable project sponsor. Connect before defining the frozen scope.</p>
        <button className="primary-button" disabled={wallet.status === "CONNECTING"} onClick={() => void wallet.connect()} type="button">
          {wallet.status === "CONNECTING" ? "Connecting…" : "Connect wallet"}
        </button>
      </section>
    )
  }

  if (wallet.status === "WRONG_NETWORK") {
    return (
      <section className="connection-gate">
        <span className="gate-icon"><AlertCircle aria-hidden="true" size={22} /></span>
        <p className="eyebrow">Wrong network</p>
        <h1>Switch to GenLayer Studionet</h1>
        <p>Project creation is configured for Studionet and will not be submitted on another chain.</p>
        <button className="primary-button" onClick={() => void wallet.switchToStudionet()} type="button">Switch network</button>
      </section>
    )
  }

  return (
    <div className="create-layout">
      <form className="creation-form" onSubmit={(event) => void submit(event)}>
        <header className="page-heading">
          <div>
            <p className="eyebrow">Immutable agreement</p>
            <h1>Create a frozen project</h1>
            <p>These parties, milestones, criteria, sources, and deadlines cannot be edited after contract execution.</p>
          </div>
          <span className="frozen-chip"><LockKeyhole size={13} /> Intentionally frozen</span>
        </header>

        {configurationError && <div className="form-alert" role="alert">{configurationError}</div>}
        {formError && <div className="form-alert" role="alert">{formError}</div>}

        <section className="form-card">
          <div className="form-section-heading"><span>01</span><div><h2>Project parties</h2><p>Your connected account is the sponsor.</p></div></div>
          <div className="field-grid">
            <label className="field field-full"><span>Sponsor address</span><input disabled value={wallet.account ?? ""} /></label>
            <label className="field field-full"><span>Builder address</span><input autoComplete="off" onChange={(event) => setBuilder(event.target.value)} placeholder="0x…" required value={builder} /></label>
            <label className="field"><span>Project title</span><input maxLength={120} onChange={(event) => setTitle(event.target.value)} required value={title} /></label>
            <label className="field"><span>Project description</span><textarea maxLength={2000} onChange={(event) => setDescription(event.target.value)} required rows={3} value={description} /></label>
          </div>
        </section>

        <section className="form-card">
          <div className="form-section-heading"><span>02</span><div><h2>Frozen milestones</h2><p>Define one to three sequential checkpoints.</p></div></div>
          <div className="milestone-editor-list">
            {milestones.map((milestone, index) => (
              <fieldset aria-label={`Milestone ${index + 1}`} className="milestone-editor" key={index}>
                <legend>Milestone {index + 1}</legend>
                {milestones.length > 1 && (
                  <button aria-label={`Remove milestone ${index + 1}`} className="remove-button" onClick={() => setMilestones((current) => current.filter((_, position) => position !== index))} type="button">
                    <Trash2 size={14} />
                  </button>
                )}
                <label className="field"><span>Title</span><input aria-label={`Milestone ${index + 1} title`} maxLength={120} onChange={(event) => updateMilestone(index, { title: event.target.value })} required value={milestone.title} /></label>
                <label className="field"><span>Acceptance criteria <small>One criterion per line</small></span><textarea aria-label={`Milestone ${index + 1} acceptance criteria`} onChange={(event) => updateMilestone(index, { criteria: event.target.value })} required rows={4} value={milestone.criteria} /></label>
                <div className="field-grid compact-grid">
                  <label className="field"><span>Allowed evidence</span><select aria-label={`Milestone ${index + 1} allowed evidence`} onChange={(event) => updateMilestone(index, { allowedSource: event.target.value as SourceKind })} value={milestone.allowedSource}>{SOURCE_KINDS.map((source) => <option key={source}>{source}</option>)}</select></label>
                  <label className="field"><span>Deadline</span><input aria-label={`Milestone ${index + 1} deadline`} onChange={(event) => updateMilestone(index, { deadline: event.target.value })} required type="datetime-local" value={milestone.deadline} /></label>
                </div>
              </fieldset>
            ))}
          </div>
          <button className="secondary-button add-milestone" disabled={milestones.length >= 3} onClick={() => setMilestones((current) => [...current, emptyMilestone()])} type="button"><Plus size={14} /> Add milestone</button>
        </section>

        <div className="creation-actions">
          <p>Submitting creates an on-chain immutable project. No verdict is selected at creation.</p>
          <button className="primary-button" disabled={!contract || createProject.isPending} type="submit">
            {createProject.isPending ? "Creating project…" : "Create project on-chain"}
          </button>
        </div>
      </form>

      <aside className="create-sidebar">
        <section className="summary-card"><p className="eyebrow">Frozen summary</p><dl><div><dt>Sponsor</dt><dd>{wallet.account}</dd></div><div><dt>Builder</dt><dd>{builder || "Not set"}</dd></div><div><dt>Milestones</dt><dd>{milestones.length} / 3</dd></div><div><dt>Contract</dt><dd>{contract?.address ?? "Not configured"}</dd></div></dl></section>
        {(createProject.isPending || createProject.transactionState.phase !== "DISCONNECTED") && <TransactionPanel state={createProject.transactionState} />}
      </aside>
    </div>
  )
}
