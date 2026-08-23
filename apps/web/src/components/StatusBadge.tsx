import type { MilestoneStatus, ProjectStatus, Verdict } from "@milestoneproof/shared"
import {
  AlertTriangle,
  Check,
  Circle,
  Clock3,
  HelpCircle,
  LoaderCircle,
  LockKeyhole,
  X,
} from "lucide-react"

import type { TransactionPhase } from "../lib/transaction"

export type BadgeStatus = ProjectStatus | MilestoneStatus | Verdict | TransactionPhase

const PRESENTATION: Record<BadgeStatus, { label: string; tone: string; icon: typeof Circle }> = {
  ACTIVE: { label: "Active", tone: "info", icon: Circle },
  COMPLETED: { label: "Completed", tone: "success", icon: Check },
  FAILED: { label: "Failed", tone: "danger", icon: X },
  LOCKED: { label: "Locked", tone: "neutral", icon: LockKeyhole },
  OPEN: { label: "Open", tone: "info", icon: Circle },
  SUBMITTED: { label: "Submitted", tone: "pending", icon: Clock3 },
  APPROVED: { label: "Approved", tone: "success", icon: Check },
  NONE: { label: "Not resolved", tone: "neutral", icon: Circle },
  REJECTED: { label: "Rejected", tone: "danger", icon: X },
  REQUEST_MORE_INFO: { label: "More info needed", tone: "violet", icon: HelpCircle },
  UNRESOLVED: { label: "Unresolved", tone: "warning", icon: AlertTriangle },
  DISCONNECTED: { label: "Wallet disconnected", tone: "neutral", icon: Circle },
  AWAITING_SIGNATURE: { label: "Awaiting signature", tone: "pending", icon: Clock3 },
  PENDING: { label: "Pending consensus", tone: "pending", icon: LoaderCircle },
  FINALIZED: { label: "Consensus finalized", tone: "info", icon: Check },
  SUCCESS: { label: "Execution succeeded", tone: "success", icon: Check },
  ERROR: { label: "Transaction error", tone: "danger", icon: X },
  READBACK: { label: "Readback confirmed", tone: "success", icon: Check },
}

export function StatusBadge({ status }: { status: BadgeStatus }) {
  const { label, tone, icon: Icon } = PRESENTATION[status]
  return (
    <span className={`status-badge status-${tone}`}>
      <Icon aria-hidden="true" className={status === "PENDING" ? "spin" : ""} size={13} />
      {label}
    </span>
  )
}
