import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { frustumCorners, sphericalCapPoint, CAMERA_COLORS, createFrustumView } from '../../src/viz/frustumView'
import { DEFAULT_CONFIG, SAMPLE_CAMERAS } from '../../src/core/defaults'
import { maxRangeFor } from '../../src/core/visibility'
import type { RobotPose } from '../../src/core/types'

describe('frustumCorners', () => {
  it('hfov 90 / vfov 60: |y/x| = tan(45deg), |z/x| = tan(30deg)', () => {
    const corners = frustumCorners(90, 60)
    expect(corners).toHaveLength(4)
    const tanH = Math.tan(Math.PI / 4) // 1
    const tanV = Math.tan(Math.PI / 6)
    for (const c of corners) {
      expect(Math.hypot(c.x, c.y, c.z)).toBeCloseTo(1, 6)
      expect(Math.abs(c.y / c.x)).toBeCloseTo(tanH, 6)
      expect(Math.abs(c.z / c.x)).toBeCloseTo(tanV, 6)
    }
  })

  it('all four sign combinations of (y, z) are present', () => {
    const corners = frustumCorners(90, 60)
    const signs = new Set(corners.map((c) => `${Math.sign(c.y)},${Math.sign(c.z)}`))
    expect(signs.size).toBe(4)
    expect(signs.has('1,1')).toBe(true)
    expect(signs.has('1,-1')).toBe(true)
    expect(signs.has('-1,1')).toBe(true)
    expect(signs.has('-1,-1')).toBe(true)
  })

  it('consecutive corners form a valid rectangle perimeter (adjacent corners differ in exactly one sign)', () => {
    const corners = frustumCorners(90, 60)
    for (let i = 0; i < 4; i++) {
      const a = corners[i]
      const b = corners[(i + 1) % 4]
      const sameY = Math.sign(a.y) === Math.sign(b.y)
      const sameZ = Math.sign(a.z) === Math.sign(b.z)
      expect(sameY !== sameZ).toBe(true)
    }
  })
})

describe('CAMERA_COLORS', () => {
  it('has 6 entries matching the spec', () => {
    expect(CAMERA_COLORS).toEqual([0x4fc3f7, 0xffb74d, 0xba68c8, 0x81c784, 0xf06292, 0xfff176])
  })
})

describe('createFrustumView', () => {
  const SAMPLE_ROBOT = { ...DEFAULT_CONFIG.robot, cameras: SAMPLE_CAMERAS }

const pose: RobotPose = { x: 8, y: 4, headingRad: 0 }

  it('builds one LineSegments per configured camera, colored by CAMERA_COLORS', () => {
    const scene = new THREE.Scene()
    const view = createFrustumView(scene)
    view.update(pose, SAMPLE_ROBOT, 0.1651)
    const root = scene.getObjectByName('frustums')!
    expect(root).toBeTruthy()
    const lineSegments: THREE.LineSegments[] = []
    root.traverse((o) => { if (o instanceof THREE.LineSegments) lineSegments.push(o) })
    expect(lineSegments).toHaveLength(SAMPLE_ROBOT.cameras.length)
    lineSegments.forEach((ls, i) => {
      const mat = ls.material as THREE.LineBasicMaterial
      expect(mat.color.getHex()).toBe(CAMERA_COLORS[i % CAMERA_COLORS.length])
    })
  })

  it('rebuilds when camera count changes', () => {
    const scene = new THREE.Scene()
    const view = createFrustumView(scene)
    view.update(pose, SAMPLE_ROBOT, 0.1651)
    const fewer = { ...SAMPLE_ROBOT, cameras: SAMPLE_ROBOT.cameras.slice(0, 1) }
    view.update(pose, fewer, 0.1651)
    const root = scene.getObjectByName('frustums')!
    const lineSegments: THREE.LineSegments[] = []
    root.traverse((o) => { if (o instanceof THREE.LineSegments) lineSegments.push(o) })
    expect(lineSegments).toHaveLength(1)
  })

  it('positions each frustum group at its camera field pose (not the origin)', () => {
    const scene = new THREE.Scene()
    const view = createFrustumView(scene)
    view.update(pose, SAMPLE_ROBOT, 0.1651)
    const root = scene.getObjectByName('frustums')!
    // The front camera is mounted forward of the robot origin, so its world
    // x should be greater than the robot pose x.
    const frontGroup = root.children[0]
    expect(frontGroup.position.x).toBeGreaterThan(pose.x)
  })

  it('recomputes frustum dirs (not just position) when an existing camera\'s FOV changes', () => {
    const scene = new THREE.Scene()
    const view = createFrustumView(scene)
    const robotA = {
      ...SAMPLE_ROBOT,
      cameras: [{ ...SAMPLE_ROBOT.cameras[0], hfovDeg: 90, vfovDeg: 60 }],
    }
    view.update(pose, robotA, 0.1651)
    const root = scene.getObjectByName('frustums')!
    const before = (root.children[0].children[0] as THREE.LineSegments).geometry.attributes.position.array.slice()

    // Same camera count (no rebuild trigger), but a different FOV.
    const robotB = {
      ...SAMPLE_ROBOT,
      cameras: [{ ...SAMPLE_ROBOT.cameras[0], hfovDeg: 40, vfovDeg: 20 }],
    }
    view.update(pose, robotB, 0.1651)
    const after = (root.children[0].children[0] as THREE.LineSegments).geometry.attributes.position.array

    expect(after).not.toEqual(before)

    // The far-rectangle vertex directions embedded in the redrawn geometry
    // should now match frustumCorners(40, 20) scaled by the (unchanged)
    // range, not the stale frustumCorners(90, 60) directions.
    const range = maxRangeFor(robotB.cameras[0], 0.1651)
    const expectedDirs = frustumCorners(40, 20)
    // First 8 floats are the 4 near(0,0,0)->far edges: [0,0,0, dir*range] x4.
    for (let i = 0; i < 4; i++) {
      const base = i * 6 + 3 // skip the (0,0,0) near vertex, land on the far vertex
      expect(after[base]).toBeCloseTo(expectedDirs[i].x * range, 5)
      expect(after[base + 1]).toBeCloseTo(expectedDirs[i].y * range, 5)
      expect(after[base + 2]).toBeCloseTo(expectedDirs[i].z * range, 5)
    }
  })
})


describe('sphericalCapPoint (QA round 8.3 v2 — the drawn far surface IS the detection sphere)', () => {
  it('every sampled far point sits at exactly the detection distance', () => {
    for (const u of [-1, -0.5, 0, 0.5, 1]) {
      for (const v of [-1, -0.5, 0, 0.5, 1]) {
        const p = sphericalCapPoint(u, v, 75, 47, 4)
        expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(4, 9)
      }
    }
  })
  it('boresight tip is at (range, 0, 0) — no center shortfall', () => {
    const p = sphericalCapPoint(0, 0, 75, 47, 4)
    expect(p.x).toBeCloseTo(4, 9)
    expect(p.y).toBeCloseTo(0, 9)
    expect(p.z).toBeCloseTo(0, 9)
  })
  it('corners coincide with the frustumCorners directions at spherical range — no corner overdraw', () => {
    const dirs = frustumCorners(75, 47)
    // frustumCorners order: (+,+), (+,-), (-,-), (-,+) in (y,z) signs = (u,v)
    const uv: [number, number][] = [[1, 1], [1, -1], [-1, -1], [-1, 1]]
    dirs.forEach((d, i) => {
      const p = sphericalCapPoint(uv[i][0], uv[i][1], 75, 47, 4)
      expect(p.x).toBeCloseTo(d.x * 4, 9)
      expect(p.y).toBeCloseTo(d.y * 4, 9)
      expect(p.z).toBeCloseTo(d.z * 4, 9)
    })
  })
})
