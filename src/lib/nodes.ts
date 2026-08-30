import Fuse from 'fuse.js'
import { createId } from './id'
import type { MapNode, NodeKind, Project } from '../types'

export const STOP_COLOR = '#2563eb'
export const WAYPOINT_COLOR = '#64748b'

export function createNode(
  kind: NodeKind,
  lat: number,
  lng: number,
  ordinal: number,
): MapNode {
  return {
    id: createId('nod'),
    kind,
    name: kind === 'stop' ? `Stop ${ordinal}` : `Waypoint ${ordinal}`,
    color: kind === 'stop' ? STOP_COLOR : WAYPOINT_COLOR,
    lat,
    lng,
    createdAt: new Date().toISOString(),
  }
}

export type NodeSort = 'name' | 'created' | 'lines'
export type KindFilter = 'all' | NodeKind

export interface NodeFilters {
  query: string
  kind: KindFilter
  sort: NodeSort
  onlyUnconnected: boolean
}

export const DEFAULT_NODE_FILTERS: NodeFilters = {
  query: '',
  kind: 'all',
  sort: 'name',
  onlyUnconnected: false,
}

/** nodeId -> ids of lines that touch it. */
export function buildNodeLineIndex(project: Project): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const line of Object.values(project.lines)) {
    const touched = new Set<string>()
    for (const segment of line.segments) {
      touched.add(segment.from)
      touched.add(segment.to)
    }
    for (const nodeId of touched) {
      const lines = index.get(nodeId)
      if (lines) lines.push(line.id)
      else index.set(nodeId, [line.id])
    }
  }
  return index
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

export function filterNodes(
  nodes: MapNode[],
  filters: NodeFilters,
  lineIndex: Map<string, string[]>,
  fuse: Fuse<MapNode>,
): MapNode[] {
  const query = filters.query.trim()
  let result = query ? fuse.search(query).map((hit) => hit.item) : nodes

  if (filters.kind !== 'all') {
    result = result.filter((node) => node.kind === filters.kind)
  }
  if (filters.onlyUnconnected) {
    result = result.filter((node) => !lineIndex.has(node.id))
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
    case 'lines':
      sorted.sort(
        (a, b) =>
          (lineIndex.get(b.id)?.length ?? 0) -
          (lineIndex.get(a.id)?.length ?? 0),
      )
      break
  }
  return sorted
}

export function createNodeFuse(nodes: MapNode[]): Fuse<MapNode> {
  return new Fuse(nodes, {
    keys: ['name'],
    threshold: 0.35,
    ignoreLocation: true,
  })
}
