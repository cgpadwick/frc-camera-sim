import { describe, it, expect } from 'vitest'
import { integratePose } from '../../src/sim/driveController'
import type { RobotPose } from '../../src/core/types'

const FIELD_L = 16.54
const FIELD_W = 8.02

function pose(x: number, y: number, headingRad = 0): RobotPose {
  return { x, y, headingRad }
}

describe('integratePose', () => {
  it('W moves +X by speed*dt', () => {
    const p = pose(5, 5)
    integratePose(p, new Set(['w']), 0.5, FIELD_L, FIELD_W)
    expect(p.x).toBeCloseTo(5 + 3 * 0.5, 6)
    expect(p.y).toBeCloseTo(5, 6)
  })

  it('A moves +Y by speed*dt', () => {
    const p = pose(5, 5)
    integratePose(p, new Set(['a']), 0.5, FIELD_L, FIELD_W)
    expect(p.y).toBeCloseTo(5 + 3 * 0.5, 6)
    expect(p.x).toBeCloseTo(5, 6)
  })

  it('S moves -X, D moves -Y', () => {
    const p = pose(5, 5)
    integratePose(p, new Set(['s', 'd']), 0.5, FIELD_L, FIELD_W)
    expect(p.x).toBeCloseTo(5 - 1.5, 6)
    expect(p.y).toBeCloseTo(5 - 1.5, 6)
  })

  it('Q increases heading (CCW)', () => {
    const p = pose(5, 5)
    integratePose(p, new Set(['q']), 1, FIELD_L, FIELD_W)
    expect(p.headingRad).toBeCloseTo(2.5, 6)
  })

  it('E decreases heading (CW)', () => {
    const p = pose(5, 5)
    integratePose(p, new Set(['e']), 1, FIELD_L, FIELD_W)
    expect(p.headingRad).toBeCloseTo(-2.5, 6)
  })

  it('clamps to the low bound with a 0.4 m margin', () => {
    const p = pose(0.5, 0.5)
    integratePose(p, new Set(['s', 'd']), 10, FIELD_L, FIELD_W)
    expect(p.x).toBeCloseTo(0.4, 6)
    expect(p.y).toBeCloseTo(0.4, 6)
  })

  it('clamps to the high bound with a 0.4 m margin', () => {
    const p = pose(FIELD_L - 0.5, FIELD_W - 0.5)
    integratePose(p, new Set(['w', 'a']), 10, FIELD_L, FIELD_W)
    expect(p.x).toBeCloseTo(FIELD_L - 0.4, 6)
    expect(p.y).toBeCloseTo(FIELD_W - 0.4, 6)
  })

  it('combined diagonal: W+A moves +X and +Y simultaneously', () => {
    const p = pose(5, 5)
    integratePose(p, new Set(['w', 'a']), 0.5, FIELD_L, FIELD_W)
    expect(p.x).toBeCloseTo(5 + 1.5, 6)
    expect(p.y).toBeCloseTo(5 + 1.5, 6)
  })

  it('opposing keys cancel out (w+s, a+d)', () => {
    const p = pose(5, 5)
    integratePose(p, new Set(['w', 's', 'a', 'd']), 1, FIELD_L, FIELD_W)
    expect(p.x).toBeCloseTo(5, 6)
    expect(p.y).toBeCloseTo(5, 6)
  })

  it('no keys pressed: no motion', () => {
    const p = pose(5, 5, 1.2)
    integratePose(p, new Set(), 1, FIELD_L, FIELD_W)
    expect(p.x).toBeCloseTo(5, 6)
    expect(p.y).toBeCloseTo(5, 6)
    expect(p.headingRad).toBeCloseTo(1.2, 6)
  })
})
