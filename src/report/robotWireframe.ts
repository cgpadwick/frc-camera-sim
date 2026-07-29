import type { RobotConfig } from '../core/types'
import { CAMERA_COLORS, frustumCorners, sphericalCapPoint } from '../viz/frustumView'
import { quatFromEuler, rotateVec, vec3, rad } from '../core/math'
import type { Vec3 } from '../core/types'

export interface WireframeModel {
  /** Colored polylines in robot frame, meters. */
  lines: { color: string; pts: [number, number, number][] }[]
  /** Translucent convex polygons (robot frame) painted back-to-front beneath the lines. */
  faces: { color: string; alpha: number; pts: [number, number, number][] }[]
  /** Floating text labels (robot frame) — axis callouts. */
  labels: { text: string; color: string; pos: [number, number, number] }[]
  /** Text decals baked onto planar quads (bumper numbers). `quad` corners in
   * order bottom-left, bottom-right, top-right, top-left as seen from outside
   * the face; `n` = outward normal for back-face culling. */
  decals: { text: string; color: string; quad: [number, number, number][]; n: [number, number, number] }[]
  /** Suggested initial camera distance / target height for the viewer. */
  fitRadius: number
  targetZ: number
}

const CONE_LEN = 1.5

/** Translucent fill alphas tuned to the app editor's look: cones stay faint
 * washes (sheets + cap stack on screen, so keep this low), chassis reads as
 * the solid red bumper body, superstructure as a subtle grey volume. */
const FRUSTUM_FILL_ALPHA = 0.05
const CHASSIS_FILL_ALPHA = 0.3
const BODY_FILL_ALPHA = 0.1
const MOUNT_CUBE_M = 0.06

/** App editor palette: red bumper chassis, light grey superstructure box. */
const CHASSIS_EDGE = '#ef5350'
const CHASSIS_FILL = '#c62828'
const BODY_EDGE = '#c9d2dc'
const BODY_FILL = '#8a94a2'

/** Segments per edge of the frustum's spherical-cap fill grid (matches the arc sampling below). */
const CAP_SEG = 6

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`
}

/** 12 edges of a yaw-rotated box as 3-point-max polylines. */
function boxEdges(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, yawDeg: number): [number, number, number][][] {
  const c = Math.cos((yawDeg * Math.PI) / 180)
  const s = Math.sin((yawDeg * Math.PI) / 180)
  const corner = (ix: number, iy: number, iz: number): [number, number, number] => {
    const lx = (ix ? 1 : -1) * (sx / 2)
    const ly = (iy ? 1 : -1) * (sy / 2)
    return [cx + lx * c - ly * s, cy + lx * s + ly * c, cz + (iz ? 1 : -1) * (sz / 2)]
  }
  const E: [number, number, number][][] = []
  // bottom + top rings as closed polylines, then 4 verticals
  for (const iz of [0, 1]) {
    E.push([corner(0, 0, iz), corner(1, 0, iz), corner(1, 1, iz), corner(0, 1, iz), corner(0, 0, iz)])
  }
  for (const [ix, iy] of [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]) {
    E.push([corner(ix, iy, 0), corner(ix, iy, 1)])
  }
  return E
}

/** 6 quads of a yaw-rotated box (same corner layout as boxEdges). */
function boxFaces(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, yawDeg: number): [number, number, number][][] {
  const c = Math.cos((yawDeg * Math.PI) / 180)
  const s = Math.sin((yawDeg * Math.PI) / 180)
  const corner = (ix: number, iy: number, iz: number): [number, number, number] => {
    const lx = (ix ? 1 : -1) * (sx / 2)
    const ly = (iy ? 1 : -1) * (sy / 2)
    return [cx + lx * c - ly * s, cy + lx * s + ly * c, cz + (iz ? 1 : -1) * (sz / 2)]
  }
  return [
    [corner(0, 0, 0), corner(1, 0, 0), corner(1, 1, 0), corner(0, 1, 0)], // bottom
    [corner(0, 0, 1), corner(1, 0, 1), corner(1, 1, 1), corner(0, 1, 1)], // top
    [corner(0, 0, 0), corner(1, 0, 0), corner(1, 0, 1), corner(0, 0, 1)], // -y side
    [corner(0, 1, 0), corner(1, 1, 0), corner(1, 1, 1), corner(0, 1, 1)], // +y side
    [corner(1, 0, 0), corner(1, 1, 0), corner(1, 1, 1), corner(1, 0, 1)], // front
    [corner(0, 0, 0), corner(0, 1, 0), corner(0, 1, 1), corner(0, 0, 1)], // back
  ]
}

/**
 * Pure: serialize the robot (chassis, body shapes, camera gizmos + aim
 * cones) into colored polylines for the report's embedded 3D viewer.
 */
export function robotWireframeModel(robot: RobotConfig): WireframeModel {
  const lines: WireframeModel['lines'] = []
  const faces: WireframeModel['faces'] = []
  const labels: WireframeModel['labels'] = []

  // Chassis (red bumper body, like the app editor) + front marker + axis labels.
  for (const pts of boxEdges(0, 0, robot.chassisHeightM / 2, robot.lengthM, robot.widthM, robot.chassisHeightM, 0)) {
    lines.push({ color: CHASSIS_EDGE, pts })
  }
  for (const pts of boxFaces(0, 0, robot.chassisHeightM / 2, robot.lengthM, robot.widthM, robot.chassisHeightM, 0)) {
    faces.push({ color: CHASSIS_FILL, alpha: CHASSIS_FILL_ALPHA, pts })
  }
  lines.push({
    color: '#ffc107',
    pts: [
      [robot.lengthM / 2, 0, robot.chassisHeightM / 2],
      [robot.lengthM / 2 + 0.15, 0, robot.chassisHeightM / 2],
    ],
  })
  labels.push({ text: 'FRONT (+X)', color: '#ffc107', pos: [robot.lengthM / 2 + 0.3, 0, 0.02] })
  labels.push({ text: 'LEFT (+Y)', color: '#d4e157', pos: [0, robot.widthM / 2 + 0.3, 0.02] })

  // Team number baked onto each bumper side face (white on red, like real
  // FRC bumpers). Corners ordered so text reads upright from outside.
  const decals: WireframeModel['decals'] = []
  const hx = robot.lengthM / 2
  const hy = robot.widthM / 2
  const hc = robot.chassisHeightM
  const eps = 0.003
  for (const n of [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
  ] as [number, number, number][]) {
    // Right-on-screen (viewed from outside along -n, z up) = z × n.
    const r: [number, number, number] = [-n[1], n[0], 0]
    const half = n[0] !== 0 ? hy : hx
    const base: [number, number, number] = [n[0] * (hx + eps), n[1] * (hy + eps), 0]
    const at = (s: number, z: number): [number, number, number] => [
      base[0] + r[0] * s, base[1] + r[1] * s, z,
    ]
    decals.push({
      text: robot.teamNumber,
      color: '#ffffff',
      quad: [at(-half, 0), at(half, 0), at(half, hc), at(-half, hc)],
      n,
    })
  }

  for (const b of robot.superstructure) {
    for (const pts of boxEdges(b.center.x, b.center.y, b.center.z, b.size.x, b.size.y, b.size.z, b.yawDeg)) {
      lines.push({ color: BODY_EDGE, pts })
    }
    for (const pts of boxFaces(b.center.x, b.center.y, b.center.z, b.size.x, b.size.y, b.size.z, b.yawDeg)) {
      faces.push({ color: BODY_FILL, alpha: BODY_FILL_ALPHA, pts })
    }
  }

  let fitRadius = Math.hypot(robot.lengthM / 2, robot.widthM / 2)
  let top = robot.chassisHeightM
  for (const b of robot.superstructure) top = Math.max(top, b.center.z + b.size.z / 2)

  robot.cameras.forEach((cam, i) => {
    const color = hex(CAMERA_COLORS[i % CAMERA_COLORS.length])
    const m = cam.mount
    const q = quatFromEuler(rad(m.rollDeg), rad(m.pitchDeg), rad(m.yawDeg))
    const toWorld = (local: Vec3): [number, number, number] => {
      const r = rotateVec(q, local)
      return [m.x + r.x, m.y + r.y, m.z + r.z]
    }
    // Mount marker: small solid cube in the camera's color (app-editor gizmo).
    for (const pts of boxFaces(m.x, m.y, m.z, MOUNT_CUBE_M, MOUNT_CUBE_M, MOUNT_CUBE_M, m.yawDeg)) {
      faces.push({ color, alpha: 0.9, pts })
    }
    // Cone: 4 edge rays + curved far boundary at the preview length.
    const dirs = frustumCorners(cam.hfovDeg, cam.vfovDeg)
    for (const d of dirs) {
      lines.push({ color, pts: [[m.x, m.y, m.z], toWorld(vec3(d.x * CONE_LEN, d.y * CONE_LEN, d.z * CONE_LEN))] })
    }
    const arc: [number, number, number][] = []
    const uv: [number, number][] = []
    const SEG = CAP_SEG
    for (let k = 0; k <= SEG; k++) uv.push([-1 + (2 * k) / SEG, 1])
    for (let k = 1; k <= SEG; k++) uv.push([1, 1 - (2 * k) / SEG])
    for (let k = 1; k <= SEG; k++) uv.push([1 - (2 * k) / SEG, -1])
    for (let k = 1; k <= SEG; k++) uv.push([-1, -1 + (2 * k) / SEG])
    for (const [u, v] of uv) {
      const p = sphericalCapPoint(u, v, cam.hfovDeg, cam.vfovDeg, CONE_LEN)
      arc.push(toWorld(vec3(p.x, p.y, p.z)))
    }
    lines.push({ color, pts: arc })

    // Translucent volume fill mirroring the app viewer: apex fanned to the
    // curved boundary (side sheets) + the spherical cap itself as a quad grid.
    const apex: [number, number, number] = [m.x, m.y, m.z]
    for (let k = 0; k < arc.length - 1; k++) {
      faces.push({ color, alpha: FRUSTUM_FILL_ALPHA, pts: [apex, arc[k], arc[k + 1]] })
    }
    const capAt = (u: number, v: number): [number, number, number] => {
      const p = sphericalCapPoint(u, v, cam.hfovDeg, cam.vfovDeg, CONE_LEN)
      return toWorld(vec3(p.x, p.y, p.z))
    }
    for (let r = 0; r < SEG; r++) {
      const v0 = -1 + (2 * r) / SEG
      const v1 = -1 + (2 * (r + 1)) / SEG
      for (let c = 0; c < SEG; c++) {
        const u0 = -1 + (2 * c) / SEG
        const u1 = -1 + (2 * (c + 1)) / SEG
        faces.push({ color, alpha: FRUSTUM_FILL_ALPHA, pts: [capAt(u0, v0), capAt(u1, v0), capAt(u1, v1), capAt(u0, v1)] })
      }
    }

    fitRadius = Math.max(fitRadius, Math.hypot(m.x, m.y) + CONE_LEN)
    top = Math.max(top, m.z + CONE_LEN * 0.5)
  })

  return { lines, faces, labels, decals, fitRadius, targetZ: top / 2 }
}
