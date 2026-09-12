import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useStore } from '../store/useStore'
import { nextNodeVisibility, typeKey, type NodeVisibility } from '../lib/visibility'
import type { NodeKind, Project, TypeId } from '../types'

interface Props {
  project: Project
  onClose: () => void
}

const VISIBILITY_TITLE: Record<NodeVisibility, string> = {
  all: 'Shown everywhere — click to show only the ones on a visible line',
  connected: 'Only the ones on a visible line — click to hide them',
  none: 'Hidden — click to show all of them',
}

/**
 * Three states: all, only the ones a visible line calls at (the dash), none.
 */
function VisibilityBox({
  value,
  onChange,
  label,
}: {
  value: NodeVisibility
  onChange: (value: NodeVisibility) => void
  label: string
}) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = value === 'connected'
  }, [value])

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={value !== 'none'}
      aria-label={label}
      title={VISIBILITY_TITLE[value]}
      onChange={() => onChange(nextNodeVisibility(value))}
    />
  )
}

/** Line types with their visibility, plus what the map draws for nodes. */
export function Legend({ project, onClose }: Props) {
  const railOverlay = useStore((s) => s.railOverlay)
  const setRailOverlay = useStore((s) => s.setRailOverlay)
  const visibility = useStore((s) => s.visibility)
  const setNodeVisibility = useStore((s) => s.setNodeVisibility)
  const toggleTypeVisibility = useStore((s) => s.toggleTypeVisibility)

  const types = useMemo(() => {
    const byType = new Map<
      string,
      { typeId: TypeId | null; label: string; colors: string[] }
    >()
    for (const line of Object.values(project.lines)) {
      const type = line.typeId ? project.lineTypes[line.typeId] : undefined
      const key = typeKey(type?.id ?? null)
      const entry = byType.get(key) ?? {
        typeId: type?.id ?? null,
        label: type?.name ?? 'Without type',
        colors: [],
      }
      entry.colors.push(line.color)
      byType.set(key, entry)
    }
    return [...byType.values()].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true }),
    )
  }, [project.lines, project.lineTypes])

  function nodeRow(kind: NodeKind, label: string, swatch: ReactNode) {
    return (
      <label className="flex items-center gap-2">
        <VisibilityBox
          value={visibility[kind]}
          onChange={(value) => setNodeVisibility(kind, value)}
          label={label}
        />
        {swatch}
        {label}
      </label>
    )
  }

  return (
    <div className="absolute bottom-4 right-4 z-[1000] max-h-[60%] w-60 overflow-y-auto rounded border border-slate-200 bg-white/95 p-3 text-xs shadow-lg">
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
        {nodeRow(
          'stop',
          'Stops',
          <span className="inline-block h-3 w-3 rounded-full border-2 border-slate-900 bg-white" />,
        )}
        {nodeRow(
          'waypoint',
          'Waypoints',
          <span className="inline-block h-2 w-2 rotate-45 border border-slate-500 bg-white" />,
        )}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={railOverlay}
            onChange={(event) => setRailOverlay(event.target.checked)}
          />
          Rail tracks (OpenRailwayMap)
        </label>
      </div>

      {types.length === 0 ? (
        <p className="text-slate-500">No lines yet.</p>
      ) : (
        <ul className="space-y-1">
          {types.map((type) => {
            const key = typeKey(type.typeId)
            return (
              <li key={key}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!visibility.hiddenTypes.includes(key)}
                    onChange={() => toggleTypeVisibility(type.typeId)}
                  />
                  <span className="flex shrink-0 gap-0.5">
                    {type.colors.slice(0, 3).map((color, index) => (
                      <span
                        key={`${key}-${index}`}
                        className="inline-block h-1.5 w-3 rounded"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </span>
                  <span className="truncate text-slate-800">{type.label}</span>
                  <span className="ml-auto shrink-0 text-slate-400">
                    {type.colors.length}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
