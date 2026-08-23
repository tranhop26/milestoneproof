import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { parseMilestoneInput, type MilestoneView, type ProjectView } from "@milestoneproof/shared"
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
    enabled: Boolean(contract),
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
