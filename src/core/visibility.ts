import type { Vec3, Pose3, Tag, CameraSpec, OccluderBox, RobotPose } from './types'
import { vec3, add, sub, length, normalize, dot, rad, quatFromEuler, quatMul, rotateVec, poseToField, fieldToFrame } from './math'

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

export function detectTags(robotPose: RobotPose, spec: CameraSpec, tags: Tag[], occluders: OccluderBox[]): Detection[] {
  const camPose = cameraFieldPose(robotPose, spec)
  const out: Detection[] = []
  for (const tag of tags) {
    const center = tag.pose.translation
    const toCam = sub(camPose.translation, center)
    const distanceM = length(toCam)
    if (distanceM > maxRangeFor(spec, tag.size)) continue
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

// Implemented in Task 4; stub returning false keeps Task 3 green.
function occludedAny(_from: Vec3, _targets: Vec3[], occluders: OccluderBox[]): boolean {
  if (occluders.length === 0) return false
  return occluders.some((b) => targetsHitBox(_from, _targets, b))
}
function targetsHitBox(_from: Vec3, _targets: Vec3[], _b: OccluderBox): boolean {
  return false // replaced in Task 4
}
