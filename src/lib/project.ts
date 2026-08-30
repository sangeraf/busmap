import { createId } from './id'
import type { Project } from '../types'

export const DEFAULT_CENTER: [number, number] = [47.4979, 19.0402]
export const DEFAULT_ZOOM = 13

export function createProject(name: string): Project {
  const now = new Date().toISOString()
  return {
    id: createId('prj'),
    name,
    createdAt: now,
    updatedAt: now,
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    nodes: {},
    lines: {},
    lineTypes: {},
  }
}

export function duplicateProject(project: Project, name: string): Project {
  const now = new Date().toISOString()
  return {
    ...structuredClone(project),
    id: createId('prj'),
    name,
    createdAt: now,
    updatedAt: now,
  }
}

export function projectStats(project: Project) {
  const nodes = Object.values(project.nodes)
  return {
    stops: nodes.filter((n) => n.kind === 'stop').length,
    waypoints: nodes.filter((n) => n.kind === 'waypoint').length,
    lines: Object.keys(project.lines).length,
  }
}
