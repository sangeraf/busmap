import type { Project } from '../../types'
import { projectStats } from '../../lib/project'

export function StopsTab({ project }: { project: Project }) {
  const stats = projectStats(project)
  return (
    <div className="space-y-3 p-4">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled
          className="rounded bg-slate-900 px-3 py-3 text-sm font-medium text-white disabled:opacity-40"
        >
          + Stop
        </button>
        <button
          type="button"
          disabled
          className="rounded border border-slate-300 px-3 py-3 text-sm font-medium text-slate-700 disabled:opacity-40"
        >
          + Waypoint
        </button>
      </div>
      <p className="text-xs text-slate-500">
        {stats.stops} stops, {stats.waypoints} waypoints. Placement, search and
        editing arrive in the next milestone.
      </p>
    </div>
  )
}
