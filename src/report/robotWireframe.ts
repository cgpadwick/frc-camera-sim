import type { RobotConfig } from '../core/types'
import { CAMERA_COLORS, frustumCorners, sphericalCapPoint } from '../viz/frustumView'
import { quatFromEuler, rotateVec, vec3, rad } from '../core/math'
import type { Vec3 } from '../core/types'

export interface WireframeModel {
  /** Colored polylines in robot frame, meters. */
  lines: { color: string; pts: [number, number, number][] }[]
  /** Suggested initial camera distance / target height for the viewer. */
  fitRadius: number
  targetZ: number
}

const CONE_LEN = 1.5

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

/**
 * Pure: serialize the robot (chassis, body shapes, camera gizmos + aim
 * cones) into colored polylines for the report's embedded 3D viewer.
 */
export function robotWireframeModel(robot: RobotConfig): WireframeModel {
  const lines: WireframeModel['lines'] = []
  const body = '#8a94a2'
  const chassis = '#c9d2dc'

  // Chassis + front marker.
  for (const pts of boxEdges(0, 0, robot.chassisHeightM / 2, robot.lengthM, robot.widthM, robot.chassisHeightM, 0)) {
    lines.push({ color: chassis, pts })
  }
  lines.push({
    color: '#ffc107',
    pts: [
      [robot.lengthM / 2, 0, robot.chassisHeightM / 2],
      [robot.lengthM / 2 + 0.15, 0, robot.chassisHeightM / 2],
    ],
  })

  for (const b of robot.superstructure) {
    for (const pts of boxEdges(b.center.x, b.center.y, b.center.z, b.size.x, b.size.y, b.size.z, b.yawDeg)) {
      lines.push({ color: body, pts })
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
    // Cone: 4 edge rays + curved far boundary at the preview length.
    const dirs = frustumCorners(cam.hfovDeg, cam.vfovDeg)
    for (const d of dirs) {
      lines.push({ color, pts: [[m.x, m.y, m.z], toWorld(vec3(d.x * CONE_LEN, d.y * CONE_LEN, d.z * CONE_LEN))] })
    }
    const arc: [number, number, number][] = []
    const uv: [number, number][] = []
    const SEG = 6
    for (let k = 0; k <= SEG; k++) uv.push([-1 + (2 * k) / SEG, 1])
    for (let k = 1; k <= SEG; k++) uv.push([1, 1 - (2 * k) / SEG])
    for (let k = 1; k <= SEG; k++) uv.push([1 - (2 * k) / SEG, -1])
    for (let k = 1; k <= SEG; k++) uv.push([-1, -1 + (2 * k) / SEG])
    for (const [u, v] of uv) {
      const p = sphericalCapPoint(u, v, cam.hfovDeg, cam.vfovDeg, CONE_LEN)
      arc.push(toWorld(vec3(p.x, p.y, p.z)))
    }
    lines.push({ color, pts: arc })
    fitRadius = Math.max(fitRadius, Math.hypot(m.x, m.y) + CONE_LEN)
    top = Math.max(top, m.z + CONE_LEN * 0.5)
  })

  return { lines, fitRadius, targetZ: top / 2 }
}
