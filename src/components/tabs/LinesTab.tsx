import type { Project } from '../../types'
import { projectStats } from '../../lib/project'

export function LinesTab({ project }: { project: Project }) {
  const stats = projectStats(project)
  return (
    <div className="space-y-3 p-4">
      <button
        type="button"
        disabled
        className="w-full rounded bg-slate-900 px-3 py-3 text-sm font-medium text-white disabled:opacity-40"
      >
        + New line
      </button>
      <p className="text-xs text-slate-500">
        {stats.lines} lines. Line types, connect mode and branch editing arrive
        in a later milestone.
      </p>
    </div>
  )
}
