import type { Line, MapNode, NodeId, NodeKind, Project, TypeId } from '../types'

/**
 * How much of a node kind the map draws: everything, only the ones a visible
 * line calls at, or nothing.
 */
export type NodeVisibility = 'all' | 'connected' | 'none'

/** Lines without a type share one legend entry, keyed by this. */
export const UNTYPED_KEY = 'untyped'

export interface VisibilityState {
  stop: NodeVisibility
  waypoint: NodeVisibility
  /** Type keys (a `TypeId` or `UNTYPED_KEY`) whose lines are hidden. */
  hiddenTypes: string[]
}

export const DEFAULT_VISIBILITY: VisibilityState = {
  stop: 'all',
  waypoint: 'all',
  hiddenTypes: [],
}

export function nextNodeVisibility(value: NodeVisibility): NodeVisibility {
  if (value === 'all') return 'connected'
  return value === 'connected' ? 'none' : 'all'
}

export function typeKey(typeId: TypeId | null | undefined): string {
  return typeId ?? UNTYPED_KEY
}

export function isLineVisible(line: Line, hiddenTypes: string[]): boolean {
  return !hiddenTypes.includes(typeKey(line.typeId))
}

/** Nodes that a currently drawn line stops at or passes through. */
export function connectedNodeIds(
  project: Project,
  hiddenTypes: string[],
): Set<NodeId> {
  const ids = new Set<NodeId>()
  for (const line of Object.values(project.lines)) {
    if (!isLineVisible(line, hiddenTypes)) continue
    for (const segment of line.segments) {
      ids.add(segment.from)
      ids.add(segment.to)
    }
  }
  return ids
}

export function isNodeVisible(
  node: MapNode,
  visibility: VisibilityState,
  connected: Set<NodeId>,
): boolean {
  const mode: NodeVisibility = visibility[node.kind as NodeKind]
  if (mode === 'none') return false
  if (mode === 'all') return true
  return connected.has(node.id)
}
