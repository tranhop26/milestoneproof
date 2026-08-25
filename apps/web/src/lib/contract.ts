import {
  parseConfig,
  parseMilestone,
  parseMilestoneInput,
  parseEvidenceInput,
  parseProject,
  parseSubmission,
  type ConfigView,
  type EvidenceInput,
  type MilestoneInput,
  type MilestoneView,
  type ProjectView,
  type SubmissionView,
} from "@milestoneproof/shared"

import type { FinalizedExecution } from "./transaction"

export const STUDIONET_EXPLORER_ADDRESS_URL = "https://explorer-studio.genlayer.com/address"
const U64_MAX = (1n << 64n) - 1n
const U256_MAX = (1n << 256n) - 1n

export type ContractAddress = `0x${string}`
export type TransactionHash = `0x${string}`
export type ActorRole = "sponsor" | "builder"

type CalldataValue = null | boolean | number | bigint | string | CalldataValue[] | { [key: string]: CalldataValue }

interface ContractCall {
  address: ContractAddress
  functionName: string
  args: CalldataValue[]
}

interface ContractWrite extends ContractCall {
  value: bigint
}

export interface ContractClient {
  readContract(args: ContractCall): Promise<unknown>
  writeContract(args: ContractWrite): Promise<unknown>
  waitForTransactionReceipt(args: {
    hash: TransactionHash
    status: "FINALIZED"
    interval?: number
    retries?: number
  }): Promise<{
    statusName?: string
    txExecutionResultName?: string
    resultName?: string
    result_name?: string
    consensus_data?: {
      leader_receipt?: Array<{
        error?: string | null
        execution_result?: string
        result?: { status?: string }
      }>
    }
  }>
}

export interface CreateProjectInput {
  builder: string
  title: string
  description: string
  milestones: MilestoneInput[]
}

export interface MilestoneProofReads {
  config(): Promise<ConfigView>
  project(projectId: string): Promise<ProjectView>
  milestone(projectId: string, index: number): Promise<MilestoneView>
  submission(submissionId: string): Promise<SubmissionView>
  actorProjects(actor: string, role: ActorRole): Promise<string[]>
}

export interface MilestoneProofWrites {
  createProject(input: CreateProjectInput, clientNonce: string): Promise<TransactionHash>
  submitEvidence(projectId: string, milestoneIndex: number, evidence: EvidenceInput[], clientNonce: string): Promise<TransactionHash>
  resolveSubmission(submissionId: string): Promise<TransactionHash>
  resubmitEvidence(projectId: string, milestoneIndex: number, evidence: EvidenceInput[], clientNonce: string): Promise<TransactionHash>
  supplementEvidence(submissionId: string, evidence: EvidenceInput[], clientNonce: string): Promise<TransactionHash>
  retryResolution(submissionId: string): Promise<TransactionHash>
  expireMilestone(projectId: string, milestoneIndex: number): Promise<TransactionHash>
  waitForFinalized(hash: TransactionHash): Promise<FinalizedExecution>
}

export interface MilestoneProofContract {
  address: ContractAddress
  reads: MilestoneProofReads
  writes: MilestoneProofWrites
}

export interface MilestoneProofContractOptions {
  address: string
  readClient: ContractClient
  getWriteClient?: () => Promise<ContractClient>
  now?: () => number
}

export class ContractInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ContractInputError"
  }
}

function address(value: string, field: string, allowZero = false): ContractAddress {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new ContractInputError(`${field} must be a 20-byte hexadecimal address`)
  }
  const normalized = value.toLowerCase() as ContractAddress
  if (!allowZero && normalized === "0x0000000000000000000000000000000000000000") {
    throw new ContractInputError(`${field} cannot be the zero address`)
  }
  return normalized
}

function deployedContractAddress(value: string): ContractAddress {
  address(value, "contract")
  return value as ContractAddress
}

function positiveId(value: string, field: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new ContractInputError(`${field} must be a positive integer`)
  }
  const parsed = BigInt(value)
  if (parsed > U256_MAX) throw new ContractInputError(`${field} exceeds u256`)
  return parsed
}

function milestoneIndex(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new ContractInputError("milestone index must be an integer between 0 and 255")
  }
  return value
}

function nonNegativeInteger(value: unknown, field: string): bigint {
  if (typeof value === "bigint" && value >= 0n) return value
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) return BigInt(value)
  throw new ContractInputError(`${field} must be a non-negative integer`)
}

function positiveReturnedId(value: unknown, field: string): string {
  const parsed = nonNegativeInteger(value, field)
  if (parsed === 0n) throw new ContractInputError(`${field} must be a positive integer`)
  if (parsed > U256_MAX) throw new ContractInputError(`${field} exceeds u256`)
  return parsed.toString()
}

function requiredText(value: string, field: string, maxLength: number): string {
  if (!value.trim()) throw new ContractInputError(`${field} is required`)
  if (value.length > maxLength) throw new ContractInputError(`${field} is too long`)
  return value.trim()
}

function validateEvidence(rawEvidence: EvidenceInput[]): CalldataValue[] {
  if (!Array.isArray(rawEvidence) || rawEvidence.length < 1 || rawEvidence.length > 4) {
    throw new ContractInputError("evidence must contain between one and four items")
  }
  return rawEvidence.map((raw, index) => {
    let evidence: EvidenceInput
    try {
      evidence = parseEvidenceInput(raw)
    } catch (error) {
      throw new ContractInputError(
        `evidence ${index + 1} is invalid: ${error instanceof Error ? error.message : "invalid input"}`,
      )
    }
    const subjectRef = requiredText(evidence.subjectRef, `evidence ${index + 1} subject`, 255)
    const versionRef = requiredText(evidence.versionRef, `evidence ${index + 1} version`, 255)
    const canonicalVersion = evidence.sourceKind === "REPOSITORY" || evidence.sourceKind === "CI"
      ? versionRef.toLowerCase()
      : versionRef
    if ((evidence.sourceKind === "REPOSITORY" || evidence.sourceKind === "CI")
      && !/^[0-9a-f]{40}$/.test(canonicalVersion)) {
      throw new ContractInputError(`evidence ${index + 1} requires a full git commit`)
    }
    const observedAt = nonNegativeInteger(evidence.observedAt, `evidence ${index + 1} observed timestamp`)
    if (observedAt > U64_MAX) throw new ContractInputError(`evidence ${index + 1} observed timestamp exceeds u64`)
    return [evidence.sourceKind, evidence.url, subjectRef, canonicalVersion, observedAt]
  })
}

function validateCreateProject(input: CreateProjectInput, now: number): {
  builder: ContractAddress
  title: string
  description: string
  milestones: Array<{ title: string, criteria: string[], allowed_sources: string[], deadline: bigint }>
} {
  const builder = address(input.builder, "builder")
  const title = requiredText(input.title, "project title", 120)
  const description = requiredText(input.description, "project description", 2_000)
  if (!Array.isArray(input.milestones) || input.milestones.length < 1 || input.milestones.length > 3) {
    throw new ContractInputError("project must contain between one and three milestones")
  }
  const milestones = input.milestones.map((raw, index) => {
    const parsed = parseMilestoneInput(raw)
    const milestoneTitle = requiredText(parsed.title, `milestone ${index + 1} title`, 120)
    if (parsed.criteria.length < 1 || parsed.criteria.length > 10) {
      throw new ContractInputError(`milestone ${index + 1} must contain between one and ten criteria`)
    }
    if (parsed.allowedSources.length < 1 || parsed.allowedSources.length > 4) {
      throw new ContractInputError(`milestone ${index + 1} must allow at least one evidence source`)
    }
    const deadlineField = `milestone ${index + 1} deadline`
    const deadline = nonNegativeInteger(parsed.deadline, deadlineField)
    if (deadline > U64_MAX) throw new ContractInputError(`${deadlineField} exceeds u64`)
    if (deadline <= BigInt(Math.floor(now))) {
      throw new ContractInputError(`milestone ${index + 1} deadline must be in the future`)
    }
    return {
      title: milestoneTitle,
      criteria: parsed.criteria.map((criterion, criterionIndex) => requiredText(
        criterion,
        `milestone ${index + 1} criterion ${criterionIndex + 1}`,
        500,
      )),
      allowed_sources: parsed.allowedSources,
      deadline,
    }
  })
  return { builder, title, description, milestones }
}

function transactionHash(value: unknown): TransactionHash {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("The wallet returned an invalid transaction hash")
  }
  return value as TransactionHash
}

function receiptError(receipt: Awaited<ReturnType<ContractClient["waitForTransactionReceipt"]>>): string | undefined {
  return receipt.consensus_data?.leader_receipt?.find(({ error }) => Boolean(error))?.error ?? undefined
}

function receiptExecutionSucceeded(
  receipt: Awaited<ReturnType<ContractClient["waitForTransactionReceipt"]>>,
): boolean {
  if (receipt.txExecutionResultName === "FINISHED_WITH_RETURN") return true
  const resultName = receipt.resultName ?? receipt.result_name
  const leader = receipt.consensus_data?.leader_receipt?.find(({ execution_result }) => execution_result === "SUCCESS")
  return resultName === "MAJORITY_AGREE"
    && leader?.execution_result === "SUCCESS"
    && leader.result?.status === "return"
}

export function createClientNonce(
  domain: string,
  randomUUID: () => string = () => globalThis.crypto.randomUUID(),
): string {
  const normalizedDomain = domain.replace(/[^a-z0-9_-]/gi, "").slice(0, 32)
  if (!normalizedDomain) throw new ContractInputError("nonce domain is required")
  const nonce = `${normalizedDomain}:${randomUUID()}`
  if (nonce.length > 128) throw new ContractInputError("client nonce is too long")
  return nonce
}

export function getConfiguredContractAddress(
  env: Record<string, unknown> = import.meta.env,
): ContractAddress {
  const configured = env.VITE_MILESTONEPROOF_ADDRESS
  if (typeof configured !== "string" || !configured) {
    throw new ContractInputError("VITE_MILESTONEPROOF_ADDRESS is not configured")
  }
  return deployedContractAddress(configured)
}

export function createMilestoneProofContract({
  address: rawAddress,
  readClient,
  getWriteClient,
  now = () => Date.now() / 1_000,
}: MilestoneProofContractOptions): MilestoneProofContract {
  const contractAddress = deployedContractAddress(rawAddress)

  const read = async (functionName: string, args: CalldataValue[] = []) => readClient.readContract({
    address: contractAddress,
    functionName,
    args,
  })

  const write = async (functionName: string, args: CalldataValue[]): Promise<TransactionHash> => {
    if (!getWriteClient) throw new Error("A wallet-backed client is required for writes")
    const client = await getWriteClient()
    return transactionHash(await client.writeContract({
      address: contractAddress,
      functionName,
      args,
      value: 0n,
    }))
  }

  const actorProjects = async (rawActor: string, role: ActorRole): Promise<string[]> => {
    const actor = address(rawActor, "actor")
    const prefix = role === "sponsor" ? "get_sponsor_project" : "get_builder_project"
    const count = nonNegativeInteger(await read(`${prefix}_count`, [actor]), "actor project count")
    const result: string[] = []
    for (let offset = 0n; offset < count; offset += 50n) {
      const limit = Number(count - offset > 50n ? 50n : count - offset)
      const page = await read(`${prefix}_ids`, [actor, offset, limit])
      if (!Array.isArray(page)) throw new Error("actor project page must be an array")
      const ids = page.map((id, index) => positiveReturnedId(id, `actor project id ${index}`))
      result.push(...ids)
      if (ids.length < limit) break
    }
    return result
  }

  return {
    address: contractAddress,
    reads: {
      config: async () => parseConfig(await read("get_config")),
      project: async (projectId) => parseProject(await read("get_project", [positiveId(projectId, "project id")])),
      milestone: async (projectId, index) => parseMilestone(await read("get_milestone", [
        positiveId(projectId, "project id"),
        milestoneIndex(index),
      ])),
      submission: async (submissionId) => parseSubmission(await read("get_submission", [
        positiveId(submissionId, "submission id"),
      ])),
      actorProjects,
    },
    writes: {
      createProject: async (input, clientNonce) => {
        const validated = validateCreateProject(input, now())
        const nonce = requiredText(clientNonce, "client nonce", 128)
        return write("create_project", [
            validated.builder,
            validated.title,
            validated.description,
            validated.milestones,
            nonce,
        ])
      },
      submitEvidence: async (projectId, index, evidence, clientNonce) => write("submit_evidence", [
        positiveId(projectId, "project id"),
        milestoneIndex(index),
        validateEvidence(evidence),
        requiredText(clientNonce, "client nonce", 128),
      ]),
      resolveSubmission: async (submissionId) => write("resolve_submission", [
        positiveId(submissionId, "submission id"),
      ]),
      resubmitEvidence: async (projectId, index, evidence, clientNonce) => write("resubmit_evidence", [
        positiveId(projectId, "project id"),
        milestoneIndex(index),
        validateEvidence(evidence),
        requiredText(clientNonce, "client nonce", 128),
      ]),
      supplementEvidence: async (submissionId, evidence, clientNonce) => write("supplement_evidence", [
        positiveId(submissionId, "submission id"),
        validateEvidence(evidence),
        requiredText(clientNonce, "client nonce", 128),
      ]),
      retryResolution: async (submissionId) => write("retry_resolution", [
        positiveId(submissionId, "submission id"),
      ]),
      expireMilestone: async (projectId, index) => write("expire_milestone", [
        positiveId(projectId, "project id"),
        milestoneIndex(index),
      ]),
      waitForFinalized: async (hash) => {
        const receipt = await readClient.waitForTransactionReceipt({
          hash,
          status: "FINALIZED",
          interval: 3_000,
          retries: 200,
        })
        return receiptExecutionSucceeded(receipt)
          ? { executionSucceeded: true }
          : {
              executionSucceeded: false,
              error: receiptError(receipt) || `Contract execution ended as ${receipt.txExecutionResultName ?? "UNKNOWN"}.`,
            }
      },
    },
  }
}
