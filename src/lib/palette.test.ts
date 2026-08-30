import { describe, expect, it } from 'vitest'
import { RECENT_COLOR_LIMIT, withRecentColor } from './palette'

describe('withRecentColor', () => {
  it('puts the newest colour first without duplicating it', () => {
    const once = withRecentColor(['#111111', '#222222'], '#222222')
    expect(once).toEqual(['#222222', '#111111'])
  })

  it('normalises case so the same colour is one entry', () => {
    expect(withRecentColor(['#aabbcc'], '#AABBCC')).toEqual(['#aabbcc'])
  })

  it('keeps only the most recent colours', () => {
    let recent: string[] = []
    for (let i = 0; i < RECENT_COLOR_LIMIT + 3; i += 1) {
      recent = withRecentColor(recent, `#0000${i.toString(16)}${i.toString(16)}`)
    }
    expect(recent).toHaveLength(RECENT_COLOR_LIMIT)
    expect(recent[0]).toBe('#0000aa')
  })

  it('ignores a blank colour', () => {
    const recent = ['#111111']
    expect(withRecentColor(recent, '  ')).toBe(recent)
  })
})
