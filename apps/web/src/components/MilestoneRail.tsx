import type { MilestoneView } from "@milestoneproof/shared"

import { StatusBadge } from "./StatusBadge"

export function MilestoneRail({ milestones }: { milestones: MilestoneView[] }) {
  return (
    <ol aria-label="Project milestones" className="milestone-rail">
      {milestones.map((milestone) => (
        <li className={`milestone-node milestone-node-${milestone.status.toLowerCase()}`} key={milestone.index}>
          <span aria-hidden="true" className="milestone-diamond" />
          <div>
            <span className="milestone-number">Milestone {milestone.index + 1}</span>
            <strong>{milestone.title}</strong>
          </div>
          <StatusBadge status={milestone.status} />
        </li>
      ))}
    </ol>
  )
}
