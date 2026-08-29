import { useState } from "react"
import { Navigate, Route, Routes } from "react-router-dom"

import { AppShell } from "./components/AppShell"
import { useWallet } from "./lib/wallet"
import { CreateProject } from "./pages/CreateProject"
import { Landing } from "./pages/Landing"
import { ProjectWorkspace } from "./pages/ProjectWorkspace"
import { Projects } from "./pages/Projects"
import { SubmissionDetail } from "./pages/SubmissionDetail"

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

export function App() {
  return (
    <AppShell actions={<WalletControl />}>
      <Routes>
        <Route element={<Landing />} path="/" />
        <Route element={<Projects />} path="/projects" />
        <Route element={<CreateProject />} path="/projects/new" />
        <Route element={<ProjectWorkspace />} path="/projects/:projectId" />
        <Route element={<SubmissionDetail />} path="/submissions/:submissionId" />
        <Route element={<Navigate replace to="/" />} path="*" />
      </Routes>
    </AppShell>
  )
}
