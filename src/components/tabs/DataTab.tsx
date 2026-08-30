import type { Project } from '../../types'

export function DataTab({ project }: { project: Project }) {
  return (
    <div className="space-y-3 p-4">
      <dl className="space-y-1 text-xs text-slate-600">
        <div className="flex justify-between">
          <dt>Project</dt>
          <dd className="font-medium text-slate-900">{project.name}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Last change</dt>
          <dd>{new Date(project.updatedAt).toLocaleString()}</dd>
        </div>
      </dl>
      <p className="text-xs text-slate-500">
        JSON and GeoJSON export/import arrive in a later milestone.
      </p>
    </div>
  )
}
