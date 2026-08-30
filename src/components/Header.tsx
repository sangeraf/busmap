import { useState } from 'react'
import { useStore } from '../store/useStore'
import type { Project } from '../types'

interface Props {
  project: Project
  onShowShortcuts: () => void
}

const SAVE_LABEL = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
} as const

export function Header({ project, onShowShortcuts }: Props) {
  const history = useStore((s) => s.history)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const workspace = useStore((s) => s.workspace)
  const saveState = useStore((s) => s.saveState)
  const switchProject = useStore((s) => s.switchProject)
  const createNewProject = useStore((s) => s.createNewProject)
  const renameProject = useStore((s) => s.renameProject)
  const duplicateActiveProject = useStore((s) => s.duplicateActiveProject)
  const deleteProject = useStore((s) => s.deleteProject)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(project.name)

  const projects = Object.values(workspace.projects).sort((a, b) =>
    a.name.localeCompare(b.name),
  )

  function commitRename() {
    const name = draftName.trim()
    if (name) renameProject(project.id, name)
    setRenaming(false)
  }

  return (
    <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
      <span className="text-sm font-semibold tracking-tight text-slate-900">
        busmap
      </span>

      {renaming ? (
        <input
          autoFocus
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitRename()
            if (event.key === 'Escape') setRenaming(false)
          }}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        />
      ) : (
        <select
          value={project.id}
          onChange={(event) => switchProject(event.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
        >
          {projects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      )}

      <div className="flex items-center gap-1 text-xs">
        <button
          type="button"
          title="Undo (Ctrl+Z)"
          disabled={history.past === 0}
          onClick={undo}
          className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent"
        >
          ↺ Undo
        </button>
        <button
          type="button"
          title="Redo (Ctrl+Shift+Z)"
          disabled={history.future === 0}
          onClick={redo}
          className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent"
        >
          ↻ Redo
        </button>
        <span className="mx-1 h-4 w-px bg-slate-200" />
        <button
          type="button"
          className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100"
          onClick={() => {
            setDraftName(project.name)
            setRenaming(true)
          }}
        >
          Rename
        </button>
        <button
          type="button"
          className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100"
          onClick={() => createNewProject('Untitled network')}
        >
          New
        </button>
        <button
          type="button"
          className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100"
          onClick={duplicateActiveProject}
        >
          Duplicate
        </button>
        <button
          type="button"
          className="rounded px-2 py-1 text-red-600 hover:bg-red-50"
          onClick={() => {
            if (
              window.confirm(
                `Delete project "${project.name}"?`,
              )
            ) {
              deleteProject(project.id)
            }
          }}
        >
          Delete
        </button>
      </div>

      <span className="ml-auto text-xs text-slate-400">
        {SAVE_LABEL[saveState]}
      </span>
      <button
        type="button"
        onClick={onShowShortcuts}
        title="Keyboard shortcuts (?)"
        className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
      >
        ⌨
      </button>
    </header>
  )
}
