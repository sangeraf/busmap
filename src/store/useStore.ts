import { create } from 'zustand'
import { produce } from 'immer'
import type {
  GroupId,
  LatLng,
  Line,
  LineId,
  MapNode,
  NodeId,
  NodeKind,
  Project,
  ProjectId,
  SegmentId,
  TypeId,
} from '../types'
import { createProject, duplicateProject } from '../lib/project'
import { createNode } from '../lib/nodes'
import {
  createLine,
  createLineType,
  createSegment,
  insertStop,
  removeChainStop,
  removeNodeFromLine,
  reorderSegment,
} from '../lib/lines'
import { createId } from '../lib/id'
import {
  emptyWorkspace,
  indexedDbBackend,
  type Workspace,
  type WorkspaceStorage,
} from './storage'

export type TabId = 'stops' | 'lines' | 'data'

export type SaveState = 'idle' | 'saving' | 'saved'

/**
 * Active "click stops on the map to chain them" session. When `bridgeId` is
 * set the clicked stops are threaded into that connection instead of being
 * appended, so the chain never breaks apart.
 */
export interface ConnectState {
  lineId: LineId
  groupId: GroupId
  anchorId: NodeId | null
  bridgeId: SegmentId | null
}

interface StoreState {
  workspace: Workspace
  hydrated: boolean
  activeTab: TabId
  saveState: SaveState
  placementKind: NodeKind | null
  selectedNodeId: NodeId | null
  hoveredNodeId: NodeId | null
  selectedLineId: LineId | null
  connect: ConnectState | null
  hydrate: () => Promise<void>
  setActiveTab: (tab: TabId) => void
  setPlacementKind: (kind: NodeKind | null) => void
  setSelectedNode: (id: NodeId | null) => void
  setHoveredNode: (id: NodeId | null) => void
  addNode: (kind: NodeKind, lat: number, lng: number) => MapNode
  updateNode: (id: NodeId, patch: Partial<Omit<MapNode, 'id'>>) => void
  deleteNode: (id: NodeId) => void
  setSelectedLine: (id: LineId | null) => void
  addLine: (input: {
    name: string
    description?: string
    color?: string
    typeId?: TypeId | null
  }) => Line
  updateLine: (
    id: LineId,
    patch: Partial<Omit<Line, 'id' | 'segments'>>,
  ) => void
  deleteLine: (id: LineId) => void
  addLineType: (name: string) => TypeId | null
  renameLineType: (id: TypeId, name: string) => void
  deleteLineType: (id: TypeId) => void
  addBranch: (lineId: LineId) => void
  renameBranch: (lineId: LineId, groupId: GroupId, label: string) => void
  startConnecting: (
    lineId: LineId,
    groupId: GroupId,
    at?: { anchorId?: NodeId | null; bridgeId?: SegmentId | null },
  ) => void
  stopConnecting: () => void
  connectTo: (nodeId: NodeId) => void
  removeSegment: (lineId: LineId, segmentId: SegmentId) => void
  removeStop: (
    lineId: LineId,
    incomingSegmentId: SegmentId | null,
    outgoingSegmentId: SegmentId | null,
  ) => void
  moveSegment: (lineId: LineId, segmentId: SegmentId, delta: number) => void
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

function activeProject(workspace: Workspace): Project | undefined {
  const id = workspace.activeProjectId
  return id ? workspace.projects[id] : undefined
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
    selectedLineId: null,
    connect: null,

    hydrate: async () => {
      if (get().hydrated) return
      const loaded = await storage.load()
      set({
        workspace: withFallbackProject(loaded ?? emptyWorkspace()),
        hydrated: true,
      })
    },

    setActiveTab: (tab) => set({ activeTab: tab }),

    setPlacementKind: (kind) =>
      set({ placementKind: kind, connect: kind ? null : get().connect }),

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
          removeNodeFromLine(line, id, project.nodes)
        }
        project.updatedAt = new Date().toISOString()
      })
      if (get().selectedNodeId === id) set({ selectedNodeId: null })
      const { connect } = get()
      if (connect?.anchorId === id)
        set({ connect: { ...connect, anchorId: null } })
    },

    setSelectedLine: (id) => set({ selectedLineId: id }),

    addLine: (input) => {
      const line = createLine(input)
      commit((workspace) => {
        const project = activeProject(workspace)
        if (!project) return
        project.lines[line.id] = line
        project.updatedAt = new Date().toISOString()
      })
      set({ selectedLineId: line.id })
      return line
    },

    updateLine: (id, patch) =>
      commit((workspace) => {
        const line = activeProject(workspace)?.lines[id]
        if (line) Object.assign(line, patch)
      }),

    deleteLine: (id) => {
      commit((workspace) => {
        const project = activeProject(workspace)
        if (project) delete project.lines[id]
      })
      set((state) => ({
        selectedLineId:
          state.selectedLineId === id ? null : state.selectedLineId,
        connect: state.connect?.lineId === id ? null : state.connect,
      }))
    },

    addLineType: (name) => {
      const trimmed = name.trim()
      if (!trimmed) return null
      const project = activeProject(get().workspace)
      const existing = project
        ? Object.values(project.lineTypes).find(
            (type) => type.name.toLowerCase() === trimmed.toLowerCase(),
          )
        : undefined
      if (existing) return existing.id
      const type = createLineType(trimmed)
      commit((workspace) => {
        const target = activeProject(workspace)
        if (target) target.lineTypes[type.id] = type
      })
      return type.id
    },

    renameLineType: (id, name) =>
      commit((workspace) => {
        const type = activeProject(workspace)?.lineTypes[id]
        if (type && name.trim()) type.name = name.trim()
      }),

    deleteLineType: (id) =>
      commit((workspace) => {
        const project = activeProject(workspace)
        if (!project) return
        delete project.lineTypes[id]
        for (const line of Object.values(project.lines)) {
          if (line.typeId === id) line.typeId = null
        }
      }),

    addBranch: (lineId) =>
      commit((workspace) => {
        const line = activeProject(workspace)?.lines[lineId]
        if (!line) return
        line.groups.push({
          id: createId('grp'),
          label: `Branch ${line.groups.length + 1}`,
        })
      }),

    renameBranch: (lineId, groupId, label) =>
      commit((workspace) => {
        const group = activeProject(workspace)?.lines[lineId]?.groups.find(
          (item) => item.id === groupId,
        )
        if (group && label.trim()) group.label = label.trim()
      }),

    startConnecting: (lineId, groupId, at) =>
      set({
        connect: {
          lineId,
          groupId,
          anchorId: at?.anchorId ?? null,
          bridgeId: at?.bridgeId ?? null,
        },
        placementKind: null,
        selectedLineId: lineId,
      }),

    stopConnecting: () => set({ connect: null }),

    /**
     * Threads clicked nodes into the chain: with a `bridgeId` each click
     * splits that connection in two, otherwise clicks append to the end (the
     * very first click of an empty branch only anchors).
     */
    connectTo: (nodeId) => {
      const { connect } = get()
      if (!connect) return
      const { anchorId, bridgeId } = connect
      if (!bridgeId && (!anchorId || anchorId === nodeId)) {
        set({ connect: { ...connect, anchorId: nodeId } })
        return
      }

      let nextBridgeId: SegmentId | null = null
      commit((workspace) => {
        const project = activeProject(workspace)
        const line = project?.lines[connect.lineId]
        const node = project?.nodes[nodeId]
        if (!project || !line || !node) return
        if (bridgeId) {
          nextBridgeId = insertStop(
            line,
            bridgeId,
            node,
            project.nodes,
            anchorId ? 'after' : 'before',
          )
        } else {
          const from = anchorId ? project.nodes[anchorId] : undefined
          if (!from) return
          line.segments.push(createSegment(from, node, connect.groupId))
        }
        project.updatedAt = new Date().toISOString()
      })
      set({
        connect: {
          ...connect,
          anchorId: nodeId,
          bridgeId: bridgeId ? nextBridgeId : null,
        },
      })
    },

    removeSegment: (lineId, segmentId) =>
      commit((workspace) => {
        const line = activeProject(workspace)?.lines[lineId]
        if (!line) return
        line.segments = line.segments.filter(
          (segment) => segment.id !== segmentId,
        )
      }),

    /** Drop a stop from a line, splicing its neighbours back together. */
    removeStop: (lineId, incomingSegmentId, outgoingSegmentId) =>
      commit((workspace) => {
        const project = activeProject(workspace)
        const line = project?.lines[lineId]
        if (!project || !line) return
        removeChainStop(
          line,
          incomingSegmentId,
          outgoingSegmentId,
          project.nodes,
        )
        project.updatedAt = new Date().toISOString()
      }),

    /** Reorder a segment within its own chain, keeping the chain connected. */
    moveSegment: (lineId, segmentId, delta) =>
      commit((workspace) => {
        const project = activeProject(workspace)
        const line = project?.lines[lineId]
        if (!project || !line) return
        reorderSegment(line, segmentId, delta, project.nodes)
        project.updatedAt = new Date().toISOString()
      }),

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
