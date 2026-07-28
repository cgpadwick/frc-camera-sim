import type { RobotPose, RobotConfig, TagLayout, OccluderBox } from './types'
import { detectTags, robotOccludersInField, type Detection } from './visibility'

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

export function evaluatePose(robotPose: RobotPose, robot: RobotConfig, layout: TagLayout, fieldOccluders: OccluderBox[]): PoseEvaluation {
  const occluders = [...fieldOccluders, ...robotOccludersInField(robotPose, robot)]
  const perCamera = robot.cameras.map((spec, cameraIndex) => ({
    cameraIndex,
    detections: detectTags(robotPose, spec, layout.tags, occluders),
  }))
  const uniqueTags = new Set<number>()
  for (const cam of perCamera) for (const d of cam.detections) uniqueTags.add(d.tagId)
  return { tagCount: uniqueTags.size, perCamera }
}

/** Display bands for a tag count: 0 dead, 1 poor (ambiguous), 2 ok, 3+ strong. */
export function countBand(tagCount: number): 'dead' | 'poor' | 'ok' | 'strong' {
  if (tagCount <= 0) return 'dead'
  if (tagCount < 2) return 'poor'
  if (tagCount < 3) return 'ok'
  return 'strong'
}
