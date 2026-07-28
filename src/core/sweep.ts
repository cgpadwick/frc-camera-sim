import type { TagLayout, RobotConfig, OccluderBox } from './types'
import { evaluatePose } from './evaluate'

export interface SweepParams { cellSizeM: number; headingCount: number }
export const DEFAULT_SWEEP: SweepParams = { cellSizeM: 0.25, headingCount: 16 }

export interface SweepResult {
  cols: number; rows: number; cellSizeM: number; headingCount: number
  /** Per cell: min/avg UNIQUE visible tag count over the sampled headings; perHeading holds every sample (cell-major). */
  minCount: Float32Array; avgCount: Float32Array; perHeading: Float32Array
  tagSeen: Record<number, number>; cameraDetections: number[]
}

export const cellIndex = (c: number, r: number, cols: number): number => r * cols + c

export function runSweep(
  layout: TagLayout, robot: RobotConfig, fieldOccluders: OccluderBox[],
  params: SweepParams, onProgress?: (frac: number) => void,
): SweepResult {
  const cols = Math.ceil(layout.field.length / params.cellSizeM)
  const rows = Math.ceil(layout.field.width / params.cellSizeM)
  const n = cols * rows
  const minCount = new Float32Array(n).fill(Infinity)
  const avgCount = new Float32Array(n)
  const perHeading = new Float32Array(n * params.headingCount)
  const tagSeen: Record<number, number> = {}
  const cameraDetections = robot.cameras.map(() => 0)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = cellIndex(c, r, cols)
      for (let h = 0; h < params.headingCount; h++) {
        const pose = {
          x: (c + 0.5) * params.cellSizeM,
          y: (r + 0.5) * params.cellSizeM,
          headingRad: (2 * Math.PI * h) / params.headingCount,
        }
        const ev = evaluatePose(pose, robot, layout, fieldOccluders)
        perHeading[i * params.headingCount + h] = ev.tagCount
        minCount[i] = Math.min(minCount[i], ev.tagCount)
        avgCount[i] += ev.tagCount / params.headingCount
        for (const cam of ev.perCamera) {
          cameraDetections[cam.cameraIndex] += cam.detections.length
          for (const d of cam.detections) tagSeen[d.tagId] = (tagSeen[d.tagId] ?? 0) + 1
        }
      }
    }
    onProgress?.((r + 1) / rows)
  }
  return { cols, rows, cellSizeM: params.cellSizeM, headingCount: params.headingCount, minCount, avgCount, perHeading, tagSeen, cameraDetections }
}
