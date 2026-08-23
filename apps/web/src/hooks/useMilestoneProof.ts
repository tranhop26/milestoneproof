import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  parseMilestoneInput,
  type EvidenceInput,
  type MilestoneView,
  type ProjectView,
  type SubmissionView,
} from "@milestoneproof/shared"
import { useMemo, useState } from "react"

import {
  createClientNonce,
  createMilestoneProofContract,
  getConfiguredContractAddress,
  type ContractClient,
  type CreateProjectInput,
  type MilestoneProofContract,
} from "../lib/contract"
import { readClient } from "../lib/genlayer"
import {
  runWriteAndReadback,
  TransactionLifecycleError,
  type TransactionState,
} from "../lib/transaction"
import { useWallet } from "../lib/wallet"

export const queryKeys = {
  config: () => ["milestoneProof", "config"] as const,
  project: (projectId: string) => ["milestoneProof", "project", projectId] as const,
  milestones: (projectId: string) => ["milestoneProof", "project", projectId, "milestones"] as const,
  milestone: (projectId: string, index: number) => ["milestoneProof", "project", projectId, "milestones", index] as const,
  submission: (submissionId: string) => ["milestoneProof", "submission", submissionId] as const,
  actorProjects: (role: "sponsor" | "builder", actor: string) => [
    "milestoneProof", "actorProjects", role, actor.toLowerCase(),
  ] as const,
}

export function useMilestoneProofContract(override?: MilestoneProofContract): {
  contract: MilestoneProofContract | null
  configurationError: string | null
} {
  const wallet = useWallet()
  return useMemo(() => {
    if (override) return { contract: override, configurationError: null }
    try {
      return {
        contract: createMilestoneProofContract({
          address: getConfiguredContractAddress(),
          readClient: readClient() as unknown as ContractClient,
          getWriteClient: async () => wallet.getWriteClient() as unknown as ContractClient,
        }),
        configurationError: null,
      }
    } catch (error) {
      return {
        contract: null,
        configurationError: error instanceof Error ? error.message : "The contract is not configured.",
      }
    }
  }, [override, wallet])
}

export function useProject(contract: MilestoneProofContract | null, projectId: string) {
  return useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => {
      if (!contract) throw new Error("The contract is not configured.")
      return contract.reads.project(projectId)
    },
    enabled: Boolean(contract && projectId),
  })
}

export function useMilestones(contract: MilestoneProofContract, project: ProjectView) {
  return useQueries({
    queries: Array.from({ length: project.milestoneCount }, (_, index) => ({
      queryKey: queryKeys.milestone(project.id, index),
      queryFn: () => contract.reads.milestone(project.id, index),
    })),
    combine: (results) => ({
      data: results.every(({ data }) => data !== undefined)
        ? results.map(({ data }) => data as MilestoneView)
        : undefined,
      isPending: results.some(({ isPending }) => isPending),
      error: results.find(({ error }) => error)?.error ?? null,
    }),
  })
}

export function useMilestone(contract: MilestoneProofContract | null, projectId: string, index: number | undefined) {
  return useQuery({
    queryKey: queryKeys.milestone(projectId, index ?? -1),
    queryFn: () => {
      if (!contract || index === undefined) throw new Error("The milestone is not available.")
      return contract.reads.milestone(projectId, index)
    },
    enabled: Boolean(contract && projectId && index !== undefined),
  })
}

export function useSubmission(contract: MilestoneProofContract | null, submissionId: string) {
  return useQuery({
    queryKey: queryKeys.submission(submissionId),
    queryFn: () => {
      if (!contract) throw new Error("The contract is not configured.")
      return contract.reads.submission(submissionId)
    },
    enabled: Boolean(contract),
  })
}

function projectMatchesInput(project: ProjectView, sponsor: string, input: CreateProjectInput): boolean {
  return project.sponsor === sponsor.toLowerCase()
    && project.builder === input.builder.toLowerCase()
    && project.title === input.title.trim()
    && project.description === input.description.trim()
    && project.milestoneCount === input.milestones.length
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

async function frozenMilestonesMatch(
  contract: MilestoneProofContract,
  projectId: string,
  input: CreateProjectInput,
): Promise<boolean> {
  const frozen = await Promise.all(input.milestones.map((_, index) => (
    contract.reads.milestone(projectId, index)
  )))
  return frozen.every((milestone, index) => {
    const submitted = parseMilestoneInput(input.milestones[index])
    return milestone.projectId === projectId
      && milestone.index === index
      && milestone.title === submitted.title.trim()
      && sameStrings(milestone.criteria, submitted.criteria.map((criterion) => criterion.trim()))
      && sameStrings(milestone.allowedSources, submitted.allowedSources)
      && milestone.deadline === submitted.deadline
  })
}

export function useCreateProject(contract: MilestoneProofContract | null) {
  const wallet = useWallet()
  const queryClient = useQueryClient()
  const [transactionState, setTransactionState] = useState<TransactionState>({
    phase: "DISCONNECTED",
    message: "Connect the sponsor wallet to create a project.",
  })

  const mutation = useMutation({
    mutationFn: async (input: CreateProjectInput) => {
      if (!contract) throw new Error("The contract is not configured.")
      const sponsor = wallet.account
      if (sponsor && input.builder.toLowerCase() === sponsor) {
        throw new Error("Sponsor and builder must be different addresses.")
      }
      const readback = await runWriteAndReadback<ProjectView>({
        assertReady: () => {
          if (!sponsor || wallet.status === "DISCONNECTED" || wallet.status === "CONNECTING") {
            throw new TransactionLifecycleError("WALLET_DISCONNECTED", "Connect the sponsor wallet to continue.")
          }
          if (wallet.status === "WRONG_NETWORK") {
            throw new TransactionLifecycleError("WRONG_NETWORK", "Switch to GenLayer Studionet to continue.")
          }
        },
        submit: () => contract.writes.createProject(input, createClientNonce("project")),
        waitForFinalized: contract.writes.waitForFinalized,
        readback: async () => {
          if (!sponsor) throw new Error("The sponsor wallet disconnected before readback.")
          const projectIds = await contract.reads.actorProjects(sponsor, "sponsor")
          const newestProjectId = projectIds[0]
          if (!newestProjectId) throw new Error("The created project is not present in the sponsor index.")
          const project = await contract.reads.project(newestProjectId)
          if (!projectMatchesInput(project, sponsor, input)) {
            throw new Error("The newest sponsor project does not match the submitted project.")
          }
          if (!await frozenMilestonesMatch(contract, project.id, input)) {
            throw new Error("The frozen milestone readback does not match the submitted project.")
          }
          return project
        },
      }, setTransactionState)

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.project(readback.id), exact: true }),
        queryClient.invalidateQueries({ queryKey: queryKeys.milestones(readback.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.actorProjects("sponsor", readback.sponsor), exact: true }),
        queryClient.invalidateQueries({ queryKey: queryKeys.actorProjects("builder", readback.builder), exact: true }),
      ])
      return readback
    },
  })

  return { ...mutation, transactionState }
}

export interface SubmissionReadbackConfirmation {
  submittedDigest: string
  submission: SubmissionView
}

export type MilestoneAction =
  | { kind: "submit", project: ProjectView, milestone: MilestoneView, evidence: EvidenceInput[] }
  | { kind: "resolve", project: ProjectView, milestone: MilestoneView, submission: SubmissionView }
  | { kind: "resubmit", project: ProjectView, milestone: MilestoneView, submission: SubmissionView, evidence: EvidenceInput[] }
  | { kind: "supplement", project: ProjectView, milestone: MilestoneView, submission: SubmissionView, evidence: EvidenceInput[] }
  | { kind: "retry", project: ProjectView, milestone: MilestoneView, submission: SubmissionView }
  | { kind: "expire", project: ProjectView, milestone: MilestoneView, submission?: SubmissionView }

function canonicalEvidence(evidence: EvidenceInput): EvidenceInput {
  return {
    ...evidence,
    subjectRef: evidence.subjectRef.trim(),
    versionRef: evidence.sourceKind === "REPOSITORY" || evidence.sourceKind === "CI"
      ? evidence.versionRef.trim().toLowerCase()
      : evidence.versionRef.trim(),
  }
}

function evidenceMatches(left: EvidenceInput[], right: EvidenceInput[]): boolean {
  if (left.length !== right.length) return false
  return left.every((raw, index) => {
    const a = canonicalEvidence(raw)
    const b = canonicalEvidence(right[index])
    return a.sourceKind === b.sourceKind
      && a.url === b.url
      && a.subjectRef === b.subjectRef
      && a.versionRef === b.versionRef
      && a.observedAt === b.observedAt
  })
}

function assertWalletReady(wallet: ReturnType<typeof useWallet>) {
  if (!wallet.account || wallet.status === "DISCONNECTED" || wallet.status === "CONNECTING") {
    throw new TransactionLifecycleError("WALLET_DISCONNECTED", "Connect a project wallet to continue.")
  }
  if (wallet.status === "WRONG_NETWORK") {
    throw new TransactionLifecycleError("WRONG_NETWORK", "Switch to GenLayer Studionet to continue.")
  }
}

export function useMilestoneActions(contract: MilestoneProofContract | null) {
  const wallet = useWallet()
  const queryClient = useQueryClient()
  const [transactionState, setTransactionState] = useState<TransactionState>({
    phase: "DISCONNECTED",
    message: "Connect an authorized wallet to submit an on-chain action.",
  })

  const mutation = useMutation({
    mutationFn: async (action: MilestoneAction): Promise<SubmissionReadbackConfirmation | MilestoneView> => {
      if (!contract) throw new Error("The contract is not configured.")
      const actor = wallet.account
      let expectedDigest = ""
      const priorSubmissionId = action.kind === "submit" ? action.milestone.currentSubmissionId : action.submission?.id ?? "0"
      const priorResolutionCount = "submission" in action && action.submission ? action.submission.resolutionCount : 0
      const resolutionSubmission = "submission" in action ? action.submission : undefined
      const expectedEvidence = action.kind === "submit" || action.kind === "resubmit"
        ? action.evidence
        : action.kind === "supplement"
          ? [...action.submission.evidence, ...action.evidence]
          : undefined

      const result = await runWriteAndReadback<SubmissionReadbackConfirmation | MilestoneView>({
        assertReady: () => assertWalletReady(wallet),
        submit: async () => {
          switch (action.kind) {
            case "submit": return contract.writes.submitEvidence(action.project.id, action.milestone.index, action.evidence, createClientNonce("submit"))
            case "resolve": return contract.writes.resolveSubmission(action.submission.id)
            case "resubmit": return contract.writes.resubmitEvidence(action.project.id, action.milestone.index, action.evidence, createClientNonce("resubmit"))
            case "supplement": return contract.writes.supplementEvidence(action.submission.id, action.evidence, createClientNonce("supplement"))
            case "retry": return contract.writes.retryResolution(action.submission.id)
            case "expire": return contract.writes.expireMilestone(action.project.id, action.milestone.index)
          }
        },
        waitForFinalized: contract.writes.waitForFinalized,
        readback: async () => {
          if (action.kind === "expire") {
            const [project, milestone] = await Promise.all([
              contract.reads.project(action.project.id),
              contract.reads.milestone(action.project.id, action.milestone.index),
            ])
            if (project.status !== "FAILED" || milestone.status !== "FAILED") {
              throw new Error("Expiry readback did not record FAILED project and milestone states.")
            }
            return milestone
          }

          if (expectedEvidence) {
            const milestone = await contract.reads.milestone(action.project.id, action.milestone.index)
            expectedDigest = milestone.currentSubmissionId
            if (!expectedDigest || expectedDigest === "0" || expectedDigest === priorSubmissionId) {
              throw new Error("The contract did not return a new current submission digest.")
            }
            const submission = await contract.reads.submission(expectedDigest)
            if (submission.id !== expectedDigest || submission.digest !== expectedDigest) {
              throw new Error("Authoritative submission digest does not match the submitted digest.")
            }
            if (submission.projectId !== action.project.id
              || submission.milestoneIndex !== action.milestone.index
              || !actor
              || submission.builder !== actor.toLowerCase()
              || !evidenceMatches(submission.evidence, expectedEvidence)) {
              throw new Error("Authoritative submission readback does not match the submitted evidence.")
            }
            return { submittedDigest: expectedDigest, submission }
          }

          if (!resolutionSubmission) throw new Error("Resolution submission context is missing.")
          const submission = await contract.reads.submission(resolutionSubmission.id)
          if (submission.id !== resolutionSubmission.id || submission.digest !== resolutionSubmission.id) {
            throw new Error("Authoritative submission digest changed during resolution.")
          }
          if (submission.verdict === "NONE" || submission.resolutionCount <= priorResolutionCount) {
            throw new Error("Resolution readback did not confirm a new contract verdict.")
          }
          return { submittedDigest: submission.id, submission }
        },
      }, setTransactionState)

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.project(action.project.id), exact: true }),
        queryClient.invalidateQueries({ queryKey: queryKeys.milestones(action.project.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.milestone(action.project.id, action.milestone.index), exact: true }),
        "submission" in action && action.submission
          ? queryClient.invalidateQueries({ queryKey: queryKeys.submission(action.submission.id), exact: true })
          : Promise.resolve(),
        expectedDigest
          ? queryClient.invalidateQueries({ queryKey: queryKeys.submission(expectedDigest), exact: true })
          : Promise.resolve(),
      ])
      return result
    },
  })

  return { ...mutation, transactionState }
}
