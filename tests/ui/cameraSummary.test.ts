import { describe, it, expect } from 'vitest'
import { facingWord, cameraSummary } from '../../src/ui/cameraSummary'
import type { CameraSpec } from '../../src/core/types'

describe('facingWord', () => {
  it('cardinals', () => {
    expect(facingWord(0)).toBe('front')
    expect(facingWord(90)).toBe('left')
    expect(facingWord(180)).toBe('back')
    expect(facingWord(-180)).toBe('back')
    expect(facingWord(-90)).toBe('right')
  })
  it('diagonals and boundaries', () => {
    expect(facingWord(45)).toBe('front-left')
    expect(facingWord(-45)).toBe('front-right')
    expect(facingWord(-150)).toBe('back-right')
    expect(facingWord(140)).toBe('back-left')
    expect(facingWord(22)).toBe('front')
    expect(facingWord(23)).toBe('front-left')
  })
  it('wraps beyond ±180', () => {
    expect(facingWord(270)).toBe('right')
    expect(facingWord(-270)).toBe('left')
  })
})

describe('cameraSummary', () => {
  const cam = (over: Partial<CameraSpec['mount']> = {}, hfov = 75): CameraSpec => ({
    name: 'c', hfovDeg: hfov, vfovDeg: 47, resWidth: 1280, resHeight: 800, maxRangeM: null,
    mount: { x: 0, y: 0, z: 0.45, rollDeg: 0, pitchDeg: -15, yawDeg: -30, ...over },
  })
  it('tester spec example shape', () => {
    expect(cameraSummary(cam({ yawDeg: 45, pitchDeg: -15 }))).toBe('75° lens · faces front-left · tilted up 15° · mounted 0.45 m up')
  })
  it('down tilt and level', () => {
    expect(cameraSummary(cam({ pitchDeg: 10 }))).toContain('tilted down 10°')
    expect(cameraSummary(cam({ pitchDeg: 0 }))).toContain('level')
  })
})
