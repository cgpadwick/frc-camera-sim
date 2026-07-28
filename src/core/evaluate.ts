import type { RobotPose, RobotConfig, TagLayout, OccluderBox, Vec3 } from './types'
import { detectTags, robotOccludersInField, segmentHitsBox, shortenedSegment, tagCorners, cameraFieldPose, maxRangeFor, SKEW_MAX_RAD, type Detection } from './visibility'
import { vec3, sub, length, normalize, dot, rotateVec, scale, add, quatFromEuler } from './math'

export interface PoseEvaluation {
  /**
   * Number of UNIQUE tags visible across all cameras at this pose — the
   * headline metric everywhere (HUD, heatmap, report). A tag seen by two
   * cameras counts once. 0 = blind, 1 = single-tag (pose ambiguous),
   * 2+ = multi-tag localization.
   */
  tagCount: number
  perCamera: { cameraIndex: number; detections: Detection[] }[]
}

export function evaluatePose(robotPose: RobotPose, robot: RobotConfig, layout: TagLayout, fieldOccluders: OccluderBox[], rangeCapM = Infinity): PoseEvaluation {
  const occluders = [...fieldOccluders, ...robotOccludersInField(robotPose, robot)]
  const perCamera = robot.cameras.map((spec, cameraIndex) => ({
    cameraIndex,
    detections: detectTags(robotPose, spec, layout.tags, occluders, rangeCapM),
  }))
  const uniqueTags = new Set<number>()
  for (const cam of perCamera) for (const d of cam.detections) uniqueTags.add(d.tagId)
  return { tagCount: uniqueTags.size, perCamera }
}

/**
 * Ideal (upper-bound) tag count: PERFECT-LENS cameras at the robot's ACTUAL
 * mounts. Same eye positions, same range cap, same 65° skew limit, same
 * 5-ray occlusion (field + robot self-occlusion) — the only removed
 * constraint is the lens FOV / full-tag-in-image rule. Removing a
 * constraint can only ADD tags, so actual <= ideal is a mathematical
 * identity, not a tuning outcome. (The previous center-of-robot definition
 * could be beaten by off-center mounts near the range boundary — the
 * "5 / 3 tags" contradiction.) Heading matters now (mounts move with the
 * robot), which also makes the ideal layer aggregate the same way the
 * Realistic layer does.
 *
 * With zero cameras there are no mounts; falls back to a single eye at the
 * robot center at each tag's height so the fresh-robot HUD still teaches.
 */
export function idealTagCount(pose: RobotPose, robot: RobotConfig, layout: TagLayout, fieldOccluders: OccluderBox[], rangeM: number): number {
  return idealTagIds(pose, robot, layout, fieldOccluders, rangeM).length
}

/** Same filters as idealTagCount, returning the qualifying tag ids (for the blue rings). */
export function idealTagIds(pose: RobotPose, robot: RobotConfig, layout: TagLayout, fieldOccluders: OccluderBox[], rangeM: number): number[] {
  const occluders = [...fieldOccluders, ...robotOccludersInField(pose, robot)]
  const eyes: Vec3[] =
    robot.cameras.length > 0
      ? robot.cameras.map((c) => cameraFieldPose(pose, c).translation)
      : [] // fallback eye is per-tag (at the tag's height) below
  const ids: number[] = []
  for (const tag of layout.tags) {
    const center = tag.pose.translation
    const tagNormal = rotateVec(tag.pose.rotation, vec3(1, 0, 0))
    const corners = tagCorners(tag)
    const tagEyes = eyes.length > 0 ? eyes : [vec3(pose.x, pose.y, center.z)]
    let visible = false
    for (const eye of tagEyes) {
      const toEye = sub(eye, center)
      const dist = length(toEye)
      if (dist > rangeM || dist < 1e-9) continue
      const skew = Math.acos(Math.min(1, Math.max(-1, dot(normalize(toEye), tagNormal))))
      if (skew > SKEW_MAX_RAD) continue
      let blocked = false
      for (const target of [...corners, center]) {
        const [a, b] = shortenedSegment(eye, target)
        if (occluders.some((box) => segmentHitsBox(a, b, box))) {
          blocked = true
          break
        }
      }
      if (!blocked) {
        visible = true
        break
      }
    }
    if (visible) ids.push(tag.id)
  }
  return ids
}

/** Display bands for a tag count: 0 dead, 1 poor (ambiguous), 2 ok, 3+ strong. */
export function countBand(tagCount: number): 'dead' | 'poor' | 'ok' | 'strong' {
  if (tagCount <= 0) return 'dead'
  if (tagCount < 2) return 'poor'
  if (tagCount < 3) return 'ok'
  return 'strong'
}

/**
 * Auto ideal range: the longest optical reach of any configured camera.
 * Ideal eyes now sit AT the mounts, so no mount-offset compensation is
 * needed — a camera's own detection range is the honest bound. Falls back
 * to 4 m with no cameras.
 */
export function autoIdealRangeM(robot: RobotConfig, tagSize: number): number {
  if (robot.cameras.length === 0) return 4
  return Math.max(...robot.cameras.map((c) => maxRangeFor(c, tagSize)))
}

/**
 * Index of the superstructure box that blocks the camera's boresight, or
 * null. Uses the SAME segment/shortening rules as detection, so the warning
 * fires exactly when the sim is actually blind: a camera flush ON a face
 * looking outward passes (its shortened rays start outside the box — QA
 * round 8.1 false-positive), while a buried camera, or one aiming INTO its
 * own box, is flagged.
 */
export function cameraBlockedByBoxIndex(robot: RobotConfig, cameraIndex: number): number | null {
  const cam = robot.cameras[cameraIndex]
  if (!cam) return null
  const m = cam.mount
  const q = quatFromEuler((m.rollDeg * Math.PI) / 180, (m.pitchDeg * Math.PI) / 180, (m.yawDeg * Math.PI) / 180)
  const dir = rotateVec(q, vec3(1, 0, 0))
  const start = vec3(m.x, m.y, m.z)
  const end = add(start, scale(dir, BORESIGHT_PROBE_M))
  const [a, b] = shortenedSegment(start, end)
  for (let i = 0; i < robot.superstructure.length; i++) {
    if (segmentHitsBox(a, b, robot.superstructure[i])) return i
  }
  return null
}

/** Boresight probe length for the blocked-camera warning — long enough to cross any realistic box. */
const BORESIGHT_PROBE_M = 2
