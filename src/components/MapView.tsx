import { MapContainer, TileLayer, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { useStore } from '../store/useStore'
import type { LatLng, Project } from '../types'
import { NodesLayer } from './NodesLayer'
import { LinesLayer } from './LinesLayer'

interface Props {
  project: Project
  onViewChange: (center: LatLng, zoom: number) => void
}

function MapEvents({ onViewChange }: { onViewChange: Props['onViewChange'] }) {
  const placementKind = useStore((s) => s.placementKind)
  const setPlacementKind = useStore((s) => s.setPlacementKind)
  const addNode = useStore((s) => s.addNode)

  useMapEvents({
    moveend(event) {
      const map = event.target
      const center = map.getCenter()
      onViewChange([center.lat, center.lng], map.getZoom())
    },
    click(event) {
      if (!placementKind) return
      addNode(placementKind, event.latlng.lat, event.latlng.lng)
      setPlacementKind(null)
    },
  })
  return null
}

export function MapView({ project, onViewChange }: Props) {
  const placementKind = useStore((s) => s.placementKind)
  const connect = useStore((s) => s.connect)

  return (
    <MapContainer
      center={project.center}
      zoom={project.zoom}
      className={`h-full w-full ${
        placementKind || connect ? 'cursor-crosshair' : ''
      }`}
      scrollWheelZoom
      preferCanvas
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <MapEvents onViewChange={onViewChange} />
      <LinesLayer project={project} />
      <NodesLayer project={project} />
    </MapContainer>
  )
}
