import { FolderKanban, Home, Menu, Plus, ShieldCheck, X } from "lucide-react"
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PropsWithChildren, type ReactNode } from "react"
import { NavLink } from "react-router-dom"

const navigation = [
  { label: "Overview", to: "/", icon: Home },
  { label: "Projects", to: "/projects", icon: FolderKanban },
  { label: "New project", to: "/projects/new", icon: Plus },
]

function Navigation({ label, onNavigate }: { label: string; onNavigate?: () => void }) {
  return (
    <nav aria-label={label} className="app-navigation">
      {navigation.map(({ label: itemLabel, to, icon: Icon }) => (
        <NavLink
          key={to}
          className={({ isActive }) => `nav-item${isActive ? " nav-item-active" : ""}`}
          end={to === "/"}
          onClick={onNavigate}
          to={to}
        >
          <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
          <span>{itemLabel}</span>
        </NavLink>
      ))}
    </nav>
  )
}

function Brand() {
  return (
    <NavLink aria-label="MilestoneProof home" className="brand" to="/">
      <span className="brand-mark"><ShieldCheck aria-hidden="true" size={18} /></span>
      <span>MilestoneProof</span>
    </NavLink>
  )
}

export interface AppShellProps extends PropsWithChildren {
  actions?: ReactNode
}

export function AppShell({ actions, children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const wasMobileOpen = useRef(false)

  useEffect(() => {
    if (mobileOpen) {
      wasMobileOpen.current = true
      closeButtonRef.current?.focus()
      return
    }
    if (wasMobileOpen.current) {
      wasMobileOpen.current = false
      menuButtonRef.current?.focus()
    }
  }, [mobileOpen])

  useEffect(() => {
    if (!mobileOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [mobileOpen])

  const trapSheetFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ))
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="app-shell">
      <aside className="desktop-sidebar">
        <Brand />
        <Navigation label="Primary" />
        <div className="trust-note">
          <ShieldCheck aria-hidden="true" size={16} />
          <p>Acceptance criteria and verdicts are read directly from the contract.</p>
        </div>
      </aside>

      <div className="app-frame">
        <header className="topbar">
          <button
            aria-controls="mobile-navigation"
            aria-expanded={mobileOpen}
            aria-label="Open navigation"
            className="icon-button mobile-menu-button"
            onClick={() => setMobileOpen(true)}
            ref={menuButtonRef}
            type="button"
          >
            <Menu aria-hidden="true" size={20} />
          </button>
          <div className="mobile-brand"><Brand /></div>
          <div className="topbar-actions">{actions}</div>
        </header>
        <main className="app-main">{children}</main>
      </div>

      {mobileOpen && (
        <div className="sheet-backdrop" onMouseDown={() => setMobileOpen(false)}>
          <section
            aria-label="Navigation"
            aria-modal="true"
            className="mobile-sheet"
            id="mobile-navigation"
            onKeyDown={trapSheetFocus}
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="sheet-header">
              <Brand />
              <button
                aria-label="Close navigation"
                className="icon-button"
                onClick={() => setMobileOpen(false)}
                ref={closeButtonRef}
                type="button"
              >
                <X aria-hidden="true" size={20} />
              </button>
            </div>
            <Navigation label="Mobile primary" onNavigate={() => setMobileOpen(false)} />
          </section>
        </div>
      )}
    </div>
  )
}
