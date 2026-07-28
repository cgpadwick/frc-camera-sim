import type { RobotConfig, CameraSpec, TagLayout, OccluderBox } from './types'
import { runSweep, coverageScoreVsIdeal } from './sweep'
import type { SweepParams } from './sweep'
import { normalToYawPitch } from '../editor/placementMath'

/**
 * A physically mountable camera pose candidate: a point on a robot surface
 * plus the aim seeded from that surface's outward normal (matching the
 * robot editor's click-to-place behavior).
 */
export interface MountCandidate {
  x: number
  y: number
  z: number
  yawDeg: number
  pitchDeg: number
}

/**
 * Samples candidate mounts from the robot's real surfaces: the four chassis
 * side faces (at bumper-top height) and every superstructure box's four side
 * faces plus its top face. Spacing controls density along each face edge.
 * Aim = face normal (top faces get a level aim in 8 directions instead of
 * straight up, which is never useful for tags).
 */
export function sampleMountCandidates(robot: RobotConfig, spacingM = 0.15): MountCandidate[] {
  const out: MountCandidate[] = []
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number): void => {
    const { yawDeg, pitchDeg } = normalToYawPitch({ x: nx, y: ny, z: nz })
    out.push({ x: r3(x), y: r3(y), z: r3(z), yawDeg: r1(yawDeg), pitchDeg: r1(pitchDeg) })
  }
  const r3 = (v: number): number => Number(v.toFixed(3))
  const r1 = (v: number): number => Number(v.toFixed(1))

  const steps = (len: number): number[] => {
    const n = Math.max(2, Math.round(len / spacingM))
    return Array.from({ length: n + 1 }, (_, i) => -len / 2 + (len * i) / n)
  }

  // Chassis side faces at a practical mounting height (top of chassis).
  const cz = robot.chassisHeightM + 0.06
  const hl = robot.lengthM / 2
  const hw = robot.widthM / 2
  for (const t of steps(robot.widthM)) {
    push(hl, t, cz, 1, 0, 0) // front face
    push(-hl, t, cz, -1, 0, 0) // back face
  }
  for (const t of steps(robot.lengthM)) {
    push(t, hw, cz, 0, 1, 0) // left face
    push(t, -hw, cz, 0, -1, 0) // right face
  }

  // Superstructure boxes: 4 side faces + level-aim ring on the top face.
  for (const box of robot.superstructure) {
    const yaw = (box.yawDeg * Math.PI) / 180
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)
    const local = (lx: number, ly: number): { x: number; y: number } => ({
      x: box.center.x + lx * cos - ly * sin,
      y: box.center.y + lx * sin + ly * cos,
    })
    const zs = [box.center.z, box.center.z + box.size.z * 0.4]
    for (const z of zs) {
      for (const t of steps(box.size.y)) {
        const f = local(box.size.x / 2, t)
        push(f.x, f.y, z, cos, sin, 0)
        const b = local(-box.size.x / 2, t)
        push(b.x, b.y, z, -cos, -sin, 0)
      }
      for (const t of steps(box.size.x)) {
        const l = local(t, box.size.y / 2)
        push(l.x, l.y, z, -sin, cos, 0)
        const r = local(t, -box.size.y / 2)
        push(r.x, r.y, z, sin, -cos, 0)
      }
    }
    // Top face center: 8 level aim directions (a mast-top camera).
    const topZ = box.center.z + box.size.z / 2 + 0.02
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4
      push(box.center.x, box.center.y, topZ, Math.cos(a), Math.sin(a), 0)
    }
  }
  return out
}

export interface OptimizeOptions {
  /** Coarse sweep used inside the loop — final proposals get re-swept at full res by the caller. */
  sweepParams: SweepParams
  /** Extra aim variants tried around each candidate's normal aim. */
  yawOffsetsDeg?: number[]
  pitchOffsetsDeg?: number[]
  /** Greedy passes over all cameras. */
  rounds?: number
  /** Indices of cameras to leave untouched. */
  lockedCameras?: number[]
  onProgress?(p: { evals: number; totalEvals: number; bestScore: number; cameraIndex: number; round: number }): void
  /** Return true to abort; the best-so-far result is returned. */
  shouldStop?(): boolean
}

export interface OptimizeResult {
  cameras: CameraSpec[]
  score: number
  evals: number
}

/**
 * Objective: worst-case coverage score vs ideal, plus a small mean-coverage
 * tiebreaker so the optimizer gets signal on plateaus where the worst-case
 * integer count doesn't move.
 */
export function objectiveScore(
  robot: RobotConfig,
  layout: TagLayout,
  fieldOccluders: OccluderBox[],
  params: SweepParams,
): number {
  const result = runSweep(layout, robot, fieldOccluders, params)
  const score = coverageScoreVsIdeal(result)
  if (!score) return 0
  let headingSum = 0
  for (let i = 0; i < result.perHeading.length; i++) headingSum += result.perHeading[i]
  const meanTiebreak = headingSum / result.perHeading.length / 10 // ~0..1 scale
  return score.worstPct + meanTiebreak * 0.5
}

/**
 * Greedy coordinate optimization: cameras are optimized one at a time over
 * the sampled mount candidates x aim offsets, keeping the best after each
 * camera, for `rounds` passes. Only mount poses change — FOV/resolution
 * (the purchased hardware) stay fixed.
 */
export function optimizeCameraMounts(
  robot: RobotConfig,
  layout: TagLayout,
  fieldOccluders: OccluderBox[],
  opts: OptimizeOptions,
): OptimizeResult {
  const yawOffsets = opts.yawOffsetsDeg ?? [-30, 0, 30]
  const pitchOffsets = opts.pitchOffsetsDeg ?? [0, 15]
  const rounds = opts.rounds ?? 2
  const locked = new Set(opts.lockedCameras ?? [])
  const candidates = sampleMountCandidates(robot)

  const working: RobotConfig = structuredClone(robot)
  let bestScore = objectiveScore(working, layout, fieldOccluders, opts.sweepParams)
  let evals = 1
  const freeCams = working.cameras.map((_, i) => i).filter((i) => !locked.has(i))
  const totalEvals = 1 + rounds * freeCams.length * candidates.length * yawOffsets.length * pitchOffsets.length

  for (let round = 0; round < rounds; round++) {
    for (const ci of freeCams) {
      let bestMount = { ...working.cameras[ci].mount }
      for (const cand of candidates) {
        for (const dy of yawOffsets) {
          for (const dp of pitchOffsets) {
            if (opts.shouldStop?.()) {
              working.cameras[ci].mount = bestMount
              return { cameras: working.cameras, score: bestScore, evals }
            }
            working.cameras[ci].mount = {
              x: cand.x,
              y: cand.y,
              z: cand.z,
              rollDeg: 0,
              yawDeg: normDeg(cand.yawDeg + dy),
              pitchDeg: clamp(cand.pitchDeg + dp, -60, 60),
            }
            const s = objectiveScore(working, layout, fieldOccluders, opts.sweepParams)
            evals++
            if (s > bestScore) {
              bestScore = s
              bestMount = { ...working.cameras[ci].mount }
            }
          }
        }
        opts.onProgress?.({ evals, totalEvals, bestScore, cameraIndex: ci, round })
      }
      working.cameras[ci].mount = bestMount
    }
  }
  return { cameras: working.cameras, score: bestScore, evals }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const normDeg = (d: number): number => {
  let x = d % 360
  if (x > 180) x -= 360
  if (x < -180) x += 360
  return Number(x.toFixed(1))
}
