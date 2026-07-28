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
  /** Translucent volume fill: apex + 4 far corners, indexed (4 sides + far quad). */
  fill: THREE.Mesh
  fillPositions: Float32Array
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

// Indexed triangles over [apex, c0, c1, c2, c3]: 4 side faces + far quad.
const FILL_INDEX = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1, 1, 2, 3, 1, 3, 4]

function buildCameraFrustum(spec: CameraSpec, colorIndex: number, fillOpacity: number, colorOverride?: number): CameraFrustum {
  const dirs = frustumCorners(spec.hfovDeg, spec.vfovDeg)
  const color = colorOverride ?? CAMERA_COLORS[colorIndex % CAMERA_COLORS.length]
  const positions = new Float32Array(VERT_COUNT * 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.LineBasicMaterial({ color })
  const lines = new THREE.LineSegments(geometry, material)

  const fillPositions = new Float32Array(5 * 3)
  const fillGeometry = new THREE.BufferGeometry()
  fillGeometry.setAttribute('position', new THREE.BufferAttribute(fillPositions, 3))
  fillGeometry.setIndex(FILL_INDEX)
  const fill = new THREE.Mesh(
    fillGeometry,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: fillOpacity,
      side: THREE.DoubleSide,
      depthWrite: false, // translucent volumes must not punch holes in each other
    }),
  )
  fill.visible = fillOpacity > 0
  fill.renderOrder = 5

  const group = new THREE.Group()
  group.add(lines, fill)
  return { group, lines, positions, fill, fillPositions, dirs, hfovDeg: spec.hfovDeg, vfovDeg: spec.vfovDeg, lastRange: -1 }
}

function disposeCameraFrustum(entry: CameraFrustum): void {
  entry.lines.geometry.dispose()
  ;(entry.lines.material as THREE.Material).dispose()
  entry.fill.geometry.dispose()
  ;(entry.fill.material as THREE.Material).dispose()
}

function writeFillPositions(out: Float32Array, dirs: Vec3Like[], range: number): void {
  out[0] = 0
  out[1] = 0
  out[2] = 0
  dirs.forEach((d, i) => {
    out[(i + 1) * 3] = d.x * range
    out[(i + 1) * 3 + 1] = d.y * range
    out[(i + 1) * 3 + 2] = d.z * range
  })
}

export interface FrustumView {
  /** `hiddenIndex`: camera whose wireframe is hidden this frame (POV view renders from inside it). `rangeCapM`: trusted-range cap - cones never draw past it. `emphasisIndex`: outline-first mode only - this camera keeps the full fill. */
  update(robotPose: RobotPose, robot: RobotConfig, tagSize: number, hiddenIndex?: number | null, rangeCapM?: number, emphasisIndex?: number | null): void
  /** Show/hide all frustum wireframes (robot editor declutter toggle). */
  setVisible(visible: boolean): void
  /** Opacity of the translucent volume fill (0 hides the fill, edges stay). */
  setFillOpacity(opacity: number): void
}

/** Live wireframe camera frustums, one per configured camera, reparented under a 'frustums' group. */
/** In outline-first mode, unselected cones cap their fill at this alpha (7b fix 5). */
const OUTLINE_FIRST_MAX_ALPHA = 0.06

export function createFrustumView(
  scene: THREE.Scene,
  opts?: { colorOverride?: number; outlineFirst?: boolean },
): FrustumView {
  const root = new THREE.Group()
  root.name = 'frustums'
  scene.add(root)
  let cameras: CameraFrustum[] = []
  let fillOpacity = 0.15

  function rebuild(specs: CameraSpec[]): void {
    for (const entry of cameras) {
      root.remove(entry.group)
      disposeCameraFrustum(entry)
    }
    cameras = specs.map((spec, i) => {
      const entry = buildCameraFrustum(spec, i, fillOpacity, opts?.colorOverride)
      root.add(entry.group)
      return entry
    })
  }

  return {
    setVisible(visible) {
      root.visible = visible
    },
    setFillOpacity(opacity) {
      fillOpacity = opacity
      for (const entry of cameras) {
        entry.fill.visible = opacity > 0
        ;(entry.fill.material as THREE.MeshBasicMaterial).opacity = opacity
      }
    },
    update(robotPose, robot, tagSize, hiddenIndex = null, rangeCapM = Infinity, emphasisIndex = null) {
      if (cameras.length !== robot.cameras.length) rebuild(robot.cameras)
      robot.cameras.forEach((spec, i) => {
        const entry = cameras[i]
        entry.group.visible = i !== hiddenIndex
        // Outline-first (Build view): colored edges carry the aim; only the
        // selected camera gets the full fill so mass follows meaning.
        if (opts?.outlineFirst) {
          const full = i === emphasisIndex
          const alpha = full ? fillOpacity : Math.min(OUTLINE_FIRST_MAX_ALPHA, fillOpacity)
          ;(entry.fill.material as THREE.MeshBasicMaterial).opacity = alpha
          entry.fill.visible = alpha > 0
        }
        const camPose = cameraFieldPose(robotPose, spec)
        entry.group.position.set(camPose.translation.x, camPose.translation.y, camPose.translation.z)
        entry.group.quaternion.set(camPose.rotation.x, camPose.rotation.y, camPose.rotation.z, camPose.rotation.w)
        if (entry.hfovDeg !== spec.hfovDeg || entry.vfovDeg !== spec.vfovDeg) {
          entry.dirs = frustumCorners(spec.hfovDeg, spec.vfovDeg)
          entry.hfovDeg = spec.hfovDeg
          entry.vfovDeg = spec.vfovDeg
          entry.lastRange = -1 // force the geometry rewrite below even if range happens to be unchanged
        }
        const range = Math.min(maxRangeFor(spec, tagSize), rangeCapM)
        if (entry.lastRange !== range) {
          writeFrustumPositions(entry.positions, entry.dirs, range)
          entry.lines.geometry.attributes.position.needsUpdate = true
          entry.lines.geometry.computeBoundingSphere()
          writeFillPositions(entry.fillPositions, entry.dirs, range)
          entry.fill.geometry.attributes.position.needsUpdate = true
          entry.fill.geometry.computeBoundingSphere()
          entry.lastRange = range
        }
      })
    },
  }
}
