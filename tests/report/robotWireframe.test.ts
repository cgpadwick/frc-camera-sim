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
    for (const l of m.lines.filter((l) => l.color === '#ef5350')) {
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
    const boxPts = m.lines.filter((l) => l.color === '#c9d2dc').flatMap((l) => l.pts)
    const maxX = Math.max(...boxPts.map((p) => Math.abs(p[0])))
    expect(maxX).toBeCloseTo(0.1 * Math.SQRT2, 5)
  })

  it('a camera adds cone edges + a boundary arc in its color, aimed by yaw', () => {
    const fwd = robotWireframeModel({ ...base, cameras: [cam(0)] })
    const back = robotWireframeModel({ ...base, cameras: [cam(180)] })
    // 4 edge rays + 1 arc polyline per camera.
    expect(fwd.lines.length).toBe(7 + 5)
    const coneTip = (m: ReturnType<typeof robotWireframeModel>) =>
      m.lines.filter((l) => !['#ef5350', '#ffc107', '#c9d2dc'].includes(l.color))
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
    const cone = m.lines.filter((l) => !['#ef5350', '#ffc107', '#c9d2dc'].includes(l.color))
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

  it('labels: axis callouts only (no bumper text in labels)', () => {
    const m = robotWireframeModel(base)
    expect(m.labels.filter((l) => l.text === 'FRONT (+X)').length).toBe(1)
    expect(m.labels.filter((l) => l.text === 'LEFT (+Y)').length).toBe(1)
    expect(m.labels.length).toBe(2)
  })

  it('decals: team number baked onto all 4 bumper side quads, upright from outside', () => {
    const m = robotWireframeModel(base)
    expect(m.decals.length).toBe(4)
    const normals = m.decals.map((d) => d.n)
    expect(normals).toContainEqual([1, 0, 0])
    expect(normals).toContainEqual([-1, 0, 0])
    expect(normals).toContainEqual([0, 1, 0])
    expect(normals).toContainEqual([0, -1, 0])
    for (const d of m.decals) {
      expect(d.text).toBe('766')
      expect(d.color).toBe('#ffffff')
      expect(d.quad.length).toBe(4)
      // Bottom edge at z=0, top edge at chassis height.
      expect(d.quad[0][2]).toBe(0)
      expect(d.quad[1][2]).toBe(0)
      expect(d.quad[2][2]).toBeCloseTo(0.15)
      expect(d.quad[3][2]).toBeCloseTo(0.15)
      // Quad sits just outside the face along its normal.
      const off = d.quad[0][0] * d.n[0] + d.quad[0][1] * d.n[1]
      const half = d.n[0] !== 0 ? 0.4 : 0.3
      expect(off).toBeCloseTo(half + 0.003)
      // Upright text: bottom-left -> bottom-right runs along z×n (right as
      // seen from outside).
      const r = [-d.n[1], d.n[0]]
      const run = [d.quad[1][0] - d.quad[0][0], d.quad[1][1] - d.quad[0][1]]
      expect(run[0] * r[0] + run[1] * r[1]).toBeGreaterThan(0)
    }
  })

  it('model is JSON-serializable round-trip (feeds the inline viewer)', () => {
    const m = robotWireframeModel({ ...base, cameras: [cam(0), cam(90, 0)] })
    expect(JSON.parse(JSON.stringify(m))).toEqual(m)
  })

  it('boxes emit 6 translucent faces each (chassis + superstructure)', () => {
    const robot: RobotConfig = {
      ...base,
      superstructure: [{ center: { x: 0, y: 0, z: 0.3 }, size: { x: 0.2, y: 0.2, z: 0.2 }, yawDeg: 0 }],
    }
    const m = robotWireframeModel(robot)
    expect(m.faces.filter((f) => f.color === '#c62828').length).toBe(6)
    expect(m.faces.filter((f) => f.color === '#8a94a2').length).toBe(6)
    for (const f of m.faces) {
      expect(f.alpha).toBeGreaterThan(0)
      expect(f.alpha).toBeLessThan(1)
      expect(f.pts.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('a camera adds a translucent volume fill: side sheets from the apex + cap grid at range', () => {
    const bare = robotWireframeModel(base)
    const m = robotWireframeModel({ ...base, cameras: [cam(0)] })
    const camFaces = m.faces.slice(bare.faces.length)
    expect(camFaces.length).toBeGreaterThan(0)
    for (const f of camFaces) {
      for (const [x, y, z] of f.pts) {
        // Every fill vertex is the apex or within the preview range of it.
        expect(Math.hypot(x - 0.3, y - 0, z - 0.4)).toBeLessThanOrEqual(1.5 + 1e-9)
      }
    }
    // Side sheets start at the apex; cap quads all sit exactly at range.
    const triangles = camFaces.filter((f) => f.pts.length === 3)
    const dist = (p: [number, number, number]) => Math.hypot(p[0] - 0.3, p[1] - 0, p[2] - 0.4)
    // Quads split into the mount-marker cube (tiny, near the mount) and the cap grid (at range).
    const cubeQuads = camFaces.filter((f) => f.pts.length === 4 && f.pts.every((p) => dist(p) < 0.1))
    const capQuads = camFaces.filter((f) => f.pts.length === 4 && f.pts.every((p) => dist(p) > 1))
    expect(triangles.length).toBe(24) // 4 edges × CAP_SEG segments
    expect(cubeQuads.length).toBe(6)
    expect(capQuads.length).toBe(36) // CAP_SEG × CAP_SEG cap grid
    expect(cubeQuads.length + capQuads.length).toBe(camFaces.length - triangles.length)
    for (const f of triangles) expect(f.pts[0]).toEqual([0.3, 0, 0.4])
    for (const f of capQuads) {
      for (const p of f.pts) expect(dist(p)).toBeCloseTo(1.5, 6)
    }
  })
})
