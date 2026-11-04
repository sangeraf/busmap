import { useMemo, useState } from 'react'
import L from 'leaflet'
import { Polyline, useMap, useMapEvents } from 'react-leaflet'
import { useStore } from '../store/useStore'
import { isLineVisible } from '../lib/visibility'
import type { LatLng, LineId, MapNode, Project, Segment } from '../types'

interface DrawnLine {
  id: LineId
  color: string
  positions: LatLng[][]
  /** Routed connections still waiting for, or lacking, their route. */
  unrouted: LatLng[][]
}

function isUnrouted(segment: Segment): boolean {
  return (
    segment.mode !== 'straight' &&
    (segment.stale === true ||
      segment.distanceM === undefined ||
      segment.routeError !== undefined)
  )
}

/**
 * A segment awaiting its route has no geometry yet, so it falls back to the
 * straight line between its stops instead of vanishing from the map.
 */
function geometryOf(
  segment: Segment,
  nodes: Record<string, MapNode>,
): LatLng[] {
  if (segment.geometry.length > 0) return segment.geometry
  const from = nodes[segment.from]
  const to = nodes[segment.to]
  if (!from || !to) return []
  return [
    [from.lat, from.lng],
    [to.lat, to.lng],
  ]
}

function intersects(geometry: LatLng[], bounds: L.LatLngBounds): boolean {
  if (geometry.length === 0) return false
  return L.latLngBounds(geometry).intersects(bounds)
}

/** Segments outside the viewport are dropped before Leaflet ever sees them. */
function useDrawnLines(project: Project, hiddenTypes: string[]): DrawnLine[] {
  const map = useMap()
  const [bounds, setBounds] = useState(() => map.getBounds().pad(0.2))

  useMapEvents({
    moveend: () => setBounds(map.getBounds().pad(0.2)),
    zoomend: () => setBounds(map.getBounds().pad(0.2)),
  })

  return useMemo(
    () =>
      Object.values(project.lines)
        .filter((line) => isLineVisible(line, hiddenTypes))
        .map((line) => {
          const drawn: DrawnLine = {
            id: line.id,
            color: line.color,
            positions: [],
            unrouted: [],
          }
          for (const segment of line.segments) {
            const geometry = geometryOf(segment, project.nodes)
            if (!intersects(geometry, bounds)) continue
            if (isUnrouted(segment)) drawn.unrouted.push(geometry)
            else drawn.positions.push(geometry)
          }
          return drawn
        })
        .filter(
          (line) => line.positions.length > 0 || line.unrouted.length > 0,
        ),
    [project.lines, project.nodes, bounds, hiddenTypes],
  )
}

export function LinesLayer({ project }: { project: Project }) {
  const selectedLineId = useStore((s) => s.selectedLineId)
  const revealLine = useStore((s) => s.revealLine)
  const hiddenTypes = useStore((s) => s.visibility.hiddenTypes)
  const drawn = useDrawnLines(project, hiddenTypes)

  return (
    <>
      {drawn.flatMap((line) => {
        const isSelected = line.id === selectedLineId
        const pathOptions = {
          color: line.color,
          weight: isSelected ? 6 : 4,
          opacity: isSelected || !selectedLineId ? 0.9 : 0.35,
        }
        const click = { click: () => revealLine(line.id) }
        return [
          line.positions.length > 0 && (
            <Polyline
              key={line.id}
              positions={line.positions}
              // Otherwise the map's click handler also fires and clears the
              // selection this click just made.
              bubblingMouseEvents={false}
              pathOptions={pathOptions}
              eventHandlers={click}
            />
          ),
          line.unrouted.length > 0 && (
            <Polyline
              key={`${line.id}:unrouted`}
              positions={line.unrouted}
              bubblingMouseEvents={false}
              pathOptions={{ ...pathOptions, dashArray: '6 8' }}
              eventHandlers={click}
            />
          ),
        ]
      })}
    </>
  )
}
