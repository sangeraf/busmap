import Fuse from 'fuse.js'
import { createId } from './id'
import { distanceM } from './nodes'
import type {
  GroupId,
  LatLng,
  Line,
  LineGroup,
  LineType,
  MapNode,
  NodeId,
  Project,
  Segment,
  SegmentId,
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

/**
 * Move a stop earlier/later inside its chain, including in and out of the
 * first position. The connections keep their place in the chain and are
 * re-stitched to the new stop order, so the branch stays continuous.
 */
export function moveChainStop(
  line: Line,
  chainIndex: number,
  stopIndex: number,
  delta: number,
  nodes: Record<NodeId, MapNode>,
): void {
  const chain = lineChains(line)[chainIndex]
  if (!chain) return

  const target = stopIndex + delta
  if (stopIndex < 0 || stopIndex >= chain.nodeIds.length) return
  if (target < 0 || target >= chain.nodeIds.length) return

  const order = [...chain.nodeIds]
  const [moved] = order.splice(stopIndex, 1)
  order.splice(target, 0, moved)

  chain.segments.forEach((segment, index) => {
    if (segment.from === order[index] && segment.to === order[index + 1]) return
    segment.from = order[index]
    segment.to = order[index + 1]
    restitchGeometry(segment, nodes)
  })
}

/**
 * Switch a connection between a straight line and a road route. Roads are
 * only marked stale here; the geometry is filled in by the router.
 */
export function applySegmentMode(
  segment: Segment,
  mode: SegmentMode,
  nodes: Record<NodeId, MapNode>,
): void {
  if (segment.mode === mode) return
  segment.mode = mode
  if (mode === 'road') {
    segment.stale = true
    return
  }
  const from = nodes[segment.from]
  const to = nodes[segment.to]
  if (from && to) {
    segment.geometry = [
      [from.lat, from.lng],
      [to.lat, to.lng],
    ]
  }
  segment.distanceM = undefined
  segment.durationS = undefined
  segment.stale = false
}

/**
 * Put a stop into an existing connection: `X -> Y` becomes `X -> node -> Y`
 * (`side: 'after'`) or `node -> X -> Y` (`side: 'before'`). The newly drawn
 * leg gets `mode`, the rest of the split connection keeps its own. Returns
 * the connection the next inserted stop should split, so clicking stops in
 * order keeps threading them into the chain.
 */
export function insertStop(
  line: Line,
  bridgeId: SegmentId,
  node: MapNode,
  nodes: Record<NodeId, MapNode>,
  side: 'before' | 'after',
  mode: SegmentMode,
): SegmentId | null {
  const at = line.segments.findIndex((item) => item.id === bridgeId)
  if (at < 0) return null
  const bridge = line.segments[at]
  const groupId = bridge.groupId ?? line.groups[0]?.id
  if (!groupId) return null

  if (side === 'before') {
    const head = nodes[bridge.from]
    if (!head) return null
    const added = createSegment(node, head, groupId, mode)
    if (mode === 'road') added.stale = true
    line.segments.splice(at, 0, added)
    return added.id
  }

  const tail = nodes[bridge.to]
  if (!tail) return null
  const added = createSegment(node, tail, groupId, bridge.mode)
  if (bridge.mode === 'road') added.stale = true
  bridge.to = node.id
  applySegmentMode(bridge, mode, nodes)
  restitchGeometry(bridge, nodes)
  line.segments.splice(at + 1, 0, added)
  return added.id
}

/**
 * Drop one stop from a chain and heal the gap: an inner stop's two
 * connections collapse into a single `previous -> next` one, an end stop just
 * takes its only connection with it. `incomingId`/`outgoingId` identify the
 * connections around the visited stop (either may be null at a chain end).
 */
export function removeChainStop(
  line: Line,
  incomingId: SegmentId | null,
  outgoingId: SegmentId | null,
  nodes: Record<NodeId, MapNode>,
): void {
  const incoming = line.segments.find((item) => item.id === incomingId)
  const outgoing = line.segments.find((item) => item.id === outgoingId)
  const dropped = incoming && outgoing ? outgoing : (incoming ?? outgoing)
  if (!dropped) return

  if (incoming && outgoing) {
    incoming.to = outgoing.to
    if (outgoing.mode === 'road') incoming.mode = 'road'
    restitchGeometry(incoming, nodes)
  }
  line.segments = line.segments.filter((item) => item.id !== dropped.id)
}

/** Remove every visit of a node from a line, healing each chain. */
export function removeNodeFromLine(
  line: Line,
  nodeId: NodeId,
  nodes: Record<NodeId, MapNode>,
): void {
  const touches = () =>
    line.segments.some(
      (segment) => segment.from === nodeId || segment.to === nodeId,
    )
  for (let guard = line.segments.length; touches() && guard >= 0; guard -= 1) {
    const chain = lineChains(line).find((item) => item.nodeIds.includes(nodeId))
    if (!chain) break
    const index = chain.nodeIds.indexOf(nodeId)
    removeChainStop(
      line,
      chain.segments[index - 1]?.id ?? null,
      chain.segments[index]?.id ?? null,
      nodes,
    )
  }
  line.segments = line.segments.filter(
    (segment) => segment.from !== nodeId && segment.to !== nodeId,
  )
}

function restitchGeometry(segment: Segment, nodes: Record<NodeId, MapNode>) {
  if (segment.mode === 'road') {
    segment.stale = true
    return
  }
  const from = nodes[segment.from]
  const to = nodes[segment.to]
  if (!from || !to) return
  segment.geometry = [
    [from.lat, from.lng],
    [to.lat, to.lng],
  ]
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

/** Length of one connection: its drawn geometry, straight otherwise. */
function segmentLengthM(
  segment: Segment,
  nodes: Record<NodeId, MapNode>,
): number {
  const from = nodes[segment.from]
  const to = nodes[segment.to]
  const straight: LatLng[] =
    from && to
      ? [
          [from.lat, from.lng],
          [to.lat, to.lng],
        ]
      : []
  const points = segment.geometry.length > 1 ? segment.geometry : straight
  let total = 0
  for (let index = 1; index < points.length; index += 1) {
    total += distanceM(points[index - 1], points[index])
  }
  return total
}

/** Total length of every connection of a line, across all branches. */
export function lineLengthM(
  line: Line,
  nodes: Record<NodeId, MapNode>,
): number {
  return line.segments.reduce(
    (total, segment) => total + segmentLengthM(segment, nodes),
    0,
  )
}

export function formatLengthM(meters: number): string {
  if (meters < 2000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
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
