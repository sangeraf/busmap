import { z } from 'zod'
import { createId } from './id'
import { decodeGeometry, encodeGeometry } from './serialize'
import { DEFAULT_CENTER, DEFAULT_ZOOM } from './project'
import { SCHEMA_VERSION } from '../types'
import type {
  LatLng,
  Line,
  LineType,
  MapNode,
  NodeId,
  Project,
  Segment,
  TypeId,
} from '../types'

const latLng = z.tuple([z.number(), z.number()])

/** Geometry may arrive as an encoded polyline or as raw coordinate pairs. */
const geometry = z.union([z.string(), z.array(latLng)])

const nodeSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(['stop', 'waypoint']).default('stop'),
  name: z.string().default(''),
  info: z.string().optional(),
  color: z.string().default('#2563eb'),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  notes: z.string().optional(),
  createdAt: z.string().optional(),
})

const segmentSchema = z.object({
  id: z.string().optional(),
  from: z.string(),
  to: z.string(),
  mode: z.enum(['straight', 'road']).default('straight'),
  geometry: geometry.optional(),
  distanceM: z.number().optional(),
  durationS: z.number().optional(),
  groupId: z.string().optional(),
  stale: z.boolean().optional(),
})

const lineSchema = z.object({
  id: z.string().optional(),
  name: z.string().default(''),
  description: z.string().default(''),
  color: z.string().default('#dc2626'),
  typeId: z.string().nullish(),
  segments: z.array(segmentSchema).default([]),
  groups: z
    .array(z.object({ id: z.string(), label: z.string().default('Branch') }))
    .default([]),
  createdAt: z.string().optional(),
})

const lineTypeSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  color: z.string().optional(),
})

const projectSchema = z.object({
  id: z.string().optional(),
  name: z.string().default('Imported network'),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  center: latLng.default(DEFAULT_CENTER),
  zoom: z.number().default(DEFAULT_ZOOM),
  nodes: z.record(nodeSchema).default({}),
  lines: z.record(lineSchema).default({}),
  lineTypes: z.record(lineTypeSchema).default({}),
})

const fileSchema = z.object({
  schemaVersion: z.number().optional(),
  project: projectSchema,
})

export interface ImportReport {
  project: Project
  warnings: string[]
}

export type ImportResult =
  ({ ok: true } & ImportReport) | { ok: false; errors: string[] }

export function exportProjectJson(project: Project): string {
  const lines: Record<string, unknown> = {}
  for (const [id, line] of Object.entries(project.lines)) {
    lines[id] = {
      ...line,
      segments: line.segments.map((segment) => ({
        ...segment,
        geometry: encodeGeometry(segment.geometry),
      })),
    }
  }
  return JSON.stringify(
    { schemaVersion: SCHEMA_VERSION, project: { ...project, lines } },
    null,
    2,
  )
}

interface GeoFeature {
  type: 'Feature'
  geometry:
    | { type: 'Point'; coordinates: [number, number] }
    | { type: 'LineString'; coordinates: [number, number][] }
  properties: Record<string, string | number | null>
}

/** Stops as points and every connection as a LineString, for QGIS/JOSM. */
export function exportProjectGeoJson(project: Project): string {
  const features: GeoFeature[] = []
  for (const node of Object.values(project.nodes)) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [node.lng, node.lat] },
      properties: {
        id: node.id,
        kind: node.kind,
        name: node.name,
        info: node.info ?? null,
        color: node.color,
        notes: node.notes ?? null,
      },
    })
  }
  for (const line of Object.values(project.lines)) {
    const type = line.typeId ? project.lineTypes[line.typeId] : undefined
    for (const segment of line.segments) {
      const branch = line.groups.find((group) => group.id === segment.groupId)
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: segment.geometry.map(([lat, lng]) => [lng, lat]),
        },
        properties: {
          lineId: line.id,
          line: line.name,
          type: type?.name ?? null,
          branch: branch?.label ?? null,
          color: line.color,
          mode: segment.mode,
          from: project.nodes[segment.from]?.name ?? segment.from,
          to: project.nodes[segment.to]?.name ?? segment.to,
          distanceM: segment.distanceM ?? null,
          durationS: segment.durationS ?? null,
        },
      })
    }
  }
  return JSON.stringify({ type: 'FeatureCollection', features })
}

function straightGeometry(
  from: MapNode | undefined,
  to: MapNode | undefined,
): LatLng[] {
  if (!from || !to) return []
  return [
    [from.lat, from.lng],
    [to.lat, to.lng],
  ]
}

/**
 * Turn a validated file into a project, dropping what cannot be placed on the
 * map (connections to unknown stops, unknown line types) and reporting it.
 */
function buildProject(
  parsed: z.infer<typeof projectSchema>,
  warnings: string[],
): Project {
  const now = new Date().toISOString()
  const nodes: Record<NodeId, MapNode> = {}
  for (const [key, node] of Object.entries(parsed.nodes)) {
    const id = node.id ?? key
    nodes[id] = {
      id,
      kind: node.kind,
      name: node.name || 'Unnamed stop',
      ...(node.info === undefined ? {} : { info: node.info }),
      color: node.color,
      lat: node.lat,
      lng: node.lng,
      ...(node.notes === undefined ? {} : { notes: node.notes }),
      createdAt: node.createdAt ?? now,
    }
  }

  const lineTypes: Record<TypeId, LineType> = {}
  for (const [key, type] of Object.entries(parsed.lineTypes)) {
    const id = type.id ?? key
    lineTypes[id] = {
      id,
      name: type.name,
      ...(type.color === undefined ? {} : { color: type.color }),
    }
  }

  const lines: Record<string, Line> = {}
  for (const [key, line] of Object.entries(parsed.lines)) {
    const id = line.id ?? key
    const groups = line.groups.length
      ? line.groups
      : [{ id: createId('grp'), label: 'Branch 1' }]
    const segments: Segment[] = []
    for (const segment of line.segments) {
      if (!nodes[segment.from] || !nodes[segment.to]) {
        warnings.push(
          `Line "${line.name}": dropped a connection to an unknown stop.`,
        )
        continue
      }
      const groupId =
        segment.groupId && groups.some((group) => group.id === segment.groupId)
          ? segment.groupId
          : groups[0].id
      const decoded =
        typeof segment.geometry === 'string'
          ? decodeGeometry(segment.geometry)
          : segment.geometry
      const geometry =
        decoded && decoded.length >= 2
          ? decoded
          : straightGeometry(nodes[segment.from], nodes[segment.to])
      segments.push({
        id: segment.id ?? createId('seg'),
        from: segment.from,
        to: segment.to,
        mode: segment.mode,
        geometry,
        groupId,
        ...(segment.distanceM === undefined
          ? {}
          : { distanceM: segment.distanceM }),
        ...(segment.durationS === undefined
          ? {}
          : { durationS: segment.durationS }),
        ...(segment.mode === 'road' && geometry.length < 3
          ? { stale: true }
          : {}),
      })
    }
    let typeId = line.typeId ?? null
    if (typeId && !lineTypes[typeId]) {
      warnings.push(`Line "${line.name}": unknown line type was cleared.`)
      typeId = null
    }
    lines[id] = {
      id,
      name: line.name || 'Unnamed line',
      description: line.description,
      color: line.color,
      typeId,
      segments,
      groups,
      createdAt: line.createdAt ?? now,
    }
  }

  return {
    id: parsed.id ?? createId('prj'),
    name: parsed.name,
    createdAt: parsed.createdAt ?? now,
    updatedAt: now,
    center: parsed.center,
    zoom: parsed.zoom,
    nodes,
    lines,
    lineTypes,
  }
}

export function parseProjectFile(text: string): ImportResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, errors: ['The file is not valid JSON.'] }
  }

  /** A bare project is accepted too, so hand-written files also load. */
  const wrapped =
    typeof raw === 'object' && raw !== null && 'project' in raw
      ? raw
      : { schemaVersion: SCHEMA_VERSION, project: raw }
  const parsed = fileSchema.safeParse(wrapped)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues
        .slice(0, 10)
        .map((issue) => `${issue.path.join('.') || 'file'}: ${issue.message}`),
    }
  }

  const { schemaVersion, project } = parsed.data
  if (
    Object.keys(project.nodes).length === 0 &&
    Object.keys(project.lines).length === 0
  ) {
    return { ok: false, errors: ['The file holds no stops and no lines.'] }
  }

  const warnings: string[] = []
  if (schemaVersion !== undefined && schemaVersion > SCHEMA_VERSION) {
    warnings.push(
      `The file was written by a newer version (schema ${schemaVersion}).`,
    )
  }
  return { ok: true, project: buildProject(project, warnings), warnings }
}

/**
 * Fold an imported project into an existing one. Line types are merged by
 * name (case-insensitively) so a project and its export share types instead of
 * collecting duplicates; anything whose id is already taken gets a fresh one.
 */
export function mergeProjects(target: Project, incoming: Project): Project {
  const merged: Project = structuredClone(target)
  const typeIds = new Map<TypeId, TypeId>()
  const byName = new Map<string, TypeId>()
  for (const type of Object.values(merged.lineTypes)) {
    byName.set(type.name.trim().toLowerCase(), type.id)
  }
  for (const type of Object.values(incoming.lineTypes)) {
    const key = type.name.trim().toLowerCase()
    const existing = byName.get(key)
    if (existing) {
      typeIds.set(type.id, existing)
      continue
    }
    const id = merged.lineTypes[type.id] ? createId('typ') : type.id
    merged.lineTypes[id] = { ...type, id }
    byName.set(key, id)
    typeIds.set(type.id, id)
  }

  const nodeIds = new Map<NodeId, NodeId>()
  for (const node of Object.values(incoming.nodes)) {
    const id = merged.nodes[node.id] ? createId('nod') : node.id
    merged.nodes[id] = { ...node, id }
    nodeIds.set(node.id, id)
  }

  for (const line of Object.values(incoming.lines)) {
    const id = merged.lines[line.id] ? createId('lin') : line.id
    const typeId = line.typeId ? (typeIds.get(line.typeId) ?? null) : null
    merged.lines[id] = {
      ...line,
      id,
      typeId,
      segments: line.segments.map((segment) => ({
        ...segment,
        from: nodeIds.get(segment.from) ?? segment.from,
        to: nodeIds.get(segment.to) ?? segment.to,
      })),
    }
  }

  merged.updatedAt = new Date().toISOString()
  return merged
}
