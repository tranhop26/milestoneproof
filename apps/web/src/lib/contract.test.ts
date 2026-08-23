import { describe, expect, it, vi } from "vitest"

import {
  ContractInputError,
  createClientNonce,
  createMilestoneProofContract,
  getConfiguredContractAddress,
  type ContractClient,
  type CreateProjectInput,
} from "./contract"
import type { EvidenceInput } from "@milestoneproof/shared"

const CONTRACT = "0xc000000000000000000000000000000000000001" as const
const SPONSOR = "0x1000000000000000000000000000000000000001" as const
const BUILDER = "0x2000000000000000000000000000000000000002" as const
const TX_HASH = `0x${"a".repeat(64)}` as `0x${string}`
const U64_TOO_LARGE = (1n << 64n).toString()
const U256_TOO_LARGE = (1n << 256n).toString()
const EVIDENCE: EvidenceInput[] = [{
  sourceKind: "REPOSITORY",
  url: "https://github.com/example/compiler/commit/0123456789abcdef0123456789abcdef01234567",
  subjectRef: "github.com/example/compiler",
  versionRef: "0123456789abcdef0123456789abcdef01234567",
  observedAt: "1800000100",
}]

const projectShape = [
  1,
  42,
  SPONSOR,
  BUILDER,
  "Public release",
  "Ship the release",
  0,
  0,
  1_800_000_000,
  1,
]

function input(overrides: Partial<CreateProjectInput> = {}): CreateProjectInput {
  return {
    builder: BUILDER,
    title: "Public release",
    description: "Ship the release",
    milestones: [{
      title: "Release v1",
      criteria: ["Release notes document the delivered scope"],
      allowedSources: ["RELEASE"],
      deadline: "1900000000",
    }],
    ...overrides,
  }
}

function client(readResult: unknown = projectShape): ContractClient {
  return {
    readContract: vi.fn(async () => readResult),
    writeContract: vi.fn(async () => TX_HASH),
    waitForTransactionReceipt: vi.fn(async () => ({
      statusName: "FINALIZED",
      txExecutionResultName: "FINISHED_WITH_RETURN",
    })),
  }
}

describe("MilestoneProof contract adapter", () => {
  it("uses the exact project read method and positional argument order", async () => {
    const read = client()
    const contract = createMilestoneProofContract({ address: CONTRACT, readClient: read })

    await expect(contract.reads.project("42")).resolves.toMatchObject({ id: "42", status: "ACTIVE" })
    expect(read.readContract).toHaveBeenCalledWith({
      address: CONTRACT,
      functionName: "get_project",
      args: [42n],
    })
  })

  it("serializes create_project with the contract's exact argument order and milestone keys", async () => {
    const read = client()
    const write = client()
    const contract = createMilestoneProofContract({
      address: CONTRACT,
      readClient: read,
      getWriteClient: async () => write,
      now: () => 1_800_000_000,
    })

    await expect(contract.writes.createProject(input(), "project:fixed-nonce")).resolves.toBe(TX_HASH)
    expect(write.writeContract).toHaveBeenCalledWith({
      address: CONTRACT,
      functionName: "create_project",
      args: [
        BUILDER,
        "Public release",
        "Ship the release",
        [{
          title: "Release v1",
          criteria: ["Release notes document the delivered scope"],
          allowed_sources: ["RELEASE"],
          deadline: 1_900_000_000n,
        }],
        "project:fixed-nonce",
      ],
      value: 0n,
    })
  })

  it.each([
    ["submitEvidence", "submit_evidence", [42n, 1, [["REPOSITORY", EVIDENCE[0].url, EVIDENCE[0].subjectRef, EVIDENCE[0].versionRef, 1_800_000_100n]], "evidence:nonce"]],
    ["resubmitEvidence", "resubmit_evidence", [42n, 1, [["REPOSITORY", EVIDENCE[0].url, EVIDENCE[0].subjectRef, EVIDENCE[0].versionRef, 1_800_000_100n]], "evidence:nonce"]],
    ["supplementEvidence", "supplement_evidence", [88n, [["REPOSITORY", EVIDENCE[0].url, EVIDENCE[0].subjectRef, EVIDENCE[0].versionRef, 1_800_000_100n]], "evidence:nonce"]],
  ] as const)("serializes %s with exact method and evidence argument order", async (writeName, functionName, args) => {
    const write = client()
    const contract = createMilestoneProofContract({ address: CONTRACT, readClient: client(), getWriteClient: async () => write })

    const method = contract.writes[writeName] as (...values: unknown[]) => Promise<unknown>
    const callArgs: unknown[] = writeName === "supplementEvidence"
      ? ["88", EVIDENCE, "evidence:nonce"]
      : ["42", 1, EVIDENCE, "evidence:nonce"]
    await expect(method(...callArgs)).resolves.toBe(TX_HASH)
    expect(write.writeContract).toHaveBeenCalledWith({ address: CONTRACT, functionName, args, value: 0n })
  })

  it.each([
    ["resolveSubmission", "resolve_submission", [88n]],
    ["retryResolution", "retry_resolution", [88n]],
    ["expireMilestone", "expire_milestone", [42n, 1]],
  ] as const)("serializes %s without invented nonce arguments", async (writeName, functionName, args) => {
    const write = client()
    const contract = createMilestoneProofContract({ address: CONTRACT, readClient: client(), getWriteClient: async () => write })

    const method = contract.writes[writeName] as (...values: unknown[]) => Promise<unknown>
    const callArgs: unknown[] = writeName === "expireMilestone" ? ["42", 1] : ["88"]
    await expect(method(...callArgs)).resolves.toBe(TX_HASH)
    expect(write.writeContract).toHaveBeenCalledWith({ address: CONTRACT, functionName, args, value: 0n })
  })

  it("rejects malformed or excessive evidence before calldata", async () => {
    const getWriteClient = vi.fn(async () => client())
    const contract = createMilestoneProofContract({ address: CONTRACT, readClient: client(), getWriteClient })

    await expect(contract.writes.submitEvidence("42", 0, [], "nonce")).rejects.toThrow("between one and four")
    await expect(contract.writes.submitEvidence("42", 0, Array.from({ length: 5 }, () => EVIDENCE[0]), "nonce")).rejects.toThrow("between one and four")
    await expect(contract.writes.submitEvidence("42", 0, [{ ...EVIDENCE[0], versionRef: "main" }], "nonce")).rejects.toThrow("full git commit")
    expect(getWriteClient).not.toHaveBeenCalled()
  })

  it.each([
    ["no milestones", []],
    ["more than three milestones", Array.from({ length: 4 }, () => input().milestones[0])],
  ])("rejects %s before requesting a write client", async (_label, milestones) => {
    const getWriteClient = vi.fn(async () => client())
    const contract = createMilestoneProofContract({
      address: CONTRACT,
      readClient: client(),
      getWriteClient,
      now: () => 1_800_000_000,
    })

    await expect(contract.writes.createProject(input({ milestones }), "nonce"))
      .rejects.toBeInstanceOf(ContractInputError)
    expect(getWriteClient).not.toHaveBeenCalled()
  })

  it.each([
    "0x1234",
    "2000000000000000000000000000000000000002",
    "0x200000000000000000000000000000000000000z",
  ])("rejects malformed builder address %s before calldata", async (builder) => {
    const getWriteClient = vi.fn(async () => client())
    const contract = createMilestoneProofContract({
      address: CONTRACT,
      readClient: client(),
      getWriteClient,
      now: () => 1_800_000_000,
    })

    await expect(contract.writes.createProject(input({ builder }), "nonce"))
      .rejects.toThrow("builder must be a 20-byte hexadecimal address")
    expect(getWriteClient).not.toHaveBeenCalled()
  })

  it("rejects a non-future deadline before calldata", async () => {
    const write = client()
    const contract = createMilestoneProofContract({
      address: CONTRACT,
      readClient: client(),
      getWriteClient: async () => write,
      now: () => 1_800_000_000,
    })

    await expect(contract.writes.createProject(input({
      milestones: [{ ...input().milestones[0], deadline: "1800000000" }],
    }), "nonce")).rejects.toThrow("deadline must be in the future")
    expect(write.writeContract).not.toHaveBeenCalled()
  })

  it("rejects criteria above the contract's 500-character limit before requesting a write client", async () => {
    const getWriteClient = vi.fn(async () => client())
    const contract = createMilestoneProofContract({
      address: CONTRACT,
      readClient: client(),
      getWriteClient,
      now: () => 1_800_000_000,
    })

    await expect(contract.writes.createProject(input({
      milestones: [{ ...input().milestones[0], criteria: ["x".repeat(501)] }],
    }), "nonce")).rejects.toThrow("criterion 1 is too long")
    expect(getWriteClient).not.toHaveBeenCalled()
  })

  it("rejects a deadline outside the contract's u64 range before requesting a write client", async () => {
    const getWriteClient = vi.fn(async () => client())
    const contract = createMilestoneProofContract({
      address: CONTRACT,
      readClient: client(),
      getWriteClient,
      now: () => 1_800_000_000,
    })

    await expect(contract.writes.createProject(input({
      milestones: [{ ...input().milestones[0], deadline: U64_TOO_LARGE }],
    }), "nonce")).rejects.toThrow("deadline exceeds u64")
    expect(getWriteClient).not.toHaveBeenCalled()
  })

  it("rejects invalid IDs and actor addresses before any contract read", async () => {
    const read = client()
    const contract = createMilestoneProofContract({ address: CONTRACT, readClient: read })

    await expect(contract.reads.project("0")).rejects.toThrow("project id")
    await expect(contract.reads.milestone("1", -1)).rejects.toThrow("milestone index")
    await expect(contract.reads.submission("01")).rejects.toThrow("submission id")
    await expect(contract.reads.actorProjects("not-an-address", "sponsor")).rejects.toThrow("actor")
    expect(read.readContract).not.toHaveBeenCalled()
  })

  it("rejects positive IDs outside the contract's u256 range before any contract read", async () => {
    const read = client()
    const contract = createMilestoneProofContract({ address: CONTRACT, readClient: read })

    await expect(contract.reads.project(U256_TOO_LARGE)).rejects.toThrow("project id exceeds u256")
    await expect(contract.reads.submission(U256_TOO_LARGE)).rejects.toThrow("submission id exceeds u256")
    await expect(contract.reads.milestone(U256_TOO_LARGE, 0)).rejects.toThrow("project id exceeds u256")
    expect(read.readContract).not.toHaveBeenCalled()
  })

  it("loads newest-first actor project IDs in contract-sized batches of at most 50", async () => {
    const read = client()
    vi.mocked(read.readContract)
      .mockResolvedValueOnce(75)
      .mockResolvedValueOnce(Array.from({ length: 50 }, (_, index) => 75 - index))
      .mockResolvedValueOnce(Array.from({ length: 25 }, (_, index) => 25 - index))
    const contract = createMilestoneProofContract({ address: CONTRACT, readClient: read })

    await expect(contract.reads.actorProjects(SPONSOR, "sponsor")).resolves.toEqual(
      Array.from({ length: 75 }, (_, index) => String(75 - index)),
    )
    expect(read.readContract).toHaveBeenNthCalledWith(2, {
      address: CONTRACT,
      functionName: "get_sponsor_project_ids",
      args: [SPONSOR, 0n, 50],
    })
    expect(read.readContract).toHaveBeenNthCalledWith(3, {
      address: CONTRACT,
      functionName: "get_sponsor_project_ids",
      args: [SPONSOR, 50n, 25],
    })
  })

  it("rejects an impossible zero project ID returned by an actor index", async () => {
    const read = client()
    vi.mocked(read.readContract).mockResolvedValueOnce(1).mockResolvedValueOnce([0])
    const contract = createMilestoneProofContract({ address: CONTRACT, readClient: read })

    await expect(contract.reads.actorProjects(SPONSOR, "builder")).rejects.toThrow("actor project id 0")
  })

  it("generates a bounded unique client nonce without secrets", () => {
    const first = createClientNonce("project", () => "11111111-1111-4111-8111-111111111111")
    const second = createClientNonce("project", () => "22222222-2222-4222-8222-222222222222")

    expect(first).toBe("project:11111111-1111-4111-8111-111111111111")
    expect(second).not.toBe(first)
    expect(first.length).toBeLessThanOrEqual(128)
  })

  it("uses the canonical VITE_MILESTONEPROOF_ADDRESS runtime key only", () => {
    expect(getConfiguredContractAddress({ VITE_MILESTONEPROOF_ADDRESS: CONTRACT })).toBe(CONTRACT)
    expect(() => getConfiguredContractAddress({
      VITE_MILESTONEPROOF_CONTRACT_ADDRESS: CONTRACT,
    })).toThrow("VITE_MILESTONEPROOF_ADDRESS is not configured")
  })
})
