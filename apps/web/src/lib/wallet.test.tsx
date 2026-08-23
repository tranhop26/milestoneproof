import { act, renderHook } from "@testing-library/react"
import type { PropsWithChildren } from "react"
import { describe, expect, it } from "vitest"

import {
  STUDIONET_CHAIN_ID,
  WalletProvider,
  useWallet,
  type Eip1193Provider,
} from "./wallet"

class FakeProvider implements Eip1193Provider {
  accounts: string[] = []
  chainId = STUDIONET_CHAIN_ID
  switchChangesChain = true
  initialAccountsRequest?: Promise<unknown>
  connectAccountsRequest?: Promise<unknown>
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>()

  async request({ method }: { method: string; params?: unknown[] | object }): Promise<unknown> {
    if (method === "eth_accounts" && this.initialAccountsRequest) return this.initialAccountsRequest
    if (method === "eth_requestAccounts" && this.connectAccountsRequest) return this.connectAccountsRequest
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [...this.accounts]
    if (method === "eth_chainId") return this.chainId
    if (method === "wallet_switchEthereumChain") {
      if (this.switchChangesChain) this.chainId = STUDIONET_CHAIN_ID
      return null
    }
    throw new Error(`unsupported method: ${method}`)
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    const handlers = this.listeners.get(event) ?? new Set()
    handlers.add(listener)
    this.listeners.set(event, handlers)
  }

  removeListener(event: string, listener: (...args: unknown[]) => void): void {
    this.listeners.get(event)?.delete(listener)
  }

  emit(event: string, value?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value)
  }
}

describe("WalletProvider", () => {
  it("exposes the disconnected state when no injected wallet exists", async () => {
    const wrapper = ({ children }: PropsWithChildren) => (
      <WalletProvider provider={null}>{children}</WalletProvider>
    )
    const { result } = renderHook(() => useWallet(), { wrapper })

    expect(result.current.status).toBe("DISCONNECTED")
    expect(result.current.account).toBeNull()
    await expect(result.current.connect()).rejects.toMatchObject({ code: "WALLET_DISCONNECTED" })
  })

  it("connects to an injected account and reacts to account changes", async () => {
    const provider = new FakeProvider()
    provider.accounts = ["0x1111111111111111111111111111111111111111"]
    const wrapper = ({ children }: PropsWithChildren) => (
      <WalletProvider provider={provider}>{children}</WalletProvider>
    )
    const { result } = renderHook(() => useWallet(), { wrapper })

    await act(async () => { await result.current.connect() })
    expect(result.current).toMatchObject({
      status: "CONNECTED",
      account: "0x1111111111111111111111111111111111111111",
    })

    act(() => provider.emit("accountsChanged", ["0x2222222222222222222222222222222222222222"]))
    expect(result.current.account).toBe("0x2222222222222222222222222222222222222222")
  })

  it("reports a wrong network and clears the account on provider disconnect", async () => {
    const provider = new FakeProvider()
    provider.accounts = ["0x1111111111111111111111111111111111111111"]
    const wrapper = ({ children }: PropsWithChildren) => (
      <WalletProvider provider={provider}>{children}</WalletProvider>
    )
    const { result } = renderHook(() => useWallet(), { wrapper })
    await act(async () => { await result.current.connect() })

    act(() => provider.emit("chainChanged", "0x1"))
    expect(result.current.status).toBe("WRONG_NETWORK")

    act(() => provider.emit("disconnect"))
    expect(result.current).toMatchObject({ status: "DISCONNECTED", account: null })
  })

  it("offers a real Studionet switch when the connected wallet is on another chain", async () => {
    const provider = new FakeProvider()
    provider.accounts = ["0x1111111111111111111111111111111111111111"]
    provider.chainId = "0x1"
    const wrapper = ({ children }: PropsWithChildren) => (
      <WalletProvider provider={provider}>{children}</WalletProvider>
    )
    const { result } = renderHook(() => useWallet(), { wrapper })
    await act(async () => { await result.current.connect() })
    expect(result.current.status).toBe("WRONG_NETWORK")

    await act(async () => { await result.current.switchToStudionet() })

    expect(result.current.status).toBe("CONNECTED")
    expect(result.current.chainId).toBe(STUDIONET_CHAIN_ID)
  })

  it("refuses a signer client while the connected wallet is on the wrong network", async () => {
    const provider = new FakeProvider()
    provider.accounts = ["0x1111111111111111111111111111111111111111"]
    provider.chainId = "0x1"
    const wrapper = ({ children }: PropsWithChildren) => (
      <WalletProvider provider={provider}>{children}</WalletProvider>
    )
    const { result } = renderHook(() => useWallet(), { wrapper })
    await act(async () => { await result.current.connect() })

    await expect(result.current.getWriteClient()).rejects.toMatchObject({ code: "WRONG_NETWORK" })
  })

  it("reports a failed network recovery when the provider stays on another chain", async () => {
    const provider = new FakeProvider()
    provider.accounts = ["0x1111111111111111111111111111111111111111"]
    provider.chainId = "0x1"
    provider.switchChangesChain = false
    const wrapper = ({ children }: PropsWithChildren) => (
      <WalletProvider provider={provider}>{children}</WalletProvider>
    )
    const { result } = renderHook(() => useWallet(), { wrapper })
    await act(async () => { await result.current.connect() })

    await expect(result.current.switchToStudionet()).rejects.toMatchObject({ code: "WRONG_NETWORK" })
    expect(result.current.status).toBe("WRONG_NETWORK")
  })

  it("treats an empty accountsChanged event as a wallet disconnect", async () => {
    const provider = new FakeProvider()
    provider.accounts = ["0x1111111111111111111111111111111111111111"]
    const wrapper = ({ children }: PropsWithChildren) => (
      <WalletProvider provider={provider}>{children}</WalletProvider>
    )
    const { result } = renderHook(() => useWallet(), { wrapper })
    await act(async () => { await result.current.connect() })

    act(() => provider.emit("accountsChanged", []))
    expect(result.current).toMatchObject({ status: "DISCONNECTED", account: null })
  })

  it("does not restore a stale account snapshot after a provider disconnect", async () => {
    let resolveInitialAccounts: (accounts: string[]) => void = () => undefined
    const provider = new FakeProvider()
    provider.accounts = ["0x1111111111111111111111111111111111111111"]
    provider.initialAccountsRequest = new Promise((resolve) => { resolveInitialAccounts = resolve })
    const wrapper = ({ children }: PropsWithChildren) => (
      <WalletProvider provider={provider}>{children}</WalletProvider>
    )
    const { result } = renderHook(() => useWallet(), { wrapper })

    act(() => provider.emit("disconnect"))
    await act(async () => { resolveInitialAccounts(provider.accounts) })

    expect(result.current).toMatchObject({ status: "DISCONNECTED", account: null })
  })

  it("does not restore a deferred manual connection after provider disconnect", async () => {
    let resolveConnect: (accounts: string[]) => void = () => undefined
    const provider = new FakeProvider()
    provider.connectAccountsRequest = new Promise((resolve) => { resolveConnect = resolve })
    const wrapper = ({ children }: PropsWithChildren) => (
      <WalletProvider provider={provider}>{children}</WalletProvider>
    )
    const { result } = renderHook(() => useWallet(), { wrapper })

    let connection!: Promise<void>
    act(() => { connection = result.current.connect() })
    act(() => provider.emit("disconnect"))
    await act(async () => { resolveConnect(["0x1111111111111111111111111111111111111111"]); await connection })

    expect(result.current).toMatchObject({ status: "DISCONNECTED", account: null, chainId: null })
  })

  it("does not overwrite a newer accountsChanged value with a deferred manual connection", async () => {
    let resolveConnect: (accounts: string[]) => void = () => undefined
    const provider = new FakeProvider()
    provider.connectAccountsRequest = new Promise((resolve) => { resolveConnect = resolve })
    const wrapper = ({ children }: PropsWithChildren) => (
      <WalletProvider provider={provider}>{children}</WalletProvider>
    )
    const { result } = renderHook(() => useWallet(), { wrapper })

    let connection!: Promise<void>
    act(() => { connection = result.current.connect() })
    act(() => provider.emit("accountsChanged", ["0x2222222222222222222222222222222222222222"]))
    await act(async () => { resolveConnect(["0x1111111111111111111111111111111111111111"]); await connection })

    expect(result.current.account).toBe("0x2222222222222222222222222222222222222222")
  })
})
