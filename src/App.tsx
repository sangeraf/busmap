import { useEffect } from 'react'
import { Header } from './components/Header'
import { MapView } from './components/MapView'
import { Sidebar } from './components/Sidebar'
import { useActiveProject, useStore } from './store/useStore'

export default function App() {
  const hydrate = useStore((s) => s.hydrate)
  const hydrated = useStore((s) => s.hydrated)
  const project = useActiveProject()
  const setMapView = useStore((s) => s.setMapView)

  const setPlacementKind = useStore((s) => s.setPlacementKind)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setPlacementKind(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setPlacementKind])

  if (!hydrated || !project) {
    return (
      <div className="grid h-screen place-items-center text-sm text-slate-500">
        Loading workspace…
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <Header project={project} />
      <div className="flex min-h-0 flex-1">
        <Sidebar project={project} />
        <main className="min-w-0 flex-1">
          <MapView key={project.id} project={project} onViewChange={setMapView} />
        </main>
      </div>
    </div>
  )
}
