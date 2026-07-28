import type { Vec3, Pose3, Tag, CameraSpec, OccluderBox, RobotPose, RobotConfig } from './types'
import { vec3, add, sub, scale, length, normalize, dot, rad, deg, quatFromEuler, quatMul, rotateVec, poseToField, fieldToFrame } from './math'

export const MIN_TAG_PX = 20
export const SKEW_MAX_RAD = rad(65)

export interface Detection {
  tagId: number
  distanceM: number
  skewRad: number
  edgeMargin: number // 1 = dead center, 0 = corner touching image edge
  bearingRad: number // robot-frame horizontal bearing to tag center
}

export function cameraFieldPose(robotPose: RobotPose, spec: CameraSpec): Pose3 {
  const robotQ = quatFromEuler(0, 0, robotPose.headingRad)
  const robot: Pose3 = { translation: vec3(robotPose.x, robotPose.y, 0), rotation: robotQ }
  const m = spec.mount
  return {
    translation: poseToField(robot, vec3(m.x, m.y, m.z)),
    rotation: quatMul(robotQ, quatFromEuler(rad(m.rollDeg), rad(m.pitchDeg), rad(m.yawDeg))),
  }
}

export function tagCorners(tag: Tag): Vec3[] {
  const h = tag.size / 2
  return [vec3(0, h, h), vec3(0, -h, h), vec3(0, -h, -h), vec3(0, h, -h)]
    .map((c) => poseToField(tag.pose, c))
}

export function projectToImage(camPose: Pose3, hfovDeg: number, vfovDeg: number, pField: Vec3) {
  const p = fieldToFrame(camPose, pField)
  if (p.x <= 1e-6) return null
  return {
    u: p.y / p.x / Math.tan(rad(hfovDeg) / 2),
    v: p.z / p.x / Math.tan(rad(vfovDeg) / 2),
  }
}

export function maxRangeFor(spec: CameraSpec, tagSize: number): number {
  if (spec.maxRangeM != null) return spec.maxRangeM
  const focalPx = spec.resWidth / 2 / Math.tan(rad(spec.hfovDeg) / 2)
  return (tagSize * focalPx) / MIN_TAG_PX
}

export function detectTags(robotPose: RobotPose, spec: CameraSpec, tags: Tag[], occluders: OccluderBox[], rangeCapM = Infinity): Detection[] {
  const camPose = cameraFieldPose(robotPose, spec)
  const out: Detection[] = []
  for (const tag of tags) {
    const center = tag.pose.translation
    const toCam = sub(camPose.translation, center)
    const distanceM = length(toCam)
    if (distanceM > Math.min(maxRangeFor(spec, tag.size), rangeCapM)) continue
    const tagNormal = rotateVec(tag.pose.rotation, vec3(1, 0, 0))
    const skewRad = Math.acos(Math.min(1, Math.max(-1, dot(normalize(toCam), tagNormal))))
    if (skewRad > SKEW_MAX_RAD) continue
    const corners = tagCorners(tag)
    let edge = 1
    let inside = true
    for (const c of corners) {
      const uv = projectToImage(camPose, spec.hfovDeg, spec.vfovDeg, c)
      if (!uv || Math.abs(uv.u) > 1 || Math.abs(uv.v) > 1) { inside = false; break }
      edge = Math.min(edge, 1 - Math.max(Math.abs(uv.u), Math.abs(uv.v)))
    }
    if (!inside) continue
    if (occludedAny(camPose.translation, [...corners, center], occluders)) continue
    const bearingRad = Math.atan2(center.y - robotPose.y, center.x - robotPose.x) - robotPose.headingRad
    out.push({ tagId: tag.id, distanceM, skewRad, edgeMargin: edge, bearingRad })
  }
  return out
}

/** Slab-method segment vs yaw-oriented box. */
export function segmentHitsBox(a: Vec3, b: Vec3, box: OccluderBox): boolean {
  // Transform segment into box-local frame (undo yaw, then translate)
  const q = quatFromEuler(0, 0, -rad(box.yawDeg))
  const la = rotateVec(q, sub(a, box.center))
  const lb = rotateVec(q, sub(b, box.center))
  const d = sub(lb, la)
  const half = scale(box.size, 0.5)
  let tmin = 0, tmax = 1
  for (const ax of ['x', 'y', 'z'] as const) {
    if (Math.abs(d[ax]) < 1e-12) {
      if (Math.abs(la[ax]) > half[ax]) return false
    } else {
      let t1 = (-half[ax] - la[ax]) / d[ax]
      let t2 = (half[ax] - la[ax]) / d[ax]
      if (t1 > t2) [t1, t2] = [t2, t1]
      tmin = Math.max(tmin, t1)
      tmax = Math.min(tmax, t2)
      if (tmin > tmax) return false
    }
  }
  return true
}

export function robotOccludersInField(robotPose: RobotPose, robot: RobotConfig): OccluderBox[] {
  const q = quatFromEuler(0, 0, robotPose.headingRad)
  return robot.superstructure.map((b) => ({
    center: add(vec3(robotPose.x, robotPose.y, 0), rotateVec(q, b.center)),
    size: b.size,
    yawDeg: b.yawDeg + deg(robotPose.headingRad),
  }))
}

// Shorten each ray by 1 cm at *both* ends: at the tag end so a tag mounted
// flush on an occluder box face does not self-occlude against that same
// face, and at the camera end so a camera whose mount origin sits flush on a
// superstructure box face (e.g. mount.x lands exactly on a 0.3m-wide
// elevator's face) does not have tmin==tmax==0 block every ray out of the
// gate. Symmetric shortening keeps both flush-mount cases working the same
// way instead of only fixing the tag side.
export const OCCLUSION_EPSILON_M = 0.01

/** Both-ends 1cm shortening used by every occlusion ray (exported for the blocked-boresight warning, QA round 8.1). */
export function shortenedSegment(a: Vec3, b: Vec3): [Vec3, Vec3] {
  const d = sub(b, a)
  const len = length(d)
  // Too short to shorten by an epsilon at each end without inverting the
  // segment — leave it as-is; occlusion at sub-2cm range is a degenerate
  // edge case either way.
  if (len < 2 * OCCLUSION_EPSILON_M) return [a, b]
  const tStart = OCCLUSION_EPSILON_M / len
  const tEnd = 1 - OCCLUSION_EPSILON_M / len
  return [add(a, scale(d, tStart)), add(a, scale(d, tEnd))]
}

function occludedAny(from: Vec3, targets: Vec3[], occluders: OccluderBox[]): boolean {
  if (occluders.length === 0) return false
  return targets.some((t) => {
    const [start, end] = shortenedSegment(from, t)
    return occluders.some((b) => segmentHitsBox(start, end, b))
  })
}
