import { ArrowUpRight, FolderKanban, LoaderCircle, ShieldAlert } from "lucide-react"
import { useMemo, useState } from "react"
import { Link } from "react-router-dom"

import { StatusBadge } from "../components/StatusBadge"
import { useActorProjects, useMilestoneProofContract } from "../hooks/useMilestoneProof"
import type { ActorRole, MilestoneProofContract } from "../lib/contract"
import { useWallet } from "../lib/wallet"

type RoleFilter = "all" | ActorRole

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function roleLabel(role: ActorRole) {
  return role === "sponsor" ? "Sponsor" : "Builder"
}

export function Projects({ contract: contractOverride }: { contract?: MilestoneProofContract }) {
  const wallet = useWallet()
  const { contract, configurationError } = useMilestoneProofContract(contractOverride)
  const [filter, setFilter] = useState<RoleFilter>("all")
  const walletReady = wallet.status === "CONNECTED"
  const projects = useActorProjects(contract, wallet.account, walletReady)
  const visibleProjects = useMemo(() => (
    projects.data?.filter(({ roles }) => filter === "all" || roles.includes(filter)) ?? []
  ), [filter, projects.data])

  return (
    <section className="projects-page">
      <header className="page-heading projects-heading">
        <div>
          <p className="eyebrow">Contract index</p>
          <h1>Your projects</h1>
          <p>Sponsor and builder projects indexed by your connected wallet, read directly from MilestoneProof.</p>
        </div>
        {walletReady && <Link className="primary-button" to="/projects/new">Create project</Link>}
      </header>

      {configurationError ? (
        <div className="projects-state projects-error" role="alert">
          <ShieldAlert aria-hidden="true" size={22} />
          <div><h2>Contract configuration unavailable</h2><p>{configurationError}</p></div>
        </div>
      ) : wallet.status === "WRONG_NETWORK" ? (
        <div className="projects-state projects-error">
          <ShieldAlert aria-hidden="true" size={22} />
          <div><strong className="wrong-network-chip">WRONG_NETWORK</strong><p>Switch to GenLayer Studionet to load your projects.</p></div>
        </div>
      ) : !walletReady ? (
        <div className="projects-state projects-empty">
          <FolderKanban aria-hidden="true" size={24} />
          <div><h2>Connect your wallet</h2><p>The contract indexes projects by sponsor and builder address. Connect the wallet used by the project to load its authoritative index.</p></div>
        </div>
      ) : projects.isPending ? (
        <div aria-live="polite" className="projects-state projects-loading">
          <LoaderCircle aria-hidden="true" className="spin" size={22} />
          <p>Reading sponsor and builder indexes from the contract…</p>
        </div>
      ) : projects.error ? (
        <div className="projects-state projects-error" role="alert">
          <ShieldAlert aria-hidden="true" size={22} />
          <div>
            <h2>Contract read failed</h2>
            <p>{projects.error instanceof Error ? projects.error.message : "The authoritative project index could not be read."}</p>
            <button className="secondary-button" onClick={() => void projects.refetch()} type="button">Retry contract read</button>
          </div>
        </div>
      ) : projects.data?.length === 0 ? (
        <div className="projects-state projects-empty">
          <FolderKanban aria-hidden="true" size={24} />
          <div><h2>No indexed projects</h2><p>The contract returned no sponsor or builder projects for this wallet.</p></div>
          <Link className="secondary-button" to="/projects/new">Create your first project</Link>
        </div>
      ) : (
        <>
          <div aria-label="Filter projects by role" className="projects-toolbar" role="group">
            {(["all", "sponsor", "builder"] as RoleFilter[]).map((role) => (
              <button
                aria-pressed={filter === role}
                className={filter === role ? "project-filter active" : "project-filter"}
                key={role}
                onClick={() => setFilter(role)}
                type="button"
              >
                {role === "all" ? "All" : roleLabel(role)}
              </button>
            ))}
            <span>{visibleProjects.length} {visibleProjects.length === 1 ? "project" : "projects"}</span>
          </div>

          <div className="projects-grid">
            {visibleProjects.map(({ project, roles }) => (
              <article className="project-card" key={project.id}>
                <header>
                  <div>
                    <span className="project-number">Project #{project.id}</span>
                    <h2>{project.title}</h2>
                  </div>
                  <StatusBadge status={project.status} />
                </header>
                <p className="project-description">{project.description}</p>
                <div className="project-role-list">
                  {roles.map((role) => <span className="project-role" key={role}>{roleLabel(role)}</span>)}
                </div>
                <dl className="project-card-facts">
                  <div><dt>Progress</dt><dd>Milestone {Math.min(project.currentMilestone + 1, project.milestoneCount)} of {project.milestoneCount}</dd></div>
                  <div><dt>Sponsor</dt><dd title={project.sponsor}>{shortAddress(project.sponsor)}</dd></div>
                  <div><dt>Builder</dt><dd title={project.builder}>{shortAddress(project.builder)}</dd></div>
                </dl>
                <Link aria-label={`Open project ${project.id}`} className="project-card-link" to={`/projects/${project.id}`}>
                  Open workspace <ArrowUpRight aria-hidden="true" size={15} />
                </Link>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
