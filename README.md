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

## Deployment

`.github/workflows/deploy.yml` builds `main` and publishes `dist/` to GitHub
Pages at `https://<owner>.github.io/<repo>/`. The workflow enables Pages itself
(`configure-pages` with `enablement: true`), so no manual repo setting is
needed.

Pages serves the app from a subpath, so the workflow builds with
`BASE_PATH=/<repo>/`; local builds default to `/`. For any other static host,
`npm run build` and serve `dist/` (`npm run preview` does this locally on
http://localhost:4173).

## Architecture

- `src/types.ts` — data model. A project holds nodes (stops/waypoints), lines
  and user-defined line types. A line owns a set of **directed** segments that
  need not form a single chain, so both directions and branches of a route live
  on one line.
- `src/store/useStore.ts` — Zustand store: workspace with multiple projects,
  active project, tab state, debounced autosave.
- `src/store/storage.ts` — persistence behind a small async interface. The
  default backend is IndexedDB.
- `src/lib/folderSync.ts` — optional File System Access mirror: each project is
  written to a picked folder as its own `*.busmap.json` and can be read back.
  Chrome/Edge only; the Data tab hides it elsewhere.
- `src/lib/serialize.ts` — persistence codec. Road geometry is stored as an
  encoded polyline rather than a coordinate array.
- `src/components/` — header (project switcher, undo/redo), sidebar tabs,
  Leaflet map, map legend.
- `src/hooks/useShortcuts.ts` — global keyboard shortcuts; letter keys are
  ignored while typing in a field.

### Scale target

The app targets networks of ~10,000 stops and ~500 lines. Consequences already
baked in: IndexedDB instead of localStorage, polyline-encoded geometry, and a
canvas-rendered Leaflet map. Sidebar lists are virtualized as they are built.

### Placing stops

Placement mode stays armed until it is switched off, and every placed node
opens a small name/colour editor with the name focused, so a row of stops is
`S`, click, type, Enter, click, type, Enter… The name is prefilled from the
nearest node of the same kind within 200 m (the other direction of the same
stop), and the colour is the last one used for that kind.

## Keyboard shortcuts

`S`/`W` place a stop/waypoint, `1`/`2`/`3` switch tabs, `Ctrl+Z` /
`Ctrl+Shift+Z` undo and redo, `L` toggles the legend, `Esc` cancels what is in
progress, `?` lists them in the app.

Undo covers edits to the data. Map panning/zooming and routes arriving from
OSRM are not undo steps, and undo keeps the current map view.
