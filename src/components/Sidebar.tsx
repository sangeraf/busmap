import { useStore, type TabId } from '../store/useStore'
import type { Project } from '../types'
import { StopsTab } from './tabs/StopsTab'
import { LinesTab } from './tabs/LinesTab'
import { DataTab } from './tabs/DataTab'

const TABS: { id: TabId; label: string }[] = [
  { id: 'stops', label: 'Stops' },
  { id: 'lines', label: 'Lines' },
  { id: 'data', label: 'Data' },
]

export function Sidebar({ project }: { project: Project }) {
  const activeTab = useStore((s) => s.activeTab)
  const setActiveTab = useStore((s) => s.setActiveTab)

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-r border-slate-200 bg-white">
      <nav className="flex border-b border-slate-200">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-3 py-2 text-sm font-medium ${
              activeTab === tab.id
                ? 'border-b-2 border-slate-900 text-slate-900'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === 'stops' && <StopsTab project={project} />}
        {activeTab === 'lines' && <LinesTab project={project} />}
        {activeTab === 'data' && <DataTab project={project} />}
      </div>
    </aside>
  )
}
