export type NodeId = string
export type LineId = string
export type SegmentId = string
export type TypeId = string
export type GroupId = string
export type ProjectId = string

export type NodeKind = 'stop' | 'waypoint'
export type SegmentMode = 'straight' | 'road'

export type LatLng = [number, number]

export interface MapNode {
  id: NodeId
  kind: NodeKind
  name: string
  color: string
  lat: number
  lng: number
  notes?: string
  createdAt: string
}

export interface LineType {
  id: TypeId
  name: string
  color?: string
}

export interface Segment {
  id: SegmentId
  from: NodeId
  to: NodeId
  mode: SegmentMode
  geometry: LatLng[]
  distanceM?: number
  durationS?: number
  groupId?: GroupId
  stale?: boolean
}

export interface LineGroup {
  id: GroupId
  label: string
}

export interface Line {
  id: LineId
  name: string
  description: string
  color: string
  typeId: TypeId | null
  segments: Segment[]
  groups: LineGroup[]
  createdAt: string
}

export interface Project {
  id: ProjectId
  name: string
  createdAt: string
  updatedAt: string
  center: LatLng
  zoom: number
  nodes: Record<NodeId, MapNode>
  lines: Record<LineId, Line>
  lineTypes: Record<TypeId, LineType>
}

export const SCHEMA_VERSION = 1

export interface ProjectFile {
  schemaVersion: number
  project: Project
}
