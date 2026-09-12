import { distanceM } from './nodes'
import type { LatLng } from '../types'

/**
 * Rail routing over the OpenStreetMap tracks OpenRailwayMap renders. There is
 * no public A-to-B service for rails (OpenRailwayMap's API only answers
 * facility questions, and the rail routers that do exist honour track
 * direction, which sends a tram leg around the whole loop), so the tracks are
 * fetched from Overpass and the path is searched here.
 */
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

/** Track kinds a line may run on; every kind is routable by default. */
export const RAIL_TYPES = [
  'rail',
  'light_rail',
  'subway',
  'tram',
  'narrow_gauge',
  'funicular',
  'monorail',
] as const

/** How far from a stop a track may be and still be used as its entry point. */
const SNAP_RADIUS_M = 300
const MIN_PADDING_M = 500
const PADDING_RATIO = 0.4
/** Tracks are cached per grid tile, roughly 2 km at the equator. */
const TILE_DEG = 0.02
const RETRIES = 2

export interface RailRoute {
  geometry: LatLng[]
  distanceM: number
}

export interface Bounds {
  south: number
  west: number
  north: number
  east: number
}

interface RailWay {
  id: number
  geometry: LatLng[]
}

interface OverpassWay {
  id: number
  geometry?: { lat: number; lon: number }[]
}

interface OverpassResponse {
  elements?: OverpassWay[]
}

export function boundsAround(from: LatLng, to: LatLng, paddingM: number): Bounds {
  const latPad = paddingM / 111320
  const lngPad =
    paddingM /
    (111320 * Math.max(0.1, Math.cos(((from[0] + to[0]) / 2) * (Math.PI / 180))))
  return {
    south: Math.min(from[0], to[0]) - latPad,
    west: Math.min(from[1], to[1]) - lngPad,
    north: Math.max(from[0], to[0]) + latPad,
    east: Math.max(from[1], to[1]) + lngPad,
  }
}

export function overpassQuery(bounds: Bounds): string {
  const box = [bounds.south, bounds.west, bounds.north, bounds.east]
    .map((value) => value.toFixed(6))
    .join(',')
  return `[out:json][timeout:60];way(${box})[railway~"^(${RAIL_TYPES.join('|')})$"];out geom;`
}

async function fetchWays(
  bounds: Bounds,
  signal?: AbortSignal,
): Promise<RailWay[]> {
  let lastError = new Error('Fetching the rail tracks failed')
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    const response = await fetch(OVERPASS_URL, {
      method: 'POST',
      body: new URLSearchParams({ data: overpassQuery(bounds) }),
      signal,
    })
    if (!response.ok) {
      lastError = new Error(`Fetching the rail tracks failed (${response.status})`)
      // Overpass answers 429/504 when it is busy; backing off is expected use.
      if (response.status !== 429 && response.status < 500) throw lastError
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)))
      continue
    }
    const body = (await response.json()) as OverpassResponse
    return (body.elements ?? [])
      .filter((element) => element.geometry && element.geometry.length > 1)
      .map((element) => ({
        id: element.id,
        geometry: element.geometry!.map(
          (point) => [point.lat, point.lon] as LatLng,
        ),
      }))
  }
  throw lastError
}

const tiles = new Map<string, RailWay[]>()

export function clearRailCache(): void {
  tiles.clear()
}

function tileKeys(bounds: Bounds): string[] {
  const keys: string[] = []
  const first = Math.floor(bounds.south / TILE_DEG)
  const last = Math.floor(bounds.north / TILE_DEG)
  const left = Math.floor(bounds.west / TILE_DEG)
  const right = Math.floor(bounds.east / TILE_DEG)
  for (let row = first; row <= last; row += 1) {
    for (let column = left; column <= right; column += 1) {
      keys.push(`${row}:${column}`)
    }
  }
  return keys
}

/**
 * Tracks covering `bounds`, fetched at most once per tile: the legs of a line
 * overlap heavily, so a whole branch normally costs a single Overpass query.
 */
async function railWays(
  bounds: Bounds,
  signal?: AbortSignal,
): Promise<RailWay[]> {
  const keys = tileKeys(bounds)
  const missing = keys.filter((key) => !tiles.has(key))
  if (missing.length > 0) {
    const rows = missing.map((key) => Number(key.split(':')[0]))
    const columns = missing.map((key) => Number(key.split(':')[1]))
    const fetched = await fetchWays(
      {
        south: Math.min(...rows) * TILE_DEG,
        west: Math.min(...columns) * TILE_DEG,
        north: (Math.max(...rows) + 1) * TILE_DEG,
        east: (Math.max(...columns) + 1) * TILE_DEG,
      },
      signal,
    )
    for (const key of missing) tiles.set(key, fetched)
  }
  const ways = new Map<number, RailWay>()
  for (const key of keys) {
    for (const way of tiles.get(key) ?? []) ways.set(way.id, way)
  }
  return [...ways.values()]
}

/**
 * Track network as an undirected graph. Junctions and switches are the points
 * two ways share, and Overpass reports a shared node with identical
 * coordinates in both ways, so the coordinate is the node identity.
 *
 * Edges are undirected on purpose: a city network maps the two directions of
 * a corridor as separate one-way tracks, and honouring that would send a leg
 * on a full loop just because the stop snapped to the opposite track.
 */
export interface RailGraph {
  points: Map<string, LatLng>
  edges: Map<string, { to: string; cost: number }[]>
}

function pointKey(point: LatLng): string {
  return `${point[0].toFixed(7)},${point[1].toFixed(7)}`
}

export function buildGraph(ways: { geometry: LatLng[] }[]): RailGraph {
  const points = new Map<string, LatLng>()
  const edges = new Map<string, { to: string; cost: number }[]>()
  const link = (from: string, to: string, cost: number) => {
    const list = edges.get(from)
    if (list) list.push({ to, cost })
    else edges.set(from, [{ to, cost }])
  }
  for (const way of ways) {
    for (let index = 1; index < way.geometry.length; index += 1) {
      const a = way.geometry[index - 1]
      const b = way.geometry[index]
      const keyA = pointKey(a)
      const keyB = pointKey(b)
      if (keyA === keyB) continue
      points.set(keyA, a)
      points.set(keyB, b)
      const cost = distanceM(a, b)
      link(keyA, keyB, cost)
      link(keyB, keyA, cost)
    }
  }
  return { points, edges }
}

export function snapToGraph(
  graph: RailGraph,
  point: LatLng,
  radiusM = SNAP_RADIUS_M,
): string | null {
  let best: string | null = null
  let bestDistance = radiusM
  for (const [key, candidate] of graph.points) {
    const distance = distanceM(point, candidate)
    if (distance > bestDistance) continue
    best = key
    bestDistance = distance
  }
  return best
}

/** Binary heap keyed by the A* score; a network tile holds tens of thousands
 * of points, where scanning for the cheapest one would dominate the search. */
class Queue {
  private items: { key: string; score: number }[] = []

  push(key: string, score: number) {
    this.items.push({ key, score })
    let index = this.items.length - 1
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (this.items[parent].score <= this.items[index].score) break
      ;[this.items[parent], this.items[index]] = [
        this.items[index],
        this.items[parent],
      ]
      index = parent
    }
  }

  pop(): string | undefined {
    const top = this.items[0]
    const last = this.items.pop()
    if (last && this.items.length > 0) {
      this.items[0] = last
      let index = 0
      for (;;) {
        const left = index * 2 + 1
        const right = left + 1
        let smallest = index
        if (
          left < this.items.length &&
          this.items[left].score < this.items[smallest].score
        )
          smallest = left
        if (
          right < this.items.length &&
          this.items[right].score < this.items[smallest].score
        )
          smallest = right
        if (smallest === index) break
        ;[this.items[smallest], this.items[index]] = [
          this.items[index],
          this.items[smallest],
        ]
        index = smallest
      }
    }
    return top?.key
  }

  get size(): number {
    return this.items.length
  }
}

export function shortestPath(
  graph: RailGraph,
  startKey: string,
  goalKey: string,
): LatLng[] | null {
  if (startKey === goalKey) {
    const point = graph.points.get(startKey)
    return point ? [point] : null
  }
  const goal = graph.points.get(goalKey)
  if (!goal) return null

  const best = new Map<string, number>([[startKey, 0]])
  const cameFrom = new Map<string, string>()
  const settled = new Set<string>()
  const queue = new Queue()
  queue.push(startKey, 0)

  while (queue.size > 0) {
    const current = queue.pop()
    if (current === undefined || settled.has(current)) continue
    if (current === goalKey) break
    settled.add(current)
    const currentCost = best.get(current) ?? Infinity
    for (const edge of graph.edges.get(current) ?? []) {
      const cost = currentCost + edge.cost
      if (cost >= (best.get(edge.to) ?? Infinity)) continue
      best.set(edge.to, cost)
      cameFrom.set(edge.to, current)
      const point = graph.points.get(edge.to)
      queue.push(edge.to, cost + (point ? distanceM(point, goal) : 0))
    }
  }

  if (!best.has(goalKey)) return null
  const path: LatLng[] = []
  for (let key: string | undefined = goalKey; key; key = cameFrom.get(key)) {
    const point = graph.points.get(key)
    if (point) path.unshift(point)
    if (key === startKey) break
  }
  return path
}

export function pathLengthM(path: LatLng[]): number {
  let total = 0
  for (let index = 1; index < path.length; index += 1) {
    total += distanceM(path[index - 1], path[index])
  }
  return total
}

/**
 * Rail route between two stops. The search area starts around the two stops
 * and is widened once, because a track can leave the straight corridor before
 * coming back (a loop around a hill, a station approach).
 */
export async function railRoute(
  from: LatLng,
  to: LatLng,
  signal?: AbortSignal,
): Promise<RailRoute> {
  const base = Math.max(MIN_PADDING_M, distanceM(from, to) * PADDING_RATIO)
  let missingTrack = false
  for (const padding of [base, base * 3]) {
    const ways = await railWays(boundsAround(from, to, padding), signal)
    const graph = buildGraph(ways)
    const start = snapToGraph(graph, from)
    const goal = snapToGraph(graph, to)
    if (!start || !goal) {
      missingTrack = true
      continue
    }
    const path = shortestPath(graph, start, goal)
    if (path) return { geometry: path, distanceM: pathLengthM(path) }
  }
  throw new Error(
    missingTrack
      ? 'No rail track near this stop'
      : 'No rail route between these stops',
  )
}
