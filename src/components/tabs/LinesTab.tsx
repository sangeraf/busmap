import { useMemo, useState } from 'react'
import { VList } from 'virtua'
import { useStore } from '../../store/useStore'
import {
  DEFAULT_LINE_FILTERS,
  LINE_COLOR,
  createLineFuse,
  filterLines,
  type LineFilters,
} from '../../lib/lines'
import { LineRow } from '../LineRow'
import { LineTypeSelect } from '../LineTypeSelect'
import type { Line, Project, TypeId } from '../../types'

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

export function LinesTab({ project }: { project: Project }) {
  const addLine = useStore((s) => s.addLine)
  const connect = useStore((s) => s.connect)
  const stopConnecting = useStore((s) => s.stopConnecting)
  const defaultSegmentMode = useStore((s) => s.defaultSegmentMode)
  const setDefaultSegmentMode = useStore((s) => s.setDefaultSegmentMode)
  const routing = useStore((s) => s.routing)
  const routeStaleSegments = useStore((s) => s.routeStaleSegments)
  const [filters, setFilters] = useState<LineFilters>(DEFAULT_LINE_FILTERS)
  const [draft, setDraft] = useState<Draft | null>(null)

  const lines = useMemo<Line[]>(
    () => Object.values(project.lines),
    [project.lines],
  )
  const fuse = useMemo(() => createLineFuse(lines), [lines])
  const visible = useMemo(
    () => filterLines(lines, filters, fuse),
    [lines, filters, fuse],
  )
  const types = Object.values(project.lineTypes)
  const staleCount = useMemo(
    () =>
      lines.reduce(
        (total, line) =>
          total +
          line.segments.filter(
            (segment) =>
              segment.mode === 'road' &&
              (segment.stale || segment.distanceM === undefined),
          ).length,
        0,
      ),
    [lines],
  )

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
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={draft.color}
                onChange={(event) =>
                  setDraft({ ...draft, color: event.target.value })
                }
                className="h-7 w-10 rounded border border-slate-300"
              />
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
                  : 'Click the first stop of the chain.'}
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
          {(['straight', 'road'] as const).map((mode) => (
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
              {mode === 'straight' ? 'Straight' : 'Via roads'}
            </button>
          ))}
          {routing.pending > 0 && (
            <span className="ml-auto shrink-0 text-blue-600">
              Routing {routing.pending}…
            </span>
          )}
        </div>

        {staleCount > 0 && routing.pending === 0 && (
          <div className="flex items-center gap-2 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
            <span className="min-w-0 flex-1">
              {routing.error ??
                `${staleCount} road connection(s) need a route.`}
            </span>
            <button
              type="button"
              onClick={() => void routeStaleSegments()}
              className="shrink-0 rounded border border-amber-300 px-2 py-0.5"
            >
              Route now
            </button>
          </div>
        )}

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
        <VList className="min-h-0 flex-1">
          {visible.map((line) => (
            <LineRow key={line.id} line={line} project={project} />
          ))}
        </VList>
      )}
    </div>
  )
}
