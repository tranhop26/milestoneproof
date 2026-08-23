import { describe, expect, it } from "vitest"

import {
  TransactionLifecycleError,
  runWriteAndReadback,
  type TransactionAdapter,
} from "./transaction"

const TX_HASH = `0x${"a".repeat(64)}` as const

function successfulAdapter<T>(readback: T): TransactionAdapter<T> {
  return {
    assertReady: () => undefined,
    submit: async () => TX_HASH,
    waitForFinalized: async () => ({ executionSucceeded: true }),
    readback: async () => readback,
  }
}

describe("runWriteAndReadback", () => {
  it("does not report success for a finalized execution error", async () => {
    const states: Array<{ phase: string; progressPhase?: string }> = []
    const adapter: TransactionAdapter<never> = {
      ...successfulAdapter(undefined as never),
      waitForFinalized: async () => ({
        executionSucceeded: false,
        error: "contract reverted: unauthorized actor",
      }),
    }

    await expect(runWriteAndReadback(adapter, (state) => states.push(state)))
      .rejects.toMatchObject({ code: "EXECUTION_FAILED" })

    expect(states.map(({ phase }) => phase)).toEqual(["AWAITING_SIGNATURE", "PENDING", "FINALIZED", "ERROR"])
    expect(states.at(-1)).toMatchObject({ phase: "ERROR", progressPhase: "FINALIZED" })
    expect(states.map(({ phase }) => phase)).not.toContain("SUCCESS")
  })

  it("reports a disconnected wallet without requesting a signature", async () => {
    const states: string[] = []
    const adapter = successfulAdapter({ projectId: "1" })
    adapter.assertReady = () => {
      throw new TransactionLifecycleError("WALLET_DISCONNECTED", "Connect a wallet to continue")
    }

    await expect(runWriteAndReadback(adapter, (state) => states.push(state.phase)))
      .rejects.toMatchObject({ code: "WALLET_DISCONNECTED" })
    expect(states).toEqual(["DISCONNECTED"])
  })

  it("reports a rejected wallet signature distinctly", async () => {
    const states: Array<{ phase: string; code?: string }> = []
    const adapter = successfulAdapter({ projectId: "1" })
    adapter.submit = async () => {
      throw Object.assign(new Error("User rejected the request"), { code: 4001 })
    }

    await expect(runWriteAndReadback(adapter, (state) => states.push(state)))
      .rejects.toMatchObject({ code: "SIGNATURE_REJECTED" })
    expect(states).toEqual([
      expect.objectContaining({ phase: "AWAITING_SIGNATURE" }),
      expect.objectContaining({ phase: "ERROR", code: "SIGNATURE_REJECTED" }),
    ])
  })

  it("reports a wrong network before submitting a write", async () => {
    const states: Array<{ phase: string; code?: string }> = []
    const adapter = successfulAdapter({ projectId: "1" })
    adapter.assertReady = () => {
      throw new TransactionLifecycleError("WRONG_NETWORK", "Switch to GenLayer Studionet")
    }

    await expect(runWriteAndReadback(adapter, (state) => states.push(state)))
      .rejects.toMatchObject({ code: "WRONG_NETWORK" })
    expect(states).toEqual([
      expect.objectContaining({ phase: "ERROR", code: "WRONG_NETWORK" }),
    ])
  })

  it("reports success only after execution succeeds and confirms authoritative readback", async () => {
    const states: string[] = []
    const result = await runWriteAndReadback(
      successfulAdapter({ projectId: "42", status: "ACTIVE" }),
      (state) => states.push(state.phase),
    )

    expect(result).toEqual({ projectId: "42", status: "ACTIVE" })
    expect(states).toEqual([
      "AWAITING_SIGNATURE",
      "PENDING",
      "FINALIZED",
      "SUCCESS",
      "READBACK",
    ])
  })

  it("turns failed readback into an error after execution success", async () => {
    const states: Array<{ phase: string; code?: string }> = []
    const adapter = successfulAdapter({ projectId: "42" })
    adapter.readback = async () => {
      throw new Error("RPC unavailable")
    }

    await expect(runWriteAndReadback(adapter, (state) => states.push(state)))
      .rejects.toMatchObject({ code: "READBACK_FAILED" })
    expect(states.map(({ phase }) => phase)).toEqual([
      "AWAITING_SIGNATURE",
      "PENDING",
      "FINALIZED",
      "SUCCESS",
      "ERROR",
    ])
    expect(states.at(-1)).toMatchObject({ phase: "ERROR", code: "READBACK_FAILED", progressPhase: "SUCCESS" })
  })

  it("clears a draft only after readback is confirmed", async () => {
    const draft = { evidenceUrl: "https://github.com/example/project/commit/abc", cleared: false }
    const adapter = successfulAdapter({ projectId: "42" })
    adapter.readback = async () => {
      throw new Error("temporary RPC failure")
    }

    await expect(runWriteAndReadback(adapter, () => undefined, {
      onReadbackConfirmed: () => { draft.cleared = true },
    })).rejects.toThrow()
    expect(draft).toEqual({
      evidenceUrl: "https://github.com/example/project/commit/abc",
      cleared: false,
    })

    await runWriteAndReadback(successfulAdapter({ projectId: "42" }), () => undefined, {
      onReadbackConfirmed: () => { draft.cleared = true },
    })
    expect(draft.cleared).toBe(true)
  })

  it("turns a failed local readback-confirmation callback into a consistent error state", async () => {
    const states: Array<{ phase: string; code?: string; progressPhase?: string }> = []

    await expect(runWriteAndReadback(
      successfulAdapter({ projectId: "42" }),
      (state) => states.push(state),
      { onReadbackConfirmed: () => { throw new Error("draft storage unavailable") } },
    )).rejects.toMatchObject({ code: "LOCAL_CONFIRMATION_FAILED" })

    expect(states.at(-1)).toMatchObject({
      phase: "ERROR",
      code: "LOCAL_CONFIRMATION_FAILED",
      progressPhase: "READBACK",
    })
    expect(states.map(({ phase }) => phase)).not.toContain("READBACK")
  })
})
