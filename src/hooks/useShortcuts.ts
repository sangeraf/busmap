import { useEffect } from 'react'
import { useStore } from '../store/useStore'

export interface Shortcut {
  keys: string
  description: string
}

export const SHORTCUTS: Shortcut[] = [
  { keys: 'S', description: 'Place a stop' },
  { keys: 'W', description: 'Place a waypoint' },
  { keys: '1 / 2 / 3', description: 'Stops, Lines, Data tab' },
  { keys: 'Ctrl+Z', description: 'Undo' },
  { keys: 'Ctrl+Shift+Z', description: 'Redo' },
  { keys: 'L', description: 'Show or hide the legend' },
  { keys: 'Esc', description: 'Cancel placing, connecting or selecting' },
  { keys: '?', description: 'This list' },
]

/** True while the user is typing, so letter shortcuts stay out of the way. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  )
}

interface Options {
  toggleLegend: () => void
  toggleHelp: () => void
}

export function useShortcuts({ toggleLegend, toggleHelp }: Options) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const store = useStore.getState()
      if (event.key === 'Escape') {
        store.setPlacementKind(null)
        store.stopConnecting()
        store.setSelectedNode(null)
        store.setSelectedLine(null)
        return
      }
      if (isTyping(event.target)) return

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) store.redo()
        else store.undo()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        store.redo()
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return

      switch (event.key.toLowerCase()) {
        case 's':
          store.setPlacementKind(store.placementKind === 'stop' ? null : 'stop')
          break
        case 'w':
          store.setPlacementKind(
            store.placementKind === 'waypoint' ? null : 'waypoint',
          )
          break
        case '1':
          store.setActiveTab('stops')
          break
        case '2':
          store.setActiveTab('lines')
          break
        case '3':
          store.setActiveTab('data')
          break
        case 'l':
          toggleLegend()
          break
        case '?':
          toggleHelp()
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleLegend, toggleHelp])
}
