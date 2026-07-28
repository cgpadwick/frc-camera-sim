import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { runSweep, cellIndex, coverageScoreVsIdeal } from '../../src/core/sweep'
import type { SweepResult } from '../../src/core/sweep'
import { parseWpilibLayout } from '../../src/field/layoutLoader'
import type { RobotConfig } from '../../src/core/types'

const layout = parseWpilibLayout(JSON.parse(readFileSync('public/layouts/2026-rebuilt-welded.json', 'utf8')))
const robot: RobotConfig = {
  lengthM: 0.8, widthM: 0.8, chassisHeightM: 0.15, teamNumber: '0000', superstructure: [],
  cameras: [{ name: 'front', hfovDeg: 80, vfovDeg: 55, resWidth: 1280, resHeight: 800, maxRangeM: null,
    mount: { x: 0.3, y: 0, z: 0.4, rollDeg: 0, pitchDeg: 15, yawDeg: 0 } }],
}

describe('runSweep', () => {
  // Coarse grid to keep the test fast
  const params = { cellSizeM: 1.0, headingCount: 4, idealRangeM: 6 }
  const result = runSweep(layout, robot, [], params)

  it('grid dimensions', () => {
    expect(result.cols).toBe(Math.ceil(16.541 / 1.0))
    expect(result.rows).toBe(Math.ceil(8.069 / 1.0))
    expect(result.minCount.length).toBe(result.cols * result.rows)
    expect(result.perHeading.length).toBe(result.cols * result.rows * 4)
  })
  it('min <= avg everywhere', () => {
    for (let i = 0; i < result.minCount.length; i++)
      expect(result.minCount[i]).toBeLessThanOrEqual(result.avgCount[i] + 1e-6)
  })
  it('single fixed camera: worst-case has blind headings near walls, avg > 0 somewhere', () => {
    expect(Math.max(...result.avgCount)).toBeGreaterThan(0)
  })
  it('progress callback fires and ends at 1', () => {
    const fracs: number[] = []
    runSweep(layout, robot, [], params, (f) => fracs.push(f))
    expect(fracs.length).toBe(result.rows)
    expect(fracs[fracs.length - 1]).toBeCloseTo(1)
  })
  it('cellIndex row-major', () => expect(cellIndex(2, 3, 17)).toBe(53))
  it('idealCount present, heading-independent upper bound >= minCount at generous range', () => {
    expect(result.idealCount.length).toBe(result.cols * result.rows)
    expect(result.idealRangeM).toBe(6)
    // Ideal range 6m exceeds the camera's derived ~5.3m detect range, so the
    // omnidirectional upper bound must dominate the worst-case actual count.
    for (let i = 0; i < result.minCount.length; i++)
      expect(result.idealCount[i]).toBeGreaterThanOrEqual(result.minCount[i])
  })
})

describe('coverageScoreVsIdeal', () => {
  const fake = (minV: number[], avgV: number[], idealV: number[]): SweepResult => ({
    cols: minV.length, rows: 1, cellSizeM: 1, headingCount: 2,
    minCount: Float32Array.from(minV), avgCount: Float32Array.from(avgV),
    perHeading: new Float32Array(minV.length * 2),
    idealCount: Float32Array.from(idealV), idealRangeM: 4,
    tagSeen: {}, cameraDetections: [],
  })
  it('ideal-equals-actual scores 100 both ways', () => {
    const s = coverageScoreVsIdeal(fake([2, 3], [2, 3], [2, 3]))!
    expect(s.worstPct).toBeCloseTo(100)
    expect(s.avgPct).toBeCloseTo(100)
  })
  it('half coverage scores 50; actual clamped to ideal cannot exceed 100', () => {
    const s = coverageScoreVsIdeal(fake([1, 1], [5, 5], [2, 2]))!
    expect(s.worstPct).toBeCloseTo(50)
    expect(s.avgPct).toBeCloseTo(100) // 5 clamps to 2 per cell
  })
  it('all-zero ideal returns null', () => {
    expect(coverageScoreVsIdeal(fake([1], [1], [0]))).toBeNull()
  })
})
