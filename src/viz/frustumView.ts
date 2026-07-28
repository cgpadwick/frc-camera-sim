import * as THREE from 'three'
import type { CameraSpec, RobotConfig, RobotPose } from '../core/types'
import { cameraFieldPose, maxRangeFor } from '../core/visibility'

/**
 * Shared per-camera color palette, indexed with wraparound
 * (`CAMERA_COLORS[i % CAMERA_COLORS.length]`). Reused by frustums, tag
 * highlight rings, and the HUD so a camera reads as the same color
 * everywhere in the UI.
 */
export const CAMERA_COLORS = [0x4fc3f7, 0xffb74d, 0xba68c8, 0x81c784, 0xf06292, 0xfff176]

export interface Vec3Like {
  x: number
  y: number
  z: number
}

/**
 * Pure, DOM-free: the 4 far-plane corner unit directions of a camera
 * frustum in the camera's local frame (+X forward/boresight, matching
 * core/visibility.ts's projectToImage convention). Ordered so consecutive
 * entries trace the rectangle's perimeter (index i -> i+1 differs in
 * exactly one of y/z sign), suitable for drawing the far rectangle as a
 * closed loop.
 */
export function frustumCorners(hfovDeg: number, vfovDeg: number): Vec3Like[] {
  const tanH = Math.tan((hfovDeg * Math.PI) / 360)
  const tanV = Math.tan((vfovDeg * Math.PI) / 360)
  const corner = (sy: number, sz: number): Vec3Like => {
    const y = sy * tanH
    const z = sz * tanV
    const len = Math.hypot(1, y, z)
    return { x: 1 / len, y: y / len, z: z / len }
  }
  return [corner(1, 1), corner(1, -1), corner(-1, -1), corner(-1, 1)]
}

// 4 near(camera origin)->far edges + 4 far-rectangle edges, 2 vertices each.
const EDGE_COUNT = 8
const VERT_COUNT = EDGE_COUNT * 2

interface CameraFrustum {
  group: THREE.Group
  lines: THREE.LineSegments
  positions: Float32Array
  dirs: Vec3Like[]
  /** FOV the current `dirs` were computed from — compared each update() so an FOV edit on an existing camera (no count change, so no rebuild()) still recomputes dirs instead of leaving the drawn cone at the stale angle. */
  hfovDeg: number
  vfovDeg: number
  lastRange: number
}

function writeFrustumPositions(out: Float32Array, dirs: Vec3Like[], range: number): void {
  let o = 0
  const write = (x: number, y: number, z: number) => {
    out[o++] = x
    out[o++] = y
    out[o++] = z
  }
  for (const d of dirs) {
    write(0, 0, 0)
    write(d.x * range, d.y * range, d.z * range)
  }
  for (let i = 0; i < dirs.length; i++) {
    const a = dirs[i]
    const b = dirs[(i + 1) % dirs.length]
    write(a.x * range, a.y * range, a.z * range)
    write(b.x * range, b.y * range, b.z * range)
  }
}

function buildCameraFrustum(spec: CameraSpec, colorIndex: number): CameraFrustum {
  const dirs = frustumCorners(spec.hfovDeg, spec.vfovDeg)
  const positions = new Float32Array(VERT_COUNT * 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.LineBasicMaterial({ color: CAMERA_COLORS[colorIndex % CAMERA_COLORS.length] })
  const lines = new THREE.LineSegments(geometry, material)
  const group = new THREE.Group()
  group.add(lines)
  return { group, lines, positions, dirs, hfovDeg: spec.hfovDeg, vfovDeg: spec.vfovDeg, lastRange: -1 }
}

function disposeCameraFrustum(entry: CameraFrustum): void {
  entry.lines.geometry.dispose()
  ;(entry.lines.material as THREE.Material).dispose()
}

export interface FrustumView {
  /** `hiddenIndex`: camera whose wireframe is hidden this frame (POV view renders from inside it). */
  update(robotPose: RobotPose, robot: RobotConfig, tagSize: number, hiddenIndex?: number | null): void
  /** Show/hide all frustum wireframes (robot editor declutter toggle). */
  setVisible(visible: boolean): void
}

/** Live wireframe camera frustums, one per configured camera, reparented under a 'frustums' group. */
export function createFrustumView(scene: THREE.Scene): FrustumView {
  const root = new THREE.Group()
  root.name = 'frustums'
  scene.add(root)
  let cameras: CameraFrustum[] = []

  function rebuild(specs: CameraSpec[]): void {
    for (const entry of cameras) {
      root.remove(entry.group)
      disposeCameraFrustum(entry)
    }
    cameras = specs.map((spec, i) => {
      const entry = buildCameraFrustum(spec, i)
      root.add(entry.group)
      return entry
    })
  }

  return {
    setVisible(visible) {
      root.visible = visible
    },
    update(robotPose, robot, tagSize, hiddenIndex = null) {
      if (cameras.length !== robot.cameras.length) rebuild(robot.cameras)
      robot.cameras.forEach((spec, i) => {
        const entry = cameras[i]
        entry.group.visible = i !== hiddenIndex
        const camPose = cameraFieldPose(robotPose, spec)
        entry.group.position.set(camPose.translation.x, camPose.translation.y, camPose.translation.z)
        entry.group.quaternion.set(camPose.rotation.x, camPose.rotation.y, camPose.rotation.z, camPose.rotation.w)
        if (entry.hfovDeg !== spec.hfovDeg || entry.vfovDeg !== spec.vfovDeg) {
          entry.dirs = frustumCorners(spec.hfovDeg, spec.vfovDeg)
          entry.hfovDeg = spec.hfovDeg
          entry.vfovDeg = spec.vfovDeg
          entry.lastRange = -1 // force the geometry rewrite below even if range happens to be unchanged
        }
        const range = maxRangeFor(spec, tagSize)
        if (entry.lastRange !== range) {
          writeFrustumPositions(entry.positions, entry.dirs, range)
          entry.lines.geometry.attributes.position.needsUpdate = true
          entry.lines.geometry.computeBoundingSphere()
          entry.lastRange = range
        }
      })
    },
  }
}
