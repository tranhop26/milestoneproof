import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import {
  CONTRACT_PATH,
  applyLocalEnv,
  assertAddress,
  assertHash,
  assertManifestExplorer,
  assertSuccessfulFinalized,
  chainFor,
  deployedAddress,
  isMain,
  loadDeploymentManifest,
  loadSdk,
  normalizeConfig,
  redactError,
  resolveNetwork,
  sourceSha256,
  transactionSender,
} from "./lib.mjs"

function option(argv, name) {
  const index = argv.indexOf(name)
  if (index < 0 || !argv[index + 1]) throw new Error(`${name} is required`)
  return argv[index + 1]
}

export async function verify({ env = process.env, argv = process.argv.slice(2) } = {}) {
  await applyLocalEnv(env)
  const manifestFile = resolve(option(argv, "--manifest"))
  const manifest = await loadDeploymentManifest(manifestFile)
  const network = resolveNetwork({ ...env, GENLAYER_NETWORK: manifest.network })
  const contractAddress = assertAddress(manifest.contractAddress, "manifest contract address")
  const transactionHash = assertHash(manifest.deploymentTransactionHash, "manifest deployment transaction hash")
  if (manifest.verification?.transactionHash !== transactionHash) {
    throw new Error("Manifest verification transaction does not match the deployment transaction")
  }
  const localSource = await readFile(CONTRACT_PATH, "utf8")
  const localHash = sourceSha256(localSource)
  if (manifest.sourceSha256 !== localHash) throw new Error("Local source hash does not match the manifest")

  const sdk = await loadSdk(env)
  const chain = chainFor(sdk, network)
  assertManifestExplorer(manifest, chain)
  const client = sdk.createClient({ chain })
  const receipt = await client.waitForTransactionReceipt({
    hash: transactionHash,
    status: sdk.TransactionStatus.FINALIZED,
  })
  assertSuccessfulFinalized(receipt, sdk.ExecutionResult.FINISHED_WITH_RETURN)
  if (deployedAddress(receipt).toLowerCase() !== contractAddress.toLowerCase()) {
    throw new Error("Deployment transaction produced a different contract address")
  }
  if (transactionSender(receipt).toLowerCase() !== manifest.deployerAddress.toLowerCase()) {
    throw new Error("Deployment transaction sender does not match the manifest deployer")
  }
  const configReadback = normalizeConfig(await client.readContract({
    address: contractAddress,
    functionName: "get_config",
    args: [],
  }))
  const deployedHash = sourceSha256(await client.getContractCode(contractAddress))
  if (deployedHash !== localHash) throw new Error("Deployed source hash mismatch")
  if (JSON.stringify(configReadback) !== JSON.stringify(manifest.verification?.configReadback)) {
    throw new Error("Readback does not match the deployment manifest")
  }

  console.log(`Contract: ${contractAddress}`)
  console.log(`Transaction: ${transactionHash} (FINALIZED / FINISHED_WITH_RETURN)`)
  console.log(`Source hash verified: ${deployedHash}`)
  console.log(`Readback verified: ${JSON.stringify(configReadback)}`)
}

if (isMain(import.meta.url)) {
  try {
    await verify()
  } catch (error) {
    console.error(redactError(error))
    process.exitCode = 1
  }
}
