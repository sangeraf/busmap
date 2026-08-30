import { create } from 'zustand'
import { produce } from 'immer'
import type { LatLng, Project, ProjectId } from '../types'
import { createProject, duplicateProject } from '../lib/project'
import {
  emptyWorkspace,
  indexedDbBackend,
  type Workspace,
  type WorkspaceStorage,
} from './storage'

export type TabId = 'stops' | 'lines' | 'data'

export type SaveState = 'idle' | 'saving' | 'saved'

interface StoreState {
  workspace: Workspace
  hydrated: boolean
  activeTab: TabId
  saveState: SaveState
  hydrate: () => Promise<void>
  setActiveTab: (tab: TabId) => void
  createNewProject: (name: string) => void
  switchProject: (id: ProjectId) => void
  renameProject: (id: ProjectId, name: string) => void
  duplicateActiveProject: () => void
  deleteProject: (id: ProjectId) => void
  setMapView: (center: LatLng, zoom: number) => void
  updateActiveProject: (recipe: (project: Project) => void) => void
}

let storage: WorkspaceStorage = indexedDbBackend

/** Swap the persistence backend (used by tests, and later by folder sync). */
export function setStorageBackend(backend: WorkspaceStorage) {
  storage = backend
}

function withFallbackProject(workspace: Workspace): Workspace {
  const ids = Object.keys(workspace.projects)
  if (ids.length === 0) {
    const project = createProject('Untitled network')
    return {
      ...workspace,
      activeProjectId: project.id,
      projects: { [project.id]: project },
    }
  }
  const activeId =
    workspace.activeProjectId && workspace.projects[workspace.activeProjectId]
      ? workspace.activeProjectId
      : ids[0]
  return { ...workspace, activeProjectId: activeId }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

export const useStore = create<StoreState>((set, get) => {
  function persist(workspace: Workspace) {
    set({ saveState: 'saving' })
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void storage.save(workspace).then(() => set({ saveState: 'saved' }))
    }, 400)
  }

  function commit(recipe: (workspace: Workspace) => void) {
    const workspace = produce(get().workspace, recipe)
    set({ workspace })
    persist(workspace)
  }

  return {
    workspace: emptyWorkspace(),
    hydrated: false,
    activeTab: 'stops',
    saveState: 'idle',

    hydrate: async () => {
      if (get().hydrated) return
      const loaded = await storage.load()
      set({
        workspace: withFallbackProject(loaded ?? emptyWorkspace()),
        hydrated: true,
      })
    },

    setActiveTab: (tab) => set({ activeTab: tab }),

    createNewProject: (name) => {
      const project = createProject(name)
      commit((workspace) => {
        workspace.projects[project.id] = project
        workspace.activeProjectId = project.id
      })
    },

    switchProject: (id) =>
      commit((workspace) => {
        if (workspace.projects[id]) workspace.activeProjectId = id
      }),

    renameProject: (id, name) =>
      commit((workspace) => {
        const project = workspace.projects[id]
        if (!project) return
        project.name = name
        project.updatedAt = new Date().toISOString()
      }),

    duplicateActiveProject: () => {
      const { workspace } = get()
      const active = workspace.activeProjectId
        ? workspace.projects[workspace.activeProjectId]
        : undefined
      if (!active) return
      const copy = duplicateProject(active, `${active.name} (copy)`)
      commit((draft) => {
        draft.projects[copy.id] = copy
        draft.activeProjectId = copy.id
      })
    },

    deleteProject: (id) =>
      commit((workspace) => {
        delete workspace.projects[id]
        if (workspace.activeProjectId === id) {
          const remaining = Object.keys(workspace.projects)
          if (remaining.length > 0) {
            workspace.activeProjectId = remaining[0]
          } else {
            const project = createProject('Untitled network')
            workspace.projects[project.id] = project
            workspace.activeProjectId = project.id
          }
        }
      }),

    setMapView: (center, zoom) =>
      commit((workspace) => {
        const id = workspace.activeProjectId
        const project = id ? workspace.projects[id] : undefined
        if (!project) return
        project.center = center
        project.zoom = zoom
      }),

    updateActiveProject: (recipe) =>
      commit((workspace) => {
        const id = workspace.activeProjectId
        const project = id ? workspace.projects[id] : undefined
        if (!project) return
        recipe(project)
        project.updatedAt = new Date().toISOString()
      }),
  }
})

export function useActiveProject(): Project | undefined {
  return useStore((state) => {
    const id = state.workspace.activeProjectId
    return id ? state.workspace.projects[id] : undefined
  })
}
