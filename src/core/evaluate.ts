import type { RobotPose, RobotConfig, TagLayout, OccluderBox } from './types'
import { detectTags, robotOccludersInField, maxRangeFor, type Detection } from './visibility'
import { poseScore } from './scoring'

export interface PoseEvaluation {
  score: number
  perCamera: { cameraIndex: number; detections: Detection[] }[]
}

export function evaluatePose(robotPose: RobotPose, robot: RobotConfig, layout: TagLayout, fieldOccluders: OccluderBox[]): PoseEvaluation {
  const occluders = [...fieldOccluders, ...robotOccludersInField(robotPose, robot)]
  const perCamera = robot.cameras.map((spec, cameraIndex) => ({
    cameraIndex,
    detections: detectTags(robotPose, spec, layout.tags, occluders),
  }))
  const score = poseScore(perCamera.map((c, i) => ({
    detections: c.detections,
    maxRangeM: maxRangeFor(robot.cameras[i], layout.tags[0]?.size ?? 0.1651),
  })))
  return { score, perCamera }
}
