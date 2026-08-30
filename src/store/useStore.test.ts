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

describe('workspace store', () => {
  beforeEach(async () => {
    setStorageBackend(memoryBackend())
    useStore.setState({ workspace: emptyWorkspace(), hydrated: false })
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

  it('persists the map view on the active project', () => {
    useStore.getState().setMapView([47.5, 19.05], 15)
    const { workspace } = useStore.getState()
    const project = workspace.projects[workspace.activeProjectId!]
    expect(project.center).toEqual([47.5, 19.05])
    expect(project.zoom).toBe(15)
  })
})
