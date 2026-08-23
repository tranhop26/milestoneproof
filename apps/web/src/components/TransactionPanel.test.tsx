import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { TransactionPanel } from "./TransactionPanel"

const TX_HASH = `0x${"a".repeat(64)}` as const

describe("TransactionPanel", () => {
  it("retains finalized progress when contract execution fails", () => {
    render(<TransactionPanel state={{
      phase: "ERROR",
      progressPhase: "FINALIZED",
      code: "EXECUTION_FAILED",
      hash: TX_HASH,
      message: "The contract rejected this transaction.",
    }} />)

    const progress = screen.getByRole("list", { name: "Transaction progress" })
    expect(within(progress).getByText(/finalized/i).closest("li")).toHaveClass("step-complete")
    expect(within(progress).getByText(/success/i).closest("li")).not.toHaveClass("step-complete")
  })

  it("retains execution success when authoritative readback fails", () => {
    render(<TransactionPanel state={{
      phase: "ERROR",
      progressPhase: "SUCCESS",
      code: "READBACK_FAILED",
      hash: TX_HASH,
      message: "Readback failed.",
    }} />)

    const progress = screen.getByRole("list", { name: "Transaction progress" })
    expect(within(progress).getByText(/success/i).closest("li")).toHaveClass("step-complete")
    expect(within(progress).getByText(/readback/i).closest("li")).not.toHaveClass("step-complete")
  })

  it("links transaction hashes to the current Studionet explorer route", () => {
    render(<TransactionPanel state={{ phase: "PENDING", hash: TX_HASH, message: "Pending." }} />)

    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `https://explorer-studio.genlayer.com/tx/${TX_HASH}`,
    )
  })
})
