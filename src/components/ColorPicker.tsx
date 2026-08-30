import { DEFAULT_PALETTE, normalizeColor } from '../lib/palette'
import { useStore } from '../store/useStore'

interface Props {
  value: string
  onChange: (color: string) => void
}

function Swatch({
  color,
  selected,
  onPick,
}: {
  color: string
  selected: boolean
  onPick: (color: string) => void
}) {
  return (
    <button
      type="button"
      title={color}
      aria-label={color}
      aria-pressed={selected}
      onClick={() => onPick(color)}
      className={`h-5 w-5 rounded border ${
        selected
          ? 'border-slate-900 ring-1 ring-slate-900'
          : 'border-slate-300 hover:border-slate-500'
      }`}
      style={{ backgroundColor: color }}
    />
  )
}

/**
 * Recently used colours, a fixed palette, and the native picker for anything
 * else. Dragging in the native picker only counts as "used" once it closes.
 */
export function ColorPicker({ value, onChange }: Props) {
  const recentColors = useStore((s) => s.recentColors)
  const rememberColor = useStore((s) => s.rememberColor)
  const current = normalizeColor(value)
  const recent = recentColors.filter(
    (color) => !DEFAULT_PALETTE.includes(color),
  )

  function pick(color: string) {
    onChange(color)
    rememberColor(color)
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {recent.map((color) => (
        <Swatch
          key={`recent-${color}`}
          color={color}
          selected={color === current}
          onPick={pick}
        />
      ))}
      {recent.length > 0 && <span className="mx-0.5 h-4 w-px bg-slate-300" />}
      {DEFAULT_PALETTE.map((color) => (
        <Swatch
          key={color}
          color={color}
          selected={color === current}
          onPick={pick}
        />
      ))}
      <input
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => rememberColor(event.target.value)}
        title="Custom colour"
        aria-label="Custom colour"
        className="ml-0.5 h-6 w-8 rounded border border-slate-300"
      />
    </div>
  )
}
