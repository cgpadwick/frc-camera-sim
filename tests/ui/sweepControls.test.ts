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
