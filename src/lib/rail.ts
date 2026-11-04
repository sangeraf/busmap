import polyline from '@mapbox/polyline'
import { distanceM } from './nodes'
import type { LatLng } from '../types'

/**
 * Rail routing over the OpenStreetMap tracks OpenRailwayMap renders. The
 * tracks are fetched from Overpass and the path is searched here, because the
 * public rail routers honour track direction, which sends a tram leg around
 * the whole loop. That router is still the fallback when Overpass is down or
 * the downloaded tracks do not connect the two stops.
 */
export const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

export const RAIL_ROUTER_URL = 'https://signal.eu.org/osm/eu/route/v1/train'

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
/** Walking to a farther track point costs this much more than riding to it. */
const SNAP_PENALTY = 3
/** Tracks are downloaded and cached in blocks of roughly 5.5 x 3.7 km. */
const BLOCK_DEG = 0.05
const BLOCKS_PER_QUERY = 6
/** Overpass gives each client two slots; more requests only queue there. */
const OVERPASS_SLOTS = 2
const OVERPASS_TIMEOUT_S = 25
const REQUEST_TIMEOUT_MS = (OVERPASS_TIMEOUT_S + 5) * 1000
const ROUTER_TIMEOUT_MS = 15_000
/** A server that failed is skipped for a while instead of timing out again. */
const COOLDOWN_MS = 3 * 60_000
/** Dangling track ends this close are joined when nothing else connects. */
const BRIDGE_RADIUS_M = 15
const GRID_DEG = 0.003
const MAX_EXPANSIONS = 2_000_000
const YIELD_EVERY = 20_000
const M_PER_DEG = 111320

export type RailProgress = (message: string) => void

export interface RailOptions {
  signal?: AbortSignal
  onProgress?: RailProgress
}

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

export interface RailWay {
  id: number
  geometry: LatLng[]
}

interface OverpassWay {
  id: number
  geometry?: { lat: number; lon: number }[]
}

interface OverpassResponse {
  elements?: OverpassWay[]
  remark?: string
}

interface RouterResponse {
  code: string
  routes?: { geometry: string; distance: number }[]
  waypoints?: { distance: number }[]
}

/** Errors that another Overpass server would answer the same way. */
class QueryError extends Error {}

function lngScale(lat: number): number {
  return Math.max(0.1, Math.cos(lat * (Math.PI / 180)))
}

export function boundsAround(from: LatLng, to: LatLng, paddingM: number): Bounds {
  const latPad = paddingM / M_PER_DEG
  const lngPad = paddingM / (M_PER_DEG * lngScale((from[0] + to[0]) / 2))
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
  return `[out:json][timeout:${OVERPASS_TIMEOUT_S}];way(${box})[railway~"^(${RAIL_TYPES.join('|')})$"];out skel geom qt;`
}

/**
 * A signal that aborts with a `TimeoutError` after `ms`, or when `signal`
 * aborts. Built by hand because `AbortSignal.any` is missing in older Safari.
 */
export function withTimeout(ms: number, signal?: AbortSignal): AbortSignal {
  const controller = new AbortController()
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException('The request timed out', 'TimeoutError'),
      ),
    ms,
  )
  const forward = () => {
    clearTimeout(timer)
    controller.abort(signal?.reason)
  }
  if (signal?.aborted) forward()
  else signal?.addEventListener('abort', forward, { once: true })
  return controller.signal
}

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError'
}

const cooldownUntil = new Map<string, number>()
let preferredServer = 0

function hostOf(url: string): string {
  return new URL(url).host
}

/** Servers to try, the last one that answered first. */
function serverOrder(): string[] {
  const now = Date.now()
  return OVERPASS_URLS.map(
    (_, index) => OVERPASS_URLS[(preferredServer + index) % OVERPASS_URLS.length],
  ).filter((url) => (cooldownUntil.get(url) ?? 0) <= now)
}

let busySlots = 0
const slotQueue: (() => void)[] = []

async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (busySlots < OVERPASS_SLOTS) busySlots += 1
  else await new Promise<void>((resolve) => slotQueue.push(resolve))
  try {
    return await task()
  } finally {
    const next = slotQueue.shift()
    if (next) next()
    else busySlots -= 1
  }
}

/**
 * Tracks inside `bounds`. Every request has a deadline, and a server that is
 * busy, down or too slow is put aside so the next one is asked right away.
 */
async function fetchWays(
  bounds: Bounds,
  label: string,
  { signal, onProgress }: RailOptions,
): Promise<RailWay[]> {
  const body = new URLSearchParams({ data: overpassQuery(bounds) })
  const failures: string[] = []
  for (const url of serverOrder()) {
    signal?.throwIfAborted()
    const host = hostOf(url)
    onProgress?.(`Downloading rail tracks${label} from ${host}…`)
    try {
      const response = await fetch(url, {
        method: 'POST',
        body,
        signal: withTimeout(REQUEST_TIMEOUT_MS, signal),
      })
      if (response.status === 400) {
        throw new QueryError('Fetching the rail tracks failed (400)')
      }
      if (!response.ok) throw new Error(`answered ${response.status}`)
      const data = (await response.json()) as OverpassResponse
      // A busy server answers 200 with a runtime error and no tracks.
      if (data.remark?.includes('runtime error')) throw new Error('timed out')
      preferredServer = OVERPASS_URLS.indexOf(url)
      return (data.elements ?? [])
        .filter((element) => element.geometry && element.geometry.length > 1)
        .map((element) => ({
          id: element.id,
          geometry: element.geometry!.map(
            (point) => [point.lat, point.lon] as LatLng,
          ),
        }))
    } catch (error) {
      if (signal?.aborted || error instanceof QueryError) throw error
      const reason = isTimeout(error)
        ? 'timed out'
        : error instanceof Error && error.message.startsWith('answered')
          ? error.message
          : error instanceof Error && error.message === 'timed out'
            ? 'timed out'
            : 'unreachable'
      failures.push(`${host} ${reason}`)
      cooldownUntil.set(url, Date.now() + COOLDOWN_MS)
      if (serverOrder().length > 0) {
        onProgress?.(`${host} ${reason}, trying another track server…`)
      }
    }
  }
  throw new Error(
    failures.length > 0
      ? `Rail tracks could not be downloaded (${failures.join(', ')})`
      : 'Every rail track server failed recently; retry in a few minutes',
  )
}

interface Block {
  row: number
  col: number
}

function blockKey({ row, col }: Block): number {
  return (row + 2000) * 10000 + (col + 4000)
}

function blockOf(lat: number, lng: number): number {
  return blockKey({
    row: Math.floor(lat / BLOCK_DEG),
    col: Math.floor(lng / BLOCK_DEG),
  })
}

/** Distance from `point` to the straight line between `a` and `b`. */
function distanceToLineM(point: LatLng, a: LatLng, b: LatLng): number {
  const scale = lngScale(a[0])
  const px = (point[1] - a[1]) * scale * M_PER_DEG
  const py = (point[0] - a[0]) * M_PER_DEG
  const bx = (b[1] - a[1]) * scale * M_PER_DEG
  const by = (b[0] - a[0]) * M_PER_DEG
  const length = bx * bx + by * by
  const t =
    length === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / length))
  return Math.hypot(px - bx * t, py - by * t)
}

/**
 * Blocks within `paddingM` of the straight line between the stops. A long
 * diagonal leg needs a band, not its whole bounding box, which would be
 * mostly empty countryside and many times the download.
 */
export function corridorBlocks(
  from: LatLng,
  to: LatLng,
  paddingM: number,
): Block[] {
  const bounds = boundsAround(from, to, paddingM)
  const halfDiagonal =
    Math.hypot(
      BLOCK_DEG * M_PER_DEG,
      BLOCK_DEG * M_PER_DEG * lngScale((from[0] + to[0]) / 2),
    ) / 2
  const blocks: Block[] = []
  for (
    let row = Math.floor(bounds.south / BLOCK_DEG);
    row <= Math.floor(bounds.north / BLOCK_DEG);
    row += 1
  ) {
    for (
      let col = Math.floor(bounds.west / BLOCK_DEG);
      col <= Math.floor(bounds.east / BLOCK_DEG);
      col += 1
    ) {
      const center: LatLng = [(row + 0.5) * BLOCK_DEG, (col + 0.5) * BLOCK_DEG]
      if (distanceToLineM(center, from, to) <= paddingM + halfDiagonal) {
        blocks.push({ row, col })
      }
    }
  }
  return blocks
}

/**
 * The downloaded track network as one undirected graph that grows with every
 * block. Junctions and switches are the points two ways share, and Overpass
 * reports a shared node with identical coordinates in both ways, so the
 * coordinate is the node identity.
 *
 * Edges are undirected on purpose: a city network maps the two directions of
 * a corridor as separate one-way tracks, and honouring that would send a leg
 * on a full loop just because the stop snapped to the opposite track.
 */
export class TrackNetwork {
  private ids = new Map<string, number>()
  private ways = new Set<number>()
  private grid = new Map<number, number[]>()
  lat: number[] = []
  lng: number[] = []
  links: number[][] = []
  costs: number[][] = []

  get size(): number {
    return this.lat.length
  }

  point(id: number): LatLng {
    return [this.lat[id], this.lng[id]]
  }

  addWays(ways: RailWay[]): void {
    for (const way of ways) {
      if (this.ways.has(way.id)) continue
      this.ways.add(way.id)
      let previous = -1
      for (const point of way.geometry) {
        const id = this.node(point)
        if (previous >= 0 && previous !== id) {
          const cost = distanceM(this.point(previous), point)
          this.link(previous, id, cost)
          this.link(id, previous, cost)
        }
        previous = id
      }
    }
  }

  /** Track points within `radiusM` of `point`, nearest first. */
  near(point: LatLng, radiusM: number): { id: number; distance: number }[] {
    const rows = Math.ceil(radiusM / (GRID_DEG * M_PER_DEG))
    const cols = Math.ceil(radiusM / (GRID_DEG * M_PER_DEG * lngScale(point[0])))
    const row = Math.floor(point[0] / GRID_DEG)
    const col = Math.floor(point[1] / GRID_DEG)
    const found: { id: number; distance: number }[] = []
    for (let r = row - rows; r <= row + rows; r += 1) {
      for (let c = col - cols; c <= col + cols; c += 1) {
        for (const id of this.grid.get(this.cell(r, c)) ?? []) {
          const distance = distanceM(point, this.point(id))
          if (distance <= radiusM) found.push({ id, distance })
        }
      }
    }
    return found.sort((a, b) => a.distance - b.distance)
  }

  private cell(row: number, col: number): number {
    return (row + 40000) * 200000 + (col + 80000)
  }

  private node(point: LatLng): number {
    const key = `${point[0].toFixed(7)},${point[1].toFixed(7)}`
    const known = this.ids.get(key)
    if (known !== undefined) return known
    const id = this.lat.length
    this.ids.set(key, id)
    this.lat.push(point[0])
    this.lng.push(point[1])
    this.links.push([])
    this.costs.push([])
    const cell = this.cell(
      Math.floor(point[0] / GRID_DEG),
      Math.floor(point[1] / GRID_DEG),
    )
    const bucket = this.grid.get(cell)
    if (bucket) bucket.push(id)
    else this.grid.set(cell, [id])
    return id
  }

  private link(from: number, to: number, cost: number) {
    if (this.links[from].includes(to)) return
    this.links[from].push(to)
    this.costs[from].push(cost)
  }
}

let network = new TrackNetwork()
/** Blocks downloaded or being downloaded; a failed block is forgotten. */
const blocks = new Map<number, Promise<void>>()

export function clearRailCache(): void {
  network = new TrackNetwork()
  blocks.clear()
  cooldownUntil.clear()
  preferredServer = 0
}

/** Block rectangle fetched with one query. */
interface Area {
  blocks: Block[]
  bounds: Bounds
}

/**
 * Missing blocks next to each other share one query: first along a row, then
 * runs covering the same columns in the rows below each other.
 */
function queryAreas(missing: Block[]): Area[] {
  const sorted = [...missing].sort((a, b) => a.row - b.row || a.col - b.col)
  const runs: Block[][] = []
  for (const block of sorted) {
    const run = runs[runs.length - 1]
    const last = run?.[run.length - 1]
    if (
      run &&
      last.row === block.row &&
      last.col === block.col - 1 &&
      run.length < BLOCKS_PER_QUERY
    ) {
      run.push(block)
    } else {
      runs.push([block])
    }
  }
  const areas: Block[][] = []
  for (const run of runs) {
    const area = areas.find((candidate) => {
      const below = candidate[candidate.length - 1]
      const top = candidate.filter((block) => block.row === below.row)
      return (
        below.row === run[0].row - 1 &&
        top.length === run.length &&
        top[0].col === run[0].col &&
        candidate.length + run.length <= BLOCKS_PER_QUERY
      )
    })
    if (area) area.push(...run)
    else areas.push([...run])
  }
  return areas.map((blocks) => ({
    blocks,
    bounds: {
      south: blocks[0].row * BLOCK_DEG,
      west: blocks[0].col * BLOCK_DEG,
      north: (blocks[blocks.length - 1].row + 1) * BLOCK_DEG,
      east: (blocks[blocks.length - 1].col + 1) * BLOCK_DEG,
    },
  }))
}

/**
 * Make sure the tracks of `wanted` are in the network. Legs of a line overlap
 * heavily, so concurrent legs wait for the same downloads instead of asking
 * Overpass for the same area again.
 */
async function loadBlocks(wanted: Block[], options: RailOptions) {
  const missing = wanted.filter((block) => !blocks.has(blockKey(block)))
  const areas = queryAreas(missing)
  areas.forEach((area, index) => {
    const label =
      areas.length > 1 ? ` (area ${index + 1} of ${areas.length})` : ''
    const request = withSlot(() =>
      fetchWays(area.bounds, label, options),
    ).then((ways) => network.addWays(ways))
    request.catch(() => {
      for (const block of area.blocks) {
        if (blocks.get(blockKey(block)) === request) {
          blocks.delete(blockKey(block))
        }
      }
    })
    for (const block of area.blocks) blocks.set(blockKey(block), request)
  })
  await Promise.all(wanted.map((block) => blocks.get(blockKey(block))))
}

/** Binary heap of node ids keyed by the A* score. */
class Queue {
  private ids: number[] = []
  private scores: number[] = []

  get size(): number {
    return this.ids.length
  }

  push(id: number, score: number) {
    const { ids, scores } = this
    let index = ids.length
    ids.push(id)
    scores.push(score)
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (scores[parent] <= score) break
      ids[index] = ids[parent]
      scores[index] = scores[parent]
      index = parent
    }
    ids[index] = id
    scores[index] = score
  }

  pop(): number {
    const { ids, scores } = this
    const top = ids[0]
    const lastId = ids.pop()!
    const lastScore = scores.pop()!
    const size = ids.length
    if (size > 0) {
      let index = 0
      for (;;) {
        const left = index * 2 + 1
        if (left >= size) break
        const right = left + 1
        const child =
          right < size && scores[right] < scores[left] ? right : left
        if (scores[child] >= lastScore) break
        ids[index] = ids[child]
        scores[index] = scores[child]
        index = child
      }
      ids[index] = lastId
      scores[index] = lastScore
    }
    return top
  }
}

export type SearchResult =
  | { path: LatLng[] }
  | { path: null; reason: 'no-track' | 'no-route' }

export interface SearchOptions {
  /** Only points in these blocks are visited (see `blockOf`). */
  blocks?: Set<number>
  /** Also step across small gaps between dangling track ends. */
  bridges?: boolean
  signal?: AbortSignal
}

const GOAL = -1

/** Links across mapping gaps: each dangling end to its nearest other point. */
function gapBridges(
  graph: TrackNetwork,
  inside: (id: number) => boolean,
): Map<number, { to: number; cost: number }[]> {
  const bridges = new Map<number, { to: number; cost: number }[]>()
  const add = (from: number, to: number, cost: number) => {
    const list = bridges.get(from)
    if (list) list.push({ to, cost })
    else bridges.set(from, [{ to, cost }])
  }
  for (let id = 0; id < graph.size; id += 1) {
    if (graph.links[id].length !== 1 || !inside(id)) continue
    const target = graph
      .near(graph.point(id), BRIDGE_RADIUS_M)
      .find(
        (candidate) =>
          candidate.id !== id && !graph.links[id].includes(candidate.id),
      )
    if (!target) continue
    const cost = target.distance * 2 + 20
    add(id, target.id, cost)
    add(target.id, id, cost)
  }
  return bridges
}

/**
 * A* between two stops. Every track point near a stop is an entry point, at a
 * penalty for its distance, so a stop next to a short detached siding still
 * finds the main track a little farther away.
 */
export async function searchPath(
  graph: TrackNetwork,
  from: LatLng,
  to: LatLng,
  options: SearchOptions = {},
): Promise<SearchResult> {
  const inside = options.blocks
    ? (id: number) => options.blocks!.has(blockOf(graph.lat[id], graph.lng[id]))
    : () => true
  const starts = graph.near(from, SNAP_RADIUS_M).filter(({ id }) => inside(id))
  const ends = graph.near(to, SNAP_RADIUS_M).filter(({ id }) => inside(id))
  if (starts.length === 0 || ends.length === 0) {
    return { path: null, reason: 'no-track' }
  }
  const exits = new Map(ends.map(({ id, distance }) => [id, distance * SNAP_PENALTY]))
  const bridges = options.bridges ? gapBridges(graph, inside) : null

  const best = new Map<number, number>()
  const cameFrom = new Map<number, number>()
  const settled = new Set<number>()
  const queue = new Queue()
  const heuristic = (id: number) => distanceM(graph.point(id), to)
  const relax = (next: number, cost: number, current: number) => {
    if (cost >= (best.get(next) ?? Infinity)) return
    best.set(next, cost)
    cameFrom.set(next, current)
    queue.push(next, next === GOAL ? cost : cost + heuristic(next))
  }
  for (const { id, distance } of starts) {
    const cost = distance * SNAP_PENALTY
    if (cost >= (best.get(id) ?? Infinity)) continue
    best.set(id, cost)
    queue.push(id, cost + heuristic(id))
  }

  let expanded = 0
  while (queue.size > 0) {
    const current = queue.pop()
    if (current === GOAL) break
    if (settled.has(current)) continue
    settled.add(current)
    expanded += 1
    if (expanded > MAX_EXPANSIONS) break
    if (expanded % YIELD_EVERY === 0) {
      // Keep the page responsive on a large network.
      await new Promise((resolve) => setTimeout(resolve, 0))
      options.signal?.throwIfAborted()
    }
    const cost = best.get(current)!
    const exit = exits.get(current)
    if (exit !== undefined) relax(GOAL, cost + exit, current)
    const links = graph.links[current]
    const costs = graph.costs[current]
    for (let index = 0; index < links.length; index += 1) {
      if (inside(links[index])) relax(links[index], cost + costs[index], current)
    }
    for (const bridge of bridges?.get(current) ?? []) {
      relax(bridge.to, cost + bridge.cost, current)
    }
  }

  if (!best.has(GOAL)) return { path: null, reason: 'no-route' }
  const path: LatLng[] = []
  for (let id = cameFrom.get(GOAL); id !== undefined; id = cameFrom.get(id)) {
    path.push(graph.point(id))
  }
  return { path: path.reverse() }
}

export function pathLengthM(path: LatLng[]): number {
  let total = 0
  for (let index = 1; index < path.length; index += 1) {
    total += distanceM(path[index - 1], path[index])
  }
  return total
}

/**
 * Route from the signal.eu.org rail router. It honours track direction, so
 * both directions are asked and the shorter one is kept, and a route that is
 * still a long detour (a loop the wrong way round) is rejected.
 */
async function routerRoute(
  from: LatLng,
  to: LatLng,
  signal?: AbortSignal,
): Promise<RailRoute | null> {
  const ask = async (a: LatLng, b: LatLng): Promise<RailRoute | null> => {
    const url = `${RAIL_ROUTER_URL}/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=polyline6`
    try {
      const response = await fetch(url, {
        signal: withTimeout(ROUTER_TIMEOUT_MS, signal),
      })
      if (!response.ok) return null
      const body = (await response.json()) as RouterResponse
      const route = body.routes?.[0]
      if (body.code !== 'Ok' || !route) return null
      if (body.waypoints?.some((point) => point.distance > SNAP_RADIUS_M)) {
        return null
      }
      return {
        geometry: polyline.decode(route.geometry, 6) as LatLng[],
        distanceM: route.distance,
      }
    } catch (error) {
      if (signal?.aborted) throw error
      return null
    }
  }
  const [forward, backward] = await Promise.all([ask(from, to), ask(to, from)])
  const candidates = [
    forward,
    backward && { ...backward, geometry: [...backward.geometry].reverse() },
  ].filter((route): route is RailRoute => route !== null)
  const best = candidates.sort((a, b) => a.distanceM - b.distanceM)[0]
  const straight = distanceM(from, to)
  if (!best || best.distanceM > straight * 4 + 2000) return null
  return best
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Rail route between two stops, trying the cheap answers first: the tracks
 * in a narrow band around the stops, the same tracks with small mapping gaps
 * closed, the rail router, and finally a much wider band for tracks that
 * leave the corridor before coming back (a loop around a hill, a station
 * approach).
 */
export async function railRoute(
  from: LatLng,
  to: LatLng,
  options: RailOptions = {},
): Promise<RailRoute> {
  const { signal, onProgress } = options
  const straight = distanceM(from, to)
  const narrow = corridorBlocks(from, to, clamp(straight * 0.3, 800, 3000))
  const wide = corridorBlocks(from, to, clamp(straight * 0.8, 3000, 10000))

  let failure = 'No rail route between these stops'
  let downloaded = true
  const search = async (wanted: Block[], bridges: boolean) => {
    await loadBlocks(wanted, options)
    onProgress?.('Searching the track network…')
    const result = await searchPath(network, from, to, {
      blocks: new Set(wanted.map(blockKey)),
      bridges,
      signal,
    })
    if (result.path) {
      return { geometry: result.path, distanceM: pathLengthM(result.path) }
    }
    if (result.reason === 'no-track') failure = 'No rail track near this stop'
    return null
  }

  const noTrack = () => failure === 'No rail track near this stop'
  try {
    const found =
      (await search(narrow, false)) ??
      (noTrack() ? null : await search(narrow, true))
    if (found) return found
  } catch (error) {
    if (signal?.aborted) throw error
    failure = error instanceof Error ? error.message : String(error)
    downloaded = false
  }

  onProgress?.('Asking the signal.eu.org rail router…')
  const routed = await routerRoute(from, to, signal)
  if (routed) return routed

  if (downloaded && !noTrack()) {
    try {
      const found = await search(wide, true)
      if (found) return found
    } catch (error) {
      if (signal?.aborted) throw error
      failure = error instanceof Error ? error.message : String(error)
    }
  }
  throw new Error(
    downloaded ? failure : `${failure}, and the rail router found no route`,
  )
}
