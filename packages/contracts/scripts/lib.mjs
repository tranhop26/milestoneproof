import { createHash } from "node:crypto"
import { constants as fsConstants } from "node:fs"
import { access, link, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url))
export const CONTRACT_PATH = resolve(ROOT, "packages/contracts/milestoneproof.py")
export const EXPECTED_CONFIG = [0, 3, 3, 4, 3, 259200]
export const CLASSIFICATION = "INTENTIONALLY_FROZEN"

const NETWORKS = {
  studionet: {
    chainExport: "studionet",
    explorer: "https://explorer-studio.genlayer.com/tx",
  },
  "testnet-asimov": {
    chainExport: "testnetAsimov",
    explorer: "https://explorer-asimov.genlayer.com/tx",
  },
  "testnet-bradbury": {
    chainExport: "testnetBradbury",
    explorer: "https://explorer-bradbury.genlayer.com/tx",
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
    const values = await loadEnvFile(".env")
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
  if (receipt?.statusName !== "FINALIZED") {
    throw new Error(`Transaction did not reach FINALIZED (received ${receipt?.statusName || "UNKNOWN"})`)
  }
  if (receipt?.txExecutionResultName !== executionResult) {
    throw new Error(`Transaction must end as ${executionResult} (received ${receipt?.txExecutionResultName || "UNKNOWN"})`)
  }
}

export function deployedAddress(receipt) {
  const value = receipt?.txDataDecoded?.contractAddress || receipt?.recipient || receipt?.to_address
  return assertAddress(value, "deployed contract address")
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

export function explorerTransactionUrl(network, transactionHash) {
  return `${network.explorer}/${assertHash(transactionHash)}`
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
