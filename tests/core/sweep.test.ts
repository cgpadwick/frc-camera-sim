import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { runSweep, cellIndex } from '../../src/core/sweep'
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
  const params = { cellSizeM: 1.0, headingCount: 4 }
  const result = runSweep(layout, robot, [], params)

  it('grid dimensions', () => {
    expect(result.cols).toBe(Math.ceil(16.541 / 1.0))
    expect(result.rows).toBe(Math.ceil(8.069 / 1.0))
    expect(result.minScore.length).toBe(result.cols * result.rows)
    expect(result.perHeading.length).toBe(result.cols * result.rows * 4)
  })
  it('min <= avg everywhere', () => {
    for (let i = 0; i < result.minScore.length; i++)
      expect(result.minScore[i]).toBeLessThanOrEqual(result.avgScore[i] + 1e-6)
  })
  it('single fixed camera: worst-case has blind headings near walls, avg > 0 somewhere', () => {
    expect(Math.max(...result.avgScore)).toBeGreaterThan(0)
  })
  it('progress callback fires and ends at 1', () => {
    const fracs: number[] = []
    runSweep(layout, robot, [], params, (f) => fracs.push(f))
    expect(fracs.length).toBe(result.rows)
    expect(fracs[fracs.length - 1]).toBeCloseTo(1)
  })
  it('cellIndex row-major', () => expect(cellIndex(2, 3, 17)).toBe(53))
})
