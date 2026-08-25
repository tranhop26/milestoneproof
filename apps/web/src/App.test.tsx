import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import { App } from "./App"
import { WalletProvider } from "./lib/wallet"

describe("landing page", () => {
  it("labels the verification sequence as an illustrative explanation, not live state", () => {
    render(
      <MemoryRouter initialEntries={["/"]} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <WalletProvider provider={null}>
          <App />
        </WalletProvider>
      </MemoryRouter>,
    )

    expect(screen.getByRole("region", { name: "How MilestoneProof works" })).toHaveTextContent("How it works")
    expect(screen.getByText("Illustrative flow")).toBeInTheDocument()
    expect(screen.queryByText("Active")).not.toBeInTheDocument()
    expect(document.querySelector(".pulse-dot")).not.toBeInTheDocument()
  })
})
