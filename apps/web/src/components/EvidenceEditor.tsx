import { parseEvidenceInput, type EvidenceInput, type SourceKind, type SubmissionView } from "@milestoneproof/shared"
import { Plus, Trash2 } from "lucide-react"
import { useState, type FormEvent } from "react"

export interface EvidenceReadbackConfirmation {
  submittedDigest: string
  submission: SubmissionView
}

interface EvidenceDraft {
  sourceKind: SourceKind
  url: string
  subjectRef: string
  versionRef: string
  observedAt: string
}

export interface EvidenceEditorProps {
  allowedSources: SourceKind[]
  onSubmit: (evidence: EvidenceInput[]) => Promise<EvidenceReadbackConfirmation>
  submitLabel: string
  disabled?: boolean
  maxItems?: number
}

function emptyEvidence(sourceKind: SourceKind): EvidenceDraft {
  return { sourceKind, url: "", subjectRef: "", versionRef: "", observedAt: "" }
}

function toEvidenceInput(draft: EvidenceDraft): EvidenceInput {
  const timestamp = new Date(draft.observedAt).getTime()
  return parseEvidenceInput({
    sourceKind: draft.sourceKind,
    url: draft.url,
    subjectRef: draft.subjectRef,
    versionRef: draft.versionRef,
    observedAt: Number.isFinite(timestamp) ? String(Math.floor(timestamp / 1_000)) : "",
  })
}

export function EvidenceEditor({
  allowedSources,
  onSubmit,
  submitLabel,
  disabled = false,
  maxItems = 4,
}: EvidenceEditorProps) {
  const firstSource = allowedSources[0] ?? "REPOSITORY"
  const boundedMaximum = Math.max(1, Math.min(4, maxItems))
  const [drafts, setDrafts] = useState<EvidenceDraft[]>([emptyEvidence(firstSource)])
  const [error, setError] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const update = (index: number, patch: Partial<EvidenceDraft>) => {
    setDrafts((current) => current.map((draft, position) => position === index ? { ...draft, ...patch } : draft))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError("")
    setConfirmation("")
    try {
      const evidence = drafts.map(toEvidenceInput)
      setSubmitting(true)
      const result = await onSubmit(evidence)
      if (result.submittedDigest !== result.submission.digest || result.submission.id !== result.submission.digest) {
        throw new Error("Authoritative submission digest does not match the submitted digest.")
      }
      setDrafts([emptyEvidence(firstSource)])
      setConfirmation(`Authoritative submission #${result.submission.id} confirmed.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Evidence submission failed.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="evidence-editor" onSubmit={(event) => void submit(event)}>
      <div className="evidence-editor-header">
        <div><h3>Evidence revision</h3><p>Each row is validated and then frozen by the contract.</p></div>
        <span>{drafts.length} / {boundedMaximum}</span>
      </div>
      {error && <div className="form-alert" role="alert">{error}</div>}
      {confirmation && <div aria-live="polite" className="readback-confirmation">{confirmation}</div>}
      <div className="evidence-row-list">
        {drafts.map((draft, index) => (
          <fieldset aria-label={`Evidence ${index + 1}`} className="evidence-row" key={index}>
            <legend>Evidence {index + 1}</legend>
            {drafts.length > 1 && <button aria-label={`Remove evidence ${index + 1}`} className="remove-button" onClick={() => setDrafts((current) => current.filter((_, position) => position !== index))} type="button"><Trash2 size={14} /></button>}
            <div className="field-grid compact-grid">
              <label className="field"><span>Source kind</span><select aria-label={`Evidence ${index + 1} source kind`} onChange={(event) => update(index, { sourceKind: event.target.value as SourceKind })} value={draft.sourceKind}>{allowedSources.map((source) => <option key={source}>{source}</option>)}</select></label>
              <label className="field"><span>Observed at</span><input aria-label={`Evidence ${index + 1} observed at`} onChange={(event) => update(index, { observedAt: event.target.value })} type="datetime-local" value={draft.observedAt} /></label>
            </div>
            <label className="field"><span>Public HTTPS URL</span><input aria-label={`Evidence ${index + 1} URL`} onChange={(event) => update(index, { url: event.target.value })} placeholder="https://…" value={draft.url} /></label>
            <label className="field"><span>Subject reference</span><input aria-label={`Evidence ${index + 1} subject`} maxLength={255} onChange={(event) => update(index, { subjectRef: event.target.value })} placeholder="github.com/owner/repository" value={draft.subjectRef} /></label>
            <label className="field"><span>Full version reference</span><input aria-label={`Evidence ${index + 1} version`} maxLength={255} onChange={(event) => update(index, { versionRef: event.target.value })} placeholder="40-character commit SHA or immutable release tag" value={draft.versionRef} /></label>
          </fieldset>
        ))}
      </div>
      <div className="evidence-editor-actions">
        <button className="secondary-button" disabled={disabled || submitting || drafts.length >= boundedMaximum} onClick={() => setDrafts((current) => [...current, emptyEvidence(firstSource)])} type="button"><Plus size={14} /> Add evidence</button>
        <button className="primary-button" disabled={disabled || submitting} type="submit">{submitting ? "Submitting…" : submitLabel}</button>
      </div>
    </form>
  )
}
