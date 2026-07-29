import { describe, it, expect } from 'vitest'
import { robotWireframeModel } from '../../src/report/robotWireframe'
import type { RobotConfig } from '../../src/core/types'

const base: RobotConfig = {
  lengthM: 0.8, widthM: 0.6, chassisHeightM: 0.15, teamNumber: '766', superstructure: [], cameras: [],
}

const cam = (yawDeg: number, x = 0.3): RobotConfig['cameras'][number] => ({
  name: 'c', hfovDeg: 75, vfovDeg: 47, resWidth: 1280, resHeight: 800, maxRangeM: null,
  mount: { x, y: 0, z: 0.4, rollDeg: 0, pitchDeg: 0, yawDeg },
})

describe('robotWireframeModel', () => {
  it('bare chassis: 6 chassis polylines (2 rings + 4 verticals) + front marker', () => {
    const m = robotWireframeModel(base)
    expect(m.lines.length).toBe(7)
    const marker = m.lines.find((l) => l.color === '#ffc107')!
    expect(marker.pts[0][0]).toBeCloseTo(0.4) // starts at front face x = length/2
    expect(marker.pts[1][0]).toBeGreaterThan(0.4)
  })

  it('all chassis points lie within the chassis box bounds', () => {
    const m = robotWireframeModel(base)
    for (const l of m.lines.filter((l) => l.color === '#c9d2dc')) {
      for (const [x, y, z] of l.pts) {
        expect(Math.abs(x)).toBeLessThanOrEqual(0.4 + 1e-9)
        expect(Math.abs(y)).toBeLessThanOrEqual(0.3 + 1e-9)
        expect(z).toBeGreaterThanOrEqual(-1e-9)
        expect(z).toBeLessThanOrEqual(0.15 + 1e-9)
      }
    }
  })

  it('superstructure boxes add 6 polylines each, honoring yaw', () => {
    const robot: RobotConfig = {
      ...base,
      superstructure: [{ center: { x: 0, y: 0, z: 0.3 }, size: { x: 0.2, y: 0.2, z: 0.2 }, yawDeg: 45 }],
    }
    const m = robotWireframeModel(robot)
    expect(m.lines.length).toBe(7 + 6)
    // Yawed 45°: corners land on the axes at ±(half-diagonal) = ±0.1*sqrt(2).
    const boxPts = m.lines.filter((l) => l.color === '#8a94a2').flatMap((l) => l.pts)
    const maxX = Math.max(...boxPts.map((p) => Math.abs(p[0])))
    expect(maxX).toBeCloseTo(0.1 * Math.SQRT2, 5)
  })

  it('a camera adds cone edges + a boundary arc in its color, aimed by yaw', () => {
    const fwd = robotWireframeModel({ ...base, cameras: [cam(0)] })
    const back = robotWireframeModel({ ...base, cameras: [cam(180)] })
    // 4 edge rays + 1 arc polyline per camera.
    expect(fwd.lines.length).toBe(7 + 5)
    const coneTip = (m: ReturnType<typeof robotWireframeModel>) =>
      m.lines.filter((l) => !['#c9d2dc', '#ffc107', '#8a94a2'].includes(l.color))
    // Forward camera's far points extend to +x beyond the mount; rear camera's to -x.
    const fwdMax = Math.max(...coneTip(fwd).flatMap((l) => l.pts.map((p) => p[0])))
    const backMin = Math.min(...coneTip(back).flatMap((l) => l.pts.map((p) => p[0])))
    expect(fwdMax).toBeGreaterThan(1)
    expect(backMin).toBeLessThan(-1)
    // Every edge ray starts exactly at the mount point.
    for (const l of coneTip(fwd).slice(0, 4)) {
      expect(l.pts[0]).toEqual([0.3, 0, 0.4])
    }
  })

  it('arc points sit at the cone preview distance from the mount (spherical cap)', () => {
    const m = robotWireframeModel({ ...base, cameras: [cam(0)] })
    const cone = m.lines.filter((l) => !['#c9d2dc', '#ffc107', '#8a94a2'].includes(l.color))
    const arc = cone[cone.length - 1]
    for (const [x, y, z] of arc.pts) {
      expect(Math.hypot(x - 0.3, y - 0, z - 0.4)).toBeCloseTo(1.5, 6)
    }
  })

  it('fitRadius covers the mount offset plus cone length; targetZ is positive', () => {
    const m = robotWireframeModel({ ...base, cameras: [cam(0, 0.35)] })
    expect(m.fitRadius).toBeCloseTo(0.35 + 1.5)
    expect(m.targetZ).toBeGreaterThan(0)
  })

  it('model is JSON-serializable round-trip (feeds the inline viewer)', () => {
    const m = robotWireframeModel({ ...base, cameras: [cam(0), cam(90, 0)] })
    expect(JSON.parse(JSON.stringify(m))).toEqual(m)
  })
})
