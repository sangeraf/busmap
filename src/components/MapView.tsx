import { MapContainer, TileLayer, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { LatLng } from '../types'

interface Props {
  center: LatLng
  zoom: number
  onViewChange: (center: LatLng, zoom: number) => void
}

function ViewSync({ onViewChange }: { onViewChange: Props['onViewChange'] }) {
  useMapEvents({
    moveend(event) {
      const map = event.target
      const center = map.getCenter()
      onViewChange([center.lat, center.lng], map.getZoom())
    },
  })
  return null
}

export function MapView({ center, zoom, onViewChange }: Props) {
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      className="h-full w-full"
      scrollWheelZoom
      preferCanvas
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <ViewSync onViewChange={onViewChange} />
    </MapContainer>
  )
}
