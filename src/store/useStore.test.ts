import polyline from '@mapbox/polyline'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setStorageBackend, useStore } from './useStore'
import { clearRouteCache } from '../lib/routing'
import { parseProjectFile } from '../lib/exchange'
import type { LatLng } from '../types'
import {
  emptyWorkspace,
  type Workspace,
  type WorkspaceStorage,
} from './storage'

function memoryBackend(): WorkspaceStorage & { current: Workspace | null } {
  return {
    current: null,
    async load() {
      return this.current
    },
    async save(workspace) {
      this.current = workspace
    },
  }
}

function activeProjectState() {
  const { workspace } = useStore.getState()
  return workspace.projects[workspace.activeProjectId!]
}

function activeLine(id: string) {
  return activeProjectState().lines[id]
}

describe('workspace store', () => {
  beforeEach(async () => {
    setStorageBackend(memoryBackend())
    useStore.setState({
      workspace: emptyWorkspace(),
      hydrated: false,
      connect: null,
      selectedNodeId: null,
      selectedLineId: null,
    })
    await useStore.getState().hydrate()
  })

  afterEach(() => {
    clearRouteCache()
    useStore.setState({
      defaultSegmentMode: 'straight',
      routing: { pending: 0, failed: 0, error: null },
    })
    vi.unstubAllGlobals()
  })

  it('imports a project as a new one or into the current one', () => {
    const store = useStore.getState()
    const kept = store.addNode('stop', 47.4, 18.9)
    const imported = parseProjectFile(
      JSON.stringify({
        name: 'Imported',
        nodes: { a: { lat: 47.5, lng: 19.0, name: 'A' } },
      }),
    )
    expect(imported.ok).toBe(true)
    if (!imported.ok) return

    useStore.getState().importProject(imported.project, 'new')
    expect(Object.keys(useStore.getState().workspace.projects)).toHaveLength(2)
    expect(activeProjectState().name).toBe('Imported')

    useStore
      .getState()
      .switchProject(
        Object.values(useStore.getState().workspace.projects).find(
          (project) => project.name !== 'Imported',
        )!.id,
      )
    useStore.getState().importProject(imported.project, 'merge')
    const merged = activeProjectState()
    expect(Object.keys(merged.nodes)).toHaveLength(2)
    expect(merged.nodes[kept.id]).toBeDefined()
  })

  it('creates a default project when storage is empty', () => {
    const { workspace } = useStore.getState()
    expect(Object.keys(workspace.projects)).toHaveLength(1)
    expect(workspace.activeProjectId).toBeTruthy()
  })

  it('switches, duplicates and deletes projects', () => {
    const store = useStore.getState()
    store.createNewProject('Szeged')
    const secondId = useStore.getState().workspace.activeProjectId
    expect(Object.keys(useStore.getState().workspace.projects)).toHaveLength(2)

    useStore.getState().duplicateActiveProject()
    const copyId = useStore.getState().workspace.activeProjectId
    expect(copyId).not.toBe(secondId)
    expect(useStore.getState().workspace.projects[copyId!].name).toBe(
      'Szeged (copy)',
    )

    useStore.getState().deleteProject(copyId!)
    expect(useStore.getState().workspace.activeProjectId).not.toBe(copyId)
    expect(Object.keys(useStore.getState().workspace.projects)).toHaveLength(2)
  })

  it('always keeps one project after deleting the last one', () => {
    const only = useStore.getState().workspace.activeProjectId!
    useStore.getState().deleteProject(only)
    const { workspace } = useStore.getState()
    expect(Object.keys(workspace.projects)).toHaveLength(1)
    expect(workspace.activeProjectId).not.toBe(only)
  })

  it('adds, edits and deletes nodes', () => {
    const node = useStore.getState().addNode('stop', 47.5, 19.04)
    expect(useStore.getState().selectedNodeId).toBe(node.id)

    useStore.getState().updateNode(node.id, { name: 'Deák tér' })
    const active = () => {
      const { workspace } = useStore.getState()
      return workspace.projects[workspace.activeProjectId!]
    }
    expect(active().nodes[node.id].name).toBe('Deák tér')

    useStore.getState().deleteNode(node.id)
    expect(active().nodes[node.id]).toBeUndefined()
    expect(useStore.getState().selectedNodeId).toBeNull()
  })

  it('numbers new nodes per kind', () => {
    const first = useStore.getState().addNode('stop', 47.5, 19.04)
    const second = useStore.getState().addNode('stop', 47.51, 19.05)
    const waypoint = useStore.getState().addNode('waypoint', 47.52, 19.06)
    expect(first.name).toBe('Stop 1')
    expect(second.name).toBe('Stop 2')
    expect(waypoint.name).toBe('Waypoint 1')
  })

  it('chains clicked stops into directed segments', () => {
    const store = useStore.getState()
    const a = store.addNode('stop', 47.5, 19.0)
    const b = store.addNode('stop', 47.51, 19.01)
    const c = store.addNode('stop', 47.52, 19.02)
    const line = store.addLine({ name: '7' })

    useStore.getState().startConnecting(line.id, line.groups[0].id)
    useStore.getState().connectTo(a.id)
    expect(activeLine(line.id).segments).toHaveLength(0)

    useStore.getState().connectTo(b.id)
    useStore.getState().connectTo(c.id)
    const segments = activeLine(line.id).segments
    expect(segments.map((segment) => [segment.from, segment.to])).toEqual([
      [a.id, b.id],
      [b.id, c.id],
    ])
    expect(segments[0].geometry).toEqual([
      [a.lat, a.lng],
      [b.lat, b.lng],
    ])
  })

  it('inserts clicked stops into an existing connection', () => {
    const store = useStore.getState()
    const a = store.addNode('stop', 47.5, 19.0)
    const b = store.addNode('stop', 47.51, 19.01)
    const c = store.addNode('stop', 47.52, 19.02)
    const d = store.addNode('stop', 47.53, 19.03)
    const line = store.addLine({ name: '7' })
    useStore.getState().startConnecting(line.id, line.groups[0].id)
    useStore.getState().connectTo(a.id)
    useStore.getState().connectTo(d.id)

    const bridge = activeLine(line.id).segments[0]
    useStore.getState().startConnecting(line.id, line.groups[0].id, {
      anchorId: a.id,
      bridgeId: bridge.id,
    })
    useStore.getState().connectTo(b.id)
    useStore.getState().connectTo(c.id)

    expect(
      activeLine(line.id).segments.map((segment) => [segment.from, segment.to]),
    ).toEqual([
      [a.id, b.id],
      [b.id, c.id],
      [c.id, d.id],
    ])
  })

  it('inserts stops before the first one of a branch', () => {
    const store = useStore.getState()
    const a = store.addNode('stop', 47.5, 19.0)
    const b = store.addNode('stop', 47.51, 19.01)
    const c = store.addNode('stop', 47.52, 19.02)
    const line = store.addLine({ name: '7' })
    useStore.getState().startConnecting(line.id, line.groups[0].id)
    useStore.getState().connectTo(b.id)
    useStore.getState().connectTo(c.id)

    useStore.getState().startConnecting(line.id, line.groups[0].id, {
      bridgeId: activeLine(line.id).segments[0].id,
    })
    useStore.getState().connectTo(a.id)

    expect(
      activeLine(line.id).segments.map((segment) => [segment.from, segment.to]),
    ).toEqual([
      [a.id, b.id],
      [b.id, c.id],
    ])
  })

  it('deletes a branch with all of its connections', () => {
    const store = useStore.getState()
    const a = store.addNode('stop', 47.5, 19.0)
    const b = store.addNode('stop', 47.51, 19.01)
    const line = store.addLine({ name: '7' })
    const outbound = line.groups[0].id
    useStore.getState().addBranch(line.id)
    const inbound = activeLine(line.id).groups[1].id

    useStore.getState().startConnecting(line.id, outbound)
    useStore.getState().connectTo(a.id)
    useStore.getState().connectTo(b.id)
    useStore.getState().startConnecting(line.id, inbound)
    useStore.getState().connectTo(b.id)
    useStore.getState().connectTo(a.id)

    useStore.getState().startConnecting(line.id, outbound)
    useStore.getState().deleteBranch(line.id, outbound)

    const updated = activeLine(line.id)
    expect(updated.groups.map((group) => group.id)).toEqual([inbound])
    expect(
      updated.segments.map((segment) => [segment.from, segment.to]),
    ).toEqual([[b.id, a.id]])
    expect(useStore.getState().connect).toBeNull()
  })

  it('reorders and removes connections', () => {
    const store = useStore.getState()
    const nodes = [
      store.addNode('stop', 47.5, 19.0),
      store.addNode('stop', 47.51, 19.01),
      store.addNode('stop', 47.52, 19.02),
    ]
    const line = store.addLine({ name: '7' })
    useStore.getState().startConnecting(line.id, line.groups[0].id)
    for (const node of nodes) useStore.getState().connectTo(node.id)

    const [first] = activeLine(line.id).segments
    useStore.getState().moveStop(line.id, 0, 2, -1)
    const moved = activeLine(line.id).segments
    expect(moved.map((segment) => [segment.from, segment.to])).toEqual([
      [nodes[0].id, nodes[2].id],
      [nodes[2].id, nodes[1].id],
    ])
    expect(moved[0].geometry).toEqual([
      [nodes[0].lat, nodes[0].lng],
      [nodes[2].lat, nodes[2].lng],
    ])

    useStore.getState().removeSegment(line.id, first.id)
    expect(activeLine(line.id).segments).toHaveLength(1)
  })

  it('deletes only project-scoped line types and untags their lines', () => {
    const typeId = useStore.getState().addLineType('villamos')!
    expect(useStore.getState().addLineType(' Villamos ')).toBe(typeId)

    const line = useStore.getState().addLine({ name: '4', typeId })
    useStore.getState().deleteLineType(typeId)
    expect(activeLine(line.id).typeId).toBeNull()
    expect(activeProjectState().lineTypes[typeId]).toBeUndefined()
  })

  it('keeps a line connected when a stop is deleted', () => {
    const store = useStore.getState()
    const a = store.addNode('stop', 47.5, 19.0)
    const b = store.addNode('stop', 47.51, 19.01)
    const c = store.addNode('stop', 47.52, 19.02)
    const line = store.addLine({ name: '7' })
    useStore.getState().startConnecting(line.id, line.groups[0].id)
    for (const node of [a, b, c]) useStore.getState().connectTo(node.id)

    useStore.getState().deleteNode(b.id)
    expect(
      activeLine(line.id).segments.map((segment) => [segment.from, segment.to]),
    ).toEqual([[a.id, c.id]])

    useStore.getState().deleteNode(a.id)
    expect(activeLine(line.id).segments).toHaveLength(0)
  })

  it('removes a stop from a line and splices its neighbours', () => {
    const store = useStore.getState()
    const nodes = [
      store.addNode('stop', 47.5, 19.0),
      store.addNode('stop', 47.51, 19.01),
      store.addNode('stop', 47.52, 19.02),
    ]
    const line = store.addLine({ name: '7' })
    useStore.getState().startConnecting(line.id, line.groups[0].id)
    for (const node of nodes) useStore.getState().connectTo(node.id)

    const [first, second] = activeLine(line.id).segments
    useStore.getState().removeStop(line.id, first.id, second.id)
    expect(
      activeLine(line.id).segments.map((segment) => [segment.from, segment.to]),
    ).toEqual([[nodes[0].id, nodes[2].id]])

    useStore.getState().removeStop(line.id, null, first.id)
    expect(activeLine(line.id).segments).toHaveLength(0)
    expect(activeProjectState().nodes[nodes[0].id]).toBeDefined()
  })

  it('routes road connections and re-routes them when a stop moves', async () => {
    const geometry: LatLng[] = [
      [47.5, 19.0],
      [47.505, 19.005],
      [47.51, 19.01],
    ]
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [
          {
            geometry: polyline.encode(geometry, 6),
            distance: 900,
            duration: 120,
          },
        ],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const store = useStore.getState()
    store.setDefaultSegmentMode('road')
    const a = store.addNode('stop', 47.5, 19.0)
    const b = store.addNode('stop', 47.51, 19.01)
    const line = store.addLine({ name: '7' })
    useStore.getState().startConnecting(line.id, line.groups[0].id)
    useStore.getState().connectTo(a.id)
    useStore.getState().connectTo(b.id)

    await useStore.getState().routeStaleSegments()
    const routed = activeLine(line.id).segments[0]
    expect(routed.mode).toBe('road')
    expect(routed.stale).toBe(false)
    expect(routed.distanceM).toBe(900)
    expect(routed.durationS).toBe(120)
    expect(routed.geometry).toHaveLength(3)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    useStore.getState().updateNode(b.id, { lat: 47.6, lng: 19.1 })
    await useStore.getState().routeStaleSegments()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(activeLine(line.id).segments[0].stale).toBe(false)
  })

  it('keeps a failed road connection stale and reports the error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ code: 'NoRoute', message: 'no route' }),
      })),
    )

    const store = useStore.getState()
    const a = store.addNode('stop', 47.5, 19.0)
    const b = store.addNode('stop', 47.51, 19.01)
    const line = store.addLine({ name: '9' })
    useStore.getState().startConnecting(line.id, line.groups[0].id)
    useStore.getState().connectTo(a.id)
    useStore.getState().connectTo(b.id)

    const segmentId = activeLine(line.id).segments[0].id
    useStore.getState().setSegmentMode(line.id, segmentId, 'road')
    await useStore.getState().routeStaleSegments()

    expect(activeLine(line.id).segments[0].stale).toBe(true)
    expect(useStore.getState().routing.failed).toBe(1)
    expect(useStore.getState().routing.pending).toBe(0)
    expect(useStore.getState().routing.error).toContain('could not be routed')
  })

  it('switches a whole line back to straight geometry', async () => {
    const store = useStore.getState()
    const a = store.addNode('stop', 47.5, 19.0)
    const b = store.addNode('stop', 47.51, 19.01)
    const line = store.addLine({ name: '4' })
    useStore.getState().startConnecting(line.id, line.groups[0].id)
    useStore.getState().connectTo(a.id)
    useStore.getState().connectTo(b.id)

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    useStore.getState().setLineMode(line.id, 'road')
    expect(activeLine(line.id).segments[0].mode).toBe('road')

    useStore.getState().setLineMode(line.id, 'straight')
    const segment = activeLine(line.id).segments[0]
    expect(segment.mode).toBe('straight')
    expect(segment.stale).toBe(false)
    expect(segment.distanceM).toBeUndefined()
    expect(segment.geometry).toEqual([
      [a.lat, a.lng],
      [b.lat, b.lng],
    ])
  })

  it('persists the map view on the active project', () => {
    useStore.getState().setMapView([47.5, 19.05], 15)
    const { workspace } = useStore.getState()
    const project = workspace.projects[workspace.activeProjectId!]
    expect(project.center).toEqual([47.5, 19.05])
    expect(project.zoom).toBe(15)
  })

  it('undoes and redoes edits without recording the map view', () => {
    const store = useStore.getState()
    const node = store.addNode('stop', 47.5, 19.0)
    useStore.getState().updateNode(node.id, { name: 'Deák tér' })
    useStore.getState().setMapView([47.6, 19.1], 14)

    expect(useStore.getState().history.past).toBe(2)

    useStore.getState().undo()
    expect(activeProjectState().nodes[node.id].name).not.toBe('Deák tér')
    expect(activeProjectState().center).toEqual([47.6, 19.1])

    useStore.getState().undo()
    expect(activeProjectState().nodes[node.id]).toBeUndefined()
    expect(useStore.getState().history.past).toBe(0)

    useStore.getState().redo()
    useStore.getState().redo()
    expect(activeProjectState().nodes[node.id].name).toBe('Deák tér')
    expect(useStore.getState().history.future).toBe(0)
  })

  it('drops the redo stack once a new edit lands', () => {
    const store = useStore.getState()
    store.addNode('stop', 47.5, 19.0)
    useStore.getState().undo()
    expect(useStore.getState().history.future).toBe(1)

    useStore.getState().addNode('waypoint', 47.4, 18.9)
    expect(useStore.getState().history.future).toBe(0)
  })
})
