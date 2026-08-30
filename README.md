# busmap

Browser-based editor for city bus network maps: place stops and waypoints on an
OpenStreetMap base map, connect them into lines, and export the result as JSON.

Everything runs client-side; there is no backend.

## Requirements

Node 22 (see `.nvmrc`).

```bash
nvm use
npm install
npm run dev      # http://localhost:5173
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | typecheck + production build |
| `npm run test` | Vitest unit tests |
| `npm run lint` | oxlint |
| `npm run typecheck` | `tsc -b` |

## Architecture

- `src/types.ts` — data model. A project holds nodes (stops/waypoints), lines
  and user-defined line types. A line owns a set of **directed** segments that
  need not form a single chain, so both directions and branches of a route live
  on one line.
- `src/store/useStore.ts` — Zustand store: workspace with multiple projects,
  active project, tab state, debounced autosave.
- `src/store/storage.ts` — persistence behind a small async interface. The
  default backend is IndexedDB; a File System Access backend can be added
  without touching the store.
- `src/lib/serialize.ts` — persistence codec. Road geometry is stored as an
  encoded polyline rather than a coordinate array.
- `src/components/` — header (project switcher), sidebar tabs, Leaflet map.

### Scale target

The app targets networks of ~10,000 stops and ~500 lines. Consequences already
baked in: IndexedDB instead of localStorage, polyline-encoded geometry, and a
canvas-rendered Leaflet map. Sidebar lists are virtualized as they are built.
