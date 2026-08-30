import polyline from '@mapbox/polyline'
import { decodeGeometry, encodeGeometry } from './serialize'
import type { LatLng } from '../types'

export const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving'

/** Parallel requests against the public OSRM demo server. */
const CONCURRENCY = 4
const RETRIES = 2

export interface RouteResult {
  geometry: LatLng[]
  distanceM: number
  durationS: number
}

interface OsrmRoute {
  geometry: string
  distance: number
  duration: number
}

interface OsrmResponse {
  code: string
  routes?: OsrmRoute[]
  message?: string
}

/**
 * Cache key of a road leg. Coordinates are rounded to ~1 m so that a stop
 * nudged by a pixel still hits the cache, and both directions are kept
 * separately because one-way streets make them differ.
 */
export function routeKey(from: LatLng, to: LatLng): string {
  const round = (value: number) => value.toFixed(5)
  return `${round(from[0])},${round(from[1])};${round(to[0])},${round(to[1])}`
}

/**
 * OSRM snaps the stops to the nearest street, so the route can start and end
 * a few metres away from them. Straight stubs tie the drawn leg back to the
 * stops themselves.
 */
export function withEndpoints(
  geometry: LatLng[],
  from: LatLng,
  to: LatLng,
): LatLng[] {
  const same = (a: LatLng, b: LatLng) =>
    Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6
  const first = geometry[0]
  const last = geometry[geometry.length - 1]
  return [
    ...(first && same(first, from) ? [] : [from]),
    ...geometry,
    ...(last && same(last, to) ? [] : [to]),
  ]
}

export function routeUrl(from: LatLng, to: LatLng): string {
  const coords = `${from[1]},${from[0]};${to[1]},${to[0]}`
  return `${OSRM_URL}/${coords}?overview=full&geometries=polyline6`
}

function isRateLimit(status: number): boolean {
  return status === 429 || status >= 500
}

async function requestRoute(
  from: LatLng,
  to: LatLng,
  signal?: AbortSignal,
): Promise<RouteResult> {
  let lastError = new Error('Routing failed')
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    const response = await fetch(routeUrl(from, to), { signal })
    if (!response.ok) {
      lastError = new Error(`Routing failed (${response.status})`)
      if (!isRateLimit(response.status)) throw lastError
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
      continue
    }
    const body = (await response.json()) as OsrmResponse
    const route = body.routes?.[0]
    if (body.code !== 'Ok' || !route) {
      throw new Error(body.message ?? `Routing failed (${body.code})`)
    }
    return {
      geometry: polyline.decode(route.geometry, 6) as LatLng[],
      distanceM: route.distance,
      durationS: route.duration,
    }
  }
  throw lastError
}

export interface CachedRoute {
  geometry: string
  distanceM: number
  durationS: number
}

export interface RouteCacheBackend {
  load(): Promise<Record<string, CachedRoute> | null>
  save(entries: Record<string, CachedRoute>): Promise<void>
}

/**
 * Routes are cached across sessions (a 500-line network is tens of thousands
 * of legs, and the demo server is rate limited). Geometry is kept encoded so
 * the cache stays roughly an order of magnitude smaller than raw coordinates.
 */
const CACHE_LIMIT = 50000

let cache = new Map<string, CachedRoute>()
let cacheBackend: RouteCacheBackend | null = null
let saveTimer: ReturnType<typeof setTimeout> | undefined

export function setRouteCacheBackend(backend: RouteCacheBackend | null) {
  cacheBackend = backend
}

export async function hydrateRouteCache(): Promise<void> {
  if (!cacheBackend) return
  const entries = await cacheBackend.load()
  if (entries) cache = new Map(Object.entries(entries))
}

export function clearRouteCache(): void {
  cache = new Map()
  clearTimeout(saveTimer)
}

function persistCache() {
  if (!cacheBackend) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void cacheBackend?.save(Object.fromEntries(cache))
  }, 1000)
}

function readCache(key: string): RouteResult | undefined {
  const hit = cache.get(key)
  if (!hit) return undefined
  return {
    geometry: decodeGeometry(hit.geometry),
    distanceM: hit.distanceM,
    durationS: hit.durationS,
  }
}

function writeCache(key: string, result: RouteResult) {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(key, {
    geometry: encodeGeometry(result.geometry),
    distanceM: result.distanceM,
    durationS: result.durationS,
  })
  persistCache()
}

const inFlight = new Map<string, Promise<RouteResult>>()

/** Cached, de-duplicated driving route between two points. */
export async function routeBetween(
  from: LatLng,
  to: LatLng,
  signal?: AbortSignal,
): Promise<RouteResult> {
  const key = routeKey(from, to)
  const cached = readCache(key)
  if (cached) return cached

  const running = inFlight.get(key)
  if (running) return running

  const request = requestRoute(from, to, signal)
    .then((result) => {
      writeCache(key, result)
      return result
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, request)
  return request
}

/** Run tasks a few at a time so the demo server is not flooded. */
export async function mapWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit = CONCURRENCY,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length)
  let next = 0
  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    async () => {
      while (next < tasks.length) {
        const index = next
        next += 1
        try {
          results[index] = { status: 'fulfilled', value: await tasks[index]() }
        } catch (reason) {
          results[index] = { status: 'rejected', reason }
        }
      }
    },
  )
  await Promise.all(workers)
  return results
}
