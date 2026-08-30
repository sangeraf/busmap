import polyline from '@mapbox/polyline'
import type { LatLng, Project, Segment } from '../types'

/**
 * Persisted shape of a segment: road geometry is stored as an encoded polyline
 * (precision 6) instead of a coordinate array. At the target scale (10k stops,
 * 500 lines) raw coordinate arrays dominate the payload; encoding shrinks them
 * by roughly an order of magnitude.
 */
type StoredSegment = Omit<Segment, 'geometry'> & { geometry: string }
type StoredLine = Omit<Project['lines'][string], 'segments'> & {
  segments: StoredSegment[]
}
export type StoredProject = Omit<Project, 'lines'> & {
  lines: Record<string, StoredLine>
}

export function encodeGeometry(geometry: LatLng[]): string {
  return polyline.encode(geometry, 6)
}

export function decodeGeometry(encoded: string): LatLng[] {
  return polyline.decode(encoded, 6) as LatLng[]
}

export function serializeProject(project: Project): StoredProject {
  const lines: StoredProject['lines'] = {}
  for (const [id, line] of Object.entries(project.lines)) {
    lines[id] = {
      ...line,
      segments: line.segments.map((segment) => ({
        ...segment,
        geometry: encodeGeometry(segment.geometry),
      })),
    }
  }
  return { ...project, lines }
}

export function deserializeProject(stored: StoredProject): Project {
  const lines: Project['lines'] = {}
  for (const [id, line] of Object.entries(stored.lines)) {
    lines[id] = {
      ...line,
      segments: line.segments.map((segment) => ({
        ...segment,
        geometry: decodeGeometry(segment.geometry),
      })),
    }
  }
  return { ...stored, lines }
}
