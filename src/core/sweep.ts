import type { TagLayout, RobotConfig, OccluderBox } from './types'
import { evaluatePose, idealTagCount } from './evaluate'

export interface SweepParams {
  cellSizeM: number
  headingCount: number
  /** Range for the ideal (upper-bound) coverage layer — see idealTagCount. */
  idealRangeM: number
}
export const DEFAULT_SWEEP: SweepParams = { cellSizeM: 0.25, headingCount: 16, idealRangeM: 4 }

export interface SweepResult {
  cols: number; rows: number; cellSizeM: number; headingCount: number
  /** Per cell: min/avg UNIQUE visible tag count over the sampled headings; perHeading holds every sample (cell-major). */
  minCount: Float32Array; avgCount: Float32Array; perHeading: Float32Array
  /** Heading-independent upper bound per cell (idealTagCount at params.idealRangeM). */
  idealCount: Float32Array
  idealRangeM: number
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
  const idealCount = new Float32Array(n)
  const tagSeen: Record<number, number> = {}
  const cameraDetections = robot.cameras.map(() => 0)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = cellIndex(c, r, cols)
      idealCount[i] = idealTagCount((c + 0.5) * params.cellSizeM, (r + 0.5) * params.cellSizeM, layout, fieldOccluders, params.idealRangeM)
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
  return { cols, rows, cellSizeM: params.cellSizeM, headingCount: params.headingCount, minCount, avgCount, perHeading, idealCount, idealRangeM: params.idealRangeM, tagSeen, cameraDetections }
}

/**
 * Field-wide coverage efficiency vs the ideal layer: sum of per-cell actual
 * counts (each clamped to that cell's ideal, so outranging the ideal N
 * can't push past 100) over the summed ideal, as a 0-100 percentage.
 * Ideal itself scores 100 by construction. Null when the ideal layer is
 * all-zero (no tags reachable anywhere at range N).
 */
export function coverageScoreVsIdeal(result: SweepResult): { worstPct: number; avgPct: number } | null {
  let sumIdeal = 0
  let sumWorst = 0
  let sumAvg = 0
  for (let i = 0; i < result.idealCount.length; i++) {
    const ideal = result.idealCount[i]
    sumIdeal += ideal
    sumWorst += Math.min(result.minCount[i], ideal)
    sumAvg += Math.min(result.avgCount[i], ideal)
  }
  if (sumIdeal <= 0) return null
  return { worstPct: (100 * sumWorst) / sumIdeal, avgPct: (100 * sumAvg) / sumIdeal }
}
