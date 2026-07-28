import type { SweepResult } from '../core/sweep'
import { cellIndex } from '../core/sweep'
import type { RobotConfig } from '../core/types'
import { countBand } from '../core/evaluate'
import { coverageScoreVsIdeal } from '../core/sweep'

export type Band = ReturnType<typeof countBand>

const BANDS: Band[] = ['dead', 'poor', 'ok', 'strong']

export const DEAD_ZONE_CAP = 40
export const RARE_SEEN_THRESHOLD_PCT = 2

export interface ReportStats {
  bandPctMin: Record<Band, number>
  bandPctAvg: Record<Band, number>
  /** Field-wide coverage vs the ideal layer (ideal = 100); null when the ideal layer is empty. */
  scoreVsIdeal: { worstPct: number; avgPct: number } | null
  /** Cell centers with minCount <= 0 ("dead" — some heading sees zero tags), capped at DEAD_ZONE_CAP entries. */
  deadZones: { xM: number; yM: number }[]
  /** Count of additional dead cells beyond the DEAD_ZONE_CAP cutoff (0 if none). */
  deadZoneOverflow: number
  cameraShare: { name: string; pct: number }[]
  /** Tag ids from `allTagIds` with zero recorded detections. Empty if allTagIds is omitted. */
  tagsNeverSeen: number[]
  /** Tags seen at least once but under RARE_SEEN_THRESHOLD_PCT of samples. */
  tagsRarelySeen: { id: number; seenPct: number }[]
}

function bandPercentages(scores: Float32Array): Record<Band, number> {
  const counts: Record<Band, number> = { dead: 0, poor: 0, ok: 0, strong: 0 }
  for (let i = 0; i < scores.length; i++) counts[countBand(scores[i])]++
  const total = scores.length || 1
  const pct: Record<Band, number> = { dead: 0, poor: 0, ok: 0, strong: 0 }
  for (const b of BANDS) pct[b] = (counts[b] * 100) / total
  return pct
}

/**
 * Pure aggregation of a completed SweepResult into printable report stats.
 *
 * `tagSeen` semantics (carried finding from Task 7 review): `SweepResult.tagSeen[id]`
 * increments once per CAMERA detection of that tag, not once per unique
 * cell-heading sample — two cameras seeing the same tag in the same sample
 * count as 2. So a raw `tagSeen[id] / totalSamples` ratio can exceed 100%
 * when a robot has multiple cameras with overlapping coverage. This function:
 *   - uses raw tagSeen presence (> 0) for the "never seen" check, since that's
 *     unaffected by the double-counting (a tag seen at all has count >= 1);
 *   - computes `seenPct` for the "rarely seen" list as
 *     `tagSeen[id] / totalSamples * 100`, then clamps the *displayed* value to
 *     100 — a tag that's genuinely rare (few detections vs. a large sample
 *     count) stays under the 2% threshold either way, so the clamp only
 *     affects display of already-common tags, never the rarity classification.
 *
 * `allTagIds` (optional): the full list of tag ids present in the field
 * layout for this sweep. `SweepResult` alone doesn't carry which tags exist
 * in the layout — only which ones were ever detected — so a tag with zero
 * detections has no key in `tagSeen` at all and can't be distinguished from
 * "not part of this layout" without the caller supplying the layout's tag
 * ids. When omitted, `tagsNeverSeen` is empty (nothing to compare against).
 */
export function computeReportStats(result: SweepResult, robot: RobotConfig, allTagIds?: number[]): ReportStats {
  const bandPctMin = bandPercentages(result.minCount)
  const bandPctAvg = bandPercentages(result.avgCount)
  const scoreVsIdeal = coverageScoreVsIdeal(result)

  const deadZonesAll: { xM: number; yM: number }[] = []
  for (let r = 0; r < result.rows; r++) {
    for (let c = 0; c < result.cols; c++) {
      const i = cellIndex(c, r, result.cols)
      if (result.minCount[i] <= 0) {
        deadZonesAll.push({ xM: (c + 0.5) * result.cellSizeM, yM: (r + 0.5) * result.cellSizeM })
      }
    }
  }
  const deadZones = deadZonesAll.slice(0, DEAD_ZONE_CAP)
  const deadZoneOverflow = Math.max(0, deadZonesAll.length - DEAD_ZONE_CAP)

  const totalDetections = result.cameraDetections.reduce((s, n) => s + n, 0) || 1
  const cameraShare = robot.cameras.map((cam, i) => ({
    name: cam.name,
    pct: ((result.cameraDetections[i] ?? 0) * 100) / totalDetections,
  }))

  const totalSamples = result.cols * result.rows * result.headingCount || 1
  const seenIds = Object.keys(result.tagSeen).map(Number)
  const tagsNeverSeen = (allTagIds ?? []).filter((id) => !(result.tagSeen[id] > 0))
  const tagsRarelySeen = seenIds
    .map((id) => ({ id, seenPct: (result.tagSeen[id] * 100) / totalSamples }))
    .filter((t) => t.seenPct < RARE_SEEN_THRESHOLD_PCT)
    .map((t) => ({ id: t.id, seenPct: Math.min(100, t.seenPct) }))
    .sort((a, b) => a.id - b.id)

  return { scoreVsIdeal, bandPctMin, bandPctAvg, deadZones, deadZoneOverflow, cameraShare, tagsNeverSeen, tagsRarelySeen }
}
