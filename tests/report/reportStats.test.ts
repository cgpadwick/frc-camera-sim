import { describe, it, expect } from 'vitest'
import { computeReportStats } from '../../src/report/report'
import type { SweepResult } from '../../src/core/sweep'

function fakeSweep(minVals: number[], avgVals: number[]): SweepResult {
  return {
    cols: minVals.length, rows: 1, cellSizeM: 1, headingCount: 2,
    minCount: Float32Array.from(minVals), avgCount: Float32Array.from(avgVals),
    perHeading: new Float32Array(minVals.length * 2),
    idealCount: new Float32Array(minVals.length), idealRangeM: 4,
    tagSeen: { 1: 100, 2: 1 }, cameraDetections: [90, 10],
  }
}
const robot = { lengthM: 1, widthM: 1, chassisHeightM: 0.1, teamNumber: '0', superstructure: [],
  cameras: [
    { name: 'front', hfovDeg: 80, vfovDeg: 55, resWidth: 1280, resHeight: 800, maxRangeM: null, mount: { x: 0, y: 0, z: 0.3, rollDeg: 0, pitchDeg: 0, yawDeg: 0 } },
    { name: 'rear', hfovDeg: 80, vfovDeg: 55, resWidth: 1280, resHeight: 800, maxRangeM: null, mount: { x: 0, y: 0, z: 0.3, rollDeg: 0, pitchDeg: 0, yawDeg: 180 } },
  ] }

describe('computeReportStats', () => {
  const stats = computeReportStats(fakeSweep([0, 1, 2, 3], [0.5, 1.5, 2.5, 3.5]), robot)
  it('band percentages from minCount', () => {
    expect(stats.bandPctMin.dead).toBeCloseTo(25)
    expect(stats.bandPctMin.poor).toBeCloseTo(25)
    expect(stats.bandPctMin.ok).toBeCloseTo(25)
    expect(stats.bandPctMin.strong).toBeCloseTo(25)
  })
  it('dead zones list cell centers', () => {
    expect(stats.deadZones).toEqual([{ xM: 0.5, yM: 0.5 }])
  })
  it('camera share percentages', () => {
    expect(stats.cameraShare).toEqual([{ name: 'front', pct: 90 }, { name: 'rear', pct: 10 }])
  })
  it('rarely-seen tags under 2% of samples', () => {
    // 4 cells * 2 headings = 8 samples; tag 2 seen once = 12.5% -> not rare with this tiny grid
    expect(stats.tagsRarelySeen.map(t => t.id)).not.toContain(1)
  })
})

// --- Additional coverage beyond the brief's transcribed tests ---

describe('computeReportStats: bandPctAvg is independent of bandPctMin', () => {
  it('computed from avgCount, not minCount', () => {
    // avgVals = [10, 30, 60, 90] -> poor, poor, ok, strong (bands: dead<=0, poor<40, ok<70, strong>=70)
    const stats = computeReportStats(fakeSweep([0, 1, 2, 3], [0.5, 1.5, 2.5, 3.5]), robot)
    expect(stats.bandPctAvg.dead).toBeCloseTo(0)
    expect(stats.bandPctAvg.poor).toBeCloseTo(50)
    expect(stats.bandPctAvg.ok).toBeCloseTo(25)
    expect(stats.bandPctAvg.strong).toBeCloseTo(25)
  })
})

describe('computeReportStats: dead zone cap', () => {
  it('caps the returned list at 40 and reports the overflow count', () => {
    const n = 50
    const minVals = new Array(n).fill(0) // every cell is dead
    const avgVals = new Array(n).fill(0)
    const sweep: SweepResult = {
      cols: n, rows: 1, cellSizeM: 1, headingCount: 1,
      minCount: Float32Array.from(minVals), avgCount: Float32Array.from(avgVals),
      perHeading: new Float32Array(n),
      tagSeen: {}, cameraDetections: [0, 0],
    }
    const stats = computeReportStats(sweep, robot)
    expect(stats.deadZones).toHaveLength(40)
    expect(stats.deadZoneOverflow).toBe(10)
  })

  it('overflow is 0 when at/under the cap', () => {
    const n = 40
    const minVals = new Array(n).fill(0)
    const avgVals = new Array(n).fill(0)
    const sweep: SweepResult = {
      cols: n, rows: 1, cellSizeM: 1, headingCount: 1,
      minCount: Float32Array.from(minVals), avgCount: Float32Array.from(avgVals),
      perHeading: new Float32Array(n),
      tagSeen: {}, cameraDetections: [0, 0],
    }
    const stats = computeReportStats(sweep, robot)
    expect(stats.deadZones).toHaveLength(40)
    expect(stats.deadZoneOverflow).toBe(0)
  })
})

describe('computeReportStats: tagSeen semantics (carried finding from Task 7 review)', () => {
  // tagSeen[id] increments once per CAMERA detection, not per unique cell-heading
  // sample, so raw tagSeen[id] / totalSamples can exceed 100% when >1 camera
  // sees the same tag in the same sample. Displayed seenPct must be capped at 100.
  it('caps seenPct at 100 even when raw count exceeds total samples', () => {
    const sweep = fakeSweep([0, 20, 50, 80], [10, 30, 60, 90]) // 4 cells * 2 headings = 8 samples
    // tag 1 seen 100 times (> 8 samples, e.g. double-counted across 2 cameras) -> would be 1250% raw
    const stats = computeReportStats(sweep, robot)
    const tag1Rare = stats.tagsRarelySeen.find((t) => t.id === 1)
    expect(tag1Rare).toBeUndefined() // nowhere near rare
    // never-seen check must use raw tagSeen presence, unaffected by the cap
    expect(stats.tagsNeverSeen).not.toContain(1)
    expect(stats.tagsNeverSeen).not.toContain(2)
  })

  it('a tag with zero detections is never-seen when allTagIds names it', () => {
    const sweep = fakeSweep([0, 20, 50, 80], [10, 30, 60, 90]) // tagSeen has ids 1, 2 only
    const stats = computeReportStats(sweep, robot, [1, 2, 3])
    expect(stats.tagsNeverSeen).toEqual([3])
  })

  it('without allTagIds, tagsNeverSeen is empty (cannot infer layout ids from tagSeen alone)', () => {
    const sweep = fakeSweep([0, 20, 50, 80], [10, 30, 60, 90])
    const stats = computeReportStats(sweep, robot)
    expect(stats.tagsNeverSeen).toEqual([])
  })

  it('a genuinely rarely-seen tag (few detections relative to a large sample count) is flagged', () => {
    const n = 100 // 100 cells * 2 headings = 200 samples
    const minVals = new Array(n).fill(50)
    const avgVals = new Array(n).fill(50)
    const sweep: SweepResult = {
      cols: n, rows: 1, cellSizeM: 1, headingCount: 2,
      minCount: Float32Array.from(minVals), avgCount: Float32Array.from(avgVals),
      perHeading: new Float32Array(n * 2),
      tagSeen: { 7: 2 }, // 2 / 200 = 1% < 2% threshold
      cameraDetections: [2, 0],
    }
    const stats = computeReportStats(sweep, robot)
    expect(stats.tagsRarelySeen).toEqual([{ id: 7, seenPct: 1 }])
  })
})
