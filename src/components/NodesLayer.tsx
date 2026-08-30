import { useEffect, useMemo, useState } from 'react'
import L from 'leaflet'
import { CircleMarker, Marker, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { NodeInfo } from './NodeInfo'
import { useStore } from '../store/useStore'
import type { MapNode, Project } from '../types'

const SELECTED_ICON = L.divIcon({
  className: '',
  html: '<div class="h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-900 shadow"></div>',
  iconSize: [0, 0],
})

/**
 * Only nodes inside the padded viewport are rendered: at the 10k-stop target
 * handing every marker to Leaflet on each render is what makes panning stutter.
 */
function useVisibleNodes(nodes: MapNode[]): MapNode[] {
  const map = useMap()
  const [bounds, setBounds] = useState(() => map.getBounds().pad(0.2))

  useMapEvents({
    moveend: () => setBounds(map.getBounds().pad(0.2)),
    zoomend: () => setBounds(map.getBounds().pad(0.2)),
  })

  return useMemo(
    () => nodes.filter((node) => bounds.contains([node.lat, node.lng])),
    [nodes, bounds],
  )
}

/** Bring a node selected from the sidebar into view. */
function useRevealSelected(node: MapNode | undefined) {
  const map = useMap()
  const id = node?.id
  useEffect(() => {
    if (!node) return
    if (!map.getBounds().contains([node.lat, node.lng])) {
      map.panTo([node.lat, node.lng])
    }
    // Panning on every coordinate change would fight the drag handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, map])
}

export function NodesLayer({ project }: { project: Project }) {
  const selectedNodeId = useStore((s) => s.selectedNodeId)
  const hoveredNodeId = useStore((s) => s.hoveredNodeId)
  const setSelectedNode = useStore((s) => s.setSelectedNode)
  const setHoveredNode = useStore((s) => s.setHoveredNode)
  const updateNode = useStore((s) => s.updateNode)
  const connect = useStore((s) => s.connect)
  const connectTo = useStore((s) => s.connectTo)

  const nodes = useMemo(() => Object.values(project.nodes), [project.nodes])
  const visible = useVisibleNodes(nodes)
  const selectedNode = selectedNodeId ? project.nodes[selectedNodeId] : undefined
  useRevealSelected(selectedNode)

  return (
    <>
      {visible.map((node) => {
        const isSelected = node.id === selectedNodeId
        const isHovered = node.id === hoveredNodeId
        const isAnchor = connect?.anchorId === node.id
        return (
          <CircleMarker
            key={node.id}
            center={[node.lat, node.lng]}
            radius={node.kind === 'stop' ? 6 : 4}
            pathOptions={{
              color: isAnchor
                ? '#16a34a'
                : isSelected || isHovered
                  ? '#0f172a'
                  : '#ffffff',
              weight: isAnchor || isSelected || isHovered ? 3 : 2,
              fillColor: node.color,
              fillOpacity: 1,
            }}
            eventHandlers={{
              click: () =>
                connect ? connectTo(node.id) : setSelectedNode(node.id),
              mouseover: () => setHoveredNode(node.id),
              mouseout: () => setHoveredNode(null),
            }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              {node.name}
              <NodeInfo info={node.info} />
            </Tooltip>
          </CircleMarker>
        )
      })}

      {/*
        Canvas circle markers cannot be dragged, so the selected node also gets
        a draggable DOM marker on top of it.
      */}
      {selectedNodeId && selectedNode && !connect && (
        <Marker
          key={`drag-${selectedNodeId}`}
          position={[selectedNode.lat, selectedNode.lng]}
          icon={SELECTED_ICON}
          draggable
          eventHandlers={{
            dragend: (event) => {
              const { lat, lng } = event.target.getLatLng()
              updateNode(selectedNodeId, { lat, lng })
            },
          }}
        />
      )}
    </>
  )
}
