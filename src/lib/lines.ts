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
 * Move a connection earlier/later inside its own chain. The chain is
 * re-stitched afterwards (`from` follows the previous segment's `to`), so the
 * stop sequence is reordered and the branch never falls apart into a detached
 * part.
 */
export function reorderSegment(
  line: Line,
  segmentId: SegmentId,
  delta: number,
  nodes: Record<NodeId, MapNode>,
): void {
  const chain = lineChains(line).find((item) =>
    item.segments.some((segment) => segment.id === segmentId),
  )
  if (!chain) return

  const at = chain.segments.findIndex((segment) => segment.id === segmentId)
  const target = at + delta
  if (target < 0 || target >= chain.segments.length) return

  const positions = chain.segments.map((segment) =>
    line.segments.indexOf(segment),
  )
  const ordered = [...chain.segments]
  const [moved] = ordered.splice(at, 1)
  ordered.splice(target, 0, moved)

  let cursor = chain.nodeIds[0]
  ordered.forEach((segment, index) => {
    if (segment.from !== cursor) {
      segment.from = cursor
      restitchGeometry(segment, nodes)
    }
    cursor = segment.to
    line.segments[positions[index]] = segment
  })
}

/**
 * Put a stop into an existing connection: `X -> Y` becomes `X -> node -> Y`
 * (`side: 'after'`) or `node -> X -> Y` (`side: 'before'`). Returns the
 * connection the next inserted stop should split, so clicking stops in order
 * keeps threading them into the chain.
 */
export function insertStop(
  line: Line,
  bridgeId: SegmentId,
  node: MapNode,
  nodes: Record<NodeId, MapNode>,
  side: 'before' | 'after',
): SegmentId | null {
  const at = line.segments.findIndex((item) => item.id === bridgeId)
  if (at < 0) return null
  const bridge = line.segments[at]
  const groupId = bridge.groupId ?? line.groups[0]?.id
  if (!groupId) return null

  if (side === 'before') {
    const head = nodes[bridge.from]
    if (!head) return null
    const added = createSegment(node, head, groupId)
    line.segments.splice(at, 0, added)
    return added.id
  }

  const tail = nodes[bridge.to]
  if (!tail) return null
  const added = createSegment(node, tail, groupId)
  bridge.to = node.id
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
