import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'
import { exportProjectJson, parseProjectFile } from './exchange'
import type { Project } from '../types'

/**
 * The File System Access API is not in lib.dom yet, so the handful of members
 * used here are declared locally rather than pulled in as a dependency.
 */
interface PermissionOptions {
  mode: 'read' | 'readwrite'
}

interface SyncDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission(options: PermissionOptions): Promise<PermissionState>
  requestPermission(options: PermissionOptions): Promise<PermissionState>
}

interface PickerWindow {
  showDirectoryPicker(options?: {
    id?: string
    mode?: 'read' | 'readwrite'
  }): Promise<SyncDirectoryHandle>
}

const HANDLE_KEY = 'busmap.folder'
const SUFFIX = '.busmap.json'

export function folderSyncSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

function picker(): PickerWindow {
  return window as unknown as PickerWindow
}

export function fileNameFor(project: Project): string {
  const slug =
    project.name
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'project'
  return `${slug}-${project.id}${SUFFIX}`
}

/** Ask for a folder; the handle is stored so the link survives reloads. */
export async function pickSyncFolder(): Promise<SyncDirectoryHandle> {
  const handle = await picker().showDirectoryPicker({
    id: 'busmap',
    mode: 'readwrite',
  })
  await idbSet(HANDLE_KEY, handle)
  return handle
}

export async function loadSyncFolder(): Promise<SyncDirectoryHandle | null> {
  if (!folderSyncSupported()) return null
  try {
    return (await idbGet<SyncDirectoryHandle>(HANDLE_KEY)) ?? null
  } catch {
    return null
  }
}

export async function forgetSyncFolder(): Promise<void> {
  await idbDel(HANDLE_KEY)
}

/**
 * Chrome drops write permission between visits, so it is re-checked before
 * every sync; `prompt` only succeeds inside a user gesture.
 */
export async function ensureFolderAccess(
  handle: SyncDirectoryHandle,
  prompt: boolean,
): Promise<boolean> {
  const options: PermissionOptions = { mode: 'readwrite' }
  if ((await handle.queryPermission(options)) === 'granted') return true
  if (!prompt) return false
  return (await handle.requestPermission(options)) === 'granted'
}

/** One file per project, named after it so the folder stays readable. */
export async function writeProjects(
  handle: SyncDirectoryHandle,
  projects: Project[],
): Promise<number> {
  for (const project of projects) {
    const file = await handle.getFileHandle(fileNameFor(project), {
      create: true,
    })
    const stream = await file.createWritable()
    await stream.write(exportProjectJson(project))
    await stream.close()
  }
  return projects.length
}

export interface FolderReadResult {
  projects: Project[]
  warnings: string[]
}

/** Read every *.busmap.json back, skipping files that fail validation. */
export async function readProjects(
  handle: SyncDirectoryHandle,
): Promise<FolderReadResult> {
  const projects: Project[] = []
  const warnings: string[] = []
  for await (const entry of handle.values()) {
    if (entry.kind !== 'file' || !entry.name.endsWith(SUFFIX)) continue
    const file = await handle.getFileHandle(entry.name)
    const parsed = parseProjectFile(await (await file.getFile()).text())
    if (!parsed.ok) {
      warnings.push(`${entry.name}: ${parsed.errors[0]}`)
      continue
    }
    projects.push(parsed.project)
    warnings.push(...parsed.warnings.map((text) => `${entry.name}: ${text}`))
  }
  return { projects, warnings }
}

export type { SyncDirectoryHandle }
