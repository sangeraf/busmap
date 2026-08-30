import { create } from 'zustand'
import { produce } from 'immer'
import type {
  LatLng,
  MapNode,
  NodeId,
  NodeKind,
  Project,
  ProjectId,
} from '../types'
import { createProject, duplicateProject } from '../lib/project'
import { createNode } from '../lib/nodes'
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
  placementKind: NodeKind | null
  selectedNodeId: NodeId | null
  hoveredNodeId: NodeId | null
  hydrate: () => Promise<void>
  setActiveTab: (tab: TabId) => void
  setPlacementKind: (kind: NodeKind | null) => void
  setSelectedNode: (id: NodeId | null) => void
  setHoveredNode: (id: NodeId | null) => void
  addNode: (kind: NodeKind, lat: number, lng: number) => MapNode
  updateNode: (id: NodeId, patch: Partial<Omit<MapNode, 'id'>>) => void
  deleteNode: (id: NodeId) => void
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
    placementKind: null,
    selectedNodeId: null,
    hoveredNodeId: null,

    hydrate: async () => {
      if (get().hydrated) return
      const loaded = await storage.load()
      set({
        workspace: withFallbackProject(loaded ?? emptyWorkspace()),
        hydrated: true,
      })
    },

    setActiveTab: (tab) => set({ activeTab: tab }),

    setPlacementKind: (kind) => set({ placementKind: kind }),

    setSelectedNode: (id) => set({ selectedNodeId: id }),

    setHoveredNode: (id) => set({ hoveredNodeId: id }),

    addNode: (kind, lat, lng) => {
      const project = get().workspace.activeProjectId
        ? get().workspace.projects[get().workspace.activeProjectId!]
        : undefined
      const existing = project
        ? Object.values(project.nodes).filter((node) => node.kind === kind)
            .length
        : 0
      const node = createNode(kind, lat, lng, existing + 1)
      commit((workspace) => {
        const id = workspace.activeProjectId
        const target = id ? workspace.projects[id] : undefined
        if (!target) return
        target.nodes[node.id] = node
        target.updatedAt = new Date().toISOString()
      })
      set({ selectedNodeId: node.id })
      return node
    },

    updateNode: (id, patch) =>
      commit((workspace) => {
        const projectId = workspace.activeProjectId
        const project = projectId ? workspace.projects[projectId] : undefined
        const node = project?.nodes[id]
        if (!project || !node) return
        Object.assign(node, patch)
        if (patch.lat !== undefined || patch.lng !== undefined) {
          for (const line of Object.values(project.lines)) {
            for (const segment of line.segments) {
              if (segment.from !== id && segment.to !== id) continue
              if (segment.mode === 'road') {
                segment.stale = true
              } else {
                const from = project.nodes[segment.from]
                const to = project.nodes[segment.to]
                if (from && to) {
                  segment.geometry = [
                    [from.lat, from.lng],
                    [to.lat, to.lng],
                  ]
                }
              }
            }
          }
        }
        project.updatedAt = new Date().toISOString()
      }),

    deleteNode: (id) => {
      commit((workspace) => {
        const projectId = workspace.activeProjectId
        const project = projectId ? workspace.projects[projectId] : undefined
        if (!project) return
        delete project.nodes[id]
        for (const line of Object.values(project.lines)) {
          line.segments = line.segments.filter(
            (segment) => segment.from !== id && segment.to !== id,
          )
        }
        project.updatedAt = new Date().toISOString()
      })
      if (get().selectedNodeId === id) set({ selectedNodeId: null })
    },

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
