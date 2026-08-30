import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import type { MapNode } from '../types'

/**
 * Opens right after a node is placed: the name is focused and preselected, the
 * colour is the last one used, and Enter stores both. Placement stays armed, so
 * the next map click can follow immediately.
 */
export function QuickNodeEditor({ node }: { node: MapNode }) {
  const updateNode = useStore((s) => s.updateNode)
  const deleteNode = useStore((s) => s.deleteNode)
  const setNamingNode = useStore((s) => s.setNamingNode)
  const [name, setName] = useState(node.name)
  const [color, setColor] = useState(node.color)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  function persist() {
    const trimmed = name.trim()
    updateNode(node.id, { name: trimmed || node.name, color })
  }

  function save() {
    persist()
    setNamingNode(null)
  }

  // Clicking the map again swaps the editor to the new node; keep what was
  // typed for the old one instead of dropping it.
  const pending = useRef(persist)
  useEffect(() => {
    pending.current = persist
  })
  useEffect(() => () => pending.current(), [])

  return (
    <div className="absolute left-1/2 top-4 z-[1200] w-72 -translate-x-1/2 rounded-lg border border-slate-300 bg-white p-3 shadow-lg">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-slate-500">
          <span>New {node.kind}</span>
          <span className="normal-case tracking-normal text-slate-400">
            {node.lat.toFixed(5)}, {node.lng.toFixed(5)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
            aria-label="Name"
          />
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            className="h-8 w-10 shrink-0 rounded border border-slate-300"
            aria-label="Colour"
          />
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs">
          <button
            type="submit"
            className="rounded bg-slate-900 px-2 py-1 text-white hover:bg-slate-800"
          >
            Save (Enter)
          </button>
          <button
            type="button"
            onClick={() => {
              deleteNode(node.id)
              setNamingNode(null)
            }}
            className="text-red-600 hover:underline"
          >
            Discard
          </button>
          <span className="ml-auto text-slate-400">Esc closes</span>
        </div>
      </form>
    </div>
  )
}
