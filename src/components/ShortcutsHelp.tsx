import { SHORTCUTS } from '../hooks/useShortcuts'

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="absolute inset-0 z-[1100] grid place-items-center bg-slate-900/30"
      onClick={onClose}
    >
      <div
        className="w-72 rounded border border-slate-200 bg-white p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-900">
            Keyboard shortcuts
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>
        <dl className="space-y-1 text-xs">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.keys} className="flex justify-between gap-3">
              <dt className="font-mono text-slate-500">{shortcut.keys}</dt>
              <dd className="text-right text-slate-800">
                {shortcut.description}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
