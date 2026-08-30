import { useState } from 'react'
import { useStore } from '../store/useStore'
import { lineChains, lineStopIds } from '../lib/lines'
import { ColorPicker } from './ColorPicker'
import { LineTypeSelect } from './LineTypeSelect'
import { NodeInfo } from './NodeInfo'
import type { Line, Project, Segment } from '../types'

/** Tooltip of the straight/road toggle, with the routed length if known. */
function legTitle(segment: Segment): string {
  if (segment.mode !== 'road') return 'Straight line — switch to roads'
  if (segment.stale || segment.distanceM === undefined) {
    return 'Via roads — waiting for a route'
  }
  const km = (segment.distanceM / 1000).toFixed(1)
  const min = Math.round((segment.durationS ?? 0) / 60)
  return `Via roads — ${km} km, ${min} min — switch to a straight line`
}

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
  const deleteBranch = useStore((s) => s.deleteBranch)
  const startConnecting = useStore((s) => s.startConnecting)
  const stopConnecting = useStore((s) => s.stopConnecting)
  const removeStop = useStore((s) => s.removeStop)
  const moveStop = useStore((s) => s.moveStop)
  const setSegmentMode = useStore((s) => s.setSegmentMode)
  const setLineMode = useStore((s) => s.setLineMode)

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
              title="Route every connection of this line along roads"
              onClick={() => setLineMode(line.id, 'road')}
              className="text-slate-600 hover:underline"
            >
              All via roads
            </button>
            <button
              type="button"
              title="Turn every connection of this line into a straight line"
              onClick={() => setLineMode(line.id, 'straight')}
              className="text-slate-600 hover:underline"
            >
              All straight
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
              <ColorPicker
                value={line.color}
                onChange={(color) => updateLine(line.id, { color })}
              />
              <div className="flex items-center gap-2">
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
                      placeholder="Branch name"
                      className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-xs font-medium text-slate-700 hover:border-slate-300"
                    />
                  ) : (
                    <span className="min-w-0 flex-1 px-1 text-xs text-slate-400">
                      {chain.label} (detached part)
                    </span>
                  )}
                  {connecting ? (
                    <button
                      type="button"
                      onClick={() => stopConnecting()}
                      className="shrink-0 rounded bg-blue-600 px-2 py-1 text-[11px] text-white"
                    >
                      Click stops… (done)
                    </button>
                  ) : (
                    <button
                      type="button"
                      title={
                        chain.segments.length === 0
                          ? 'Click stops on the map to start this branch'
                          : 'Insert stops before the first one'
                      }
                      onClick={() =>
                        startConnecting(line.id, chain.groupId, {
                          bridgeId: chain.segments[0]?.id ?? null,
                        })
                      }
                      className="shrink-0 rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700"
                    >
                      {chain.segments.length === 0 ? 'Add stops' : '+ at start'}
                    </button>
                  )}
                  {first === chainIndex && (
                    <button
                      type="button"
                      title="Delete this branch and all its connections"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete branch "${chain.label}" and all its connections?`,
                          )
                        )
                          deleteBranch(line.id, chain.groupId)
                      }}
                      className="shrink-0 text-[11px] text-red-500 hover:text-red-700"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {chain.nodeIds.length === 0 ? (
                  <p className="mt-1 px-1 text-[11px] text-slate-400">
                    No connections yet.
                  </p>
                ) : (
                  <ol className="mt-1 space-y-0.5">
                    {chain.nodeIds.map((nodeId, index) => {
                      const node = project.nodes[nodeId]
                      const incoming = chain.segments[index - 1]
                      const outgoing = chain.segments[index]
                      const anchored =
                        connecting && connect
                          ? connect.anchorId
                            ? connect.anchorId === nodeId &&
                              (connect.bridgeId === null ||
                                outgoing?.id === connect.bridgeId)
                            : !incoming &&
                              chain.segments[0]?.id === connect.bridgeId
                          : false
                      return (
                        <li
                          key={`${nodeId}-${index}`}
                          className={`flex items-center gap-2 rounded text-xs ${
                            anchored ? 'bg-blue-100 text-blue-900' : ''
                          }`}
                          title={
                            anchored
                              ? connect?.anchorId
                                ? 'The next clicked stop goes after this one'
                                : 'The next clicked stop goes before this one'
                              : undefined
                          }
                        >
                          <span
                            className={`w-4 shrink-0 text-right ${
                              anchored ? 'text-blue-600' : 'text-slate-400'
                            }`}
                          >
                            {anchored ? '▸' : index + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => setSelectedNode(nodeId)}
                            className={`min-w-0 flex-1 truncate text-left hover:underline ${
                              anchored
                                ? 'font-medium text-blue-900'
                                : 'text-slate-700'
                            }`}
                          >
                            {node?.name ?? 'Missing stop'}
                            <NodeInfo info={node?.info} />
                          </button>
                          <span className="flex shrink-0 items-center gap-1 text-slate-400">
                            {incoming ? (
                              <button
                                type="button"
                                title={legTitle(incoming)}
                                onClick={() =>
                                  setSegmentMode(
                                    line.id,
                                    incoming.id,
                                    incoming.mode === 'road'
                                      ? 'straight'
                                      : 'road',
                                  )
                                }
                                className={`w-3 ${
                                  incoming.mode === 'road'
                                    ? incoming.stale ||
                                      incoming.distanceM === undefined
                                      ? 'text-amber-500'
                                      : 'text-emerald-600'
                                    : 'hover:text-slate-900'
                                }`}
                              >
                                {incoming.mode === 'road' ? '↝' : '╱'}
                              </button>
                            ) : (
                              <span className="w-3" />
                            )}
                            {index > 0 ? (
                              <button
                                type="button"
                                title="Move earlier"
                                onClick={() =>
                                  moveStop(line.id, chainIndex, index, -1)
                                }
                                className="w-3 hover:text-slate-900"
                              >
                                ↑
                              </button>
                            ) : (
                              <span className="w-3" />
                            )}
                            {index < chain.nodeIds.length - 1 ? (
                              <button
                                type="button"
                                title="Move later"
                                onClick={() =>
                                  moveStop(line.id, chainIndex, index, 1)
                                }
                                className="w-3 hover:text-slate-900"
                              >
                                ↓
                              </button>
                            ) : (
                              <span className="w-3" />
                            )}
                            <button
                              type="button"
                              title={
                                outgoing
                                  ? 'Insert stops after this one'
                                  : 'Continue the branch from this stop'
                              }
                              onClick={() =>
                                startConnecting(line.id, chain.groupId, {
                                  anchorId: nodeId,
                                  bridgeId: outgoing?.id ?? null,
                                })
                              }
                              className="hover:text-blue-600"
                            >
                              +
                            </button>
                            <button
                              type="button"
                              title={
                                incoming && outgoing
                                  ? 'Remove stop and connect its neighbours'
                                  : 'Remove stop from this branch'
                              }
                              onClick={() =>
                                removeStop(
                                  line.id,
                                  incoming?.id ?? null,
                                  outgoing?.id ?? null,
                                )
                              }
                              className="hover:text-red-600"
                            >
                              ✕
                            </button>
                          </span>
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
