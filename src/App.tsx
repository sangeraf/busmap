import { useCallback, useEffect, useState } from 'react'
import { Header } from './components/Header'
import { Legend } from './components/Legend'
import { MapView } from './components/MapView'
import { ShortcutsHelp } from './components/ShortcutsHelp'
import { Sidebar } from './components/Sidebar'
import { useShortcuts } from './hooks/useShortcuts'
import { useActiveProject, useStore } from './store/useStore'

export default function App() {
  const hydrate = useStore((s) => s.hydrate)
  const hydrated = useStore((s) => s.hydrated)
  const project = useActiveProject()
  const setMapView = useStore((s) => s.setMapView)

  const [legendOpen, setLegendOpen] = useState(true)
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useShortcuts({
    toggleLegend: useCallback(() => setLegendOpen((open) => !open), []),
    toggleHelp: useCallback(() => setHelpOpen((open) => !open), []),
  })

  if (!hydrated || !project) {
    return (
      <div className="grid h-screen place-items-center text-sm text-slate-500">
        Loading workspace…
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <Header project={project} onShowShortcuts={() => setHelpOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <Sidebar project={project} />
        <main className="relative min-w-0 flex-1">
          <MapView
            key={project.id}
            project={project}
            onViewChange={setMapView}
          />
          {legendOpen ? (
            <Legend project={project} onClose={() => setLegendOpen(false)} />
          ) : (
            <button
              type="button"
              onClick={() => setLegendOpen(true)}
              title="Show the legend (L)"
              className="absolute bottom-4 right-4 z-[1000] rounded border border-slate-200 bg-white/95 px-2 py-1 text-xs text-slate-600 shadow hover:text-slate-900"
            >
              Legend
            </button>
          )}
          {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
        </main>
      </div>
    </div>
  )
}
