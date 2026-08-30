import { describe, expect, it } from 'vitest'
import { createNode, distanceM } from './nodes'
import {
  DEFAULT_LINE_FILTERS,
  createLine,
  createLineFuse,
  createSegment,
  filterLines,
  formatLengthM,
  lineChains,
  lineLengthM,
  insertStop,
  lineStopIds,
  removeChainStop,
  removeNodeFromLine,
  moveChainStop,
} from './lines'
import type { Line, MapNode } from '../types'

function stops(count: number): MapNode[] {
  return Array.from({ length: count }, (_, index) =>
    createNode('stop', 47.5 + index * 0.001, 19.0 + index * 0.001, index + 1),
  )
}

function distanceBetween(a: MapNode, b: MapNode): number {
  return distanceM([a.lat, a.lng], [b.lat, b.lng])
}

function chained(line: Line, nodes: MapNode[], groupId: string) {
  for (let i = 0; i < nodes.length - 1; i += 1) {
    line.segments.push(createSegment(nodes[i], nodes[i + 1], groupId))
  }
}

describe('lineChains', () => {
  it('lists the stops of a branch in order', () => {
    const nodes = stops(4)
    const line = createLine({ name: '7' })
    chained(line, nodes, line.groups[0].id)

    const chains = lineChains(line)
    expect(chains).toHaveLength(1)
    expect(chains[0].nodeIds).toEqual(nodes.map((node) => node.id))
  })

  it('splits a branch where segments do not meet', () => {
    const nodes = stops(5)
    const line = createLine({ name: '7' })
    const groupId = line.groups[0].id
    line.segments.push(createSegment(nodes[0], nodes[1], groupId))
    line.segments.push(createSegment(nodes[3], nodes[4], groupId))

    const chains = lineChains(line)
    expect(chains.map((chain) => chain.nodeIds)).toEqual([
      [nodes[0].id, nodes[1].id],
      [nodes[3].id, nodes[4].id],
    ])
  })

  it('keeps branches separate and reports an empty branch', () => {
    const nodes = stops(4)
    const line = createLine({ name: '7' })
    const outbound = line.groups[0].id
    const inbound = 'grp-inbound'
    line.groups.push({ id: inbound, label: 'Branch 2' })
    chained(line, nodes.slice(0, 3), outbound)
    line.segments.push(createSegment(nodes[2], nodes[0], inbound))

    const chains = lineChains(line)
    expect(chains).toHaveLength(2)
    expect(chains[1].nodeIds).toEqual([nodes[2].id, nodes[0].id])

    line.groups.push({ id: 'grp-empty', label: 'Branch 3' })
    expect(lineChains(line)[2].nodeIds).toEqual([])
  })

  it('counts each served stop once across branches', () => {
    const nodes = stops(3)
    const line = createLine({ name: '7' })
    const outbound = line.groups[0].id
    chained(line, nodes, outbound)
    line.groups.push({ id: 'grp-back', label: 'Branch 2' })
    line.segments.push(createSegment(nodes[2], nodes[1], 'grp-back'))
    line.segments.push(createSegment(nodes[1], nodes[0], 'grp-back'))

    expect(lineStopIds(line)).toHaveLength(3)
  })
})

function nodeMap(nodes: MapNode[]): Record<string, MapNode> {
  return Object.fromEntries(nodes.map((node) => [node.id, node]))
}

describe('insertStop', () => {
  it('splits a connection in two and keeps threading further stops', () => {
    const nodes = stops(4)
    const line = createLine({ name: '7' })
    const groupId = line.groups[0].id
    line.segments.push(createSegment(nodes[0], nodes[3], groupId))

    const bridge = insertStop(
      line,
      line.segments[0].id,
      nodes[1],
      nodeMap(nodes),
      'after',
      'straight',
    )
    expect(bridge).toBeTruthy()
    insertStop(line, bridge!, nodes[2], nodeMap(nodes), 'after', 'straight')

    const chains = lineChains(line)
    expect(chains).toHaveLength(1)
    expect(chains[0].nodeIds).toEqual(nodes.map((node) => node.id))
    expect(chains[0].segments[0].geometry).toEqual([
      [nodes[0].lat, nodes[0].lng],
      [nodes[1].lat, nodes[1].lng],
    ])
  })

  it('prepends a stop before the first one', () => {
    const nodes = stops(3)
    const line = createLine({ name: '7' })
    chained(line, nodes.slice(1), line.groups[0].id)

    insertStop(
      line,
      line.segments[0].id,
      nodes[0],
      nodeMap(nodes),
      'before',
      'straight',
    )

    expect(lineChains(line)[0].nodeIds).toEqual(nodes.map((node) => node.id))
  })

  it('gives the new leg the chosen mode and keeps the rest as it was', () => {
    const nodes = stops(3)
    const line = createLine({ name: '7' })
    const road = createSegment(nodes[0], nodes[2], line.groups[0].id, 'road')
    road.distanceM = 1000
    road.durationS = 120
    line.segments.push(road)

    insertStop(line, road.id, nodes[1], nodeMap(nodes), 'after', 'straight')

    const [first, second] = lineChains(line)[0].segments
    expect(first.mode).toBe('straight')
    expect(first.distanceM).toBeUndefined()
    expect(first.geometry).toEqual([
      [nodes[0].lat, nodes[0].lng],
      [nodes[1].lat, nodes[1].lng],
    ])
    expect(second.mode).toBe('road')
    expect(second.stale).toBe(true)
  })
})

describe('removing a stop from a line', () => {
  it('connects the neighbours of an inner stop', () => {
    const nodes = stops(4)
    const line = createLine({ name: '7' })
    chained(line, nodes, line.groups[0].id)

    const chain = lineChains(line)[0]
    removeChainStop(
      line,
      chain.segments[0].id,
      chain.segments[1].id,
      nodeMap(nodes),
    )

    const chains = lineChains(line)
    expect(chains).toHaveLength(1)
    expect(chains[0].nodeIds).toEqual([nodes[0].id, nodes[2].id, nodes[3].id])
    expect(chains[0].segments[0].geometry).toEqual([
      [nodes[0].lat, nodes[0].lng],
      [nodes[2].lat, nodes[2].lng],
    ])
  })

  it('shortens the chain at either end', () => {
    const nodes = stops(4)
    const line = createLine({ name: '7' })
    chained(line, nodes, line.groups[0].id)

    removeChainStop(
      line,
      null,
      lineChains(line)[0].segments[0].id,
      nodeMap(nodes),
    )
    let chain = lineChains(line)[0]
    expect(chain.nodeIds).toEqual([nodes[1].id, nodes[2].id, nodes[3].id])

    chain = lineChains(line)[0]
    removeChainStop(line, chain.segments[1].id, null, nodeMap(nodes))
    expect(lineChains(line)[0].nodeIds).toEqual([nodes[1].id, nodes[2].id])
  })

  it('heals every branch when a node is deleted', () => {
    const nodes = stops(4)
    const line = createLine({ name: '7' })
    const outbound = line.groups[0].id
    chained(line, nodes, outbound)
    line.groups.push({ id: 'grp-back', label: 'Branch 2' })
    chained(line, [...nodes].reverse(), 'grp-back')

    removeNodeFromLine(line, nodes[1].id, nodeMap(nodes))

    expect(lineChains(line).map((chain) => chain.nodeIds)).toEqual([
      [nodes[0].id, nodes[2].id, nodes[3].id],
      [nodes[3].id, nodes[2].id, nodes[0].id],
    ])
  })
})

describe('moveChainStop', () => {
  it('reorders the stop sequence without breaking the chain', () => {
    const nodes = stops(4)
    const line = createLine({ name: '7' })
    chained(line, nodes, line.groups[0].id)

    moveChainStop(line, 0, 3, -1, nodeMap(nodes))

    const chains = lineChains(line)
    expect(chains).toHaveLength(1)
    expect(chains[0].nodeIds).toEqual([
      nodes[0].id,
      nodes[1].id,
      nodes[3].id,
      nodes[2].id,
    ])
    expect(line.segments[1].geometry).toEqual([
      [nodes[1].lat, nodes[1].lng],
      [nodes[3].lat, nodes[3].lng],
    ])
  })

  it('swaps the first two stops in either direction', () => {
    const nodes = stops(3)
    const line = createLine({ name: '7' })
    chained(line, nodes, line.groups[0].id)

    moveChainStop(line, 0, 0, 1, nodeMap(nodes))
    expect(lineChains(line)[0].nodeIds).toEqual([
      nodes[1].id,
      nodes[0].id,
      nodes[2].id,
    ])

    moveChainStop(line, 0, 1, -1, nodeMap(nodes))
    expect(lineChains(line)[0].nodeIds).toEqual(nodes.map((node) => node.id))
  })

  it('stays inside its own chain and clamps at the ends', () => {
    const nodes = stops(5)
    const line = createLine({ name: '7' })
    const groupId = line.groups[0].id
    chained(line, nodes.slice(0, 3), groupId)
    line.segments.push(createSegment(nodes[3], nodes[4], groupId))

    moveChainStop(line, 1, 0, -1, nodeMap(nodes))
    moveChainStop(line, 1, 1, 1, nodeMap(nodes))

    expect(lineChains(line).map((chain) => chain.nodeIds)).toEqual([
      [nodes[0].id, nodes[1].id, nodes[2].id],
      [nodes[3].id, nodes[4].id],
    ])
  })

  it('marks a re-stitched road segment stale', () => {
    const nodes = stops(3)
    const line = createLine({ name: '7' })
    const groupId = line.groups[0].id
    line.segments.push(createSegment(nodes[0], nodes[1], groupId))
    line.segments.push(createSegment(nodes[1], nodes[2], groupId, 'road'))

    moveChainStop(line, 0, 0, 1, nodeMap(nodes))

    expect(line.segments[1].stale).toBe(true)
  })
})

describe('line length', () => {
  it('sums every branch, following the drawn geometry', () => {
    const nodes = stops(3)
    const byId = Object.fromEntries(nodes.map((node) => [node.id, node]))
    const line = createLine({ name: '9' })
    const first = line.groups[0].id
    chained(line, nodes, first)

    const straight = lineLengthM(line, byId)
    expect(straight).toBeGreaterThan(0)

    const other = createNode('stop', 47.6, 19.1, 4)
    byId[other.id] = other
    line.groups.push({ id: 'grp-2', label: 'Branch 2' })
    line.segments.push(createSegment(nodes[0], other, 'grp-2'))

    expect(lineLengthM(line, byId)).toBeGreaterThan(straight)

    line.segments[0].geometry = [
      [nodes[0].lat, nodes[0].lng],
      [nodes[0].lat + 0.05, nodes[0].lng],
      [nodes[1].lat, nodes[1].lng],
    ]
    expect(lineLengthM(line, byId)).toBeGreaterThan(
      straight + distanceBetween(nodes[0], other),
    )
  })

  it('formats metres under 2 km and kilometres above', () => {
    expect(formatLengthM(0)).toBe('0 m')
    expect(formatLengthM(1999.4)).toBe('1999 m')
    expect(formatLengthM(2000)).toBe('2.0 km')
    expect(formatLengthM(12345)).toBe('12.3 km')
  })
})

describe('line filtering', () => {
  const busz = 'typ-busz'
  const villamos = 'typ-villamos'
  const lines = [
    { ...createLine({ name: '9', typeId: busz }), createdAt: '2024-01-01' },
    {
      ...createLine({ name: '10', typeId: villamos }),
      createdAt: '2024-01-02',
    },
    { ...createLine({ name: 'Airport express' }), createdAt: '2024-01-03' },
  ]

  it('filters by type, including untyped lines', () => {
    const fuse = createLineFuse(lines)
    expect(
      filterLines(lines, { ...DEFAULT_LINE_FILTERS, typeId: busz }, fuse).map(
        (line) => line.name,
      ),
    ).toEqual(['9'])
    expect(
      filterLines(lines, { ...DEFAULT_LINE_FILTERS, typeId: 'none' }, fuse).map(
        (line) => line.name,
      ),
    ).toEqual(['Airport express'])
  })

  it('sorts names numerically and finds lines by fuzzy name', () => {
    const fuse = createLineFuse(lines)
    expect(
      filterLines(lines, DEFAULT_LINE_FILTERS, fuse).map((line) => line.name),
    ).toEqual(['9', '10', 'Airport express'])
    expect(
      filterLines(
        lines,
        { ...DEFAULT_LINE_FILTERS, query: 'airprt' },
        fuse,
      ).map((line) => line.name),
    ).toEqual(['Airport express'])
  })
})
