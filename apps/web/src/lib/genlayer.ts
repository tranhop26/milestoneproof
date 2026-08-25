import { createClient } from "genlayer-js"
import { studionet } from "genlayer-js/chains"

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>
  on?(event: string, listener: (...args: unknown[]) => void): void
  removeListener?(event: string, listener: (...args: unknown[]) => void): void
}

export type GenLayerClient = ReturnType<typeof createClient>

export const STUDIONET_EXPLORER_TRANSACTION_URL = "https://explorer-studio.genlayer.com/tx"

let accountlessClient: GenLayerClient | undefined
let writeClients = new WeakMap<Eip1193Provider, Map<string, GenLayerClient>>()

export function readClient(): GenLayerClient {
  accountlessClient ??= createClient({ chain: studionet })
  return accountlessClient
}

export async function writeClient(
  provider: Eip1193Provider,
  account: `0x${string}`,
): Promise<GenLayerClient> {
  let providerClients = writeClients.get(provider)
  if (!providerClients) {
    providerClients = new Map()
    writeClients.set(provider, providerClients)
  }

  const key = account.toLowerCase()
  let client = providerClients.get(key)
  if (!client) {
    client = createClient({
      chain: studionet,
      account,
      provider: provider as NonNullable<Parameters<typeof createClient>[0]>["provider"],
    })
    providerClients.set(key, client)
  }
  try {
    await client.connect("studionet")
  } catch (error) {
    if (providerClients.get(key) === client) providerClients.delete(key)
    throw error
  }
  return client
}

export function clearWriteClientCache(provider?: Eip1193Provider): void {
  if (provider) {
    writeClients.delete(provider)
    return
  }
  writeClients = new WeakMap()
}
