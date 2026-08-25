import { randomUUID } from "node:crypto"
import { resolve } from "node:path"

import {
  ROOT,
  applyLocalEnv,
  assertAddress,
  assertHash,
  assertManifestExplorer,
  assertSuccessfulFinalized,
  chainFor,
  isMain,
  loadDeploymentManifest,
  loadSdk,
  pathExists,
  redactError,
  resolveNetwork,
  writeJsonAtomically,
} from "./lib.mjs"

const FIXTURE = {
  sourceKind: "RELEASE",
  url: "https://raw.githubusercontent.com/genlayerlabs/genlayer-js/v1.1.8/package.json",
  subjectRef: "github.com/genlayerlabs/genlayer-js",
  versionRef: "1.1.8",
  criterion: "The official genlayerlabs/genlayer-js repository tag v1.1.8 declares package version 1.1.8.",
}

const PROJECT_TITLE = "SDK GitHub release proof"
const PROJECT_DESCRIPTION = "Verify a GenLayer SDK version at an immutable official repository tag."
const STUDIONET_FUNDING_METHOD = "sim_fundAccount"
const STUDIONET_FUNDING_AMOUNT = 100

function option(argv, name) {
  const index = argv.indexOf(name)
  if (index < 0 || !argv[index + 1]) throw new Error(`${name} is required`)
  return argv[index + 1]
}

function integer(value, label) {
  if (typeof value === "bigint" && value >= 0n) return value
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value)) return BigInt(value)
  throw new Error(`${label} is not a non-negative integer`)
}

function jsonSafe(value) {
  if (typeof value === "bigint") return value.toString()
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]))
  }
  return value
}

function optionalTransactionHash(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/u.test(value) ? value : undefined
}

function executionError(receipt) {
  return receipt?.consensus_data?.leader_receipt?.find((item) => item?.error)?.error || "Contract rejected the write"
}

async function wait(client, sdk, hash, expected) {
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: sdk.TransactionStatus.FINALIZED,
    interval: 5_000,
    retries: 240,
  })
  assertSuccessfulFinalized(receipt, expected)
  return receipt
}

async function successfulWrite(client, sdk, input) {
  const hash = assertHash(await client.writeContract(input))
  console.log(`Submitted ${input.functionName}: ${hash}`)
  await wait(client, sdk, hash, sdk.ExecutionResult.FINISHED_WITH_RETURN)
  return {
    hash,
    transactionStatus: "FINALIZED",
    executionResult: "FINISHED_WITH_RETURN",
  }
}

async function rejectedWrite(client, sdk, input) {
  const hash = assertHash(await client.writeContract(input))
  console.log(`Submitted expected rejection ${input.functionName}: ${hash}`)
  const receipt = await wait(client, sdk, hash, sdk.ExecutionResult.FINISHED_WITH_ERROR)
  return {
    hash,
    transactionStatus: "FINALIZED",
    executionResult: "FINISHED_WITH_ERROR",
    error: executionError(receipt),
  }
}

export async function runLiveE2e({ env = process.env, argv = process.argv.slice(2) } = {}) {
  await applyLocalEnv(env)
  if (env.CONFIRM_LIVE_E2E !== "YES") {
    throw new Error("Live E2E refused: set CONFIRM_LIVE_E2E=YES only after action-time confirmation")
  }

  const evidencePath = resolve(env.LIVE_EVIDENCE_PATH || resolve(ROOT, "work/evidence/live-contract.json"))
  if (await pathExists(evidencePath)) {
    throw new Error(`Live evidence already exists: ${evidencePath}`)
  }
  const manifestFile = resolve(option(argv, "--manifest"))
  const manifest = await loadDeploymentManifest(manifestFile)
  if (manifest.network !== "studionet") throw new Error("Live E2E supports Studionet only")
  const contractAddress = assertAddress(manifest.contractAddress, "manifest contract address")
  const network = resolveNetwork({ ...env, GENLAYER_NETWORK: manifest.network })
  const sdk = await loadSdk(env)
  const chain = chainFor(sdk, network)
  assertManifestExplorer(manifest, chain)

  const sponsor = sdk.createAccount()
  const builder = sdk.createAccount()
  const stranger = sdk.createAccount()
  const addresses = [sponsor.address, builder.address, stranger.address].map((value) => assertAddress(value, "generated actor address"))
  if (new Set(addresses.map((value) => value.toLowerCase())).size !== 3) {
    throw new Error("Generated actors are not distinct")
  }

  const readClient = sdk.createClient({ chain })
  const balancesBeforeFunding = []
  for (const actorAddress of addresses) {
    balancesBeforeFunding.push(integer(await readClient.getBalance({ address: actorAddress }), "actor balance before funding"))
  }
  const fundingTransactions = []
  for (const actorAddress of addresses) {
    const response = await readClient.request({
      method: STUDIONET_FUNDING_METHOD,
      params: [actorAddress, STUDIONET_FUNDING_AMOUNT],
    })
    const transactionHash = optionalTransactionHash(response)
    if (transactionHash) fundingTransactions.push(transactionHash)
  }
  const balancesAfterFunding = []
  for (const actorAddress of addresses) {
    balancesAfterFunding.push(integer(await readClient.getBalance({ address: actorAddress }), "actor balance after funding"))
  }
  for (let index = 0; index < addresses.length; index += 1) {
    if (balancesAfterFunding[index] <= 0n || balancesAfterFunding[index] <= balancesBeforeFunding[index]) {
      throw new Error(`Studionet funding did not increase actor balance: ${addresses[index]}`)
    }
  }
  const sponsorClient = sdk.createClient({ chain, account: sponsor })
  const builderClient = sdk.createClient({ chain, account: builder })
  const strangerClient = sdk.createClient({ chain, account: stranger })

  const deadline = BigInt(Math.floor(Date.now() / 1_000) + (7 * 24 * 60 * 60))
  const createProject = await successfulWrite(sponsorClient, sdk, {
    account: sponsor,
    address: contractAddress,
    functionName: "create_project",
    args: [
      builder.address,
      PROJECT_TITLE,
      PROJECT_DESCRIPTION,
      [{
        title: "Verify v1.1.8",
        criteria: [FIXTURE.criterion],
        allowed_sources: [FIXTURE.sourceKind],
        deadline,
      }],
      `e2e-project:${randomUUID()}`,
    ],
    value: 0n,
  })

  const sponsorProjectCount = integer(await readClient.readContract({
    address: contractAddress,
    functionName: "get_sponsor_project_count",
    args: [sponsor.address],
  }), "sponsor project count")
  if (sponsorProjectCount !== 1n) throw new Error("Fresh sponsor project index is not unique")
  const sponsorProjectIds = await readClient.readContract({
    address: contractAddress,
    functionName: "get_sponsor_project_ids",
    args: [sponsor.address, 0n, 1],
  })
  if (!Array.isArray(sponsorProjectIds) || sponsorProjectIds.length !== 1) {
    throw new Error("Fresh sponsor project index did not return one newest project")
  }
  const projectId = integer(sponsorProjectIds[0], "project id")
  if (projectId === 0n) throw new Error("create_project did not produce a project")
  const createdProject = await readClient.readContract({
    address: contractAddress,
    functionName: "get_project",
    args: [projectId],
  })
  const openMilestone = await readClient.readContract({
    address: contractAddress,
    functionName: "get_milestone",
    args: [projectId, 0],
  })
  if (!Array.isArray(createdProject)
    || integer(createdProject[1], "project id readback") !== projectId
    || String(createdProject[2]).toLowerCase() !== sponsor.address.toLowerCase()
    || String(createdProject[3]).toLowerCase() !== builder.address.toLowerCase()
    || createdProject[4] !== PROJECT_TITLE
    || createdProject[5] !== PROJECT_DESCRIPTION
    || integer(createdProject[9], "project milestone count") !== 1n) {
    throw new Error("Created project readback does not match the fresh sponsor action")
  }
  if (!Array.isArray(openMilestone) || integer(openMilestone[7], "milestone state") !== 1n) {
    throw new Error("Created milestone is not OPEN")
  }
  if (integer(openMilestone[1], "milestone project id") !== projectId
    || integer(openMilestone[2], "milestone index") !== 0n
    || openMilestone[3] !== "Verify v1.1.8"
    || JSON.stringify(openMilestone[4]) !== JSON.stringify([FIXTURE.criterion])
    || JSON.stringify(openMilestone[5]) !== JSON.stringify([FIXTURE.sourceKind])) {
    throw new Error("Created milestone readback does not match the frozen milestone")
  }
  const observedAt = integer(openMilestone[8], "milestone opened_at")
  const evidence = [[
    FIXTURE.sourceKind,
    FIXTURE.url,
    FIXTURE.subjectRef,
    FIXTURE.versionRef,
    observedAt,
  ]]

  const unauthorizedSubmission = await rejectedWrite(strangerClient, sdk, {
    account: stranger,
    address: contractAddress,
    functionName: "submit_evidence",
    args: [projectId, 0, evidence, `e2e-unauthorized:${randomUUID()}`],
    value: 0n,
  })
  const [projectAfterUnauthorized, milestoneAfterUnauthorized] = await Promise.all([
    readClient.readContract({
      address: contractAddress,
      functionName: "get_project",
      args: [projectId],
    }),
    readClient.readContract({
      address: contractAddress,
      functionName: "get_milestone",
      args: [projectId, 0],
    }),
  ])
  const currentSubmissionIdAfterUnauthorized = integer(
    milestoneAfterUnauthorized?.[10],
    "current submission id after unauthorized write",
  )
  if (integer(projectAfterUnauthorized?.[6], "project status after unauthorized write") !== 0n
    || integer(projectAfterUnauthorized?.[7], "project milestone after unauthorized write") !== 0n
    || integer(milestoneAfterUnauthorized?.[7], "milestone state after unauthorized write") !== 1n
    || integer(milestoneAfterUnauthorized?.[9], "submission count after unauthorized write") !== 0n
    || currentSubmissionIdAfterUnauthorized !== 0n) {
    throw new Error("Unauthorized submission changed contract state")
  }
  const unauthorizedSubmissionReadback = {
    project: projectAfterUnauthorized,
    milestone: milestoneAfterUnauthorized,
    currentSubmissionId: currentSubmissionIdAfterUnauthorized,
  }

  const submitEvidence = await successfulWrite(builderClient, sdk, {
    account: builder,
    address: contractAddress,
    functionName: "submit_evidence",
    args: [projectId, 0, evidence, `e2e-submission:${randomUUID()}`],
    value: 0n,
  })
  const submittedMilestone = await readClient.readContract({
    address: contractAddress,
    functionName: "get_milestone",
    args: [projectId, 0],
  })
  const submissionId = integer(submittedMilestone?.[10], "submission id")
  if (integer(submittedMilestone?.[7], "submitted milestone state") !== 2n || submissionId === 0n) {
    throw new Error("submit_evidence did not produce a SUBMITTED milestone")
  }

  const resolveSubmission = await successfulWrite(sponsorClient, sdk, {
    account: sponsor,
    address: contractAddress,
    functionName: "resolve_submission",
    args: [submissionId],
    value: 0n,
  })
  const [project, milestone, submission] = await Promise.all([
    readClient.readContract({ address: contractAddress, functionName: "get_project", args: [projectId] }),
    readClient.readContract({ address: contractAddress, functionName: "get_milestone", args: [projectId, 0] }),
    readClient.readContract({ address: contractAddress, functionName: "get_submission", args: [submissionId] }),
  ])
  if (integer(project?.[6], "project status") !== 1n) throw new Error("Happy path did not complete the project")
  if (integer(milestone?.[7], "milestone state") !== 3n) throw new Error("Happy path did not approve the milestone")
  if (integer(submission?.[5], "submission verdict") !== 1n) throw new Error("Happy path verdict was not APPROVED")

  const proof = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    network: network.name,
    contractAddress,
    actors: {
      sponsor: sponsor.address,
      builder: builder.address,
      stranger: stranger.address,
    },
    fixture: FIXTURE,
    transactions: {
      funding: fundingTransactions,
      createProject,
      unauthorizedSubmission,
      submitEvidence,
      resolveSubmission,
    },
    readback: jsonSafe({
      fundingBalances: {
        before: balancesBeforeFunding,
        after: balancesAfterFunding,
      },
      unauthorizedSubmission: unauthorizedSubmissionReadback,
      projectId,
      submissionId,
      project,
      milestone,
      submission,
    }),
  }
  await writeJsonAtomically(evidencePath, proof, { immutable: true })
  console.log(`Live contract evidence written: ${evidencePath}`)
  console.log("Happy path: FINALIZED / FINISHED_WITH_RETURN / APPROVED")
  console.log("Unauthorized branch: FINALIZED / FINISHED_WITH_ERROR")
}

if (isMain(import.meta.url)) {
  try {
    await runLiveE2e()
  } catch (error) {
    console.error(redactError(error))
    process.exitCode = 1
  }
}
