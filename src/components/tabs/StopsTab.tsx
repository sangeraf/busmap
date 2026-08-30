import { useMemo, useState } from 'react'
import { VList } from 'virtua'
import { useStore } from '../../store/useStore'
import {
  DEFAULT_NODE_FILTERS,
  buildNodeLineIndex,
  createNodeFuse,
  filterNodes,
  type NodeFilters,
} from '../../lib/nodes'
import type { MapNode, Project } from '../../types'
import { NodeRow } from '../NodeRow'

export function StopsTab({ project }: { project: Project }) {
  const placementKind = useStore((s) => s.placementKind)
  const setPlacementKind = useStore((s) => s.setPlacementKind)
  const [filters, setFilters] = useState<NodeFilters>(DEFAULT_NODE_FILTERS)

  const nodes = useMemo<MapNode[]>(
    () => Object.values(project.nodes),
    [project.nodes],
  )
  const lineIndex = useMemo(() => buildNodeLineIndex(project), [project])
  const fuse = useMemo(() => createNodeFuse(nodes), [nodes])
  const visible = useMemo(
    () => filterNodes(nodes, filters, lineIndex, fuse),
    [nodes, filters, lineIndex, fuse],
  )

  function patch(update: Partial<NodeFilters>) {
    setFilters((current) => ({ ...current, ...update }))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b border-slate-200 p-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() =>
              setPlacementKind(placementKind === 'stop' ? null : 'stop')
            }
            className={`rounded px-3 py-3 text-sm font-medium ${
              placementKind === 'stop'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-900 text-white hover:bg-slate-800'
            }`}
          >
            {placementKind === 'stop' ? 'Click the map…' : '+ Stop'}
          </button>
          <button
            type="button"
            onClick={() =>
              setPlacementKind(placementKind === 'waypoint' ? null : 'waypoint')
            }
            className={`rounded border px-3 py-3 text-sm font-medium ${
              placementKind === 'waypoint'
                ? 'border-blue-600 bg-blue-50 text-blue-700'
                : 'border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {placementKind === 'waypoint' ? 'Click the map…' : '+ Waypoint'}
          </button>
        </div>

        <input
          type="search"
          value={filters.query}
          onChange={(event) => patch({ query: event.target.value })}
          placeholder="Search stops…"
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
        />

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={filters.kind}
            onChange={(event) =>
              patch({ kind: event.target.value as NodeFilters['kind'] })
            }
            className="rounded border border-slate-300 px-2 py-1"
          >
            <option value="all">All</option>
            <option value="stop">Stops</option>
            <option value="waypoint">Waypoints</option>
          </select>
          <select
            value={filters.sort}
            onChange={(event) =>
              patch({ sort: event.target.value as NodeFilters['sort'] })
            }
            className="rounded border border-slate-300 px-2 py-1"
            disabled={filters.query.trim().length > 0}
          >
            <option value="name">Name</option>
            <option value="created">Newest</option>
            <option value="lines">Most lines</option>
          </select>
          <label className="flex items-center gap-1 text-slate-600">
            <input
              type="checkbox"
              checked={filters.onlyUnconnected}
              onChange={(event) =>
                patch({ onlyUnconnected: event.target.checked })
              }
            />
            Unconnected only
          </label>
          <span className="ml-auto text-slate-400">
            {visible.length} / {nodes.length}
          </span>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="p-4 text-xs text-slate-500">
          {nodes.length === 0
            ? 'No stops yet. Hit “+ Stop” and click the map.'
            : 'Nothing matches these filters.'}
        </p>
      ) : (
        <VList className="min-h-0 flex-1">
          {visible.map((node) => (
            <NodeRow
              key={node.id}
              node={node}
              lineCount={lineIndex.get(node.id)?.length ?? 0}
            />
          ))}
        </VList>
      )}
    </div>
  )
}
