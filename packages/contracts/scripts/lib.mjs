import { createHash } from "node:crypto"
import { constants as fsConstants } from "node:fs"
import { access, link, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import Ajv2020 from "ajv/dist/2020.js"
import addFormats from "ajv-formats"

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url))
export const CONTRACT_PATH = resolve(ROOT, "packages/contracts/milestoneproof.py")
export const MANIFEST_SCHEMA_PATH = resolve(ROOT, "deployments/schema.json")
export const EXPECTED_CONFIG = [0, 3, 3, 4, 3, 259200]
export const CLASSIFICATION = "INTENTIONALLY_FROZEN"

const NETWORKS = {
  studionet: {
    chainExport: "studionet",
  },
  "testnet-asimov": {
    chainExport: "testnetAsimov",
  },
  "testnet-bradbury": {
    chainExport: "testnetBradbury",
  },
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

export function resolveNetwork(env = process.env) {
  const name = env.GENLAYER_NETWORK || env.VITE_GENLAYER_NETWORK || "studionet"
  const definition = NETWORKS[name]
  if (!definition) throw new Error(`Unsupported GenLayer network: ${name}`)
  return { name, ...definition }
}

export async function loadSdk(env = process.env) {
  if (env.MILESTONEPROOF_SDK_MODULE) {
    if (env.NODE_ENV !== "test") {
      throw new Error("MILESTONEPROOF_SDK_MODULE is only available during tests")
    }
    return import(env.MILESTONEPROOF_SDK_MODULE)
  }
  const [sdk, chains, types] = await Promise.all([
    import("genlayer-js"),
    import("genlayer-js/chains"),
    import("genlayer-js/types"),
  ])
  return { ...sdk, ...chains, ...types }
}

export function chainFor(sdk, network) {
  const chain = sdk[network.chainExport]
  if (!chain) throw new Error(`SDK does not provide chain ${network.chainExport}`)
  return chain
}

export async function loadEnvFile(path) {
  const content = await readFile(resolve(ROOT, path), "utf8")
  const result = {}
  for (const sourceLine of content.replace(/^\uFEFF/, "").split(/\r?\n/u)) {
    const line = sourceLine.trim()
    if (!line || line.startsWith("#")) continue
    const separator = line.indexOf("=")
    if (separator < 1) throw new Error(`Invalid environment line: ${sourceLine}`)
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

export async function applyLocalEnv(env = process.env) {
  try {
    const values = await loadEnvFile(env.MILESTONEPROOF_ENV_FILE || ".env")
    for (const [key, value] of Object.entries(values)) {
      if (env[key] === undefined) env[key] = value
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
}

export function requirePrivateKey(env = process.env) {
  const key = env.DEPLOYER_PRIVATE_KEY
  if (!/^0x[0-9a-fA-F]{64}$/u.test(key || "")) {
    throw new Error("DEPLOYER_PRIVATE_KEY must be supplied as a 32-byte hexadecimal environment value")
  }
  return key
}

export function assertAddress(value, label = "address") {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

export function assertHash(value, label = "transaction hash") {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value)) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

export function normalizeConfig(value) {
  if (!Array.isArray(value) || value.length !== EXPECTED_CONFIG.length) {
    throw new Error("get_config returned an unexpected shape")
  }
  const normalized = value.map((item) => {
    if (typeof item === "bigint") return Number(item)
    if (typeof item === "number" && Number.isSafeInteger(item)) return item
    if (typeof item === "string" && /^(0|[1-9][0-9]*)$/u.test(item)) return Number(item)
    throw new Error("get_config returned a non-integer value")
  })
  if (normalized.some((item, index) => item !== EXPECTED_CONFIG[index])) {
    throw new Error(`get_config mismatch: ${JSON.stringify(normalized)}`)
  }
  return normalized
}

export function assertSuccessfulFinalized(receipt, executionResult = "FINISHED_WITH_RETURN") {
  const status = receipt?.status_name ?? receipt?.statusName
  let actualExecutionResult = receipt?.txExecutionResultName ?? receipt?.tx_execution_result_name
  if (!actualExecutionResult && (receipt?.result_name ?? receipt?.resultName) === "MAJORITY_AGREE") {
    const leaderReceipts = receipt?.consensus_data?.leader_receipt
    const leader = Array.isArray(leaderReceipts)
      ? leaderReceipts.find((item) => item?.mode === "leader")
      : undefined
    if (leader?.execution_result === "SUCCESS" && leader?.result?.status === "return") {
      actualExecutionResult = "FINISHED_WITH_RETURN"
    } else if (leader?.execution_result === "ERROR" || leader?.result?.status === "contract_error") {
      actualExecutionResult = "FINISHED_WITH_ERROR"
    }
  }
  if (status !== "FINALIZED") {
    throw new Error(`Transaction did not reach FINALIZED (received ${status || "UNKNOWN"})`)
  }
  if (actualExecutionResult !== executionResult) {
    throw new Error(`Transaction must end as ${executionResult} (received ${actualExecutionResult || "UNKNOWN"})`)
  }
}

export function deployedAddress(receipt) {
  const value = receipt?.txDataDecoded?.contractAddress
    || receipt?.tx_data_decoded?.contract_address
    || receipt?.recipient
    || receipt?.to_address
  return assertAddress(value, "deployed contract address")
}

export function transactionSender(receipt) {
  return assertAddress(receipt?.from_address || receipt?.sender, "deployment transaction sender")
}

export async function pathExists(path) {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch (error) {
    if (error?.code === "ENOENT") return false
    throw error
  }
}

export async function writeJsonAtomically(path, value, { immutable = false } = {}) {
  const target = resolve(path)
  await mkdir(dirname(target), { recursive: true })
  if (immutable && await pathExists(target)) throw new Error(`Deployment manifest already exists: ${target}`)
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  const rendered = `${JSON.stringify(value, null, 2)}\n`
  await writeFile(temporary, rendered, { encoding: "utf8", flag: "wx", mode: 0o600 })
  try {
    if (immutable) {
      await link(temporary, target)
      await unlink(temporary)
    } else {
      await rename(temporary, target)
    }
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    if (immutable && error?.code === "EEXIST") {
      throw new Error(`Deployment manifest already exists: ${target}`)
    }
    throw error
  }
}

export function manifestPath(network, env = process.env) {
  return resolve(env.DEPLOYMENT_MANIFEST_PATH || resolve(ROOT, `deployments/${network.name}.json`))
}

export function explorerTransactionUrl(chain, transactionHash) {
  const base = chain?.blockExplorers?.default?.url
  if (typeof base !== "string" || !/^https:\/\/[^/]+/u.test(base)) {
    throw new Error("SDK chain does not provide a secure default explorer URL")
  }
  return `${base.replace(/\/+$/u, "")}/tx/${assertHash(transactionHash)}`
}

let manifestValidator

async function getManifestValidator() {
  if (!manifestValidator) {
    const schema = JSON.parse(await readFile(MANIFEST_SCHEMA_PATH, "utf8"))
    const ajv = new Ajv2020({ allErrors: true, strict: true })
    addFormats(ajv)
    manifestValidator = ajv.compile(schema)
  }
  return manifestValidator
}

export async function validateDeploymentManifest(manifest) {
  const validate = await getManifestValidator()
  if (!validate(manifest)) {
    const details = validate.errors
      .map((error) => `${error.instancePath || "/"} ${error.message}`)
      .join("; ")
    throw new Error(`Deployment manifest schema validation failed: ${details}`)
  }
  return manifest
}

export async function loadDeploymentManifest(path) {
  const manifest = JSON.parse(await readFile(resolve(path), "utf8"))
  return validateDeploymentManifest(manifest)
}

export function assertManifestExplorer(manifest, chain) {
  const expected = explorerTransactionUrl(chain, manifest.deploymentTransactionHash)
  if (manifest.explorerUrl !== expected) {
    throw new Error("Manifest explorer URL does not match the locked SDK chain")
  }
  return expected
}

export function redactError(error, secrets = []) {
  let message = error instanceof Error ? error.message : String(error)
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join("[REDACTED]")
  }
  return message
}

export function isMain(importMetaUrl) {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(importMetaUrl)
}
