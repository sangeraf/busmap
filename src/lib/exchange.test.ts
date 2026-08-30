import { describe, expect, it } from 'vitest'
import {
  exportProjectGeoJson,
  exportProjectJson,
  mergeProjects,
  parseProjectFile,
} from './exchange'
import { createLine, createLineType, createSegment } from './lines'
import { createNode } from './nodes'
import { createProject } from './project'
import type { Project } from '../types'

function sample(): Project {
  const project = createProject('Budapest')
  const a = createNode('stop', 47.5, 19.0, 1)
  a.info = 'Platform 2'
  const b = createNode('stop', 47.51, 19.02, 2)
  project.nodes[a.id] = a
  project.nodes[b.id] = b

  const type = createLineType('busz')
  project.lineTypes[type.id] = type

  const line = createLine({ name: '7', typeId: type.id })
  const segment = createSegment(a, b, line.groups[0].id, 'road')
  segment.geometry = [
    [47.5, 19.0],
    [47.505, 19.01],
    [47.51, 19.02],
  ]
  segment.distanceM = 2100
  segment.durationS = 300
  line.segments.push(segment)
  project.lines[line.id] = line
  return project
}

describe('project export', () => {
  it('round-trips a project through JSON', () => {
    const project = sample()
    const result = parseProjectFile(exportProjectJson(project))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.warnings).toEqual([])
    expect(Object.keys(result.project.nodes)).toEqual(
      Object.keys(project.nodes),
    )
    const [firstNode, secondNode] = Object.values(result.project.nodes)
    expect(firstNode.info).toBe('Platform 2')
    expect(secondNode.info).toBeUndefined()
    const [line] = Object.values(result.project.lines)
    const original = Object.values(project.lines)[0]
    expect(line.name).toBe('7')
    expect(line.typeId).toBe(original.typeId)
    expect(line.segments[0].mode).toBe('road')
    expect(line.segments[0].distanceM).toBe(2100)
    expect(line.segments[0].geometry).toHaveLength(3)
    expect(line.segments[0].geometry[1][0]).toBeCloseTo(47.505, 5)
  })

  it('writes GeoJSON in lng,lat order', () => {
    const geo = JSON.parse(exportProjectGeoJson(sample()))
    expect(geo.type).toBe('FeatureCollection')
    expect(geo.features).toHaveLength(3)
    const point = geo.features.find(
      (feature: { geometry: { type: string } }) =>
        feature.geometry.type === 'Point',
    )
    expect(point.geometry.coordinates[0]).toBeCloseTo(19.0, 5)
    const lineString = geo.features.find(
      (feature: { geometry: { type: string } }) =>
        feature.geometry.type === 'LineString',
    )
    expect(lineString.geometry.coordinates[0]).toEqual([19.0, 47.5])
    expect(lineString.properties.line).toBe('7')
    expect(lineString.properties.type).toBe('busz')
  })
})

describe('project import', () => {
  it('rejects a file that is not a project', () => {
    expect(parseProjectFile('not json')).toEqual({
      ok: false,
      errors: ['The file is not valid JSON.'],
    })
    const result = parseProjectFile('{"project":{"nodes":{"a":{"lat":"x"}}}}')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('accepts a bare project with raw coordinates and fills the gaps', () => {
    const result = parseProjectFile(
      JSON.stringify({
        name: 'Hand written',
        nodes: {
          a: { lat: 47.5, lng: 19.0, name: 'A' },
          b: { lat: 47.51, lng: 19.02, name: 'B' },
        },
        lines: {
          l1: {
            name: '9',
            typeId: 'missing',
            segments: [
              { from: 'a', to: 'b' },
              { from: 'a', to: 'ghost' },
            ],
          },
        },
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const line = result.project.lines.l1
    expect(line.segments).toHaveLength(1)
    expect(line.segments[0].geometry).toEqual([
      [47.5, 19.0],
      [47.51, 19.02],
    ])
    expect(line.groups).toHaveLength(1)
    expect(line.segments[0].groupId).toBe(line.groups[0].id)
    expect(line.typeId).toBeNull()
    expect(result.warnings).toHaveLength(2)
  })
})

describe('mergeProjects', () => {
  it('merges line types by name and keeps both networks', () => {
    const target = sample()
    const incoming = parseProjectFile(exportProjectJson(sample()))
    expect(incoming.ok).toBe(true)
    if (!incoming.ok) return

    const merged = mergeProjects(target, incoming.project)
    expect(Object.keys(merged.lineTypes)).toHaveLength(1)
    expect(Object.keys(merged.nodes)).toHaveLength(4)
    expect(Object.keys(merged.lines)).toHaveLength(2)

    const [typeId] = Object.keys(merged.lineTypes)
    for (const line of Object.values(merged.lines)) {
      expect(line.typeId).toBe(typeId)
      for (const segment of line.segments) {
        expect(merged.nodes[segment.from]).toBeDefined()
        expect(merged.nodes[segment.to]).toBeDefined()
      }
    }
  })
})
