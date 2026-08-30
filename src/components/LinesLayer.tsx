import { useMemo, useState } from 'react'
import L from 'leaflet'
import { Polyline, useMap, useMapEvents } from 'react-leaflet'
import { useStore } from '../store/useStore'
import type { LatLng, LineId, Project, Segment } from '../types'

interface DrawnLine {
  id: LineId
  color: string
  positions: LatLng[][]
}

function intersects(segment: Segment, bounds: L.LatLngBounds): boolean {
  return L.latLngBounds(segment.geometry).intersects(bounds)
}

/** Segments outside the viewport are dropped before Leaflet ever sees them. */
function useDrawnLines(project: Project): DrawnLine[] {
  const map = useMap()
  const [bounds, setBounds] = useState(() => map.getBounds().pad(0.2))

  useMapEvents({
    moveend: () => setBounds(map.getBounds().pad(0.2)),
    zoomend: () => setBounds(map.getBounds().pad(0.2)),
  })

  return useMemo(
    () =>
      Object.values(project.lines)
        .map((line) => ({
          id: line.id,
          color: line.color,
          positions: line.segments
            .filter((segment) => intersects(segment, bounds))
            .map((segment) => segment.geometry),
        }))
        .filter((line) => line.positions.length > 0),
    [project.lines, bounds],
  )
}

export function LinesLayer({ project }: { project: Project }) {
  const selectedLineId = useStore((s) => s.selectedLineId)
  const setSelectedLine = useStore((s) => s.setSelectedLine)
  const drawn = useDrawnLines(project)

  return (
    <>
      {drawn.map((line) => {
        const isSelected = line.id === selectedLineId
        return (
          <Polyline
            key={line.id}
            positions={line.positions}
            pathOptions={{
              color: line.color,
              weight: isSelected ? 6 : 4,
              opacity: isSelected || !selectedLineId ? 0.9 : 0.35,
            }}
            eventHandlers={{ click: () => setSelectedLine(line.id) }}
          />
        )
      })}
    </>
  )
}
