import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { App } from "./App"
import { WalletProvider } from "./lib/wallet"

const CONTRACT = "0xc000000000000000000000000000000000000001"

function renderApp(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <WalletProvider provider={null}>
          <App />
        </WalletProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllEnvs())

describe("landing page", () => {
  it("labels the verification sequence as an illustrative explanation, not live state", () => {
    renderApp("/")

    expect(screen.getByRole("region", { name: "How MilestoneProof works" })).toHaveTextContent("How it works")
    expect(screen.getByText("Illustrative flow")).toBeInTheDocument()
    expect(screen.queryByText("Active")).not.toBeInTheDocument()
    expect(document.querySelector(".pulse-dot")).not.toBeInTheDocument()
  })

  it("routes /projects to the contract-backed wallet index", () => {
    vi.stubEnv("VITE_MILESTONEPROOF_ADDRESS", CONTRACT)
    renderApp("/projects")

    expect(screen.getByRole("heading", { name: "Your projects" })).toBeInTheDocument()
    expect(screen.getByText(/indexed by your connected wallet/i)).toBeInTheDocument()
  })
})
