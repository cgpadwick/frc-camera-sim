import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseWpilibLayout } from '../../src/field/layoutLoader'
import { evaluatePose, idealTagCount } from '../../src/core/evaluate'
import type { RobotConfig } from '../../src/core/types'

const layout = parseWpilibLayout(JSON.parse(readFileSync('public/layouts/2026-rebuilt-welded.json', 'utf8')))
const robot: RobotConfig = {
  lengthM: 0.8, widthM: 0.8, chassisHeightM: 0.15, teamNumber: '0000', superstructure: [],
  cameras: [{ name: 'front', hfovDeg: 80, vfovDeg: 55, resWidth: 1280, resHeight: 800, maxRangeM: null,
    mount: { x: 0.3, y: 0, z: 0.4, rollDeg: 0, pitchDeg: 15, yawDeg: 0 } }],
}

describe('evaluatePose on real field', () => {
  it('center of field, some heading sees at least one tag', () => {
    // Sweep 8 headings at field center; at least one should see tags on a 32-tag field
    const scores = Array.from({ length: 8 }, (_, i) =>
      evaluatePose({ x: 16.541 / 2, y: 8.069 / 2, headingRad: (i * Math.PI) / 4 }, robot, layout, []).tagCount)
    expect(Math.max(...scores)).toBeGreaterThan(0)
  })
  it('zero cameras => 0 tags', () => {
    const r = { ...robot, cameras: [] }
    expect(evaluatePose({ x: 4, y: 4, headingRad: 0 }, r, layout, []).tagCount).toBe(0)
  })
})

describe('idealTagCount', () => {
  // One tag at (3, 0, 0.5) facing -X (toward the origin half-plane).
  const layout1 = {
    field: { length: 16, width: 8 },
    tags: [{ id: 1, size: 0.1651, pose: { translation: { x: 3, y: 0.5, z: 0.5 }, rotation: { w: 6.123233995736766e-17, x: 0, y: 0, z: 1 } } }],
  }
  it('counts a tag within range on its front side', () => {
    expect(idealTagCount(1, 0.5, layout1, [], 4)).toBe(1)
  })
  it('excludes a tag beyond range', () => {
    expect(idealTagCount(1, 0.5, layout1, [], 1.5)).toBe(0)
  })
  it('excludes a tag viewed from behind', () => {
    expect(idealTagCount(5, 0.5, layout1, [], 4)).toBe(0)
  })
  it('excludes past the skew limit (nearly edge-on)', () => {
    // Robot far to the side: view direction nearly parallel to the tag face.
    expect(idealTagCount(3.05, 4, layout1, [], 4)).toBe(0)
  })
  it('field occluder between robot and tag blocks it', () => {
    const wall = { center: { x: 2, y: 0.5, z: 0.5 }, size: { x: 0.1, y: 2, z: 2 }, yawDeg: 0 }
    expect(idealTagCount(1, 0.5, layout1, [wall], 4)).toBe(0)
  })
  it('is heading-independent by construction and >= any single-camera count at matching range', () => {
    // Sanity on the real field: ideal at generous range dominates a 1-camera actual count.
    const pose = { x: 16.541 / 2, y: 8.069 / 2, headingRad: 0 }
    const robotOne: RobotConfig = {
      lengthM: 0.8, widthM: 0.8, chassisHeightM: 0.15, teamNumber: '0', superstructure: [],
      cameras: [{ name: 'f', hfovDeg: 80, vfovDeg: 55, resWidth: 1280, resHeight: 800, maxRangeM: 4,
        mount: { x: 0.3, y: 0, z: 0.4, rollDeg: 0, pitchDeg: 15, yawDeg: 0 } }],
    }
    const actual = evaluatePose(pose, robotOne, layout, []).tagCount
    const ideal = idealTagCount(pose.x, pose.y, layout, [], 4)
    expect(ideal).toBeGreaterThanOrEqual(actual)
  })
})
