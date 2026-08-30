import { useState } from 'react'
import { useStore } from '../store/useStore'
import type { MapNode } from '../types'

interface Props {
  node: MapNode
  lineCount: number
}

export function NodeRow({ node, lineCount }: Props) {
  const selected = useStore((s) => s.selectedNodeId === node.id)
  const setSelectedNode = useStore((s) => s.setSelectedNode)
  const setHoveredNode = useStore((s) => s.setHoveredNode)
  const updateNode = useStore((s) => s.updateNode)
  const deleteNode = useStore((s) => s.deleteNode)
  const [editing, setEditing] = useState(false)

  return (
    <div
      onMouseEnter={() => setHoveredNode(node.id)}
      onMouseLeave={() => setHoveredNode(null)}
      className={`border-b border-slate-100 px-4 py-2 ${
        selected ? 'bg-blue-50' : 'hover:bg-slate-50'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-3 w-3 shrink-0 rounded-full border border-white ring-1 ring-slate-300"
          style={{ backgroundColor: node.color }}
        />
        <button
          type="button"
          onClick={() => setSelectedNode(node.id)}
          className="min-w-0 flex-1 truncate text-left text-sm text-slate-800"
        >
          {node.name}
        </button>
        <span className="shrink-0 text-[11px] text-slate-400">
          {node.kind === 'waypoint' ? 'waypoint' : `${lineCount} lines`}
        </span>
        <button
          type="button"
          onClick={() => setEditing((value) => !value)}
          className="shrink-0 text-[11px] text-slate-500 hover:text-slate-900"
        >
          {editing ? 'Close' : 'Edit'}
        </button>
      </div>

      {editing && (
        <div className="mt-2 space-y-2">
          <input
            value={node.name}
            onChange={(event) => updateNode(node.id, { name: event.target.value })}
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <div className="flex items-center gap-2 text-xs">
            <input
              type="color"
              value={node.color}
              onChange={(event) =>
                updateNode(node.id, { color: event.target.value })
              }
              className="h-7 w-10 rounded border border-slate-300"
            />
            <select
              value={node.kind}
              onChange={(event) =>
                updateNode(node.id, {
                  kind: event.target.value as MapNode['kind'],
                })
              }
              className="rounded border border-slate-300 px-2 py-1"
            >
              <option value="stop">Stop</option>
              <option value="waypoint">Waypoint</option>
            </select>
            <span className="text-slate-400">
              {node.lat.toFixed(5)}, {node.lng.toFixed(5)}
            </span>
            <button
              type="button"
              onClick={() => {
                const warning =
                  lineCount > 0
                    ? `Delete "${node.name}"? It is used by ${lineCount} line(s); those connections will be removed.`
                    : `Delete "${node.name}"?`
                if (window.confirm(warning)) deleteNode(node.id)
              }}
              className="ml-auto text-red-600 hover:underline"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
