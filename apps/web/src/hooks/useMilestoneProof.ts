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
  type ActorRole,
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

const INFO_WINDOW_SECONDS = 72 * 60 * 60
const READBACK_ATTEMPTS = 10
const READBACK_RETRY_DELAY_MS = 500

class AuthoritativeMismatchError extends Error {}

async function reconcileAuthoritativeReadback<T>(read: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= READBACK_ATTEMPTS; attempt += 1) {
    try {
      return await read()
    } catch (error) {
      if (error instanceof AuthoritativeMismatchError) throw error
      lastError = error
      if (attempt < READBACK_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, READBACK_RETRY_DELAY_MS))
      }
    }
  }
  throw lastError
}

export const queryKeys = {
  config: () => ["milestoneProof", "config"] as const,
  project: (projectId: string) => ["milestoneProof", "project", projectId] as const,
  milestones: (projectId: string) => ["milestoneProof", "project", projectId, "milestones"] as const,
  milestone: (projectId: string, index: number) => ["milestoneProof", "project", projectId, "milestones", index] as const,
  submission: (submissionId: string) => ["milestoneProof", "submission", submissionId] as const,
  actorProjectEntries: (actor: string) => [
    "milestoneProof", "actorProjectEntries", actor.toLowerCase(),
  ] as const,
}

export interface ActorProjectEntry {
  project: ProjectView
  roles: ActorRole[]
}

export function useActorProjects(
  contract: MilestoneProofContract | null,
  actor: string | null,
  enabled = true,
) {
  const normalizedActor = actor?.toLowerCase() ?? ""
  return useQuery({
    queryKey: queryKeys.actorProjectEntries(normalizedActor),
    queryFn: async (): Promise<ActorProjectEntry[]> => {
      if (!contract || !normalizedActor) throw new Error("A connected actor and contract are required.")
      const [sponsorIds, builderIds] = await Promise.all([
        contract.reads.actorProjects(normalizedActor, "sponsor"),
        contract.reads.actorProjects(normalizedActor, "builder"),
      ])
      const orderedIds: string[] = []
      const rolesById = new Map<string, Set<ActorRole>>()
      const add = (ids: string[], role: ActorRole) => {
        for (const id of ids) {
          let roles = rolesById.get(id)
          if (!roles) {
            roles = new Set<ActorRole>()
            rolesById.set(id, roles)
            orderedIds.push(id)
          }
          roles.add(role)
        }
      }
      add(sponsorIds, "sponsor")
      add(builderIds, "builder")
      const projects = await Promise.all(orderedIds.map((id) => contract.reads.project(id)))
      return projects.map((project, index) => ({
        project,
        roles: Array.from(rolesById.get(orderedIds[index]) ?? []),
      }))
    },
    enabled: Boolean(enabled && contract && normalizedActor),
  })
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
        readback: () => reconcileAuthoritativeReadback(async () => {
          if (!sponsor) throw new Error("The sponsor wallet disconnected before readback.")
          const projectIds = await contract.reads.actorProjects(sponsor, "sponsor")
          const newestProjectId = projectIds[0]
          if (!newestProjectId) throw new Error("The created project is not present in the sponsor index.")
          const project = await contract.reads.project(newestProjectId)
          if (!projectMatchesInput(project, sponsor, input)) {
            throw new Error("The newest sponsor project does not match the submitted project.")
          }
          if (!await frozenMilestonesMatch(contract, project.id, input)) {
            throw new AuthoritativeMismatchError("The frozen milestone readback does not match the submitted project.")
          }
          return project
        }),
      }, setTransactionState)

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.project(readback.id), exact: true }),
        queryClient.invalidateQueries({ queryKey: queryKeys.milestones(readback.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.actorProjectEntries(readback.sponsor), exact: true }),
        queryClient.invalidateQueries({ queryKey: queryKeys.actorProjectEntries(readback.builder), exact: true }),
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

interface AuthoritativeActionContext {
  project: ProjectView
  milestone: MilestoneView
  submission?: SubmissionView
}

function assertCurrentProjectContext(project: ProjectView, milestone: MilestoneView) {
  if (project.status !== "ACTIVE") throw new Error("Project is not active.")
  if (project.currentMilestone !== milestone.index) throw new Error("Milestone is not the current project milestone.")
  if (milestone.projectId !== project.id) throw new Error("Milestone does not belong to this project.")
}

function assertActionAllowed(action: MilestoneAction, actor: string, now: number, context: AuthoritativeActionContext) {
  const { project, milestone, submission } = context
  assertCurrentProjectContext(project, milestone)
  const isBuilder = actor === project.builder
  const isParty = isBuilder || actor === project.sponsor
  const actionSubmission = action.kind === "submit" ? undefined : action.submission
  const requiresCurrentSubmission = action.kind !== "submit"
    && (action.kind !== "expire" || milestone.status === "SUBMITTED")
  if (requiresCurrentSubmission && (!actionSubmission
    || actionSubmission.id !== milestone.currentSubmissionId
    || !submission
    || submission.id !== milestone.currentSubmissionId
    || submission.projectId !== project.id
    || submission.milestoneIndex !== milestone.index)) {
    throw new Error("Submission is not the authoritative current submission.")
  }
  if (action.kind === "expire") {
    if (action.submission && action.submission.id !== milestone.currentSubmissionId) {
      throw new Error("Submission is not the authoritative current submission.")
    }
    const expiryAllowed = milestone.status === "OPEN"
      ? now >= Number(milestone.deadline)
      : milestone.status === "SUBMITTED" && submission?.verdict === "REJECTED"
        ? now >= Number(milestone.deadline)
        : milestone.status === "SUBMITTED" && submission?.verdict === "REQUEST_MORE_INFO"
          ? now >= Number(submission.resolvedAt) + INFO_WINDOW_SECONDS
          : false
    if (!expiryAllowed) throw new Error("Milestone is not eligible for expiry.")
    return
  }
  if (action.kind === "submit") {
    if (!isBuilder) throw new Error("Only the frozen builder can submit evidence.")
    if (milestone.status !== "OPEN") throw new Error("Milestone is not open.")
    if (milestone.submissionCount >= 3) throw new Error("Submission attempts are exhausted.")
    if (now >= Number(milestone.deadline)) throw new Error("Milestone deadline has elapsed.")
    return
  }
  if (!submission
    || submission.projectId !== project.id
    || submission.milestoneIndex !== milestone.index
    || milestone.status !== "SUBMITTED"
    || milestone.currentSubmissionId !== submission.id) {
    throw new Error("Submission is not the authoritative current submission.")
  }
  if (action.kind === "resolve") {
    if (!isParty) throw new Error("Only a project party can resolve this submission.")
    if (submission.verdict !== "NONE") throw new Error("Submission is already resolved.")
    return
  }
  if (action.kind === "retry") {
    if (!isParty) throw new Error("Only a project party can retry resolution.")
    if (submission.verdict !== "UNRESOLVED") throw new Error("Submission is not unresolved.")
    if (submission.resolutionCount >= 3) throw new Error("Resolution attempts are exhausted.")
    if (now < Number(submission.nextRetryAt)) throw new Error("Resolution retry cooldown has not elapsed.")
    return
  }
  if (!isBuilder) throw new Error("Only the frozen builder can create an evidence revision.")
  if (milestone.submissionCount >= 3) throw new Error("Submission attempts are exhausted.")
  if (action.kind === "resubmit") {
    if (submission.verdict !== "REJECTED") throw new Error("Current submission is not rejected.")
    if (now >= Number(milestone.deadline)) throw new Error("Milestone deadline has elapsed.")
    return
  }
  if (submission.verdict !== "REQUEST_MORE_INFO") throw new Error("Current submission does not request more information.")
  if (now >= Number(submission.resolvedAt) + INFO_WINDOW_SECONDS) throw new Error("Information window has elapsed.")
  if (submission.evidence.length + action.evidence.length > 4) throw new Error("Evidence item limit would be exceeded.")
}

async function loadAuthoritativeActionContext(
  contract: MilestoneProofContract,
  action: MilestoneAction,
): Promise<AuthoritativeActionContext> {
  const [project, milestone] = await Promise.all([
    contract.reads.project(action.project.id),
    contract.reads.milestone(action.project.id, action.milestone.index),
  ])
  if (action.kind === "submit") return { project, milestone }
  const submissionId = milestone.currentSubmissionId
  const submission = submissionId && submissionId !== "0"
    ? await contract.reads.submission(submissionId)
    : undefined
  return { project, milestone, submission }
}

async function verifyResolutionConsequences(
  contract: MilestoneProofContract,
  before: AuthoritativeActionContext,
  submission: SubmissionView,
) {
  const [project, milestone] = await Promise.all([
    contract.reads.project(before.project.id),
    contract.reads.milestone(before.project.id, before.milestone.index),
  ])
  if (submission.verdict === "APPROVED") {
    if (milestone.status !== "APPROVED") throw new Error("Approved verdict did not approve the milestone.")
    const nextIndex = before.milestone.index + 1
    if (nextIndex >= before.project.milestoneCount) {
      if (project.status !== "COMPLETED" || project.currentMilestone !== before.milestone.index) {
        throw new Error("Approved final milestone did not complete the project.")
      }
      return
    }
    if (project.status !== "ACTIVE" || project.currentMilestone !== nextIndex) {
      throw new Error("Approved milestone did not advance the project.")
    }
    const nextMilestone = await contract.reads.milestone(before.project.id, nextIndex)
    if (nextMilestone.status !== "OPEN") throw new Error("Approved milestone did not open the next milestone.")
    return
  }
  if (submission.verdict === "REJECTED" && before.milestone.submissionCount >= 3) {
    if (project.status !== "FAILED" || milestone.status !== "FAILED") {
      throw new Error("Terminal rejection did not fail the project and milestone.")
    }
    return
  }
  if (project.status !== "ACTIVE"
    || project.currentMilestone !== before.milestone.index
    || milestone.status !== "SUBMITTED"
    || milestone.currentSubmissionId !== submission.id) {
    throw new Error("Nonterminal verdict did not preserve the active submitted milestone.")
  }
}

export function useMilestoneActions(contract: MilestoneProofContract | null, now: () => number = () => Date.now() / 1_000) {
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
      let before: AuthoritativeActionContext | undefined

      const result = await runWriteAndReadback<SubmissionReadbackConfirmation | MilestoneView>({
        assertReady: async () => {
          assertWalletReady(wallet)
          if (!actor) throw new Error("Connected wallet account is unavailable.")
          before = await loadAuthoritativeActionContext(contract, action)
          assertActionAllowed(action, actor.toLowerCase(), Math.floor(now()), before)
        },
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
          if (!before) throw new Error("Authoritative preflight context is unavailable.")
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

          const priorSubmissionId = before.submission?.id ?? before.milestone.currentSubmissionId
          const expectedEvidence = action.kind === "submit" || action.kind === "resubmit"
            ? action.evidence
            : action.kind === "supplement" && before.submission
              ? [...before.submission.evidence, ...action.evidence]
              : undefined
          if (expectedEvidence) {
            const [project, milestone] = await Promise.all([
              contract.reads.project(action.project.id),
              contract.reads.milestone(action.project.id, action.milestone.index),
            ])
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
            if (project.status !== "ACTIVE"
              || project.currentMilestone !== action.milestone.index
              || milestone.status !== "SUBMITTED") {
              throw new Error("New evidence revision did not preserve the active submitted milestone.")
            }
            return { submittedDigest: expectedDigest, submission }
          }

          const resolutionSubmission = before.submission
          if (!resolutionSubmission) throw new Error("Resolution submission context is missing.")
          const submission = await contract.reads.submission(resolutionSubmission.id)
          if (submission.id !== resolutionSubmission.id || submission.digest !== resolutionSubmission.id) {
            throw new Error("Authoritative submission digest changed during resolution.")
          }
          if (submission.verdict === "NONE" || submission.resolutionCount <= resolutionSubmission.resolutionCount) {
            throw new Error("Resolution readback did not confirm a new contract verdict.")
          }
          await verifyResolutionConsequences(contract, before, submission)
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
