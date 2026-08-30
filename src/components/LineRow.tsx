import { useState } from 'react'
import { useStore } from '../store/useStore'
import { lineChains, lineStopIds } from '../lib/lines'
import { LineTypeSelect } from './LineTypeSelect'
import type { Line, Project } from '../types'

interface Props {
  line: Line
  project: Project
}

export function LineRow({ line, project }: Props) {
  const selected = useStore((s) => s.selectedLineId === line.id)
  const connect = useStore((s) => s.connect)
  const setSelectedLine = useStore((s) => s.setSelectedLine)
  const setSelectedNode = useStore((s) => s.setSelectedNode)
  const updateLine = useStore((s) => s.updateLine)
  const deleteLine = useStore((s) => s.deleteLine)
  const addBranch = useStore((s) => s.addBranch)
  const renameBranch = useStore((s) => s.renameBranch)
  const startConnecting = useStore((s) => s.startConnecting)
  const stopConnecting = useStore((s) => s.stopConnecting)
  const removeSegment = useStore((s) => s.removeSegment)
  const moveSegment = useStore((s) => s.moveSegment)

  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)

  const type = line.typeId ? project.lineTypes[line.typeId] : undefined
  const chains = lineChains(line)
  const stopCount = lineStopIds(line).length

  return (
    <div
      className={`border-b border-slate-100 px-4 py-2 ${
        selected ? 'bg-blue-50' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-3 w-3 shrink-0 rounded-sm"
          style={{ backgroundColor: line.color }}
        />
        <button
          type="button"
          onClick={() => {
            setSelectedLine(line.id)
            setExpanded((value) => !value)
          }}
          className="min-w-0 flex-1 truncate text-left text-sm text-slate-800"
        >
          <span className="font-medium">{line.name}</span>
          {type && (
            <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
              {type.name}
            </span>
          )}
        </button>
        <span className="shrink-0 text-[11px] text-slate-400">
          {stopCount} stops
        </span>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="shrink-0 text-[11px] text-slate-500 hover:text-slate-900"
        >
          {expanded ? '▲' : '▼'}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 space-y-3">
          {line.description && !editing && (
            <p className="text-xs text-slate-500">{line.description}</p>
          )}

          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => setEditing((value) => !value)}
              className="text-slate-600 hover:underline"
            >
              {editing ? 'Done' : 'Edit'}
            </button>
            <button
              type="button"
              onClick={() => addBranch(line.id)}
              className="text-slate-600 hover:underline"
            >
              + Branch
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Delete line "${line.name}"?`))
                  deleteLine(line.id)
              }}
              className="ml-auto text-red-600 hover:underline"
            >
              Delete line
            </button>
          </div>

          {editing && (
            <div className="space-y-2 rounded border border-slate-200 p-2">
              <input
                value={line.name}
                onChange={(event) =>
                  updateLine(line.id, { name: event.target.value })
                }
                placeholder="Number / name"
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
              <textarea
                value={line.description}
                onChange={(event) =>
                  updateLine(line.id, { description: event.target.value })
                }
                placeholder="Description"
                rows={2}
                className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
              />
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={line.color}
                  onChange={(event) =>
                    updateLine(line.id, { color: event.target.value })
                  }
                  className="h-7 w-10 rounded border border-slate-300"
                />
                <LineTypeSelect
                  project={project}
                  value={line.typeId}
                  onChange={(typeId) => updateLine(line.id, { typeId })}
                />
              </div>
            </div>
          )}

          {chains.map((chain, chainIndex) => {
            const connecting =
              connect?.lineId === line.id && connect.groupId === chain.groupId
            const first = chains.findIndex(
              (item) => item.groupId === chain.groupId,
            )
            return (
              <div
                key={`${chain.groupId}-${chainIndex}`}
                className="rounded border border-slate-200 p-2"
              >
                <div className="flex items-center gap-2">
                  {first === chainIndex ? (
                    <input
                      value={chain.label}
                      onChange={(event) =>
                        renameBranch(line.id, chain.groupId, event.target.value)
                      }
                      className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-xs font-medium text-slate-700 hover:border-slate-300"
                    />
                  ) : (
                    <span className="min-w-0 flex-1 px-1 text-xs text-slate-400">
                      {chain.label} (detached part)
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      connecting
                        ? stopConnecting()
                        : startConnecting(line.id, chain.groupId)
                    }
                    className={`shrink-0 rounded px-2 py-1 text-[11px] ${
                      connecting
                        ? 'bg-blue-600 text-white'
                        : 'border border-slate-300 text-slate-700'
                    }`}
                  >
                    {connecting ? 'Click stops…' : 'Connect stops'}
                  </button>
                </div>

                {chain.nodeIds.length === 0 ? (
                  <p className="mt-1 px-1 text-[11px] text-slate-400">
                    No connections yet.
                  </p>
                ) : (
                  <ol className="mt-1 space-y-0.5">
                    {chain.nodeIds.map((nodeId, index) => {
                      const node = project.nodes[nodeId]
                      const segment = chain.segments[index - 1]
                      return (
                        <li
                          key={`${nodeId}-${index}`}
                          className="flex items-center gap-2 text-xs"
                        >
                          <span className="w-4 shrink-0 text-right text-slate-400">
                            {index + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => setSelectedNode(nodeId)}
                            className="min-w-0 flex-1 truncate text-left text-slate-700 hover:underline"
                          >
                            {node?.name ?? 'Missing stop'}
                          </button>
                          {segment && (
                            <span className="flex shrink-0 items-center gap-1 text-slate-400">
                              {segment.stale && (
                                <span
                                  title="Road geometry is out of date"
                                  className="text-amber-500"
                                >
                                  ●
                                </span>
                              )}
                              <button
                                type="button"
                                title="Move earlier"
                                onClick={() =>
                                  moveSegment(line.id, segment.id, -1)
                                }
                                className="hover:text-slate-900"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                title="Move later"
                                onClick={() =>
                                  moveSegment(line.id, segment.id, 1)
                                }
                                className="hover:text-slate-900"
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                title="Remove connection"
                                onClick={() =>
                                  removeSegment(line.id, segment.id)
                                }
                                className="hover:text-red-600"
                              >
                                ✕
                              </button>
                            </span>
                          )}
                        </li>
                      )
                    })}
                  </ol>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
