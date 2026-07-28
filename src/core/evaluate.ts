import type { RobotPose, RobotConfig, TagLayout, OccluderBox } from './types'
import { detectTags, robotOccludersInField, segmentHitsBox, maxRangeFor, SKEW_MAX_RAD, type Detection } from './visibility'
import { vec3, sub, length, normalize, dot, rotateVec, scale, add } from './math'

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
 * Ideal (upper-bound) tag count at a field position: how many tags an
 * omnidirectional, perfectly mounted camera could possibly read from
 * (x, y) — tag within `rangeM`, robot on the tag's front side within the
 * same 65° skew readability limit, ray not blocked by field occluders.
 * Camera FOV/mount/self-occlusion deliberately ignored; heading-irrelevant.
 * The eye point sits at each tag's own height (best case). The gap between
 * this and the actual worst-case count is coverage lost to mounting choices.
 */
export function idealTagCount(x: number, y: number, layout: TagLayout, fieldOccluders: OccluderBox[], rangeM: number): number {
  return idealTagIds(x, y, layout, fieldOccluders, rangeM).length
}

/** Same filters as idealTagCount, returning the qualifying tag ids (for visualization). */
export function idealTagIds(x: number, y: number, layout: TagLayout, fieldOccluders: OccluderBox[], rangeM: number): number[] {
  const ids: number[] = []
  for (const tag of layout.tags) {
    const center = tag.pose.translation
    const eye = vec3(x, y, center.z)
    const toEye = sub(eye, center)
    const dist = length(toEye)
    if (dist > rangeM || dist < 1e-9) continue
    const tagNormal = rotateVec(tag.pose.rotation, vec3(1, 0, 0))
    const skew = Math.acos(Math.min(1, Math.max(-1, dot(normalize(toEye), tagNormal))))
    if (skew > SKEW_MAX_RAD) continue
    // Same 1cm end-shortening as detectTags so flush-mounted tags don't self-occlude.
    const dir = normalize(toEye)
    const a = sub(eye, scale(dir, 0.01))
    const b = add(center, scale(dir, 0.01))
    if (fieldOccluders.some((box) => segmentHitsBox(a, b, box))) continue
    ids.push(tag.id)
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
 * Auto ideal range: the longest reach any configured camera actually has —
 * its detection range plus its horizontal mount offset from robot center
 * (idealTagCount measures from center, cameras measure from their mount).
 * Guarantees the ideal layer's range never trails the actual cameras, so
 * actual can't exceed ideal. Falls back to 4 m with no cameras.
 */
export function autoIdealRangeM(robot: RobotConfig, tagSize: number): number {
  if (robot.cameras.length === 0) return 4
  return Math.max(
    ...robot.cameras.map((c) => maxRangeFor(c, tagSize) + Math.hypot(c.mount.x, c.mount.y)),
  )
}
