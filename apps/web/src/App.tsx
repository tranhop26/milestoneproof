import { ArrowRight, Blocks, Github, ShieldCheck } from "lucide-react"
import { useState } from "react"
import { Navigate, Route, Routes } from "react-router-dom"

import { AppShell } from "./components/AppShell"
import { StatusBadge } from "./components/StatusBadge"
import { useWallet } from "./lib/wallet"

function WalletControl() {
  const wallet = useWallet()
  const [error, setError] = useState("")
  const runWalletAction = async () => {
    setError("")
    try {
      if (wallet.status === "WRONG_NETWORK") await wallet.switchToStudionet()
      else await wallet.connect()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The wallet action failed.")
    }
  }
  if (wallet.status === "CONNECTED") {
    return (
      <button className="wallet-button wallet-connected" onClick={wallet.disconnect} type="button">
        <span className="wallet-dot" />
        {wallet.account?.slice(0, 6)}…{wallet.account?.slice(-4)}
      </button>
    )
  }
  return (
    <div className="wallet-action">
      {error && <span aria-live="polite" className="wallet-error">{error}</span>}
      <button className="primary-button" disabled={wallet.status === "CONNECTING"} onClick={() => void runWalletAction()} type="button">
        {wallet.status === "CONNECTING" ? "Connecting…" : wallet.status === "WRONG_NETWORK" ? "Switch to Studionet" : "Connect wallet"}
      </button>
    </div>
  )
}

function Landing() {
  return (
    <div className="landing-stack">
      <section className="hero-card">
        <div>
          <div className="hero-kicker"><ShieldCheck size={15} /> Intelligent milestone verification</div>
          <h1>Proof of work,<br /><span>decided on-chain.</span></h1>
          <p>Freeze acceptance criteria, bind public delivery evidence, and let GenLayer validators establish a semantic verdict neither party controls.</p>
          <div className="hero-actions">
            <a className="primary-button" href="/projects/new">Create project <ArrowRight size={16} /></a>
            <a className="secondary-button" href="/projects">View projects</a>
          </div>
        </div>
        <div aria-label="Verification flow" className="verification-card">
          <div className="verification-header"><span>Verification flow</span><StatusBadge status="ACTIVE" /></div>
          <ol className="flow-list">
            <li><span>01</span><div><strong>Criteria frozen</strong><small>Sponsor commits the scope</small></div><CheckMark /></li>
            <li><span>02</span><div><strong>Evidence submitted</strong><small>Builder binds immutable sources</small></div><CheckMark /></li>
            <li><span>03</span><div><strong>Validator consensus</strong><small>Semantic decision on GenLayer</small></div><div className="pulse-dot" /></li>
          </ol>
        </div>
      </section>

      <section className="trust-grid">
        <article><Blocks size={18} /><h2>Contract source of truth</h2><p>Projects, frozen criteria, evidence digests, and verdicts are authoritative contract reads.</p></article>
        <article><Github size={18} /><h2>Public evidence, bound</h2><p>Repository, release, CI, and deployment evidence is tied to exact subjects and versions.</p></article>
        <article><ShieldCheck size={18} /><h2>No unilateral approval</h2><p>Neither sponsor nor builder chooses the verdict. Invalid or uncertain proof never defaults to approval.</p></article>
      </section>
    </div>
  )
}

function CheckMark() {
  return <span aria-label="Complete" className="check-mark">✓</span>
}

function RoutePlaceholder({ title, detail }: { title: string; detail: string }) {
  return (
    <section className="empty-state">
      <p className="eyebrow">MilestoneProof</p>
      <h1>{title}</h1>
      <p>{detail}</p>
    </section>
  )
}

export function App() {
  return (
    <AppShell actions={<WalletControl />}>
      <Routes>
        <Route element={<Landing />} path="/" />
        <Route element={<RoutePlaceholder detail="Connect a wallet to load sponsor or builder projects directly from the contract." title="Projects" />} path="/projects" />
        <Route element={<RoutePlaceholder detail="Define the sponsor, builder, and one to three immutable milestones." title="Create a project" />} path="/projects/new" />
        <Route element={<RoutePlaceholder detail="Authoritative project and milestone readback will appear here." title="Project workspace" />} path="/projects/:projectId" />
        <Route element={<RoutePlaceholder detail="Evidence, consensus outcome, and transaction audit will appear here." title="Submission detail" />} path="/submissions/:submissionId" />
        <Route element={<Navigate replace to="/" />} path="*" />
      </Routes>
    </AppShell>
  )
}
