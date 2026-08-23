import { render, screen, waitFor, within } from "@testing-library/react"
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

    const trigger = screen.getByRole("button", { name: "Open navigation" })
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    expect(trigger).toHaveAttribute("aria-controls", "mobile-navigation")

    await user.click(trigger)
    const dialog = screen.getByRole("dialog", { name: "Navigation" })
    expect(dialog).toHaveAttribute("id", "mobile-navigation")
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    await waitFor(() => expect(screen.getByRole("button", { name: "Close navigation" })).toHaveFocus())

    const links = within(dialog).getAllByRole("link")
    links.at(-1)?.focus()
    await user.tab()
    expect(links[0]).toHaveFocus()

    await user.click(screen.getByRole("button", { name: "Close navigation" }))
    expect(screen.queryByRole("dialog", { name: "Navigation" })).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it("closes the mobile sheet with Escape and restores focus to its trigger", async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <AppShell><p>Content</p></AppShell>
      </MemoryRouter>,
    )

    const trigger = screen.getByRole("button", { name: "Open navigation" })
    await user.click(trigger)
    await user.keyboard("{Escape}")

    expect(screen.queryByRole("dialog", { name: "Navigation" })).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
