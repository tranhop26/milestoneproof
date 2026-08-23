import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import { AppShell } from "./AppShell"

describe("AppShell", () => {
  it("provides compact primary navigation and a main content landmark", () => {
    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <AppShell><h1>Project workspace</h1></AppShell>
      </MemoryRouter>,
    )

    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument()
    expect(screen.getByRole("main")).toHaveTextContent("Project workspace")
    expect(screen.getAllByRole("link", { name: "Projects" }).length).toBeGreaterThan(0)
  })

  it("opens and closes an accessible mobile navigation sheet", async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <AppShell><p>Content</p></AppShell>
      </MemoryRouter>,
    )

    await user.click(screen.getByRole("button", { name: "Open navigation" }))
    expect(screen.getByRole("dialog", { name: "Navigation" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Close navigation" }))
    expect(screen.queryByRole("dialog", { name: "Navigation" })).not.toBeInTheDocument()
  })
})
