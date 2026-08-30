import { useMemo } from 'react'
import type { Project } from '../types'

interface Props {
  project: Project
  onClose: () => void
}

/** Lines grouped by their project type, so the map reads on its own. */
export function Legend({ project, onClose }: Props) {
  const groups = useMemo(() => {
    const byType = new Map<string, { name: string; color: string }[]>()
    for (const line of Object.values(project.lines)) {
      const type = line.typeId ? project.lineTypes[line.typeId] : undefined
      const key = type?.name ?? 'Without type'
      const entries = byType.get(key) ?? []
      entries.push({ name: line.name, color: line.color })
      byType.set(key, entries)
    }
    return [...byType.entries()].map(([label, lines]) => ({
      label,
      lines: lines.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    }))
  }, [project.lines, project.lineTypes])

  return (
    <div className="absolute bottom-4 right-4 z-[1000] max-h-[60%] w-56 overflow-y-auto rounded border border-slate-200 bg-white/95 p-3 text-xs shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-slate-900">Legend</span>
        <button
          type="button"
          onClick={onClose}
          title="Hide the legend (L)"
          className="text-slate-400 hover:text-slate-700"
        >
          ✕
        </button>
      </div>

      <div className="mb-2 space-y-1 border-b border-slate-100 pb-2 text-slate-600">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full border-2 border-slate-900 bg-white" />
          Stop
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rotate-45 border border-slate-500 bg-white" />
          Waypoint
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="text-slate-500">No lines yet.</p>
      ) : (
        groups.map((group) => (
          <div key={group.label} className="mb-2 last:mb-0">
            <p className="mb-1 font-medium text-slate-500">{group.label}</p>
            <ul className="space-y-1">
              {group.lines.map((line) => (
                <li key={line.name} className="flex items-center gap-2">
                  <span
                    className="inline-block h-1 w-5 rounded"
                    style={{ backgroundColor: line.color }}
                  />
                  <span className="truncate text-slate-800">{line.name}</span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  )
}
