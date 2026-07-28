import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { sampleMountCandidates, optimizeCameraMounts, objectiveScore } from '../../src/core/optimize'
import { parseWpilibLayout } from '../../src/field/layoutLoader'
import { DEFAULT_CONFIG } from '../../src/core/defaults'
import type { RobotConfig, CameraSpec } from '../../src/core/types'

const layout = parseWpilibLayout(JSON.parse(readFileSync('public/layouts/2026-rebuilt-welded.json', 'utf8')))
// Coarse params keep the test fast; correctness, not quality, is under test.
const sweepParams = { cellSizeM: 1.5, headingCount: 4, idealRangeM: 5, rangeCapM: 5 }

const cam = (yawDeg: number): CameraSpec => ({
  name: `c${yawDeg}`, hfovDeg: 75, vfovDeg: 47, resWidth: 1280, resHeight: 800, maxRangeM: null,
  mount: { x: 0.3, y: 0, z: 0.25, rollDeg: 0, pitchDeg: 10, yawDeg },
})
const robot: RobotConfig = { ...structuredClone(DEFAULT_CONFIG.robot), cameras: [cam(0)] }

describe('sampleMountCandidates', () => {
  const candidates = sampleMountCandidates(robot)
  it('produces candidates on all four chassis faces and the superstructure', () => {
    expect(candidates.length).toBeGreaterThan(30)
    expect(candidates.some((c) => c.x > 0.3)).toBe(true) // front face
    expect(candidates.some((c) => c.x < -0.3)).toBe(true) // back face
    expect(candidates.some((c) => c.z > 0.5)).toBe(true) // up the elevator box
  })
  it('side-face candidates aim along the outward normal', () => {
    const front = candidates.find((c) => c.x > 0.3 && Math.abs(c.y) < 0.08 && c.z < 0.3)!
    expect(front.yawDeg).toBeCloseTo(0, 0)
    expect(front.pitchDeg).toBeCloseTo(0, 0)
  })
  it('top-face candidates aim level, never straight up', () => {
    for (const c of candidates.filter((v) => v.z > 0.9)) expect(Math.abs(c.pitchDeg)).toBeLessThan(1)
  })
})

describe('optimizeCameraMounts', () => {
  it('never lowers the score, keeps camera count and optics fixed', () => {
    const before = objectiveScore(robot, layout, [], sweepParams)
    const result = optimizeCameraMounts(robot, layout, [], {
      sweepParams,
      yawOffsetsDeg: [0],
      pitchOffsetsDeg: [0],
      rounds: 1,
    })
    expect(result.score).toBeGreaterThanOrEqual(before)
    expect(result.cameras).toHaveLength(robot.cameras.length)
    expect(result.cameras[0].hfovDeg).toBe(75)
    expect(result.cameras[0].resWidth).toBe(1280)
    expect(result.cameras[0].mount.rollDeg).toBe(0)
  })
  it('locked cameras keep their mount exactly', () => {
    const result = optimizeCameraMounts(robot, layout, [], {
      sweepParams,
      yawOffsetsDeg: [0],
      pitchOffsetsDeg: [0],
      rounds: 1,
      lockedCameras: [0],
    })
    expect(result.cameras[0].mount).toEqual(robot.cameras[0].mount)
    expect(result.evals).toBe(1) // only the baseline evaluation
  })
  it('shouldStop aborts early and still returns a valid result', () => {
    let calls = 0
    const result = optimizeCameraMounts(robot, layout, [], {
      sweepParams,
      yawOffsetsDeg: [0],
      pitchOffsetsDeg: [0],
      rounds: 1,
      shouldStop: () => ++calls > 5,
    })
    expect(result.cameras).toHaveLength(1)
    expect(result.evals).toBeLessThan(10)
  })
})
