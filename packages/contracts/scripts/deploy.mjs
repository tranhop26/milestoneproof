import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import {
  CLASSIFICATION,
  CONTRACT_PATH,
  applyLocalEnv,
  assertHash,
  assertSuccessfulFinalized,
  chainFor,
  deployedAddress,
  explorerTransactionUrl,
  isMain,
  loadEnvFile,
  loadSdk,
  manifestPath,
  normalizeConfig,
  pathExists,
  redactError,
  requirePrivateKey,
  resolveNetwork,
  sha256,
  writeJsonAtomically,
} from "./lib.mjs"

export { loadEnvFile }

export async function deploy({ env = process.env, argv = process.argv.slice(2) } = {}) {
  await applyLocalEnv(env)
  const dryRun = argv.includes("--dry-run")
  const network = resolveNetwork(env)
  const target = manifestPath(network, env)
  if (!dryRun && await pathExists(target)) throw new Error(`Deployment manifest already exists: ${target}`)

  const privateKey = requirePrivateKey(env)
  const sdk = await loadSdk(env)
  const deployer = sdk.createAccount(privateKey)
  const deployerAddress = deployer.address
  const source = await readFile(CONTRACT_PATH, "utf8")
  const sourceSha256 = sha256(source)

  console.log(`Network: ${network.name}`)
  console.log(`Deployer: ${deployerAddress}`)
  console.log(`Source SHA-256: ${sourceSha256}`)
  console.log(`Manifest: ${target}`)

  if (dryRun) {
    if (env.DEPLOYMENT_PREVIEW_PATH) {
      await writeJsonAtomically(resolve(env.DEPLOYMENT_PREVIEW_PATH), {
        network: network.name,
        deployerAddress,
        sourceSha256,
        classification: CLASSIFICATION,
        intendedManifestPath: target,
        dryRun: true,
      })
    }
    console.log("Dry run complete; no network client was created and no transaction was sent.")
    return
  }

  if (env.CONFIRM_DEPLOY !== "YES") {
    throw new Error("Deployment refused: set CONFIRM_DEPLOY=YES only after action-time identity confirmation")
  }

  const chain = chainFor(sdk, network)
  const client = sdk.createClient({ chain, account: deployer })
  const transactionHash = assertHash(await client.deployContract({ account: deployer, code: source }))
  const receipt = await client.waitForTransactionReceipt({
    hash: transactionHash,
    status: sdk.TransactionStatus.FINALIZED,
  })
  assertSuccessfulFinalized(receipt, sdk.ExecutionResult.FINISHED_WITH_RETURN)
  const contractAddress = deployedAddress(receipt)
  const configReadback = normalizeConfig(await client.readContract({
    address: contractAddress,
    functionName: "get_config",
    args: [],
  }))
  const deployedSource = await client.getContractCode(contractAddress)
  if (sha256(deployedSource) !== sourceSha256) throw new Error("Deployed source hash mismatch")

  const verifiedAt = new Date().toISOString()
  const manifest = {
    schemaVersion: 1,
    network: network.name,
    contractAddress,
    deploymentTransactionHash: transactionHash,
    deployerAddress,
    sourceSha256,
    deployedAt: verifiedAt,
    classification: CLASSIFICATION,
    explorerUrl: explorerTransactionUrl(network, transactionHash),
    verification: {
      transactionHash,
      transactionStatus: "FINALIZED",
      executionResult: "FINISHED_WITH_RETURN",
      verifiedAt,
      sourceMatches: true,
      configReadback,
    },
  }
  await writeJsonAtomically(target, manifest, { immutable: true })
  console.log(`Deployment verified and manifest written: ${target}`)
}

if (isMain(import.meta.url)) {
  let secret
  try {
    secret = process.env.DEPLOYER_PRIVATE_KEY
    await deploy()
  } catch (error) {
    console.error(redactError(error, [secret]))
    process.exitCode = 1
  }
}
