import { createId } from './id'
import { createProject } from './project'
import type { Line, MapNode, Project, Segment } from '../types'

/**
 * Synthetic network used to exercise the target scale (10k stops, 500 lines).
 */
export function generateNetwork(stopCount: number, lineCount: number): Project {
  const project = createProject('Synthetic network')
  const nodes: MapNode[] = []
  const now = new Date().toISOString()

  for (let i = 0; i < stopCount; i += 1) {
    const node: MapNode = {
      id: createId('nod'),
      kind: 'stop',
      name: `Stop ${i}`,
      color: '#2563eb',
      lat: 47.4 + (i % 100) * 0.002,
      lng: 19.0 + Math.floor(i / 100) * 0.002,
      createdAt: now,
    }
    nodes.push(node)
    project.nodes[node.id] = node
  }

  const typeId = createId('typ')
  project.lineTypes[typeId] = { id: typeId, name: 'busz' }

  for (let l = 0; l < lineCount; l += 1) {
    const groupId = createId('grp')
    const segments: Segment[] = []
    const start = (l * 7) % Math.max(nodes.length - 21, 1)
    for (let s = 0; s < 20; s += 1) {
      const from = nodes[start + s]
      const to = nodes[start + s + 1]
      if (!from || !to) break
      segments.push({
        id: createId('seg'),
        from: from.id,
        to: to.id,
        mode: 'straight',
        geometry: [
          [from.lat, from.lng],
          [to.lat, to.lng],
        ],
        groupId,
      })
    }
    const line: Line = {
      id: createId('lin'),
      name: `${l + 1}`,
      description: '',
      color: '#dc2626',
      typeId,
      segments,
      groups: [{ id: groupId, label: 'Branch 1' }],
      createdAt: now,
    }
    project.lines[line.id] = line
  }

  return project
}
