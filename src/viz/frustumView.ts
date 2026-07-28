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

/**
 * The detection boundary is a SPHERE (distance <= range), not a plane — so
 * the drawn far surface is a spherical cap sampled on a (u, v) grid over
 * the FOV. Every drawn far point sits at exactly the detection distance:
 * no center shortfall (pre-8.3 bug), no corner overdraw (8.3's planar
 * residual that user testing caught immediately).
 */
export function sphericalCapPoint(u: number, v: number, hfovDeg: number, vfovDeg: number, range: number): Vec3Like {
  const y = u * Math.tan((hfovDeg * Math.PI) / 360)
  const z = v * Math.tan((vfovDeg * Math.PI) / 360)
  const len = Math.hypot(1, y, z)
  return { x: range / len, y: (y * range) / len, z: (z * range) / len }
}

/** Grid resolution of the spherical cap (segments per edge). */
const CAP_SEG = 8
// Wireframe: 4 apex->corner edges + 4 curved boundary arcs of CAP_SEG segments.
const LINE_SEGMENTS = 4 + 4 * CAP_SEG
const LINE_VERTS = LINE_SEGMENTS * 2
// Fill: apex + (CAP_SEG+1)^2 cap grid vertices.
const FILL_VERTS = 1 + (CAP_SEG + 1) * (CAP_SEG + 1)

interface CameraFrustum {
  group: THREE.Group
  lines: THREE.LineSegments
  positions: Float32Array
  /** Translucent volume fill: apex fans to the cap boundary + the cap grid itself. */
  fill: THREE.Mesh
  fillPositions: Float32Array
  dirs: Vec3Like[]
  /** FOV the current geometry was computed from — compared each update() so an FOV edit on an existing camera (no count change, so no rebuild()) still recomputes instead of leaving the drawn cone at the stale angle. */
  hfovDeg: number
  vfovDeg: number
  lastRange: number
}

/** Boundary of the cap as (u, v) pairs walking the FOV rectangle's perimeter, CAP_SEG steps per edge. */
function boundaryUV(): [number, number][] {
  const pts: [number, number][] = []
  const step = 2 / CAP_SEG
  for (let i = 0; i < CAP_SEG; i++) pts.push([-1 + i * step, 1]) // top: left -> right
  for (let i = 0; i < CAP_SEG; i++) pts.push([1, 1 - i * step]) // right: top -> bottom
  for (let i = 0; i < CAP_SEG; i++) pts.push([1 - i * step, -1]) // bottom
  for (let i = 0; i < CAP_SEG; i++) pts.push([-1, -1 + i * step]) // left
  return pts
}
const BOUNDARY_UV = boundaryUV()

function writeFrustumPositions(out: Float32Array, hfovDeg: number, vfovDeg: number, range: number): void {
  let o = 0
  const write = (p: Vec3Like) => {
    out[o++] = p.x
    out[o++] = p.y
    out[o++] = p.z
  }
  // 4 apex -> corner edges (corners at true spherical range).
  for (const [u, v] of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ]) {
    write({ x: 0, y: 0, z: 0 })
    write(sphericalCapPoint(u, v, hfovDeg, vfovDeg, range))
  }
  // Curved boundary arcs.
  for (let i = 0; i < BOUNDARY_UV.length; i++) {
    const [ua, va] = BOUNDARY_UV[i]
    const [ub, vb] = BOUNDARY_UV[(i + 1) % BOUNDARY_UV.length]
    write(sphericalCapPoint(ua, va, hfovDeg, vfovDeg, range))
    write(sphericalCapPoint(ub, vb, hfovDeg, vfovDeg, range))
  }
}

/** Static fill index: cap grid triangles + apex fans to the grid's outer ring. */
function buildFillIndex(): number[] {
  const idx: number[] = []
  const grid = (r: number, c: number): number => 1 + r * (CAP_SEG + 1) + c
  for (let r = 0; r < CAP_SEG; r++) {
    for (let c = 0; c < CAP_SEG; c++) {
      idx.push(grid(r, c), grid(r + 1, c), grid(r + 1, c + 1))
      idx.push(grid(r, c), grid(r + 1, c + 1), grid(r, c + 1))
    }
  }
  // Side sheets: apex (0) fanned to each boundary row/column of the grid.
  for (let c = 0; c < CAP_SEG; c++) {
    idx.push(0, grid(0, c), grid(0, c + 1)) // v = -1 edge (row 0)
    idx.push(0, grid(CAP_SEG, c + 1), grid(CAP_SEG, c)) // v = +1 edge
  }
  for (let r = 0; r < CAP_SEG; r++) {
    idx.push(0, grid(r + 1, 0), grid(r, 0)) // u = -1 edge (col 0)
    idx.push(0, grid(r, CAP_SEG), grid(r + 1, CAP_SEG)) // u = +1 edge
  }
  return idx
}
const FILL_INDEX = buildFillIndex()

function writeFillPositions(out: Float32Array, hfovDeg: number, vfovDeg: number, range: number): void {
  out[0] = 0
  out[1] = 0
  out[2] = 0
  let o = 3
  for (let r = 0; r <= CAP_SEG; r++) {
    const v = -1 + (2 * r) / CAP_SEG
    for (let c = 0; c <= CAP_SEG; c++) {
      const u = -1 + (2 * c) / CAP_SEG
      const p = sphericalCapPoint(u, v, hfovDeg, vfovDeg, range)
      out[o++] = p.x
      out[o++] = p.y
      out[o++] = p.z
    }
  }
}

function buildCameraFrustum(spec: CameraSpec, colorIndex: number, fillOpacity: number, colorOverride?: number): CameraFrustum {
  const dirs = frustumCorners(spec.hfovDeg, spec.vfovDeg)
  const color = colorOverride ?? CAMERA_COLORS[colorIndex % CAMERA_COLORS.length]
  const positions = new Float32Array(LINE_VERTS * 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.LineBasicMaterial({ color })
  const lines = new THREE.LineSegments(geometry, material)

  const fillPositions = new Float32Array(FILL_VERTS * 3)
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
          writeFrustumPositions(entry.positions, spec.hfovDeg, spec.vfovDeg, range)
          entry.lines.geometry.attributes.position.needsUpdate = true
          entry.lines.geometry.computeBoundingSphere()
          writeFillPositions(entry.fillPositions, spec.hfovDeg, spec.vfovDeg, range)
          entry.fill.geometry.attributes.position.needsUpdate = true
          entry.fill.geometry.computeBoundingSphere()
          entry.lastRange = range
        }
      })
    },
  }
}
