import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { frustumCorners, CAMERA_COLORS, createFrustumView } from '../../src/viz/frustumView'
import { DEFAULT_CONFIG } from '../../src/core/defaults'
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
  const pose: RobotPose = { x: 8, y: 4, headingRad: 0 }

  it('builds one LineSegments per configured camera, colored by CAMERA_COLORS', () => {
    const scene = new THREE.Scene()
    const view = createFrustumView(scene)
    view.update(pose, DEFAULT_CONFIG.robot, 0.1651)
    const root = scene.getObjectByName('frustums')!
    expect(root).toBeTruthy()
    const lineSegments: THREE.LineSegments[] = []
    root.traverse((o) => { if (o instanceof THREE.LineSegments) lineSegments.push(o) })
    expect(lineSegments).toHaveLength(DEFAULT_CONFIG.robot.cameras.length)
    lineSegments.forEach((ls, i) => {
      const mat = ls.material as THREE.LineBasicMaterial
      expect(mat.color.getHex()).toBe(CAMERA_COLORS[i % CAMERA_COLORS.length])
    })
  })

  it('rebuilds when camera count changes', () => {
    const scene = new THREE.Scene()
    const view = createFrustumView(scene)
    view.update(pose, DEFAULT_CONFIG.robot, 0.1651)
    const fewer = { ...DEFAULT_CONFIG.robot, cameras: DEFAULT_CONFIG.robot.cameras.slice(0, 1) }
    view.update(pose, fewer, 0.1651)
    const root = scene.getObjectByName('frustums')!
    const lineSegments: THREE.LineSegments[] = []
    root.traverse((o) => { if (o instanceof THREE.LineSegments) lineSegments.push(o) })
    expect(lineSegments).toHaveLength(1)
  })

  it('positions each frustum group at its camera field pose (not the origin)', () => {
    const scene = new THREE.Scene()
    const view = createFrustumView(scene)
    view.update(pose, DEFAULT_CONFIG.robot, 0.1651)
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
      ...DEFAULT_CONFIG.robot,
      cameras: [{ ...DEFAULT_CONFIG.robot.cameras[0], hfovDeg: 90, vfovDeg: 60 }],
    }
    view.update(pose, robotA, 0.1651)
    const root = scene.getObjectByName('frustums')!
    const before = (root.children[0].children[0] as THREE.LineSegments).geometry.attributes.position.array.slice()

    // Same camera count (no rebuild trigger), but a different FOV.
    const robotB = {
      ...DEFAULT_CONFIG.robot,
      cameras: [{ ...DEFAULT_CONFIG.robot.cameras[0], hfovDeg: 40, vfovDeg: 20 }],
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
