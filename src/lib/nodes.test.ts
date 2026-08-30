import { describe, expect, it } from 'vitest'
import { generateNetwork } from './fixtures'
import {
  DEFAULT_NODE_FILTERS,
  buildNodeLineIndex,
  createNode,
  createNodeFuse,
  filterNodes,
  nearestNode,
} from './nodes'
import type { MapNode } from '../types'

function setup() {
  const project = generateNetwork(40, 2)
  const orphan = createNode('waypoint', 47.5, 19.05, 1)
  orphan.name = 'Depot entrance'
  project.nodes[orphan.id] = orphan
  const nodes: MapNode[] = Object.values(project.nodes)
  return {
    project,
    nodes,
    orphan,
    lineIndex: buildNodeLineIndex(project),
    fuse: createNodeFuse(nodes),
  }
}

describe('node filtering', () => {
  it('finds nodes by fuzzy name', () => {
    const { nodes, lineIndex, fuse } = setup()
    const result = filterNodes(
      nodes,
      { ...DEFAULT_NODE_FILTERS, query: 'depot' },
      lineIndex,
      fuse,
    )
    expect(result.map((node) => node.name)).toContain('Depot entrance')
  })

  it('filters by kind and connectivity', () => {
    const { nodes, lineIndex, fuse, orphan } = setup()
    const waypoints = filterNodes(
      nodes,
      { ...DEFAULT_NODE_FILTERS, kind: 'waypoint' },
      lineIndex,
      fuse,
    )
    expect(waypoints).toEqual([orphan])

    const unconnected = filterNodes(
      nodes,
      { ...DEFAULT_NODE_FILTERS, onlyUnconnected: true },
      lineIndex,
      fuse,
    )
    expect(unconnected).toContain(orphan)
    expect(unconnected.every((node) => !lineIndex.has(node.id))).toBe(true)
  })

  it('sorts names numerically', () => {
    const { nodes, lineIndex, fuse } = setup()
    const sorted = filterNodes(nodes, DEFAULT_NODE_FILTERS, lineIndex, fuse)
    const stops = sorted.filter((node) => node.name.startsWith('Stop '))
    expect(stops[0].name).toBe('Stop 0')
    expect(stops[1].name).toBe('Stop 1')
    expect(stops[2].name).toBe('Stop 2')
  })
})

describe('nearest node', () => {
  it('picks the closest node of the same kind inside the radius', () => {
    const near = createNode('stop', 47.5, 19.0, 1)
    near.name = 'Deák Ferenc tér'
    const closer = createNode('stop', 47.5001, 19.0, 2)
    closer.name = 'Deák Ferenc tér M'
    const waypoint = createNode('waypoint', 47.50005, 19.0, 3)
    const nodes = [near, closer, waypoint]

    expect(nearestNode(nodes, 'stop', 47.50011, 19.0)?.name).toBe(
      'Deák Ferenc tér M',
    )
    expect(nearestNode(nodes, 'waypoint', 47.50011, 19.0)).toBe(waypoint)
  })

  it('ignores nodes beyond the radius', () => {
    const far = createNode('stop', 47.5, 19.0, 1)
    // ~0.01° of latitude is over a kilometre.
    expect(nearestNode([far], 'stop', 47.51, 19.0)).toBeNull()
  })
})

describe('node/line index', () => {
  it('lists every line touching a node once', () => {
    const { project, lineIndex } = setup()
    const line = Object.values(project.lines)[0]
    const nodeId = line.segments[1].from
    expect(lineIndex.get(nodeId)).toContain(line.id)
    expect(new Set(lineIndex.get(nodeId)).size).toBe(
      lineIndex.get(nodeId)!.length,
    )
  })
})
