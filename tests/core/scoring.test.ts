import { describe, it, expect } from 'vitest'
import { tagQuality, poseScore, scoreBand, SCORING } from '../../src/core/scoring'
import type { Detection } from '../../src/core/visibility'

const det = (over: Partial<Detection> = {}): Detection => ({
  tagId: 1, distanceM: 1, skewRad: 0, edgeMargin: 1, bearingRad: 0, ...over,
})

describe('tagQuality', () => {
  it('perfect close head-on centered tag ≈ 1', () => {
    expect(tagQuality(det(), 5)).toBeGreaterThan(0.95)
  })
  it('monotonic: farther is not better', () => {
    expect(tagQuality(det({ distanceM: 4 }), 5)).toBeLessThanOrEqual(tagQuality(det({ distanceM: 2 }), 5))
  })
  it('monotonic: more skew is not better', () => {
    expect(tagQuality(det({ skewRad: 1.0 }), 5)).toBeLessThanOrEqual(tagQuality(det({ skewRad: 0.3 }), 5))
  })
  it('edge-hugging tag scores lower than centered', () => {
    expect(tagQuality(det({ edgeMargin: 0.05 }), 5)).toBeLessThan(tagQuality(det({ edgeMargin: 0.9 }), 5))
  })
})

describe('poseScore', () => {
  const cam = (ds: Detection[]) => [{ detections: ds, maxRangeM: 5 }]
  it('no tags => 0', () => expect(poseScore(cam([]))).toBe(0))
  it('one perfect tag => BASE_SCALE-ish (poor band)', () => {
    const s = poseScore(cam([det()]))
    expect(s).toBeGreaterThan(15); expect(s).toBeLessThan(40)
  })
  it('two spread tags beat two clustered tags', () => {
    const clustered = poseScore(cam([det(), det({ tagId: 2, bearingRad: 0.05 })]))
    const spread = poseScore(cam([det(), det({ tagId: 2, bearingRad: Math.PI / 2 })]))
    expect(spread).toBeGreaterThan(clustered)
  })
  it('more tags never lowers score', () => {
    const two = poseScore(cam([det(), det({ tagId: 2, bearingRad: 1 })]))
    const three = poseScore(cam([det(), det({ tagId: 2, bearingRad: 1 }), det({ tagId: 3, bearingRad: 2 })]))
    expect(three).toBeGreaterThanOrEqual(two)
  })
  it('reviewer regression: degraded 4th tag never lowers score', () => {
    const three = poseScore(cam([
      det({ tagId: 1, bearingRad: 0 }),
      det({ tagId: 2, bearingRad: Math.PI / 4 }),
      det({ tagId: 3, bearingRad: Math.PI / 2 }),
    ]))
    const four = poseScore(cam([
      det({ tagId: 1, bearingRad: 0 }),
      det({ tagId: 2, bearingRad: Math.PI / 4 }),
      det({ tagId: 3, bearingRad: Math.PI / 2 }),
      det({ tagId: 4, bearingRad: Math.PI / 4, distanceM: 4.9, skewRad: 1.1, edgeMargin: 0.02 }),
    ]))
    expect(four).toBeGreaterThanOrEqual(three)
  })
  it('same tag from two cameras counts once', () => {
    const one = poseScore(cam([det()]))
    const dup = poseScore([{ detections: [det()], maxRangeM: 5 }, { detections: [det()], maxRangeM: 5 }])
    expect(dup).toBeCloseTo(one, 5)
  })
  it('capped at 100', () => {
    const many = Array.from({ length: 8 }, (_, i) => det({ tagId: i + 1, bearingRad: (i * Math.PI) / 4 }))
    expect(poseScore(cam(many))).toBeLessThanOrEqual(100)
  })
})

describe('scoreBand', () => {
  it('bands', () => {
    expect(scoreBand(0)).toBe('dead'); expect(scoreBand(20)).toBe('poor')
    expect(scoreBand(50)).toBe('ok'); expect(scoreBand(85)).toBe('strong')
  })
})
