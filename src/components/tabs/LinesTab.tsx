import { useEffect, useMemo, useRef, useState } from 'react'
import { VList, type VListHandle } from 'virtua'
import { useStore } from '../../store/useStore'
import {
  DEFAULT_LINE_FILTERS,
  LINE_COLOR,
  createLineFuse,
  filterLines,
  isRouted,
  type LineFilters,
} from '../../lib/lines'
import { ColorPicker } from '../ColorPicker'
import { LineRow } from '../LineRow'
import { LineTypeSelect } from '../LineTypeSelect'
import type { Line, LineId, Project, TypeId } from '../../types'

interface Draft {
  name: string
  description: string
  color: string
  typeId: TypeId | null
}

const EMPTY_DRAFT: Draft = {
  name: '',
  description: '',
  color: LINE_COLOR,
  typeId: null,
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * What the background router is doing: progress, the current step and how
 * long it has been running while it works, and the connections it could not
 * route (drawn straight and dashed on the map) once it is done.
 */
function RoutingStatus({ lines }: { lines: Line[] }) {
  const routing = useStore((s) => s.routing)
  const routeStaleSegments = useStore((s) => s.routeStaleSegments)
  const cancelRouting = useStore((s) => s.cancelRouting)
  const [now, setNow] = useState(() => Date.now())
  const running = routing.pending > 0

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])

  const { waiting, failed, reason } = useMemo(() => {
    let waiting = 0
    let failed = 0
    let reason: string | null = null
    for (const line of lines) {
      for (const segment of line.segments) {
        if (!isRouted(segment.mode)) continue
        if (segment.routeError) {
          failed += 1
          reason ??= segment.routeError
        } else if (segment.stale || segment.distanceM === undefined) {
          waiting += 1
        }
      }
    }
    return { waiting, failed, reason }
  }, [lines])

  if (running) {
    const percent =
      routing.total > 0 ? Math.round((routing.done / routing.total) * 100) : 0
    return (
      <div
        role="status"
        className="space-y-1 rounded bg-blue-50 px-2 py-1.5 text-xs text-blue-900"
      >
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 font-medium">
            Routing {routing.done} of {routing.total} connection(s)…
          </span>
          {routing.startedAt !== null && (
            <span className="shrink-0 tabular-nums text-blue-700">
              {formatElapsed(now - routing.startedAt)}
            </span>
          )}
          <button
            type="button"
            onClick={cancelRouting}
            className="shrink-0 rounded border border-blue-300 px-2 py-0.5"
          >
            Cancel
          </button>
        </div>
        <div className="h-1 overflow-hidden rounded bg-blue-100">
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: `${Math.max(percent, 3)}%` }}
          />
        </div>
        {routing.status && (
          <div className="truncate text-blue-700" title={routing.status}>
            {routing.status}
          </div>
        )}
      </div>
    )
  }

  if (failed === 0 && waiting === 0) return null
  return (
    <div className="flex items-center gap-2 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
      <span className="min-w-0 flex-1">
        {failed > 0 && (
          <span className="block" title={reason ?? undefined}>
            {failed} connection(s) could not be routed and are drawn as dashed
            straight lines{reason ? `: ${reason}` : '.'}
          </span>
        )}
        {waiting > 0 && (
          <span className="block">
            {routing.error === 'Routing was cancelled'
              ? `Routing was cancelled; ${waiting} connection(s) still need a route.`
              : `${waiting} connection(s) need a route.`}
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={() => void routeStaleSegments({ retryFailed: true })}
        className="shrink-0 rounded border border-amber-300 px-2 py-0.5"
      >
        {failed > 0 ? 'Retry' : 'Route now'}
      </button>
    </div>
  )
}

export function LinesTab({ project }: { project: Project }) {
  const addLine = useStore((s) => s.addLine)
  const connect = useStore((s) => s.connect)
  const stopConnecting = useStore((s) => s.stopConnecting)
  const defaultSegmentMode = useStore((s) => s.defaultSegmentMode)
  const setDefaultSegmentMode = useStore((s) => s.setDefaultSegmentMode)
  const expandedLineId = useStore((s) => s.expandedLineId)
  const [filters, setFilters] = useState<LineFilters>(DEFAULT_LINE_FILTERS)
  const [draft, setDraft] = useState<Draft | null>(null)
  const listRef = useRef<VListHandle>(null)
  const revealed = useRef<LineId | null>(null)

  const lines = useMemo<Line[]>(
    () => Object.values(project.lines),
    [project.lines],
  )
  const fuse = useMemo(() => createLineFuse(lines), [lines])
  const visible = useMemo(() => {
    const matching = filterLines(lines, filters, fuse)
    const opened = expandedLineId ? project.lines[expandedLineId] : undefined
    // A line opened from the map is listed even when the filters hide it.
    return opened && !matching.some((line) => line.id === opened.id)
      ? [opened, ...matching]
      : matching
  }, [lines, filters, fuse, expandedLineId, project.lines])
  const types = Object.values(project.lineTypes)
  // The list is virtualised, so the opened row has to be scrolled to.
  useEffect(() => {
    if (!expandedLineId) {
      revealed.current = null
      return
    }
    if (revealed.current === expandedLineId) return
    const index = visible.findIndex((line) => line.id === expandedLineId)
    if (index < 0) return
    revealed.current = expandedLineId
    listRef.current?.scrollToIndex(index, { align: 'center' })
  }, [expandedLineId, visible])

  function patch(update: Partial<LineFilters>) {
    setFilters((current) => ({ ...current, ...update }))
  }

  function submitDraft() {
    if (!draft || !draft.name.trim()) return
    addLine({ ...draft, name: draft.name.trim() })
    setDraft(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b border-slate-200 p-4">
        <button
          type="button"
          onClick={() => setDraft(draft ? null : EMPTY_DRAFT)}
          className="w-full rounded bg-slate-900 px-3 py-3 text-sm font-medium text-white hover:bg-slate-800"
        >
          {draft ? 'Cancel' : '+ New line'}
        </button>

        {draft && (
          <div className="space-y-2 rounded border border-slate-200 p-2">
            <input
              autoFocus
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitDraft()
              }}
              placeholder="Number / name"
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
            <textarea
              value={draft.description}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
              placeholder="Description"
              rows={2}
              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
            />
            <ColorPicker
              value={draft.color}
              onChange={(color) => setDraft({ ...draft, color })}
            />
            <div className="flex items-center gap-2">
              <LineTypeSelect
                project={project}
                value={draft.typeId}
                onChange={(typeId) => setDraft({ ...draft, typeId })}
              />
              <button
                type="button"
                onClick={submitDraft}
                disabled={!draft.name.trim()}
                className="ml-auto rounded bg-blue-600 px-3 py-1 text-xs text-white disabled:opacity-40"
              >
                Create
              </button>
            </div>
          </div>
        )}

        {connect && (
          <div className="flex items-center gap-2 rounded bg-blue-50 px-2 py-1.5 text-xs text-blue-800">
            <span className="min-w-0 flex-1">
              {connect.bridgeId
                ? 'Click the stops to insert, in order.'
                : connect.anchorId
                  ? 'Click the next stop to connect.'
                  : 'Click the first stop of the chain.'}{' '}
              Empty map adds a waypoint.
            </span>
            <button
              type="button"
              onClick={stopConnecting}
              className="shrink-0 rounded border border-blue-300 px-2 py-0.5"
            >
              Done
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-slate-600">
          <span className="shrink-0">New connections:</span>
          {(['straight', 'road', 'rail'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setDefaultSegmentMode(mode)}
              className={`rounded px-2 py-1 ${
                defaultSegmentMode === mode
                  ? 'bg-slate-800 text-white'
                  : 'border border-slate-300'
              }`}
            >
              {mode === 'straight'
                ? 'Straight'
                : mode === 'road'
                  ? 'Via roads'
                  : 'Via rails'}
            </button>
          ))}
        </div>

        <RoutingStatus lines={lines} />

        <input
          type="search"
          value={filters.query}
          onChange={(event) => patch({ query: event.target.value })}
          placeholder="Search lines…"
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
        />

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={filters.typeId}
            onChange={(event) => patch({ typeId: event.target.value })}
            className="rounded border border-slate-300 px-2 py-1"
          >
            <option value="all">All types</option>
            <option value="none">No type</option>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
          <select
            value={filters.sort}
            onChange={(event) =>
              patch({ sort: event.target.value as LineFilters['sort'] })
            }
            disabled={filters.query.trim().length > 0}
            className="rounded border border-slate-300 px-2 py-1"
          >
            <option value="name">Name</option>
            <option value="created">Newest</option>
            <option value="stops">Most stops</option>
          </select>
          <span className="ml-auto text-slate-400">
            {visible.length} / {lines.length}
          </span>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="p-4 text-xs text-slate-500">
          {lines.length === 0
            ? 'No lines yet. Create one, then use “Connect stops”.'
            : 'Nothing matches these filters.'}
        </p>
      ) : (
        <VList ref={listRef} className="min-h-0 flex-1">
          {visible.map((line) => (
            <LineRow key={line.id} line={line} project={project} />
          ))}
        </VList>
      )}
    </div>
  )
}
