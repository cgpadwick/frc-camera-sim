import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { sampleMountCandidates, optimizeCameraMounts, objectiveScore, fanSeeds } from '../../src/core/optimize'
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

describe('fast mask path parity', () => {
  // The optimizer's inlined visibility must agree with detectTags exactly.
  // Exercised indirectly: a 1-round greedy run whose reported score must be
  // reproducible by the reference objectiveScore on the returned cameras.
  it('returned score matches reference scoring of returned cameras', () => {
    const result = optimizeCameraMounts(robot, layout, [], {
      sweepParams,
      yawOffsetsDeg: [-30, 0, 30],
      pitchOffsetsDeg: [0, 15],
      rounds: 1,
    })
    const reference = objectiveScore({ ...robot, cameras: result.cameras }, layout, [], sweepParams)
    expect(result.score).toBeCloseTo(reference, 6)
  })
})

describe('cluster-fan seeding (regression: greedy could not reach coordinated solutions)', () => {
  // User's real one-box, 4-face-camera build. Hand-placed "all cameras
  // clustered on the box top, up-tilted, even fan" beat the optimizer
  // 40 vs 31 before fan seeds existed. The optimizer must now match or
  // beat that family. Coarse params keep CI fast; the relation holds at
  // production resolution too (verified manually at 40.51 vs 40.42).
  const box = { center: { x: 0, y: 0, z: 0.331 }, size: { x: 0.639, y: 0.604, z: 0.385 }, yawDeg: 0 }
  const mk = (x: number, y: number, z: number, yawDeg: number, pitchDeg = 0): CameraSpec => ({
    name: 'c', hfovDeg: 75, vfovDeg: 47, resWidth: 1280, resHeight: 800, maxRangeM: null,
    mount: { x, y, z, rollDeg: 0, pitchDeg, yawDeg },
  })
  const spread: RobotConfig = {
    lengthM: 0.75, widthM: 0.75, chassisHeightM: 0.13, teamNumber: '766', superstructure: [box],
    cameras: [mk(0.319, 0.013, 0.3, 0), mk(-0.011, 0.302, 0.364, 90), mk(-0.319, 0.019, 0.36, 180), mk(-0.043, -0.302, 0.378, -90)],
  }
  const coarse = { cellSizeM: 1.0, headingCount: 8, idealRangeM: 4.32, rangeCapM: 4 }

  it('fanSeeds proposes clustered fans on every box top, level and up-tilted', () => {
    const seeds = fanSeeds(spread)
    expect(seeds.length).toBe(4) // 1 box x 2 base yaws x 2 pitches
    for (const seed of seeds) {
      expect(seed).toHaveLength(4)
      for (const m of seed) {
        expect(m.x).toBeCloseTo(0)
        expect(m.y).toBeCloseTo(0)
        expect(m.z).toBeCloseTo(0.544, 3)
      }
      const yaws = seed.map((m) => m.yawDeg)
      expect(new Set(yaws).size).toBe(4) // even fan, no duplicates
    }
  })

  it('optimizer matches or beats the hand-placed up-tilted cluster fan', () => {
    const topZ = 0.331 + 0.385 / 2 + 0.02
    const handSolution: RobotConfig = {
      ...spread,
      cameras: [mk(0, 0, topZ, 45, -15), mk(0, 0, topZ, 135, -15), mk(0, 0, topZ, -135, -15), mk(0, 0, topZ, -45, -15)],
    }
    const hand = objectiveScore(handSolution, layout, [], coarse)
    const res = optimizeCameraMounts(spread, layout, [], { sweepParams: coarse })
    expect(res.score).toBeGreaterThanOrEqual(hand)
    // And it must genuinely move the cameras off the faces.
    const identity = JSON.stringify(res.cameras.map((c) => c.mount)) === JSON.stringify(spread.cameras.map((c) => c.mount))
    expect(identity).toBe(false)
  }, 120000)
})
