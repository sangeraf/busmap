import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OVERPASS_URLS,
  RAIL_ROUTER_URL,
  TrackNetwork,
  boundsAround,
  clearRailCache,
  corridorBlocks,
  overpassQuery,
  pathLengthM,
  railRoute,
  searchPath,
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

function overpassBody(ways: LatLng[][]) {
  return {
    elements: ways.map((geometry, index) => ({
      type: 'way',
      id: index + 1,
      geometry: geometry.map(([lat, lon]) => ({ lat, lon })),
    })),
  }
}

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

function network(...ways: LatLng[][]): TrackNetwork {
  const graph = new TrackNetwork()
  graph.addWays(ways.map((geometry, index) => ({ id: index + 1, geometry })))
  return graph
}

function routerBody(geometry: LatLng[], distance: number) {
  return {
    type: 'FeatureCollection',
    features: [
      {
        properties: { 'track-length': String(distance) },
        geometry: {
          type: 'LineString',
          coordinates: geometry.map(([lat, lng]) => [lng, lat, 100]),
        },
      },
    ],
  }
}

type Handler = (url: string) => unknown

/** Fetch stub that answers Overpass and the rail router separately. */
function stubFetch(overpass: Handler, router: Handler = () => ({ ok: false, status: 404 })) {
  const mock = vi.fn(async (url: string) => {
    const result = url.startsWith(RAIL_ROUTER_URL) ? router(url) : overpass(url)
    if (result instanceof Error) throw result
    return result
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

const overpassCalls = (mock: ReturnType<typeof stubFetch>) =>
  mock.mock.calls.filter(([url]) => !url.startsWith(RAIL_ROUTER_URL))

afterEach(() => {
  clearRailCache()
  vi.unstubAllGlobals()
})

describe('rail', () => {
  it('asks Overpass for every track type inside the box', () => {
    const bounds = boundsAround([47.5, 19.0], [47.5, 19.02], 500)
    expect(bounds.south).toBeLessThan(47.5)
    expect(bounds.east).toBeGreaterThan(19.02)

    const query = overpassQuery(bounds)
    expect(query).toContain('way(')
    expect(query).toContain('tram')
    expect(query).toContain('subway')
    expect(query).toContain('narrow_gauge')
    expect(query).toContain('out skel geom')
  })

  it('downloads a band along a long diagonal leg, not its whole box', () => {
    const from: LatLng = [47.2, 18.6]
    const to: LatLng = [47.7, 19.4]
    const band = corridorBlocks(from, to, 2000)
    const box = corridorBlocks(from, to, 200000)
    expect(band.length).toBeGreaterThan(0)
    expect(band.length).toBeLessThan(box.length / 2)
  })

  it('joins ways that share a point into one graph', () => {
    const graph = network(NORTH, SOUTH)
    expect(graph.size).toBe(4)
    const [start] = graph.near([47.5, 19.0], 300)
    expect(graph.links[start.id]).toHaveLength(2)
  })

  it('ignores track direction so the short way is taken', async () => {
    const graph = network(NORTH, SOUTH)
    const result = await searchPath(graph, [47.5, 19.0201], [47.5, 19.0001])
    expect(result.path).toHaveLength(3)
    expect(result.path![1]).toEqual([47.5, 19.01])
  })

  it('reports a stop that is nowhere near a track', async () => {
    const graph = network(NORTH)
    const result = await searchPath(graph, [47.6, 19.0], [47.5, 19.02])
    expect(result).toEqual({ path: null, reason: 'no-track' })
  })

  it('finds the main track when the nearest one is a detached siding', async () => {
    const siding: LatLng[] = [
      [47.5003, 18.9995],
      [47.5003, 19.0005],
    ]
    const graph = network(NORTH, siding)
    const result = await searchPath(graph, [47.5004, 19.0], [47.5, 19.02])
    expect(result.path?.at(-1)).toEqual([47.5, 19.02])
  })

  it('steps over a small mapping gap only when asked to', async () => {
    const before: LatLng[] = [
      [47.5, 19.0],
      [47.5, 19.01],
    ]
    const after: LatLng[] = [
      [47.5, 19.01008],
      [47.5, 19.02],
    ]
    const graph = network(before, after)
    const strict = await searchPath(graph, [47.5, 19.0], [47.5, 19.02])
    expect(strict).toEqual({ path: null, reason: 'no-route' })
    const bridged = await searchPath(graph, [47.5, 19.0], [47.5, 19.02], {
      bridges: true,
    })
    expect(bridged.path).toHaveLength(4)
  })

  it('routes over the fetched tracks and reuses them for the next leg', async () => {
    const mock = stubFetch(() => ok(overpassBody([NORTH, SOUTH])))
    const progress: string[] = []

    const route = await railRoute([47.5, 19.0], [47.5, 19.02], {
      onProgress: (message) => progress.push(message),
    })
    expect(route.geometry[0]).toEqual([47.5, 19.0])
    expect(route.geometry.at(-1)).toEqual([47.5, 19.02])
    expect(route.distanceM).toBeCloseTo(pathLengthM(NORTH), 0)
    expect(progress[0]).toContain('Downloading rail tracks')

    await railRoute([47.5, 19.01], [47.5, 19.02])
    expect(overpassCalls(mock)).toHaveLength(1)
  })

  it('downloads shared tracks once for legs routed at the same time', async () => {
    const mock = stubFetch(() => ok(overpassBody([NORTH, SOUTH])))
    await Promise.all([
      railRoute([47.5, 19.0], [47.5, 19.01]),
      railRoute([47.5, 19.01], [47.5, 19.02]),
      railRoute([47.5, 19.0], [47.5, 19.02]),
    ])
    expect(overpassCalls(mock)).toHaveLength(1)
  })

  it('moves on to another server when one times out or is busy', async () => {
    const mock = stubFetch((url) =>
      url === OVERPASS_URLS[0]
        ? new DOMException('slow', 'TimeoutError')
        : url === OVERPASS_URLS[1]
          ? ok({ elements: [], remark: 'runtime error: Query timed out' })
          : ok(overpassBody([NORTH, SOUTH])),
    )
    const progress: string[] = []
    const route = await railRoute([47.5, 19.0], [47.5, 19.02], {
      onProgress: (message) => progress.push(message),
    })
    expect(route.geometry.at(-1)).toEqual([47.5, 19.02])
    expect(progress.some((message) => message.includes('timed out'))).toBe(true)

    // The servers that failed are skipped for the next area.
    const before = overpassCalls(mock).length
    await railRoute([47.5, 19.3], [47.5, 19.32]).catch(() => undefined)
    const later = overpassCalls(mock).slice(before).map(([url]) => url)
    expect(later.length).toBeGreaterThan(0)
    expect(later).not.toContain(OVERPASS_URLS[0])
    expect(later).not.toContain(OVERPASS_URLS[1])
  })

  it('falls back to the rail router when no track server answers', async () => {
    const mock = stubFetch(
      () => ({ ok: false, status: 504 }),
      () => ok(routerBody(NORTH, 1600)),
    )
    const route = await railRoute([47.5, 19.0], [47.5, 19.02])
    expect(route.distanceM).toBe(1600)
    expect(route.geometry).toEqual(NORTH)
    const [routerUrl] = mock.mock.calls.find(([url]) =>
      url.startsWith(RAIL_ROUTER_URL),
    )!
    expect(routerUrl).toContain('lonlats=19,47.5|19.02,47.5')
    expect(routerUrl).toContain('profile=rail')
  })

  it('rejects a rail route that snapped far away from the stops', async () => {
    stubFetch(
      () => ({ ok: false, status: 504 }),
      () =>
        ok(
          routerBody(
            [
              [47.52, 19.0],
              [47.52, 19.02],
            ],
            1600,
          ),
        ),
    )
    await expect(railRoute([47.5, 19.0], [47.5, 19.02])).rejects.toThrow(
      /the rail router found no route/,
    )
  })

  it('uses the rail router while the track servers are still busy', async () => {
    stubFetch(
      () => new Promise(() => undefined),
      () => ok(routerBody(NORTH, 1600)),
    )
    const route = await railRoute([47.5, 19.0], [47.5, 19.02])
    expect(route.distanceM).toBe(1600)
    expect(route.geometry.at(-1)).toEqual([47.5, 19.02])
  })

  it('gives up soon when the router finds no track and the servers hang', async () => {
    vi.useFakeTimers()
    try {
      stubFetch(
        () => new Promise(() => undefined),
        () =>
          ok(
            routerBody(
              [
                [47.52, 19.0],
                [47.52, 19.02],
              ],
              1600,
            ),
          ),
      )
      const result = railRoute([47.5, 19.0], [47.5, 19.02]).catch(
        (error: Error) => error,
      )
      await vi.advanceTimersByTimeAsync(10_000)
      expect(String(await result)).toContain('No rail track near this stop')
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a rail router detour and reports why the tracks failed', async () => {
    stubFetch(
      () => new TypeError('Failed to fetch'),
      () => ok(routerBody(NORTH, 50000)),
    )
    await expect(railRoute([47.5, 19.0], [47.5, 19.02])).rejects.toThrow(
      /Rail tracks could not be downloaded \(overpass-api\.de unreachable/,
    )
  })

  it('reports a stop with no track nearby', async () => {
    stubFetch(() => ok(overpassBody([NORTH])))
    await expect(railRoute([47.6, 19.0], [47.5, 19.02])).rejects.toThrow(
      'No rail track near this stop',
    )
  })

  it('reports tracks that are not connected to each other', async () => {
    const detached: LatLng[] = [
      [47.5, 19.05],
      [47.5, 19.06],
    ]
    stubFetch(() => ok(overpassBody([NORTH, detached])))
    await expect(railRoute([47.5, 19.0], [47.5, 19.06])).rejects.toThrow(
      'No rail route between these stops',
    )
  })

  it('stops when the routing is cancelled', async () => {
    stubFetch(() => ok(overpassBody([NORTH, SOUTH])))
    const abort = new AbortController()
    abort.abort()
    await expect(
      railRoute([47.5, 19.0], [47.5, 19.02], { signal: abort.signal }),
    ).rejects.toThrow()
  })
})
