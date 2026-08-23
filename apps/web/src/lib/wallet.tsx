import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react"

import {
  clearWriteClientCache,
  writeClient,
  type Eip1193Provider,
  type GenLayerClient,
} from "./genlayer"
import { TransactionLifecycleError } from "./transaction"

export type { Eip1193Provider } from "./genlayer"

export const STUDIONET_CHAIN_ID = "0xf22f"

export type WalletStatus = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "WRONG_NETWORK"

export interface WalletContextValue {
  account: `0x${string}` | null
  chainId: string | null
  status: WalletStatus
  connect: () => Promise<void>
  switchToStudionet: () => Promise<void>
  disconnect: () => void
  getWriteClient: () => Promise<GenLayerClient>
}

const WalletContext = createContext<WalletContextValue | null>(null)

declare global {
  interface Window {
    ethereum?: Eip1193Provider
  }
}

function normalizeChainId(chainId: unknown): string | null {
  if (typeof chainId !== "string" || !/^0x[0-9a-f]+$/i.test(chainId)) return null
  return `0x${BigInt(chainId).toString(16)}`
}

function normalizeAccount(account: unknown): `0x${string}` | null {
  return typeof account === "string" && /^0x[0-9a-f]{40}$/i.test(account)
    ? account.toLowerCase() as `0x${string}`
    : null
}

function firstAccount(value: unknown): `0x${string}` | null {
  return Array.isArray(value) ? normalizeAccount(value[0]) : null
}

export interface WalletProviderProps extends PropsWithChildren {
  provider?: Eip1193Provider | null
}

export function WalletProvider({ children, provider: providerOverride }: WalletProviderProps) {
  const provider = providerOverride === undefined
    ? (typeof window === "undefined" ? null : window.ethereum ?? null)
    : providerOverride
  const [account, setAccount] = useState<`0x${string}` | null>(null)
  const [chainId, setChainId] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  const clearConnection = useCallback(() => {
    if (provider) clearWriteClientCache(provider)
    setAccount(null)
    setConnecting(false)
  }, [provider])

  useEffect(() => {
    if (!provider) {
      setAccount(null)
      setChainId(null)
      return
    }

    let active = true
    let acceptInitialSnapshot = true
    void Promise.all([
      provider.request({ method: "eth_accounts" }),
      provider.request({ method: "eth_chainId" }),
    ]).then(([accounts, activeChainId]) => {
      if (!active || !acceptInitialSnapshot) return
      setAccount(firstAccount(accounts))
      setChainId(normalizeChainId(activeChainId))
    }).catch(() => {
      if (active) clearConnection()
    })

    const handleAccountsChanged = (...args: unknown[]) => {
      acceptInitialSnapshot = false
      clearWriteClientCache(provider)
      const nextAccount = firstAccount(args[0])
      setAccount(nextAccount)
      if (!nextAccount) setConnecting(false)
    }
    const handleChainChanged = (...args: unknown[]) => {
      acceptInitialSnapshot = false
      clearWriteClientCache(provider)
      setChainId(normalizeChainId(args[0]))
    }
    const handleDisconnect = () => {
      acceptInitialSnapshot = false
      setChainId(null)
      clearConnection()
    }

    provider.on?.("accountsChanged", handleAccountsChanged)
    provider.on?.("chainChanged", handleChainChanged)
    provider.on?.("disconnect", handleDisconnect)
    return () => {
      active = false
      provider.removeListener?.("accountsChanged", handleAccountsChanged)
      provider.removeListener?.("chainChanged", handleChainChanged)
      provider.removeListener?.("disconnect", handleDisconnect)
    }
  }, [clearConnection, provider])

  const connect = useCallback(async () => {
    if (!provider) {
      throw new TransactionLifecycleError("WALLET_DISCONNECTED", "No injected wallet was found.")
    }
    setConnecting(true)
    try {
      const [accounts, activeChainId] = await Promise.all([
        provider.request({ method: "eth_requestAccounts" }),
        provider.request({ method: "eth_chainId" }),
      ])
      const nextAccount = firstAccount(accounts)
      if (!nextAccount) {
        throw new TransactionLifecycleError("WALLET_DISCONNECTED", "The wallet did not provide an account.")
      }
      clearWriteClientCache(provider)
      setAccount(nextAccount)
      setChainId(normalizeChainId(activeChainId))
    } finally {
      setConnecting(false)
    }
  }, [provider])

  const disconnect = useCallback(() => {
    setChainId(null)
    clearConnection()
  }, [clearConnection])

  const switchToStudionet = useCallback(async () => {
    if (!provider || !account) {
      throw new TransactionLifecycleError("WALLET_DISCONNECTED", "Connect a wallet to continue.")
    }
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: STUDIONET_CHAIN_ID }],
      })
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined
      if (code !== 4902) throw error
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: STUDIONET_CHAIN_ID,
          chainName: "GenLayer Studionet",
          nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
          rpcUrls: ["https://studio.genlayer.com/api"],
          blockExplorerUrls: ["https://explorer-studio.genlayer.com"],
        }],
      })
    }
    clearWriteClientCache(provider)
    const activeChainId = await provider.request({ method: "eth_chainId" })
    const normalizedChainId = normalizeChainId(activeChainId)
    setChainId(normalizedChainId)
    if (normalizedChainId !== STUDIONET_CHAIN_ID) {
      throw new TransactionLifecycleError(
        "WRONG_NETWORK",
        "The wallet did not switch to GenLayer Studionet.",
      )
    }
  }, [account, provider])

  const getWriteClient = useCallback(async () => {
    if (!provider || !account) {
      throw new TransactionLifecycleError("WALLET_DISCONNECTED", "Connect a wallet to continue.")
    }
    if (chainId !== STUDIONET_CHAIN_ID) {
      throw new TransactionLifecycleError("WRONG_NETWORK", "Switch to GenLayer Studionet to continue.")
    }
    return writeClient(provider, account)
  }, [account, chainId, provider])

  const status: WalletStatus = connecting
    ? "CONNECTING"
    : !account
      ? "DISCONNECTED"
      : chainId === STUDIONET_CHAIN_ID
        ? "CONNECTED"
        : "WRONG_NETWORK"

  const value = useMemo<WalletContextValue>(() => ({
    account,
    chainId,
    status,
    connect,
    switchToStudionet,
    disconnect,
    getWriteClient,
  }), [account, chainId, connect, disconnect, getWriteClient, status, switchToStudionet])

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet(): WalletContextValue {
  const wallet = useContext(WalletContext)
  if (!wallet) throw new Error("useWallet must be used within WalletProvider")
  return wallet
}
