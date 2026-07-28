import { describe, it, expect } from 'vitest'
import { normalToYawPitch } from '../../src/editor/placementMath'
import { quatFromEuler, rotateVec, vec3, rad, normalize } from '../../src/core/math'

/** Boresight of a mount with the given yaw/pitch — must recover the normal. */
function boresight(yawDeg: number, pitchDeg: number) {
  return rotateVec(quatFromEuler(0, rad(pitchDeg), rad(yawDeg)), vec3(1, 0, 0))
}

describe('normalToYawPitch', () => {
  it('cardinal faces', () => {
    expect(normalToYawPitch(vec3(1, 0, 0))).toEqual({ yawDeg: 0, pitchDeg: -0 })
    expect(normalToYawPitch(vec3(0, 1, 0)).yawDeg).toBeCloseTo(90)
    expect(normalToYawPitch(vec3(-1, 0, 0)).yawDeg).toBeCloseTo(180)
    const top = normalToYawPitch(vec3(0, 0, 1))
    expect(top.pitchDeg).toBeCloseTo(-90)
    expect(top.yawDeg).toBe(0)
    expect(normalToYawPitch(vec3(0, 0, -1)).pitchDeg).toBeCloseTo(90)
  })

  it('round-trips: quatFromEuler boresight equals the input normal', () => {
    const cases = [
      vec3(1, 0, 0),
      vec3(0, -1, 0),
      normalize(vec3(1, 1, 0)),
      normalize(vec3(1, -2, 0.5)),
      normalize(vec3(-0.3, 0.4, -0.86)),
    ]
    for (const n of cases) {
      const { yawDeg, pitchDeg } = normalToYawPitch(n)
      const b = boresight(yawDeg, pitchDeg)
      expect(b.x).toBeCloseTo(n.x, 6)
      expect(b.y).toBeCloseTo(n.y, 6)
      expect(b.z).toBeCloseTo(n.z, 6)
    }
  })
})
