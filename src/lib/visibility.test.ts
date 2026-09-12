import { describe, expect, it } from 'vitest'
import { generateNetwork } from './fixtures'
import {
  DEFAULT_VISIBILITY,
  connectedNodeIds,
  isLineVisible,
  isNodeVisible,
  nextNodeVisibility,
  typeKey,
  UNTYPED_KEY,
} from './visibility'
import { createNode } from './nodes'

describe('visibility', () => {
  it('cycles a node kind through all, connected and none', () => {
    expect(nextNodeVisibility('all')).toBe('connected')
    expect(nextNodeVisibility('connected')).toBe('none')
    expect(nextNodeVisibility('none')).toBe('all')
  })

  it('groups typeless lines under one legend key', () => {
    const project = generateNetwork(6, 1)
    const line = Object.values(project.lines)[0]
    expect(typeKey(line.typeId)).toBe(line.typeId)
    expect(typeKey(null)).toBe(UNTYPED_KEY)
    expect(isLineVisible(line, [])).toBe(true)
    expect(isLineVisible(line, [typeKey(line.typeId)])).toBe(false)
    expect(isLineVisible({ ...line, typeId: null }, [UNTYPED_KEY])).toBe(false)
  })

  it('counts only the nodes of lines that are still drawn', () => {
    const project = generateNetwork(6, 1)
    const line = Object.values(project.lines)[0]
    const served = connectedNodeIds(project, [])
    expect(served.has(line.segments[0].from)).toBe(true)
    expect(connectedNodeIds(project, [typeKey(line.typeId)]).size).toBe(0)
  })

  it('shows an unconnected node only in the "all" mode', () => {
    const project = generateNetwork(6, 1)
    const orphan = createNode('stop', 47.5, 19.05, 1)
    const connected = connectedNodeIds(project, [])

    expect(isNodeVisible(orphan, DEFAULT_VISIBILITY, connected)).toBe(true)
    expect(
      isNodeVisible(orphan, { ...DEFAULT_VISIBILITY, stop: 'connected' }, connected),
    ).toBe(false)
    expect(
      isNodeVisible(orphan, { ...DEFAULT_VISIBILITY, stop: 'none' }, connected),
    ).toBe(false)
  })
})
