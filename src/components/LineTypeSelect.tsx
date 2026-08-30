import { useState } from 'react'
import { useStore } from '../store/useStore'
import type { Project, TypeId } from '../types'

interface Props {
  project: Project
  value: TypeId | null
  onChange: (typeId: TypeId | null) => void
}

/**
 * Type dropdown that starts empty: options are only the types this project
 * actually uses, and new ones are typed in by the user (no English defaults).
 */
export function LineTypeSelect({ project, value, onChange }: Props) {
  const addLineType = useStore((s) => s.addLineType)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const types = Object.values(project.lineTypes)

  function commitDraft() {
    const id = addLineType(draft)
    if (id) onChange(id)
    setDraft('')
    setAdding(false)
  }

  if (adding) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitDraft()
            if (event.key === 'Escape') setAdding(false)
          }}
          placeholder="New type…"
          className="w-28 rounded border border-slate-300 px-2 py-1 text-xs"
        />
        <button
          type="button"
          onClick={commitDraft}
          className="rounded bg-slate-900 px-2 py-1 text-xs text-white"
        >
          Add
        </button>
      </div>
    )
  }

  return (
    <select
      value={value ?? ''}
      onChange={(event) => {
        if (event.target.value === '__new') setAdding(true)
        else onChange(event.target.value || null)
      }}
      className="rounded border border-slate-300 px-2 py-1 text-xs"
    >
      <option value="">No type</option>
      {types.map((type) => (
        <option key={type.id} value={type.id}>
          {type.name}
        </option>
      ))}
      <option value="__new">+ New type…</option>
    </select>
  )
}
