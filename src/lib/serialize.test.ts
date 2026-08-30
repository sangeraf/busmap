import { describe, expect, it } from 'vitest'
import { generateNetwork } from './fixtures'
import { deserializeProject, serializeProject } from './serialize'

describe('project serialization', () => {
  it('round-trips geometry within polyline precision', () => {
    const project = generateNetwork(50, 3)
    const restored = deserializeProject(serializeProject(project))

    for (const [id, line] of Object.entries(project.lines)) {
      const back = restored.lines[id]
      expect(back.segments).toHaveLength(line.segments.length)
      line.segments.forEach((segment, index) => {
        segment.geometry.forEach(([lat, lng], point) => {
          const [rlat, rlng] = back.segments[index].geometry[point]
          expect(rlat).toBeCloseTo(lat, 5)
          expect(rlng).toBeCloseTo(lng, 5)
        })
      })
    }
  })

  it('shrinks the persisted payload at target scale', () => {
    const project = generateNetwork(2000, 100)
    const raw = JSON.stringify(project).length
    const encoded = JSON.stringify(serializeProject(project)).length
    expect(encoded).toBeLessThan(raw)
  })
})
