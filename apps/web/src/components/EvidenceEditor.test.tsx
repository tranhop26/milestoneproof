import type { EvidenceInput, SubmissionView } from "@milestoneproof/shared"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { EvidenceEditor, type EvidenceReadbackConfirmation } from "./EvidenceEditor"

const DIGEST = "987654321"

function submission(digest = DIGEST): SubmissionView {
  return {
    schemaVersion: 2,
    id: digest,
    projectId: "7",
    milestoneIndex: 0,
    revision: 1,
    verdict: "NONE",
    builder: "0x2000000000000000000000000000000000000002",
    submittedAt: "1800000200",
    evidence: [],
    digest,
    criteriaMet: [],
    missingCriteria: [],
    integrity: { subjectMatch: false, versionMatch: false, fresh: false, provenanceOk: false },
    rationale: "",
    resolvedAt: "0",
    resolutionCount: 0,
    nextRetryAt: "0",
    freshnessDeadline: "1900000000",
  }
}

async function fillValidEvidence() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText("Evidence 1 URL"), "https://github.com/example/compiler/commit/0123456789abcdef0123456789abcdef01234567")
  await user.type(screen.getByLabelText("Evidence 1 subject"), "github.com/example/compiler")
  await user.type(screen.getByLabelText("Evidence 1 version"), "0123456789abcdef0123456789abcdef01234567")
  await user.type(screen.getByLabelText("Evidence 1 observed at"), "2030-01-01T10:00")
  return user
}

describe("EvidenceEditor", () => {
  it("validates all five fields with shared evidence rules before submission", async () => {
    const onSubmit = vi.fn<() => Promise<EvidenceReadbackConfirmation>>()
    render(<EvidenceEditor allowedSources={["REPOSITORY"]} onSubmit={onSubmit} submitLabel="Submit evidence" />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "Submit evidence" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(/URL|required/i)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("supports at most four evidence rows", async () => {
    render(<EvidenceEditor allowedSources={["REPOSITORY", "RELEASE"]} onSubmit={vi.fn()} submitLabel="Submit evidence" />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "Add evidence" }))
    await user.click(screen.getByRole("button", { name: "Add evidence" }))
    await user.click(screen.getByRole("button", { name: "Add evidence" }))

    expect(screen.getAllByRole("group", { name: /Evidence \d/ })).toHaveLength(4)
    expect(screen.getByRole("button", { name: "Add evidence" })).toBeDisabled()
  })

  it("keeps the draft until authoritative returned digest matches the submitted digest", async () => {
    const mismatch = vi.fn(async (items: EvidenceInput[]): Promise<EvidenceReadbackConfirmation> => ({
      submittedDigest: DIGEST,
      submission: { ...submission("123"), evidence: items },
    }))
    const { rerender } = render(<EvidenceEditor allowedSources={["REPOSITORY"]} onSubmit={mismatch} submitLabel="Submit evidence" />)
    const user = await fillValidEvidence()

    await user.click(screen.getByRole("button", { name: "Submit evidence" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("digest does not match")
    expect(screen.getByLabelText("Evidence 1 subject")).toHaveValue("github.com/example/compiler")

    const confirmed = vi.fn(async (items: EvidenceInput[]): Promise<EvidenceReadbackConfirmation> => ({
      submittedDigest: DIGEST,
      submission: { ...submission(), evidence: items },
    }))
    rerender(<EvidenceEditor allowedSources={["REPOSITORY"]} onSubmit={confirmed} submitLabel="Submit evidence" />)
    await user.click(screen.getByRole("button", { name: "Submit evidence" }))

    expect(await screen.findByText("Authoritative submission #987654321 confirmed.")).toBeInTheDocument()
    expect(screen.getByLabelText("Evidence 1 subject")).toHaveValue("")
  })

  it("retains a complete draft after a finalized execution error", async () => {
    const onSubmit = vi.fn(async () => { throw new Error("Contract execution ended as FAILED") })
    render(<EvidenceEditor allowedSources={["REPOSITORY"]} onSubmit={onSubmit} submitLabel="Supplement evidence" />)
    const user = await fillValidEvidence()

    await user.click(screen.getByRole("button", { name: "Supplement evidence" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Contract execution ended as FAILED")
    expect(screen.getByLabelText("Evidence 1 version")).toHaveValue("0123456789abcdef0123456789abcdef01234567")
  })
})
