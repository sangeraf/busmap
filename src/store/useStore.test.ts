import { beforeEach, describe, expect, it } from 'vitest'
import { setStorageBackend, useStore } from './useStore'
import { emptyWorkspace, type Workspace, type WorkspaceStorage } from './storage'

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
    expect(
      useStore.getState().workspace.projects[copyId!].name,
    ).toBe('Szeged (copy)')

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

    const [first, second] = activeLine(line.id).segments
    useStore.getState().moveSegment(line.id, second.id, -1)
    expect(activeLine(line.id).segments[0].id).toBe(second.id)

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

  it('drops segments of a deleted node', () => {
    const store = useStore.getState()
    const a = store.addNode('stop', 47.5, 19.0)
    const b = store.addNode('stop', 47.51, 19.01)
    const line = store.addLine({ name: '7' })
    useStore.getState().startConnecting(line.id, line.groups[0].id)
    useStore.getState().connectTo(a.id)
    useStore.getState().connectTo(b.id)

    useStore.getState().deleteNode(b.id)
    expect(activeLine(line.id).segments).toHaveLength(0)
  })

  it('persists the map view on the active project', () => {
    useStore.getState().setMapView([47.5, 19.05], 15)
    const { workspace } = useStore.getState()
    const project = workspace.projects[workspace.activeProjectId!]
    expect(project.center).toEqual([47.5, 19.05])
    expect(project.zoom).toBe(15)
  })
})
