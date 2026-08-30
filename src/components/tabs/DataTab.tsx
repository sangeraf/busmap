import { useRef, useState } from 'react'
import { useStore, type ImportMode } from '../../store/useStore'
import {
  exportProjectGeoJson,
  exportProjectJson,
  parseProjectFile,
} from '../../lib/exchange'
import { folderSyncSupported } from '../../lib/folderSync'
import { projectStats } from '../../lib/project'
import type { Project } from '../../types'

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'busmap'
  )
}

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

const MODES: { id: ImportMode; label: string; hint: string }[] = [
  {
    id: 'new',
    label: 'As a new project',
    hint: 'Adds the file as a separate project and switches to it.',
  },
  {
    id: 'merge',
    label: 'Merge into this project',
    hint: 'Adds its stops and lines here; line types are merged by name.',
  },
  {
    id: 'replace',
    label: 'Replace this project',
    hint: 'Overwrites the current project with the file.',
  },
]

function FolderSync() {
  const folder = useStore((s) => s.folder)
  const connectFolder = useStore((s) => s.connectFolder)
  const disconnectFolder = useStore((s) => s.disconnectFolder)
  const syncToFolder = useStore((s) => s.syncToFolder)
  const loadFromFolder = useStore((s) => s.loadFromFolder)
  const [warnings, setWarnings] = useState<string[]>([])

  if (!folderSyncSupported()) {
    return (
      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Folder sync
        </h2>
        <p className="text-[11px] text-slate-500">
          This browser cannot open folders; use JSON export/import instead.
          Chrome and Edge support it.
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Folder sync
      </h2>
      {folder.connected ? (
        <>
          <p className="text-[11px] text-slate-600">
            Saving every project into{' '}
            <span className="font-medium text-slate-900">{folder.name}</span>
            {folder.lastSyncAt
              ? ` · last write ${new Date(folder.lastSyncAt).toLocaleTimeString()}`
              : ''}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              disabled={folder.busy}
              onClick={() => void syncToFolder()}
              className="rounded bg-slate-900 px-2 py-2 text-xs text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Sync now
            </button>
            <button
              type="button"
              disabled={folder.busy}
              title="Read every .busmap.json back from the folder"
              onClick={() => {
                void loadFromFolder().then(setWarnings)
              }}
              className="rounded border border-slate-300 px-2 py-2 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Load
            </button>
            <button
              type="button"
              onClick={() => void disconnectFolder()}
              className="rounded border border-slate-300 px-2 py-2 text-xs text-slate-700 hover:bg-slate-50"
            >
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => void connectFolder()}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Choose a folder…
          </button>
          <p className="text-[11px] text-slate-500">
            Every project is written there as its own .busmap.json file and kept
            up to date as you edit.
          </p>
        </>
      )}
      {folder.error && (
        <p className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
          {folder.error}
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="space-y-1 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
          {warnings.map((warning, index) => (
            <li key={`${warning}-${index}`}>{warning}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function DataTab({ project }: { project: Project }) {
  const importProject = useStore((s) => s.importProject)
  const fileInput = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<ImportMode>('new')
  const [errors, setErrors] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const stats = projectStats(project)

  async function load(file: File) {
    setErrors([])
    setNotice(null)
    const result = parseProjectFile(await file.text())
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    importProject(result.project, mode)
    const counts = projectStats(result.project)
    setNotice(
      `Imported "${result.project.name}" — ${counts.stops} stops, ${counts.waypoints} waypoints, ${counts.lines} lines.`,
    )
    setErrors(result.warnings)
  }

  return (
    <div className="space-y-4 overflow-y-auto p-4">
      <dl className="space-y-1 text-xs text-slate-600">
        <div className="flex justify-between">
          <dt>Project</dt>
          <dd className="font-medium text-slate-900">{project.name}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Contents</dt>
          <dd>
            {stats.stops} stops · {stats.waypoints} waypoints · {stats.lines}{' '}
            lines
          </dd>
        </div>
        <div className="flex justify-between">
          <dt>Last change</dt>
          <dd>{new Date(project.updatedAt).toLocaleString()}</dd>
        </div>
      </dl>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Export
        </h2>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() =>
              download(
                `${slug(project.name)}.busmap.json`,
                exportProjectJson(project),
                'application/json',
              )
            }
            className="rounded bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800"
          >
            JSON
          </button>
          <button
            type="button"
            title="Stops as points and every connection as a line, for QGIS/JOSM"
            onClick={() =>
              download(
                `${slug(project.name)}.geojson`,
                exportProjectGeoJson(project),
                'application/geo+json',
              )
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            GeoJSON
          </button>
        </div>
        <p className="text-[11px] text-slate-500">
          JSON keeps everything and can be imported back; GeoJSON is for other
          map tools.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Import JSON
        </h2>
        <div className="space-y-1">
          {MODES.map((option) => (
            <label
              key={option.id}
              className="flex items-start gap-2 text-xs text-slate-700"
              title={option.hint}
            >
              <input
                type="radio"
                name="import-mode"
                checked={mode === option.id}
                onChange={() => setMode(option.id)}
                className="mt-0.5"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>

        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            const file = event.dataTransfer.files[0]
            if (file) void load(file)
          }}
          className={`rounded border border-dashed p-4 text-center text-xs ${
            dragging
              ? 'border-blue-500 bg-blue-50 text-blue-700'
              : 'border-slate-300 text-slate-500'
          }`}
        >
          Drop a .json file here, or{' '}
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="text-blue-600 underline"
          >
            choose a file
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void load(file)
              event.target.value = ''
            }}
          />
        </div>

        {notice && (
          <p className="rounded bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700">
            {notice}
          </p>
        )}
        {errors.length > 0 && (
          <ul className="space-y-1 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
            {errors.map((error, index) => (
              <li key={`${error}-${index}`}>{error}</li>
            ))}
          </ul>
        )}
      </section>

      <FolderSync />
    </div>
  )
}
