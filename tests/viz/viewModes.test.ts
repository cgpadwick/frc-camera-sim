import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { OPTICAL_TO_THREE, viewModeList, nextViewMode, resolveViewMode, letterboxRect, povAspect } from '../../src/viz/viewModes'
import { cameraFieldPose } from '../../src/core/visibility'
import type { CameraSpec } from '../../src/core/types'

const close = (v: THREE.Vector3, x: number, y: number, z: number) => {
  expect(v.x).toBeCloseTo(x, 6)
  expect(v.y).toBeCloseTo(y, 6)
  expect(v.z).toBeCloseTo(z, 6)
}

describe('OPTICAL_TO_THREE', () => {
  it('three camera forward (-Z) maps to optical boresight (+X)', () => {
    close(new THREE.Vector3(0, 0, -1).applyQuaternion(OPTICAL_TO_THREE), 1, 0, 0)
  })
  it('three camera up (+Y) maps to optical up (+Z)', () => {
    close(new THREE.Vector3(0, 1, 0).applyQuaternion(OPTICAL_TO_THREE), 0, 0, 1)
  })
  it('is a proper rotation (right-handed: +X maps to image right, optical -Y)', () => {
    close(new THREE.Vector3(1, 0, 0).applyQuaternion(OPTICAL_TO_THREE), 0, -1, 0)
  })

  it('composed with a real camera pose, the three camera looks along the mount boresight', () => {
    // Camera yawed 90° left on a robot heading 0 at origin: boresight = field +Y.
    const spec: CameraSpec = {
      name: 't', hfovDeg: 75, vfovDeg: 47, resWidth: 1280, resHeight: 800, maxRangeM: null,
      mount: { x: 0, y: 0, z: 0.3, rollDeg: 0, pitchDeg: 0, yawDeg: 90 },
    }
    const pose = cameraFieldPose({ x: 0, y: 0, headingRad: 0 }, spec)
    const q = new THREE.Quaternion(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w)
      .multiply(OPTICAL_TO_THREE)
    close(new THREE.Vector3(0, 0, -1).applyQuaternion(q), 0, 1, 0)
    close(new THREE.Vector3(0, 1, 0).applyQuaternion(q), 0, 0, 1)
  })
})

describe('viewModeList / nextViewMode / resolveViewMode', () => {
  const modes = viewModeList(['front', 'rear-left'])
  it('orbit first, then one POV per camera with its name', () => {
    expect(modes.map((m) => m.id)).toEqual(['orbit', 'cam-0', 'cam-1'])
    expect(modes[1].label).toBe('POV: front')
    expect(modes[2].cameraIndex).toBe(1)
  })
  it('cycles in order and wraps', () => {
    expect(nextViewMode('orbit', modes)).toBe('cam-0')
    expect(nextViewMode('cam-0', modes)).toBe('cam-1')
    expect(nextViewMode('cam-1', modes)).toBe('orbit')
  })
  it('unknown id cycles to the first mode', () => {
    expect(nextViewMode('cam-9', modes)).toBe('orbit')
  })
  it('resolveViewMode keeps a valid POV, falls back to orbit when the camera is gone', () => {
    expect(resolveViewMode('cam-1', 2)).toBe('cam-1')
    expect(resolveViewMode('cam-1', 1)).toBe('orbit')
    expect(resolveViewMode('orbit', 0)).toBe('orbit')
  })
})

describe('letterboxRect', () => {
  it('pillarboxes a wide canvas showing a narrower aspect', () => {
    // 2000x1000 canvas, 1.6 aspect -> 1600x1000 centered at x=200
    expect(letterboxRect(2000, 1000, 1.6)).toEqual({ x: 200, y: 0, w: 1600, h: 1000 })
  })
  it('letterboxes a tall canvas showing a wider aspect', () => {
    // 1000x1000 canvas, 2.0 aspect -> 1000x500 centered at y=250
    expect(letterboxRect(1000, 1000, 2.0)).toEqual({ x: 0, y: 250, w: 1000, h: 500 })
  })
  it('exact fit needs no bars', () => {
    expect(letterboxRect(1600, 1000, 1.6)).toEqual({ x: 0, y: 0, w: 1600, h: 1000 })
  })
})

describe('povAspect', () => {
  it('derives aspect from FOVs, not sensor resolution', () => {
    // tan(41°)/tan(28°) ≈ 1.635 — noticeably not 1280/800 = 1.6
    expect(povAspect(82, 56)).toBeCloseTo(Math.tan((41 * Math.PI) / 180) / Math.tan((28 * Math.PI) / 180), 10)
    expect(povAspect(82, 56)).not.toBeCloseTo(1.6, 2)
  })
  it('rendered horizontal FOV round-trips: vfov + povAspect recovers hfov', () => {
    const aspect = povAspect(75, 47)
    const recoveredHfovDeg = (2 * Math.atan(aspect * Math.tan((47 * Math.PI) / 360)) * 180) / Math.PI
    expect(recoveredHfovDeg).toBeCloseTo(75, 10)
  })
})
