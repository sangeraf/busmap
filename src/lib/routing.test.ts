import polyline from '@mapbox/polyline'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearRouteCache,
  mapWithConcurrency,
  routeBetween,
  routeKey,
  routeUrl,
  setRouteCacheBackend,
  withEndpoints,
} from './routing'
import { RAIL_ROUTER_URL, clearRailCache } from './rail'
import type { LatLng } from '../types'

const A: LatLng = [47.5, 19.0]
const B: LatLng = [47.51, 19.02]

function osrmResponse(geometry: LatLng[]) {
  return {
    ok: true,
    json: async () => ({
      code: 'Ok',
      routes: [
        {
          geometry: polyline.encode(geometry, 6),
          distance: 1234.5,
          duration: 210,
        },
      ],
    }),
  }
}

afterEach(() => {
  clearRouteCache()
  clearRailCache()
  setRouteCacheBackend(null)
  vi.unstubAllGlobals()
})

describe('routing', () => {
  it('asks OSRM for a driving route in lng,lat order', () => {
    expect(routeUrl(A, B)).toBe(
      'https://router.project-osrm.org/route/v1/driving/19,47.5;19.02,47.51?overview=full&geometries=polyline6',
    )
  })

  it('hands a pending rail refinement to later legs that hit the cache', async () => {
    const track: LatLng[] = [A, [47.505, 19.01], B]
    let release: () => void = () => undefined
    const tracksReady = new Promise<void>((resolve) => (release = resolve))
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith(RAIL_ROUTER_URL)) {
          return {
            ok: true,
            json: async () => ({
              features: [
                {
                  properties: { 'track-length': '2500' },
                  geometry: { coordinates: [A, B].map(([lat, lng]) => [lng, lat]) },
                },
              ],
            }),
          }
        }
        await tracksReady
        return {
          ok: true,
          json: async () => ({
            elements: [
              { type: 'way', id: 1, geometry: track.map(([lat, lon]) => ({ lat, lon })) },
            ],
          }),
        }
      }),
    )
    const first = await routeBetween(A, B, 'rail')
    const second = await routeBetween(A, B, 'rail')
    expect(second.distanceM).toBe(2500)
    expect(second.refined).toBeDefined()
    release()
    expect((await second.refined)!.geometry).toEqual(track)
    await first.refined
    const later = await routeBetween(A, B, 'rail')
    expect(later.geometry).toEqual(track)
    expect(later.refined).toBeUndefined()
  })

  it('keys both directions separately', () => {
    expect(routeKey(A, B)).not.toBe(routeKey(B, A))
    expect(routeKey(A, [47.500001, 19.0])).toBe(routeKey(A, A))
  })

  it('decodes the route and serves repeats from the cache', async () => {
    const geometry: LatLng[] = [A, [47.505, 19.01], B]
    const fetchMock = vi.fn(async () => osrmResponse(geometry))
    vi.stubGlobal('fetch', fetchMock)

    const first = await routeBetween(A, B)
    expect(first.distanceM).toBe(1234.5)
    expect(first.durationS).toBe(210)
    expect(first.geometry).toHaveLength(3)
    expect(first.geometry[2][0]).toBeCloseTo(B[0], 5)

    const second = await routeBetween(A, B)
    expect(second.geometry).toEqual(first.geometry)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('ties a snapped route back to the stops', () => {
    const snapped: LatLng[] = [
      [47.5001, 19.0002],
      [47.51, 19.0201],
    ]
    expect(withEndpoints(snapped, A, B)).toEqual([A, ...snapped, B])
    expect(withEndpoints([A, ...snapped, B], A, B)).toEqual([A, ...snapped, B])
  })

  it('reports a routing failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ code: 'NoRoute', message: 'no route' }),
      })),
    )
    await expect(routeBetween(A, B)).rejects.toThrow('no route')
  })

  it('runs tasks with a concurrency cap and keeps failures', async () => {
    let running = 0
    let peak = 0
    const task = (fail: boolean) => async () => {
      running += 1
      peak = Math.max(peak, running)
      await Promise.resolve()
      running -= 1
      if (fail) throw new Error('nope')
      return 1
    }

    const results = await mapWithConcurrency(
      [task(false), task(true), task(false), task(false), task(false)],
      2,
    )
    expect(peak).toBeLessThanOrEqual(2)
    expect(results.map((item) => item.status)).toEqual([
      'fulfilled',
      'rejected',
      'fulfilled',
      'fulfilled',
      'fulfilled',
    ])
  })
})
