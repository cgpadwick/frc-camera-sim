import { describe, it, expect } from 'vitest'
import { segmentHitsBox, detectTags, robotOccludersInField } from '../../src/core/visibility'
import { vec3, quatFromEuler, rad } from '../../src/core/math'
import type { Tag, CameraSpec, OccluderBox } from '../../src/core/types'

const box = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, yawDeg = 0): OccluderBox =>
  ({ center: vec3(cx, cy, cz), size: vec3(sx, sy, sz), yawDeg })

describe('segmentHitsBox', () => {
  it('hits box between endpoints', () => {
    expect(segmentHitsBox(vec3(0, 0, 0.5), vec3(4, 0, 0.5), box(2, 0, 0.5, 0.5, 0.5, 0.5))).toBe(true)
  })
  it('misses box off to the side', () => {
    expect(segmentHitsBox(vec3(0, 0, 0.5), vec3(4, 0, 0.5), box(2, 2, 0.5, 0.5, 0.5, 0.5))).toBe(false)
  })
  it('misses box beyond the segment end', () => {
    expect(segmentHitsBox(vec3(0, 0, 0.5), vec3(1, 0, 0.5), box(2, 0, 0.5, 0.5, 0.5, 0.5))).toBe(false)
  })
  it('respects box yaw', () => {
    // Long thin box rotated 90°: now spans Y, blocks the X-axis ray
    expect(segmentHitsBox(vec3(0, 0, 0.5), vec3(4, 0, 0.5), box(2, 1.2, 0.5, 3, 0.1, 1, 90))).toBe(true)
    expect(segmentHitsBox(vec3(0, 0, 0.5), vec3(4, 0, 0.5), box(2, 1.2, 0.5, 3, 0.1, 1, 0))).toBe(false)
  })
})

describe('occluded detection', () => {
  const cam: CameraSpec = {
    name: 't', hfovDeg: 90, vfovDeg: 60, resWidth: 1280, resHeight: 800, maxRangeM: null,
    mount: { x: 0, y: 0, z: 0.5, rollDeg: 0, pitchDeg: 0, yawDeg: 0 },
  }
  const tag: Tag = { id: 1, size: 0.1651, pose: { translation: vec3(3, 0, 0.5), rotation: quatFromEuler(0, 0, rad(180)) } }
  it('wall between camera and tag blocks detection', () => {
    expect(detectTags({ x: 0, y: 0, headingRad: 0 }, cam, [tag], [box(1.5, 0, 0.5, 0.2, 2, 2)])).toHaveLength(0)
  })
  it('partially blocking wall (covers one corner ray) blocks detection', () => {
    // Hand-checked geometry: tag corner c1 (local +z,-y => field (3, 0.08255, 0.58255)
    // after the tag's 180deg yaw) is hit by a thin post placed exactly on that ray at
    // x=1.5 (box center y=0.041275, z=0.541275, matching the ray's y/z at t=0.5).
    // The other three corner rays and the center ray (which stays at y=0, z=0.5) all
    // miss this box. Since occludedAny rejects a tag if any single ray is blocked,
    // clipping one corner is enough to reject the whole detection.
    expect(detectTags({ x: 0, y: 0, headingRad: 0 }, cam, [tag], [box(1.5, 0.041275, 0.541275, 0.02, 0.02, 0.06)]))
      .toHaveLength(0)
  })
})

describe('robotOccludersInField', () => {
  it('transforms superstructure boxes by robot pose', () => {
    const robot = { lengthM: 0.8, widthM: 0.8, chassisHeightM: 0.15, teamNumber: '0000', cameras: [],
      superstructure: [box(0.2, 0, 0.5, 0.1, 0.1, 1)] }
    const out = robotOccludersInField({ x: 5, y: 5, headingRad: rad(90) }, robot)
    expect(out[0].center.x).toBeCloseTo(5)
    expect(out[0].center.y).toBeCloseTo(5.2)
    expect(out[0].yawDeg).toBeCloseTo(90)
  })
})
