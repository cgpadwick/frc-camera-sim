import type { Detection } from './visibility'
import { SKEW_MAX_RAD } from './visibility'

export const SCORING = {
  DIST_FALLOFF_START: 0.4, // fraction of max range where distance falloff begins
  EDGE_POW: 0.5,
  EDGE_SATURATION: 0.5, // edgeMargin at/above this counts as fully centered
  TAG_CAP: 4,
  SPREAD_BONUS_MAX: 1.5,
  BASE_SCALE: 25, // one perfect tag ≈ 25 points
}

export function tagQuality(d: Detection, maxRangeM: number): number {
  const start = SCORING.DIST_FALLOFF_START * maxRangeM
  const distFactor = d.distanceM <= start ? 1 : Math.max(0, 1 - (d.distanceM - start) / (maxRangeM - start))
  const skewFactor = Math.max(0, 1 - d.skewRad / SKEW_MAX_RAD)
  const edgeFactor = Math.pow(Math.min(1, d.edgeMargin / SCORING.EDGE_SATURATION), SCORING.EDGE_POW)
  return distFactor * skewFactor * edgeFactor
}

export function poseScore(perCamera: { detections: Detection[]; maxRangeM: number }[]): number {
  // Dedupe by tag id, keep best quality (and that detection's bearing)
  const best = new Map<number, { q: number; bearing: number }>()
  for (const { detections, maxRangeM } of perCamera) {
    for (const d of detections) {
      const q = tagQuality(d, maxRangeM)
      const cur = best.get(d.tagId)
      if (!cur || q > cur.q) best.set(d.tagId, { q, bearing: d.bearingRad })
    }
  }
  if (best.size === 0) return 0
  const items = [...best.values()].sort((a, b) => b.q - a.q).slice(0, SCORING.TAG_CAP)
  const base = items.reduce((s, i) => s + i.q, 0)
  // Bearing spread in [0,1]: 1 - |mean unit vector| (circular variance)
  const spreadFactorOf = (xs: { q: number; bearing: number }[]) => {
    let sx = 0, sy = 0
    for (const i of xs) { sx += Math.cos(i.bearing); sy += Math.sin(i.bearing) }
    const spread = xs.length < 2 ? 0 : 1 - Math.hypot(sx, sy) / xs.length
    return 1 + (SCORING.SPREAD_BONUS_MAX - 1) * Math.min(1, spread * 2)
  }
  // Adding a low-quality tag can shrink circular-mean spread even though base only
  // grows; guard monotonicity by also considering the factor from the item set with
  // the weakest (last, since items is sorted desc by quality) tag dropped.
  const spreadFactor = Math.max(spreadFactorOf(items), spreadFactorOf(items.slice(0, -1)))
  return Math.min(100, base * spreadFactor * SCORING.BASE_SCALE)
}

export function scoreBand(score: number): 'dead' | 'poor' | 'ok' | 'strong' {
  if (score <= 0) return 'dead'
  if (score < 40) return 'poor'
  if (score < 70) return 'ok'
  return 'strong'
}
