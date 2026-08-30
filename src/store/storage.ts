import { get as idbGet, set as idbSet } from 'idb-keyval'
import type { Project, ProjectId } from '../types'
import { SCHEMA_VERSION } from '../types'
import {
  deserializeProject,
  serializeProject,
  type StoredProject,
} from '../lib/serialize'
import type { CachedRoute, RouteCacheBackend } from '../lib/routing'

const STORE_KEY = 'busmap.workspace'

export interface Workspace {
  schemaVersion: number
  activeProjectId: ProjectId | null
  projects: Record<ProjectId, Project>
}

interface StoredWorkspace {
  schemaVersion: number
  activeProjectId: ProjectId | null
  projects: Record<ProjectId, StoredProject>
}

/**
 * Persistence behind a narrow async interface so a File System Access backend
 * can be added later without touching the store.
 */
export interface WorkspaceStorage {
  load(): Promise<Workspace | null>
  save(workspace: Workspace): Promise<void>
}

function toStored(workspace: Workspace): StoredWorkspace {
  const projects: Record<ProjectId, StoredProject> = {}
  for (const [id, project] of Object.entries(workspace.projects)) {
    projects[id] = serializeProject(project)
  }
  return { ...workspace, projects }
}

function fromStored(stored: StoredWorkspace): Workspace {
  const projects: Record<ProjectId, Project> = {}
  for (const [id, project] of Object.entries(stored.projects)) {
    projects[id] = deserializeProject(project)
  }
  return { ...stored, projects }
}

/**
 * IndexedDB rather than localStorage: a 10k-stop / 500-line network with road
 * geometry runs well past the ~5 MB localStorage quota.
 */
export const indexedDbBackend: WorkspaceStorage = {
  async load() {
    try {
      const stored = await idbGet<StoredWorkspace>(STORE_KEY)
      if (!stored || typeof stored !== 'object' || !stored.projects) return null
      return fromStored(stored)
    } catch (error) {
      console.error('Failed to read workspace', error)
      return null
    }
  },
  async save(workspace) {
    try {
      await idbSet(STORE_KEY, toStored(workspace))
    } catch (error) {
      console.error('Failed to persist workspace', error)
    }
  },
}

const ROUTE_CACHE_KEY = 'busmap.routes'

/** Road legs survive reloads, so re-opening a project costs no OSRM calls. */
export const indexedDbRouteCache: RouteCacheBackend = {
  async load() {
    try {
      return (
        (await idbGet<Record<string, CachedRoute>>(ROUTE_CACHE_KEY)) ?? null
      )
    } catch (error) {
      console.error('Failed to read route cache', error)
      return null
    }
  },
  async save(entries) {
    try {
      await idbSet(ROUTE_CACHE_KEY, entries)
    } catch (error) {
      console.error('Failed to persist route cache', error)
    }
  },
}

const RECENT_COLORS_KEY = 'busmap.recentColors'

/** Recently picked colours are a workspace-wide preference, not project data. */
export const recentColorsStorage = {
  async load(): Promise<string[]> {
    try {
      const stored = await idbGet<string[]>(RECENT_COLORS_KEY)
      return Array.isArray(stored)
        ? stored.filter((entry) => typeof entry === 'string')
        : []
    } catch (error) {
      console.error('Failed to read recent colours', error)
      return []
    }
  },
  async save(colors: string[]): Promise<void> {
    try {
      await idbSet(RECENT_COLORS_KEY, colors)
    } catch (error) {
      console.error('Failed to persist recent colours', error)
    }
  },
}

export function emptyWorkspace(): Workspace {
  return { schemaVersion: SCHEMA_VERSION, activeProjectId: null, projects: {} }
}
