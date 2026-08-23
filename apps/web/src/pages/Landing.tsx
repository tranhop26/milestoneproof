import { ArrowRight, Blocks, Circle, Github, ShieldCheck } from "lucide-react"
import { Link } from "react-router-dom"

export function Landing() {
  return (
    <div className="landing-stack">
      <section className="hero-card">
        <div>
          <div className="hero-kicker"><ShieldCheck size={15} /> Intelligent milestone verification</div>
          <h1>Proof of work,<br /><span>decided on-chain.</span></h1>
          <p>Freeze acceptance criteria, bind public delivery evidence, and let GenLayer validators establish a semantic verdict neither party controls.</p>
          <div className="hero-actions">
            <Link className="primary-button" to="/projects/new">Create project <ArrowRight size={16} /></Link>
            <Link className="secondary-button" to="/projects">View projects</Link>
          </div>
        </div>
        <section aria-label="How MilestoneProof works" className="verification-card">
          <div className="verification-header"><span>How it works</span><span className="illustrative-label">Illustrative flow</span></div>
          <ol className="flow-list">
            <li><span>01</span><div><strong>Criteria frozen</strong><small>Sponsor commits the scope</small></div><Circle aria-hidden="true" className="flow-neutral" size={14} /></li>
            <li><span>02</span><div><strong>Evidence submitted</strong><small>Builder binds immutable sources</small></div><Circle aria-hidden="true" className="flow-neutral" size={14} /></li>
            <li><span>03</span><div><strong>Validator consensus</strong><small>Semantic decision on GenLayer</small></div><Circle aria-hidden="true" className="flow-neutral" size={14} /></li>
          </ol>
        </section>
      </section>

      <section className="trust-grid">
        <article><Blocks size={18} /><h2>Contract source of truth</h2><p>Projects, frozen criteria, evidence digests, and verdicts are authoritative contract reads.</p></article>
        <article><Github size={18} /><h2>Public evidence, bound</h2><p>Repository, release, CI, and deployment evidence is tied to exact subjects and versions.</p></article>
        <article><ShieldCheck size={18} /><h2>No unilateral approval</h2><p>Neither sponsor nor builder chooses the verdict. Invalid or uncertain proof never defaults to approval.</p></article>
      </section>
    </div>
  )
}
