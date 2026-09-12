import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  boundsAround,
  buildGraph,
  clearRailCache,
  overpassQuery,
  pathLengthM,
  railRoute,
  shortestPath,
  snapToGraph,
} from './rail'
import type { LatLng } from '../types'

/**
 * Two parallel one-way tracks joined at both ends, as a city corridor is
 * mapped: A -> B -> C on one side, C -> D -> A on the other.
 */
const NORTH: LatLng[] = [
  [47.5, 19.0],
  [47.5, 19.01],
  [47.5, 19.02],
]
const SOUTH: LatLng[] = [
  [47.5, 19.02],
  [47.499, 19.01],
  [47.5, 19.0],
]

function overpassResponse(ways: LatLng[][]) {
  return {
    ok: true,
    json: async () => ({
      elements: ways.map((geometry, index) => ({
        type: 'way',
        id: index + 1,
        geometry: geometry.map(([lat, lon]) => ({ lat, lon })),
      })),
    }),
  }
}

afterEach(() => {
  clearRailCache()
  vi.unstubAllGlobals()
})

describe('rail', () => {
  it('asks Overpass for every track type inside the padded box', () => {
    const bounds = boundsAround([47.5, 19.0], [47.5, 19.02], 500)
    expect(bounds.south).toBeLessThan(47.5)
    expect(bounds.east).toBeGreaterThan(19.02)

    const query = overpassQuery(bounds)
    expect(query).toContain('way(')
    expect(query).toContain('tram')
    expect(query).toContain('subway')
    expect(query).toContain('narrow_gauge')
  })

  it('joins ways that share a point into one graph', () => {
    const graph = buildGraph([{ geometry: NORTH }, { geometry: SOUTH }])
    expect(graph.points.size).toBe(4)
    const start = snapToGraph(graph, [47.5, 19.0])
    expect(start).not.toBeNull()
    expect(graph.edges.get(start!)).toHaveLength(2)
  })

  it('ignores track direction so the short way is taken', () => {
    const graph = buildGraph([{ geometry: NORTH }, { geometry: SOUTH }])
    const start = snapToGraph(graph, [47.5, 19.0201])!
    const goal = snapToGraph(graph, [47.5, 19.0001])!
    const path = shortestPath(graph, start, goal)!
    expect(path).toHaveLength(3)
    expect(path[1]).toEqual([47.5, 19.01])
  })

  it('leaves a stop that is nowhere near a track unsnapped', () => {
    const graph = buildGraph([{ geometry: NORTH }])
    expect(snapToGraph(graph, [47.6, 19.0])).toBeNull()
  })

  it('routes over the fetched tracks and reuses them for the next leg', async () => {
    const fetchMock = vi.fn(async () => overpassResponse([NORTH, SOUTH]))
    vi.stubGlobal('fetch', fetchMock)

    const route = await railRoute([47.5, 19.0], [47.5, 19.02])
    expect(route.geometry[0]).toEqual([47.5, 19.0])
    expect(route.geometry.at(-1)).toEqual([47.5, 19.02])
    expect(route.distanceM).toBeCloseTo(pathLengthM(NORTH), 0)

    await railRoute([47.5, 19.01], [47.5, 19.02])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports a stop with no track nearby', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => overpassResponse([NORTH])),
    )
    await expect(railRoute([47.6, 19.0], [47.5, 19.02])).rejects.toThrow(
      'No rail track near this stop',
    )
  })

  it('reports tracks that are not connected to each other', async () => {
    const detached: LatLng[] = [
      [47.5, 19.05],
      [47.5, 19.06],
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => overpassResponse([NORTH, detached])),
    )
    await expect(railRoute([47.5, 19.0], [47.5, 19.06])).rejects.toThrow(
      'No rail route between these stops',
    )
  })

  it('fails when Overpass keeps rejecting the query', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 400 })),
    )
    await expect(railRoute([47.5, 19.0], [47.5, 19.02])).rejects.toThrow(
      'Fetching the rail tracks failed (400)',
    )
  })
})
