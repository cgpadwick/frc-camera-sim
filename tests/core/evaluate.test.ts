import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseWpilibLayout } from '../../src/field/layoutLoader'
import { evaluatePose } from '../../src/core/evaluate'
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
