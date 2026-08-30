import Fuse from 'fuse.js'
import { createId } from './id'
import type {
  GroupId,
  Line,
  LineGroup,
  LineType,
  MapNode,
  NodeId,
  Project,
  Segment,
  SegmentMode,
} from '../types'

export const LINE_COLOR = '#dc2626'

export function createLine(input: {
  name: string
  description?: string
  color?: string
  typeId?: string | null
}): Line {
  const group: LineGroup = { id: createId('grp'), label: 'Branch 1' }
  return {
    id: createId('lin'),
    name: input.name,
    description: input.description ?? '',
    color: input.color ?? LINE_COLOR,
    typeId: input.typeId ?? null,
    segments: [],
    groups: [group],
    createdAt: new Date().toISOString(),
  }
}

export function createLineType(name: string): LineType {
  return { id: createId('typ'), name }
}

export function createSegment(
  from: MapNode,
  to: MapNode,
  groupId: GroupId,
  mode: SegmentMode = 'straight',
): Segment {
  return {
    id: createId('seg'),
    from: from.id,
    to: to.id,
    mode,
    geometry: [
      [from.lat, from.lng],
      [to.lat, to.lng],
    ],
    groupId,
  }
}

/**
 * A run of segments that actually connect end-to-end. A branch can hold
 * several of them because segments are added manually and are allowed to be
 * disconnected (`previous.to !== next.from`).
 */
export interface Chain {
  groupId: GroupId
  label: string
  segments: Segment[]
  nodeIds: NodeId[]
}

export function lineChains(line: Line): Chain[] {
  const chains: Chain[] = []
  for (const group of line.groups) {
    const segments = line.segments.filter(
      (segment) => (segment.groupId ?? line.groups[0]?.id) === group.id,
    )
    let current: Chain | null = null
    for (const segment of segments) {
      const continues =
        current && current.nodeIds[current.nodeIds.length - 1] === segment.from
      if (!current || !continues) {
        current = {
          groupId: group.id,
          label: group.label,
          segments: [],
          nodeIds: [segment.from],
        }
        chains.push(current)
      }
      current.segments.push(segment)
      current.nodeIds.push(segment.to)
    }
    if (segments.length === 0) {
      chains.push({
        groupId: group.id,
        label: group.label,
        segments: [],
        nodeIds: [],
      })
    }
  }
  return chains
}

/** Distinct stops served by a line, in the order they first appear. */
export function lineStopIds(line: Line): NodeId[] {
  const seen = new Set<NodeId>()
  const ordered: NodeId[] = []
  for (const chain of lineChains(line)) {
    for (const nodeId of chain.nodeIds) {
      if (seen.has(nodeId)) continue
      seen.add(nodeId)
      ordered.push(nodeId)
    }
  }
  return ordered
}

/** nodeId -> lines serving it, for the Stops tab and node deletion. */
export function linesForNode(project: Project, nodeId: NodeId): Line[] {
  return Object.values(project.lines).filter((line) =>
    line.segments.some(
      (segment) => segment.from === nodeId || segment.to === nodeId,
    ),
  )
}

export type LineSort = 'name' | 'created' | 'stops'

export interface LineFilters {
  query: string
  /** 'all', 'none' for untyped lines, or a type id. */
  typeId: string
  sort: LineSort
}

export const DEFAULT_LINE_FILTERS: LineFilters = {
  query: '',
  typeId: 'all',
  sort: 'name',
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

export function createLineFuse(lines: Line[]): Fuse<Line> {
  return new Fuse(lines, {
    keys: ['name', 'description'],
    threshold: 0.35,
    ignoreLocation: true,
  })
}

export function filterLines(
  lines: Line[],
  filters: LineFilters,
  fuse: Fuse<Line>,
): Line[] {
  const query = filters.query.trim()
  let result = query ? fuse.search(query).map((hit) => hit.item) : lines

  if (filters.typeId === 'none') {
    result = result.filter((line) => !line.typeId)
  } else if (filters.typeId !== 'all') {
    result = result.filter((line) => line.typeId === filters.typeId)
  }
  if (query) return result

  const sorted = [...result]
  switch (filters.sort) {
    case 'name':
      sorted.sort((a, b) => collator.compare(a.name, b.name))
      break
    case 'created':
      sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      break
    case 'stops':
      sorted.sort((a, b) => lineStopIds(b).length - lineStopIds(a).length)
      break
  }
  return sorted
}
