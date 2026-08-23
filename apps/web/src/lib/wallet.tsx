import { createAccount, createClient } from "genlayer-js"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react"
import { studionet } from "genlayer-js/chains"

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
    __MILESTONEPROOF_E2E_PRIVATE_KEY__?: string
  }
}

const E2E_WALLET_EVENT = "milestoneproof:e2e-wallet"
type DemoAccount = ReturnType<typeof createAccount>

function consumeDemoAccount(): DemoAccount | null {
  if (typeof window === "undefined" || import.meta.env.VITE_ENABLE_E2E_WALLET !== "true") {
    return null
  }
  const privateKey = window.__MILESTONEPROOF_E2E_PRIVATE_KEY__
  delete window.__MILESTONEPROOF_E2E_PRIVATE_KEY__
  if (typeof privateKey !== "string" || !/^0x[0-9a-f]{64}$/i.test(privateKey)) return null
  return createAccount(privateKey as `0x${string}`)
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
  const baseProvider = providerOverride === undefined
    ? (typeof window === "undefined" ? null : window.ethereum ?? null)
    : providerOverride
  const [demoAccount, setDemoAccount] = useState<DemoAccount | null>(null)
  const provider = demoAccount ? null : baseProvider
  const [account, setAccount] = useState<`0x${string}` | null>(null)
  const [chainId, setChainId] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const connectionVersion = useRef(0)

  useEffect(() => {
    const selectDemoAccount = () => {
      const nextAccount = consumeDemoAccount()
      if (!nextAccount) return
      connectionVersion.current += 1
      setDemoAccount(nextAccount)
      setAccount(nextAccount.address.toLowerCase() as `0x${string}`)
      setChainId(STUDIONET_CHAIN_ID)
      setConnecting(false)
    }
    selectDemoAccount()
    window.addEventListener(E2E_WALLET_EVENT, selectDemoAccount)
    return () => window.removeEventListener(E2E_WALLET_EVENT, selectDemoAccount)
  }, [])

  const clearConnection = useCallback(() => {
    connectionVersion.current += 1
    if (provider) clearWriteClientCache(provider)
    setDemoAccount(null)
    setAccount(null)
    setConnecting(false)
  }, [provider])

  useEffect(() => {
    if (!provider) {
      connectionVersion.current += 1
      if (demoAccount) {
        setAccount(demoAccount.address.toLowerCase() as `0x${string}`)
        setChainId(STUDIONET_CHAIN_ID)
      } else {
        setAccount(null)
        setChainId(null)
      }
      return
    }

    let active = true
    const snapshotVersion = connectionVersion.current
    void Promise.all([
      provider.request({ method: "eth_accounts" }),
      provider.request({ method: "eth_chainId" }),
    ]).then(([accounts, activeChainId]) => {
      if (!active || snapshotVersion !== connectionVersion.current) return
      setAccount(firstAccount(accounts))
      setChainId(normalizeChainId(activeChainId))
    }).catch(() => {
      if (active && snapshotVersion === connectionVersion.current) clearConnection()
    })

    const handleAccountsChanged = (...args: unknown[]) => {
      connectionVersion.current += 1
      clearWriteClientCache(provider)
      const nextAccount = firstAccount(args[0])
      setAccount(nextAccount)
      setConnecting(false)
    }
    const handleChainChanged = (...args: unknown[]) => {
      connectionVersion.current += 1
      clearWriteClientCache(provider)
      setChainId(normalizeChainId(args[0]))
      setConnecting(false)
    }
    const handleDisconnect = () => {
      setChainId(null)
      clearConnection()
    }

    provider.on?.("accountsChanged", handleAccountsChanged)
    provider.on?.("chainChanged", handleChainChanged)
    provider.on?.("disconnect", handleDisconnect)
    return () => {
      active = false
      connectionVersion.current += 1
      provider.removeListener?.("accountsChanged", handleAccountsChanged)
      provider.removeListener?.("chainChanged", handleChainChanged)
      provider.removeListener?.("disconnect", handleDisconnect)
    }
  }, [clearConnection, demoAccount, provider])

  const connect = useCallback(async () => {
    if (demoAccount) {
      setAccount(demoAccount.address.toLowerCase() as `0x${string}`)
      setChainId(STUDIONET_CHAIN_ID)
      return
    }
    if (!provider) {
      throw new TransactionLifecycleError("WALLET_DISCONNECTED", "No injected wallet was found.")
    }
    const requestVersion = connectionVersion.current + 1
    connectionVersion.current = requestVersion
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
      if (requestVersion !== connectionVersion.current) return
      clearWriteClientCache(provider)
      setAccount(nextAccount)
      setChainId(normalizeChainId(activeChainId))
    } finally {
      if (requestVersion === connectionVersion.current) setConnecting(false)
    }
  }, [demoAccount, provider])

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
    if (demoAccount) {
      if (chainId !== STUDIONET_CHAIN_ID) {
        throw new TransactionLifecycleError("WRONG_NETWORK", "Switch to GenLayer Studionet to continue.")
      }
      return createClient({ chain: studionet, account: demoAccount })
    }
    if (!provider || !account) {
      throw new TransactionLifecycleError("WALLET_DISCONNECTED", "Connect a wallet to continue.")
    }
    if (chainId !== STUDIONET_CHAIN_ID) {
      throw new TransactionLifecycleError("WRONG_NETWORK", "Switch to GenLayer Studionet to continue.")
    }
    return writeClient(provider, account)
  }, [account, chainId, demoAccount, provider])

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
