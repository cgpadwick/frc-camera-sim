import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseWpilibLayout, parseOccluders } from '../../src/field/layoutLoader'

describe('parseWpilibLayout', () => {
  const real = JSON.parse(readFileSync('public/layouts/2026-rebuilt-welded.json', 'utf8'))
  it('parses the real 2026 file: 32 tags, field dims, quaternion mapped w<-W', () => {
    const l = parseWpilibLayout(real)
    expect(l.tags).toHaveLength(32)
    expect(l.field.length).toBeCloseTo(16.541)
    expect(l.tags[0].size).toBeCloseTo(0.1651)
    expect(typeof l.tags[0].pose.rotation.w).toBe('number')
  })
  it('rejects missing tags array', () => {
    expect(() => parseWpilibLayout({ field: { length: 1, width: 1 } })).toThrow(/tags/)
  })
  it('rejects duplicate tag IDs', () => {
    const dup = { ...real, tags: [real.tags[0], real.tags[0]] }
    expect(() => parseWpilibLayout(dup)).toThrow(/duplicate/i)
  })
})

describe('parseOccluders', () => {
  it('parses boxes', () => {
    const o = parseOccluders({ boxes: [{ center: { x: 1, y: 2, z: 0.5 }, size: { x: 1, y: 1, z: 1 }, yawDeg: 0 }] })
    expect(o).toHaveLength(1)
  })
  it('rejects non-numeric size', () => {
    expect(() => parseOccluders({ boxes: [{ center: { x: 1, y: 2, z: 0.5 }, size: { x: 'a', y: 1, z: 1 }, yawDeg: 0 }] })).toThrow()
  })
})
