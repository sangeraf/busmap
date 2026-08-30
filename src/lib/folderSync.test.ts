import { describe, expect, it } from 'vitest'
import { fileNameFor, readProjects, writeProjects } from './folderSync'
import type { SyncDirectoryHandle } from './folderSync'
import { createProject } from './project'
import { createNode } from './nodes'

/** In-memory stand-in for a directory the user picked. */
function fakeFolder(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial))
  const handle = {
    name: 'networks',
    async getFileHandle(name: string) {
      if (!files.has(name)) files.set(name, '')
      return {
        async getFile() {
          return { text: async () => files.get(name) ?? '' }
        },
        async createWritable() {
          return {
            async write(text: string) {
              files.set(name, text)
            },
            async close() {},
          }
        },
      }
    },
    async *values() {
      for (const name of files.keys()) yield { kind: 'file', name }
    },
    async queryPermission() {
      return 'granted'
    },
    async requestPermission() {
      return 'granted'
    },
  }
  return { files, handle: handle as unknown as SyncDirectoryHandle }
}

describe('folder sync', () => {
  it('names files after the project and its id', () => {
    const project = createProject('Belváros / Buda')
    expect(fileNameFor(project)).toBe(
      `belvaros-buda-${project.id}.busmap.json`,
    )
  })

  it('writes every project and reads them back', async () => {
    const project = createProject('Nightlines')
    const node = createNode('stop', 47.5, 19.0, 1)
    project.nodes[node.id] = node

    const folder = fakeFolder()
    await writeProjects(folder.handle, [project])
    expect([...folder.files.keys()]).toEqual([fileNameFor(project)])

    const { projects, warnings } = await readProjects(folder.handle)
    expect(warnings).toEqual([])
    expect(projects).toHaveLength(1)
    expect(projects[0].name).toBe('Nightlines')
    expect(projects[0].nodes[node.id].lat).toBe(47.5)
  })

  it('reports unreadable files instead of failing the whole read', async () => {
    const good = createProject('Good')
    const node = createNode('stop', 47.5, 19.0, 1)
    good.nodes[node.id] = node

    const folder = fakeFolder({ 'broken.busmap.json': '{ not json' })
    await writeProjects(folder.handle, [good])

    const { projects, warnings } = await readProjects(folder.handle)
    expect(projects.map((item) => item.name)).toEqual(['Good'])
    expect(warnings[0]).toContain('broken.busmap.json')
  })

  it('ignores files that are not project files', async () => {
    const folder = fakeFolder({ 'notes.txt': 'hello' })
    const { projects, warnings } = await readProjects(folder.handle)
    expect(projects).toEqual([])
    expect(warnings).toEqual([])
  })
})
