/** Swatches offered everywhere a colour is picked, before the RGB picker. */
export const DEFAULT_PALETTE = [
  '#2563eb',
  '#0ea5e9',
  '#14b8a6',
  '#16a34a',
  '#84cc16',
  '#eab308',
  '#f97316',
  '#dc2626',
  '#db2777',
  '#9333ea',
  '#78350f',
  '#64748b',
  '#0f172a',
]

export const RECENT_COLOR_LIMIT = 8

export function normalizeColor(color: string): string {
  return color.trim().toLowerCase()
}

/** Most recent first, without duplicates, capped at RECENT_COLOR_LIMIT. */
export function withRecentColor(recent: string[], color: string): string[] {
  const next = normalizeColor(color)
  if (!next) return recent
  return [next, ...recent.filter((entry) => entry !== next)].slice(
    0,
    RECENT_COLOR_LIMIT,
  )
}
