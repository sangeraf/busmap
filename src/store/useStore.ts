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
  SegmentMode,
  TypeId,
} from '../types'
import { createProject, duplicateProject } from '../lib/project'
import { mergeProjects } from '../lib/exchange'
import {
  ensureFolderAccess,
  forgetSyncFolder,
  loadSyncFolder,
  pickSyncFolder,
  readProjects,
  writeProjects,
  type SyncDirectoryHandle,
} from '../lib/folderSync'
import { STOP_COLOR, createNode, nearestNode } from '../lib/nodes'
import {
  applySegmentMode,
  createLine,
  createLineType,
  createSegment,
  insertStop,
  removeChainStop,
  removeNodeFromLine,
  moveChainStop,
} from '../lib/lines'
import { createId } from '../lib/id'
import {
  hydrateRouteCache,
  mapWithConcurrency,
  routeBetween,
  withEndpoints,
} from '../lib/routing'
import {
  emptyWorkspace,
  indexedDbBackend,
  recentColorsStorage,
  type Workspace,
  type WorkspaceStorage,
} from './storage'
import { withRecentColor } from '../lib/palette'

export type TabId = 'stops' | 'lines' | 'data'

export type SaveState = 'idle' | 'saving' | 'saved'

/** How an imported project lands: new entry, folded in, or overwriting. */
export type ImportMode = 'new' | 'merge' | 'replace'

/** State of the optional link to a folder on disk (Chrome/Edge only). */
export interface FolderSyncState {
  connected: boolean
  name: string | null
  lastSyncAt: string | null
  busy: boolean
  error: string | null
}

/** Undoable snapshots; routing results and view changes are not recorded. */
export interface HistoryState {
  past: number
  future: number
}

/** Progress of the background OSRM requests. */
export interface RoutingState {
  pending: number
  failed: number
  error: string | null
}

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
  /** Stop whose quick name/colour editor is open right after placing it. */
  namingNodeId: NodeId | null
  /** Colour given to the next stop; waypoints stay grey. */
  lastStopColor: string
  /** Colours picked lately, offered as swatches. Most recent first. */
  recentColors: string[]
  /** Mode used for connections created from now on. */
  defaultSegmentMode: SegmentMode
  routing: RoutingState
  history: HistoryState
  folder: FolderSyncState
  hydrate: () => Promise<void>
  undo: () => void
  redo: () => void
  connectFolder: () => Promise<void>
  disconnectFolder: () => Promise<void>
  syncToFolder: () => Promise<void>
  loadFromFolder: () => Promise<string[]>
  setActiveTab: (tab: TabId) => void
  setPlacementKind: (kind: NodeKind | null) => void
  setSelectedNode: (id: NodeId | null) => void
  setHoveredNode: (id: NodeId | null) => void
  setNamingNode: (id: NodeId | null) => void
  rememberColor: (color: string) => void
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
  deleteBranch: (lineId: LineId, groupId: GroupId) => void
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
  moveStop: (
    lineId: LineId,
    chainIndex: number,
    stopIndex: number,
    delta: number,
  ) => void
  setDefaultSegmentMode: (mode: SegmentMode) => void
  setSegmentMode: (
    lineId: LineId,
    segmentId: SegmentId,
    mode: SegmentMode,
  ) => void
  setLineMode: (lineId: LineId, mode: SegmentMode) => void
  routeStaleSegments: () => Promise<void>
  createNewProject: (name: string) => void
  importProject: (project: Project, mode: ImportMode) => void
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

/** Segments with an OSRM request in flight, so they are not queued twice. */
const routingSegments = new Set<SegmentId>()

/** Routing runs are chained, so awaiting one also awaits the queued ones. */
let routingRun: Promise<void> | null = null

let saveTimer: ReturnType<typeof setTimeout> | undefined

const HISTORY_LIMIT = 50
let past: Workspace[] = []
let future: Workspace[] = []
let folderHandle: SyncDirectoryHandle | null = null

export const useStore = create<StoreState>((set, get) => {
  function persist(workspace: Workspace) {
    set({ saveState: 'saving' })
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void storage.save(workspace).then(() => set({ saveState: 'saved' }))
      if (folderHandle) void syncFolder(false)
    }, 400)
  }

  /**
   * Edits are undoable by default; background results (routing) and view
   * changes pass `history: false` so they never eat an undo step. Immer keeps
   * the snapshots structurally shared, so the stack stays cheap at 10k stops.
   */
  function commit(
    recipe: (workspace: Workspace) => void,
    options: { history?: boolean } = {},
  ) {
    const previous = get().workspace
    const workspace = produce(previous, recipe)
    if (workspace === previous) return
    if (options.history !== false) {
      past.push(previous)
      if (past.length > HISTORY_LIMIT) past.shift()
      future = []
    }
    set({ workspace, history: { past: past.length, future: future.length } })
    persist(workspace)
  }

  /**
   * Undo only rewinds the data: where the map is currently looking is kept,
   * otherwise panning around would jump back with every step.
   */
  function restore(snapshot: Workspace) {
    const current = get().workspace
    const workspace = produce(snapshot, (draft) => {
      for (const project of Object.values(draft.projects)) {
        const live = current.projects[project.id]
        if (!live) continue
        project.center = live.center
        project.zoom = live.zoom
      }
    })
    set({
      workspace,
      history: { past: past.length, future: future.length },
      connect: null,
      placementKind: null,
    })
    persist(workspace)
    void get().routeStaleSegments()
  }

  async function syncFolder(prompt: boolean) {
    if (!folderHandle) return
    set((state) => ({ folder: { ...state.folder, busy: true, error: null } }))
    try {
      if (!(await ensureFolderAccess(folderHandle, prompt))) {
        set((state) => ({
          folder: {
            ...state.folder,
            busy: false,
            error: 'The folder needs permission again — press Sync now.',
          },
        }))
        return
      }
      await writeProjects(
        folderHandle,
        Object.values(get().workspace.projects),
      )
      set((state) => ({
        folder: {
          ...state.folder,
          busy: false,
          error: null,
          lastSyncAt: new Date().toISOString(),
        },
      }))
    } catch (error) {
      set((state) => ({
        folder: {
          ...state.folder,
          busy: false,
          error: error instanceof Error ? error.message : 'Folder sync failed.',
        },
      }))
    }
  }

  async function routePending() {
    const project = activeProject(get().workspace)
    if (!project) return

    const targets: {
      lineId: LineId
      segmentId: SegmentId
      ends: LatLng[]
    }[] = []
    for (const line of Object.values(project.lines)) {
      for (const segment of line.segments) {
        if (segment.mode !== 'road') continue
        if (!segment.stale && segment.distanceM !== undefined) continue
        if (routingSegments.has(segment.id)) continue
        const from = project.nodes[segment.from]
        const to = project.nodes[segment.to]
        if (!from || !to) continue
        routingSegments.add(segment.id)
        targets.push({
          lineId: line.id,
          segmentId: segment.id,
          ends: [
            [from.lat, from.lng],
            [to.lat, to.lng],
          ],
        })
      }
    }
    if (targets.length === 0) return

    set((state) => ({
      routing: {
        ...state.routing,
        pending: state.routing.pending + targets.length,
        error: null,
      },
    }))

    const results = await mapWithConcurrency(
      targets.map((target) => async () => {
        const route = await routeBetween(target.ends[0], target.ends[1])
        commit(
          (workspace) => {
          const line = activeProject(workspace)?.lines[target.lineId]
          const segment = line?.segments.find(
            (item) => item.id === target.segmentId,
          )
          if (!segment || segment.mode !== 'road') return
          segment.geometry = withEndpoints(
            route.geometry,
            target.ends[0],
            target.ends[1],
          )
            segment.distanceM = route.distanceM
            segment.durationS = route.durationS
            segment.stale = false
          },
          { history: false },
        )
      }),
    )

    for (const target of targets) routingSegments.delete(target.segmentId)
    const failures = results.filter((item) => item.status === 'rejected')
    set((state) => ({
      routing: {
        pending: Math.max(0, state.routing.pending - targets.length),
        failed: failures.length,
        error:
          failures.length > 0
            ? `${failures.length} connection(s) could not be routed`
            : null,
      },
    }))
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
    namingNodeId: null,
    lastStopColor: STOP_COLOR,
    recentColors: [],
    defaultSegmentMode: 'straight',
    routing: { pending: 0, failed: 0, error: null },
    history: { past: 0, future: 0 },
    folder: {
      connected: false,
      name: null,
      lastSyncAt: null,
      busy: false,
      error: null,
    },

    hydrate: async () => {
      if (get().hydrated) return
      await hydrateRouteCache()
      const [loaded, recentColors] = await Promise.all([
        storage.load(),
        recentColorsStorage.load(),
      ])
      set({ recentColors })
      past = []
      future = []
      set({
        workspace: withFallbackProject(loaded ?? emptyWorkspace()),
        hydrated: true,
        history: { past: 0, future: 0 },
      })
      folderHandle = await loadSyncFolder()
      if (folderHandle) {
        set((state) => ({
          folder: {
            ...state.folder,
            connected: true,
            name: folderHandle?.name ?? null,
          },
        }))
      }
      void get().routeStaleSegments()
    },

    rememberColor: (color) => {
      const recentColors = withRecentColor(get().recentColors, color)
      if (recentColors === get().recentColors) return
      set({ recentColors })
      void recentColorsStorage.save(recentColors)
    },

    undo: () => {
      const previous = past.pop()
      if (!previous) return
      future.push(get().workspace)
      restore(previous)
    },

    redo: () => {
      const next = future.pop()
      if (!next) return
      past.push(get().workspace)
      restore(next)
    },

    connectFolder: async () => {
      try {
        folderHandle = await pickSyncFolder()
      } catch {
        return
      }
      set((state) => ({
        folder: {
          ...state.folder,
          connected: true,
          name: folderHandle?.name ?? null,
          error: null,
        },
      }))
      await syncFolder(true)
    },

    disconnectFolder: async () => {
      folderHandle = null
      await forgetSyncFolder()
      set({
        folder: {
          connected: false,
          name: null,
          lastSyncAt: null,
          busy: false,
          error: null,
        },
      })
    },

    syncToFolder: () => syncFolder(true),

    /** Pull every *.busmap.json back in, replacing same-id projects. */
    loadFromFolder: async () => {
      if (!folderHandle) return []
      set((state) => ({ folder: { ...state.folder, busy: true, error: null } }))
      try {
        if (!(await ensureFolderAccess(folderHandle, true))) {
          set((state) => ({
            folder: {
              ...state.folder,
              busy: false,
              error: 'The folder needs permission again.',
            },
          }))
          return []
        }
        const { projects, warnings } = await readProjects(folderHandle)
        commit((workspace) => {
          for (const project of projects) {
            workspace.projects[project.id] = project
          }
          if (!workspace.activeProjectId && projects[0]) {
            workspace.activeProjectId = projects[0].id
          }
        })
        set((state) => ({ folder: { ...state.folder, busy: false } }))
        void get().routeStaleSegments()
        return warnings
      } catch (error) {
        set((state) => ({
          folder: {
            ...state.folder,
            busy: false,
            error:
              error instanceof Error ? error.message : 'Reading the folder failed.',
          },
        }))
        return []
      }
    },

    setActiveTab: (tab) => set({ activeTab: tab }),

    setPlacementKind: (kind) =>
      set({ placementKind: kind, connect: kind ? null : get().connect }),

    setSelectedNode: (id) => set({ selectedNodeId: id }),

    setHoveredNode: (id) => set({ hoveredNodeId: id }),

    setNamingNode: (id) => set({ namingNodeId: id }),

    /**
     * A new stop starts from the last colour used and, when another stop sits
     * within 200 m, borrows its name, so the quick editor usually only needs
     * an Enter. Waypoints stay plain and skip the editor entirely.
     */
    addNode: (kind, lat, lng) => {
      const project = get().workspace.activeProjectId
        ? get().workspace.projects[get().workspace.activeProjectId!]
        : undefined
      const existing = project
        ? Object.values(project.nodes).filter((node) => node.kind === kind)
            .length
        : 0
      const node = createNode(kind, lat, lng, existing + 1)
      if (kind === 'stop') {
        node.color = get().lastStopColor
        const neighbour = project
          ? nearestNode(Object.values(project.nodes), 'stop', lat, lng)
          : null
        if (neighbour) node.name = neighbour.name
      }
      commit((workspace) => {
        const id = workspace.activeProjectId
        const target = id ? workspace.projects[id] : undefined
        if (!target) return
        target.nodes[node.id] = node
        target.updatedAt = new Date().toISOString()
      })
      set({
        selectedNodeId: node.id,
        namingNodeId: kind === 'stop' ? node.id : null,
      })
      return node
    },

    updateNode: (id, patch) => {
      const current = activeProject(get().workspace)?.nodes[id]
      if (!current) return
      // `updatedAt` alone would make a no-op edit look like a change and cost
      // an undo step, so patches that change nothing are dropped here.
      const entries = Object.entries(patch) as [keyof MapNode, unknown][]
      if (entries.every(([key, value]) => current[key] === value)) return
      const kind = patch.kind ?? current.kind
      if (patch.color && kind === 'stop') set({ lastStopColor: patch.color })
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
      })
      if (patch.lat !== undefined || patch.lng !== undefined) {
        void get().routeStaleSegments()
      }
    },

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
      if (get().namingNodeId === id) set({ namingNodeId: null })
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

    /** Drops a branch together with every connection that belongs to it. */
    deleteBranch: (lineId, groupId) => {
      commit((workspace) => {
        const project = activeProject(workspace)
        const line = project?.lines[lineId]
        if (!project || !line) return
        line.groups = line.groups.filter((group) => group.id !== groupId)
        line.segments = line.segments.filter(
          (segment) => segment.groupId !== groupId,
        )
        project.updatedAt = new Date().toISOString()
      })
      const { connect } = get()
      if (connect?.lineId === lineId && connect.groupId === groupId) {
        set({ connect: null })
      }
    },

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
            get().defaultSegmentMode,
          )
        } else {
          const from = anchorId ? project.nodes[anchorId] : undefined
          if (!from) return
          line.segments.push(
            createSegment(
              from,
              node,
              connect.groupId,
              get().defaultSegmentMode,
            ),
          )
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
      void get().routeStaleSegments()
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
    removeStop: (lineId, incomingSegmentId, outgoingSegmentId) => {
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
      })
      void get().routeStaleSegments()
    },

    /** Move a stop within its own chain, keeping the chain connected. */
    moveStop: (lineId, chainIndex, stopIndex, delta) => {
      commit((workspace) => {
        const project = activeProject(workspace)
        const line = project?.lines[lineId]
        if (!project || !line) return
        moveChainStop(line, chainIndex, stopIndex, delta, project.nodes)
        project.updatedAt = new Date().toISOString()
      })
      void get().routeStaleSegments()
    },

    setDefaultSegmentMode: (mode) => set({ defaultSegmentMode: mode }),

    /**
     * Switching a connection to `road` only marks it stale; the geometry is
     * filled in by the background router. Switching back to `straight` drops
     * the road geometry and its distance/duration right away.
     */
    setSegmentMode: (lineId, segmentId, mode) => {
      commit((workspace) => {
        const project = activeProject(workspace)
        const line = project?.lines[lineId]
        const segment = line?.segments.find((item) => item.id === segmentId)
        if (!project || !segment) return
        applySegmentMode(segment, mode, project.nodes)
        project.updatedAt = new Date().toISOString()
      })
      void get().routeStaleSegments()
    },

    setLineMode: (lineId, mode) => {
      commit((workspace) => {
        const project = activeProject(workspace)
        const line = project?.lines[lineId]
        if (!project || !line) return
        for (const segment of line.segments) {
          applySegmentMode(segment, mode, project.nodes)
        }
        project.updatedAt = new Date().toISOString()
      })
      void get().routeStaleSegments()
    },

    /**
     * Fetches the driving route of every road connection that has none yet or
     * whose stops moved. Requests are cached, de-duplicated and run a few at a
     * time; segments that fail stay stale so they can be retried.
     */
    routeStaleSegments: () => {
      const run = (routingRun ?? Promise.resolve()).then(() => routePending())
      routingRun = run.finally(() => {
        if (routingRun === run) routingRun = null
      })
      return routingRun
    },

    importProject: (imported, mode) => {
      const { workspace } = get()
      const currentId = workspace.activeProjectId
      const current = currentId ? workspace.projects[currentId] : undefined
      const project =
        mode === 'new' || !current
          ? { ...imported, id: createId('prj') }
          : mode === 'merge'
            ? mergeProjects(current, imported)
            : { ...imported, id: current.id }
      commit((draft) => {
        draft.projects[project.id] = project
        draft.activeProjectId = project.id
      })
      void get().routeStaleSegments()
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
      commit(
        (workspace) => {
          const id = workspace.activeProjectId
          const project = id ? workspace.projects[id] : undefined
          if (!project) return
          project.center = center
          project.zoom = zoom
        },
        { history: false },
      ),

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
