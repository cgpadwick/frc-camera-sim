import { describe, it, expect } from 'vitest'
import { detectTags, maxRangeFor, projectToImage, cameraFieldPose } from '../../src/core/visibility'
import { vec3, quatFromEuler, rad } from '../../src/core/math'
import type { Tag, CameraSpec } from '../../src/core/types'

const cam = (over: Partial<CameraSpec> = {}): CameraSpec => ({
  name: 'test', hfovDeg: 90, vfovDeg: 60, resWidth: 1280, resHeight: 800, maxRangeM: null,
  mount: { x: 0, y: 0, z: 0.5, rollDeg: 0, pitchDeg: 0, yawDeg: 0 }, ...over,
})
// Tag 3 m in front of origin, facing back toward origin (faces -X => yaw 180)
const tagAt = (x: number, y: number, z = 0.5, yawDeg = 180): Tag => ({
  id: 1, size: 0.1651,
  pose: { translation: vec3(x, y, z), rotation: quatFromEuler(0, 0, rad(yawDeg)) },
})
const origin = { x: 0, y: 0, headingRad: 0 }

describe('projectToImage', () => {
  const pose = cameraFieldPose(origin, cam())
  it('point on optical axis projects to center', () => {
    const p = projectToImage(pose, 90, 60, vec3(3, 0, 0.5))!
    expect(p.u).toBeCloseTo(0); expect(p.v).toBeCloseTo(0)
  })
  it('point at horizontal FOV edge has |u| = 1', () => {
    // hfov 90 => edge at 45°: y = x
    const p = projectToImage(pose, 90, 60, vec3(3, 3, 0.5))!
    expect(Math.abs(p.u)).toBeCloseTo(1)
  })
  it('point behind camera returns null', () => {
    expect(projectToImage(pose, 90, 60, vec3(-1, 0, 0.5))).toBeNull()
  })
})

describe('detectTags', () => {
  it('sees a facing tag in front', () => {
    const d = detectTags(origin, cam(), [tagAt(3, 0)], [])
    expect(d).toHaveLength(1)
    expect(d[0].distanceM).toBeCloseTo(3, 1)
    expect(d[0].skewRad).toBeCloseTo(0, 1)
  })
  it('rejects tag behind robot', () => {
    expect(detectTags(origin, cam(), [tagAt(-3, 0)], [])).toHaveLength(0)
  })
  it('rejects tag beyond max range', () => {
    expect(detectTags(origin, cam({ maxRangeM: 2 }), [tagAt(3, 0)], [])).toHaveLength(0)
  })
  it('rejects tag past skew threshold (edge-on)', () => {
    expect(detectTags(origin, cam(), [tagAt(3, 0, 0.5, 90)], [])).toHaveLength(0)
  })
  it('rejects tag straddling FOV edge even when center is inside', () => {
    // hfov 90 => at x=1, edge at |y|=1. Center just inside, one corner outside.
    const d = detectTags(origin, cam(), [tagAt(1, 0.999, 0.5, 180)], [])
    expect(d).toHaveLength(0)
  })
  it('camera yawed 180 sees tag behind robot', () => {
    const c = cam({ mount: { x: 0, y: 0, z: 0.5, rollDeg: 0, pitchDeg: 0, yawDeg: 180 } })
    expect(detectTags(origin, c, [tagAt(-3, 0, 0.5, 0)], [])).toHaveLength(1)
  })
})

describe('maxRangeFor', () => {
  it('derives from resolution when maxRangeM null', () => {
    // focalPx = 640/tan(45°) = 640; 0.1651*640/20 ≈ 5.28
    expect(maxRangeFor(cam(), 0.1651)).toBeCloseTo(5.28, 1)
  })
  it('uses override when set', () => {
    expect(maxRangeFor(cam({ maxRangeM: 4 }), 0.1651)).toBe(4)
  })
})
