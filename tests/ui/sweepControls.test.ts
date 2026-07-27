import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { runSweep, cellIndex } from '../../src/core/sweep'
import { parseWpilibLayout } from '../../src/field/layoutLoader'
import { buildCellDetail } from '../../src/ui/sweepControls'
import { scoreBand } from '../../src/core/scoring'
import type { RobotConfig } from '../../src/core/types'

const layout = parseWpilibLayout(JSON.parse(readFileSync('public/layouts/2026-rebuilt-welded.json', 'utf8')))
const robot: RobotConfig = {
  lengthM: 0.8,
  widthM: 0.8,
  chassisHeightM: 0.15,
  teamNumber: '0000',
  superstructure: [],
  cameras: [
    {
      name: 'front',
      hfovDeg: 80,
      vfovDeg: 55,
      resWidth: 1280,
      resHeight: 800,
      maxRangeM: null,
      mount: { x: 0.3, y: 0, z: 0.4, rollDeg: 0, pitchDeg: 15, yawDeg: 0 },
    },
  ],
}

describe('buildCellDetail', () => {
  const params = { cellSizeM: 1.0, headingCount: 4 }
  const result = runSweep(layout, robot, [], params)
  const c = 3
  const r = 2

  it('one row per heading, matching perHeading exactly', () => {
    const detail = buildCellDetail(result, c, r, robot, layout, [])
    expect(detail.rows).toHaveLength(4)
    const i = cellIndex(c, r, result.cols)
    detail.rows.forEach((row, h) => {
      expect(row.score).toBeCloseTo(result.perHeading[i * 4 + h])
      expect(row.band).toBe(scoreBand(row.score))
      expect(row.headingDeg).toBe((360 * h) / 4)
    })
  })

  it('field coords are cell-center coordinates', () => {
    const detail = buildCellDetail(result, c, r, robot, layout, [])
    expect(detail.xM).toBeCloseTo((c + 0.5) * params.cellSizeM)
    expect(detail.yM).toBeCloseTo((r + 0.5) * params.cellSizeM)
    expect(detail.c).toBe(c)
    expect(detail.r).toBe(r)
  })

  it('worstHeadingDeg matches the heading with the minimum score', () => {
    const detail = buildCellDetail(result, c, r, robot, layout, [])
    const scores = detail.rows.map((row) => row.score)
    const minIdx = scores.indexOf(Math.min(...scores))
    expect(detail.worstHeadingDeg).toBe((360 * minIdx) / 4)
    // and it agrees with the stored minScore for that cell
    const i = cellIndex(c, r, result.cols)
    expect(Math.min(...scores)).toBeCloseTo(result.minScore[i])
  })

  it('worstHeadingCameras has one entry per robot camera, tagIds from a fresh evaluatePose at the worst heading', () => {
    const detail = buildCellDetail(result, c, r, robot, layout, [])
    expect(detail.worstHeadingCameras).toHaveLength(robot.cameras.length)
    expect(detail.worstHeadingCameras[0].cameraName).toBe('front')
    expect(Array.isArray(detail.worstHeadingCameras[0].tagIds)).toBe(true)
  })

  it('an all-zero-score cell (e.g. no cameras) reports no tags at the worst heading', () => {
    const blindRobot: RobotConfig = { ...robot, cameras: [] }
    const blindResult = runSweep(layout, blindRobot, [], params)
    const detail = buildCellDetail(blindResult, c, r, blindRobot, layout, [])
    expect(detail.rows.every((row) => row.score === 0)).toBe(true)
    expect(detail.rows.every((row) => row.band === 'dead')).toBe(true)
    expect(detail.worstHeadingCameras).toHaveLength(0)
  })
})

// Regression coverage for a bug caught in review: main.ts's click-to-inspect
// handler must pass the robot config *snapshotted at sweep time*
// (lastSweep.config.robot), not whatever the live config is at click time —
// buildCellDetail's score table (from result.perHeading) and its
// worst-heading camera/tag recompute (a fresh evaluatePose call) must both
// describe the same robot, or a config edit after a sweep silently produces
// a self-contradictory detail box (old-config scores, new-config cameras).
// buildCellDetail itself has no notion of "live" vs "snapshot" — it renders
// whatever robot it's given — so this documents the caller-side invariant
// the wiring fix depends on.
describe('buildCellDetail robot snapshot vs. live drift (regression)', () => {
  const params = { cellSizeM: 1.0, headingCount: 4 }
  const c = 3
  const r = 2

  const robotA: RobotConfig = { ...robot, cameras: [robot.cameras[0]] } // 1 camera — the config the sweep was actually run with
  const robotB: RobotConfig = {
    ...robot,
    cameras: [
      robot.cameras[0],
      {
        name: 'rear-left',
        hfovDeg: 75,
        vfovDeg: 47,
        resWidth: 1280,
        resHeight: 800,
        maxRangeM: null,
        mount: { x: -0.3, y: 0.3, z: 0.4, rollDeg: 0, pitchDeg: 15, yawDeg: 160 },
      },
    ],
  } // 2 cameras — simulates the live config after a post-sweep edit (e.g. "+ Add camera")

  const resultA = runSweep(layout, robotA, [], params)

  it('called with the sweep-time snapshot (robotA): camera list is internally consistent with the sweep', () => {
    const detail = buildCellDetail(resultA, c, r, robotA, layout, [])
    expect(detail.worstHeadingCameras).toHaveLength(robotA.cameras.length)
    expect(detail.worstHeadingCameras.map((cam) => cam.cameraName)).toEqual(robotA.cameras.map((cam) => cam.name))
    // Score rows are exactly the sweep's own perHeading data for robotA.
    const i = cellIndex(c, r, resultA.cols)
    detail.rows.forEach((row, h) => expect(row.score).toBeCloseTo(resultA.perHeading[i * 4 + h]))
  })

  it('called with a different ("live/mutated") robot than the sweep was run with: camera list reflects that other robot, not the sweep\'s — demonstrating why the caller must always pass the snapshot', () => {
    const driftedDetail = buildCellDetail(resultA, c, r, robotB, layout, [])
    // The score table still comes from resultA (robotA's sweep) ...
    const i = cellIndex(c, r, resultA.cols)
    driftedDetail.rows.forEach((row, h) => expect(row.score).toBeCloseTo(resultA.perHeading[i * 4 + h]))
    // ... but the camera/tag recompute now describes robotB: a
    // self-contradictory detail box (2 cameras listed against scores that
    // were computed with only 1 camera in play). This is exactly the drift
    // main.ts must avoid by always passing lastSweep.config.robot.
    expect(driftedDetail.worstHeadingCameras).toHaveLength(robotB.cameras.length)
    expect(driftedDetail.worstHeadingCameras).not.toHaveLength(robotA.cameras.length)
    expect(driftedDetail.worstHeadingCameras.map((cam) => cam.cameraName)).toEqual(robotB.cameras.map((cam) => cam.name))
  })
})
