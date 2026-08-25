import { Check, Circle, ExternalLink } from "lucide-react"

import type { TransactionPhase, TransactionState } from "../lib/transaction"
import { STUDIONET_EXPLORER_TRANSACTION_URL } from "../lib/genlayer"
import { StatusBadge } from "./StatusBadge"

const HAPPY_PATH: TransactionPhase[] = [
  "AWAITING_SIGNATURE",
  "PENDING",
  "FINALIZED",
  "SUCCESS",
  "READBACK",
]

export interface TransactionPanelProps {
  state: TransactionState
  explorerBaseUrl?: string
}

export function TransactionPanel({
  state,
  explorerBaseUrl = STUDIONET_EXPLORER_TRANSACTION_URL,
}: TransactionPanelProps) {
  const progressPhase = state.phase === "ERROR" ? state.progressPhase : state.phase
  const currentIndex = progressPhase ? HAPPY_PATH.indexOf(progressPhase) : -1
  return (
    <section
      aria-labelledby="transaction-title"
      className="transaction-panel"
      data-transaction-phase={state.phase}
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">On-chain transaction</p>
          <h2 id="transaction-title">Execution status</h2>
        </div>
        <StatusBadge status={state.phase} />
      </div>

      <div aria-atomic="true" aria-live="polite" className="transaction-message">
        <strong>{state.phase === "ERROR" ? "Action needs attention" : "Current update"}</strong>
        <span>{state.message}</span>
      </div>

      <ol aria-label="Transaction progress" className="transaction-steps">
        {HAPPY_PATH.map((phase, index) => {
          const complete = currentIndex >= index
          const current = state.phase === phase
          return (
            <li className={complete ? "step-complete" : ""} key={phase}>
              {complete ? <Check aria-hidden="true" size={14} /> : <Circle aria-hidden="true" size={14} />}
              <span aria-current={current ? "step" : undefined}>{phase.replaceAll("_", " ")}</span>
            </li>
          )
        })}
      </ol>

      {state.hash && (
        <a
          aria-label={state.hash}
          className="transaction-link"
          href={`${explorerBaseUrl}/${state.hash}`}
          rel="noreferrer"
          target="_blank"
        >
          <span>{state.hash}</span>
          <ExternalLink aria-hidden="true" size={14} />
        </a>
      )}
    </section>
  )
}
