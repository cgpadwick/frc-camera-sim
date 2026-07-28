import type { RobotConfig, CameraSpec, TagLayout, OccluderBox } from './types'
import { runSweep, coverageScoreVsIdeal } from './sweep'
import { idealTagCount } from './evaluate'
import { detectTags, robotOccludersInField, tagCorners, maxRangeFor } from './visibility'
import { rotateVec, vec3 } from './math'
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
  /** Independent greedy runs: 1 from the current config + (restarts-1) from deterministic random seeds; best wins. */
  restarts?: number
  /** Indices of cameras to leave untouched. */
  lockedCameras?: number[]
  onProgress?(p: { evals: number; totalEvals: number; bestScore: number; bestWorstPct: number; cameraIndex: number; round: number }): void
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
 * Precomputed pose grid shared by every candidate evaluation. The expensive
 * invariants — robot self-occluders per pose and the ideal layer per cell —
 * are computed once; per-camera visibility is stored as 64-bit tag masks
 * (two uint32 words per pose) so the multi-camera union is a bitwise OR and
 * the unique-tag count is a popcount.
 */
interface PoseGrid {
  poses: { x: number; y: number; headingRad: number }[]
  cellCount: number
  headingCount: number
  /** Per pose: field + robot-self occluders (superstructure only — cameras don't occlude). */
  occludersPerPose: OccluderBox[][]
  idealPerCell: Float32Array
  idealSum: number
  tagBit: Map<number, number>
}

function buildPoseGrid(
  robot: RobotConfig,
  layout: TagLayout,
  fieldOccluders: OccluderBox[],
  params: SweepParams,
): PoseGrid {
  const cols = Math.ceil(layout.field.length / params.cellSizeM)
  const rows = Math.ceil(layout.field.width / params.cellSizeM)
  const cellCount = cols * rows
  const poses: PoseGrid['poses'] = []
  const occludersPerPose: OccluderBox[][] = []
  const idealPerCell = new Float32Array(cellCount)
  let idealSum = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * params.cellSizeM
      const y = (r + 0.5) * params.cellSizeM
      const cell = r * cols + c
      idealPerCell[cell] = idealTagCount(x, y, layout, fieldOccluders, params.idealRangeM)
      idealSum += idealPerCell[cell]
      for (let h = 0; h < params.headingCount; h++) {
        const pose = { x, y, headingRad: (2 * Math.PI * h) / params.headingCount }
        poses.push(pose)
        occludersPerPose.push([...fieldOccluders, ...robotOccludersInField(pose, robot)])
      }
    }
  }
  const tagBit = new Map<number, number>()
  layout.tags.forEach((t, i) => {
    if (i < 64) tagBit.set(t.id, i)
  })
  return { poses, cellCount, headingCount: params.headingCount, occludersPerPose, idealPerCell, idealSum, tagBit }
}

/** Per-pose visibility masks for one camera at one mount: 2 uint32 words per pose. */
function cameraMasks(grid: PoseGrid, spec: CameraSpec, tags: TagLayout['tags'], rangeCapM: number): Uint32Array {
  const out = new Uint32Array(grid.poses.length * 2)
  for (let p = 0; p < grid.poses.length; p++) {
    const detections = detectTags(grid.poses[p], spec, tags, grid.occludersPerPose[p], rangeCapM)
    let lo = 0
    let hi = 0
    for (const d of detections) {
      const bit = grid.tagBit.get(d.tagId)
      if (bit === undefined) continue
      if (bit < 32) lo |= 1 << bit
      else hi |= 1 << (bit - 32)
    }
    out[p * 2] = lo
    out[p * 2 + 1] = hi
  }
  return out
}

/** Static per-tag geometry unpacked to flat numbers for the fast mask path. */
interface TagPrecomp {
  bit: number
  cx: number
  cy: number
  cz: number
  nx: number
  ny: number
  nz: number
  /** 4 world-space corners, xyz-interleaved. */
  corners: Float64Array
}

const COS_SKEW_MAX = Math.cos((65 * Math.PI) / 180)
const OCCL_EPS = 0.01

function precomputeTags(layout: TagLayout, tagBit: Map<number, number>): TagPrecomp[] {
  return layout.tags
    .filter((t) => tagBit.has(t.id))
    .map((t) => {
      const corners = tagCorners(t)
      const flat = new Float64Array(12)
      corners.forEach((c, i) => {
        flat[i * 3] = c.x
        flat[i * 3 + 1] = c.y
        flat[i * 3 + 2] = c.z
      })
      const n = rotateVec(t.pose.rotation, vec3(1, 0, 0))
      return {
        bit: tagBit.get(t.id)!,
        cx: t.pose.translation.x,
        cy: t.pose.translation.y,
        cz: t.pose.translation.z,
        nx: n.x,
        ny: n.y,
        nz: n.z,
        corners: flat,
      }
    })
}

/** Allocation-free segment-vs-yaw-box test (mirrors visibility.ts segmentHitsBox + its 1cm end shortening). */
function segmentBlocked(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  boxes: OccluderBox[],
): boolean {
  let dx = bx - ax
  let dy = by - ay
  let dz = bz - az
  const len = Math.hypot(dx, dy, dz)
  if (len > 2 * OCCL_EPS) {
    const s = OCCL_EPS / len
    ax += dx * s
    ay += dy * s
    az += dz * s
    bx -= dx * s
    by -= dy * s
    bz -= dz * s
    dx = bx - ax
    dy = by - ay
    dz = bz - az
  }
  for (const box of boxes) {
    const yaw = (box.yawDeg * Math.PI) / 180
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    // segment endpoints in box-local frame (undo yaw)
    const tax = ax - box.center.x
    const tay = ay - box.center.y
    const lax = tax * c + tay * s
    const lay = -tax * s + tay * c
    const laz = az - box.center.z
    const tbx = bx - box.center.x
    const tby = by - box.center.y
    const lbx = tbx * c + tby * s
    const lby = -tbx * s + tby * c
    const lbz = bz - box.center.z
    const ddx = lbx - lax
    const ddy = lby - lay
    const ddz = lbz - laz
    const hx = box.size.x / 2
    const hy = box.size.y / 2
    const hz = box.size.z / 2
    let tmin = 0
    let tmax = 1
    let miss = false
    for (const [la, dd, h] of [
      [lax, ddx, hx],
      [lay, ddy, hy],
      [laz, ddz, hz],
    ] as const) {
      if (Math.abs(dd) < 1e-12) {
        if (Math.abs(la) > h) {
          miss = true
          break
        }
      } else {
        let t1 = (-h - la) / dd
        let t2 = (h - la) / dd
        if (t1 > t2) {
          const tmp = t1
          t1 = t2
          t2 = tmp
        }
        if (t1 > tmin) tmin = t1
        if (t2 < tmax) tmax = t2
        if (tmin > tmax) {
          miss = true
          break
        }
      }
    }
    if (!miss) return true
  }
  return false
}

/**
 * Fast candidate-mask builder: identical semantics to
 * cameraMasks(detectTags) for roll-0 mounts (parity-tested), but with all
 * vector math inlined on flat numbers — no per-call quaternion/object
 * allocation. This is the optimizer's hot loop.
 */
function fastCameraMasks(
  grid: PoseGrid,
  spec: CameraSpec,
  tagsPre: TagPrecomp[],
  tagSize: number,
  rangeCapM: number,
): Uint32Array {
  const out = new Uint32Array(grid.poses.length * 2)
  const effRange = Math.min(maxRangeFor(spec, tagSize), rangeCapM)
  const effRange2 = effRange * effRange
  const tanH = Math.tan((spec.hfovDeg * Math.PI) / 360)
  const tanV = Math.tan((spec.vfovDeg * Math.PI) / 360)
  const myaw = (spec.mount.yawDeg * Math.PI) / 180
  const mpitch = (spec.mount.pitchDeg * Math.PI) / 180
  const cosP = Math.cos(mpitch)
  const sinP = Math.sin(mpitch)

  for (let p = 0; p < grid.poses.length; p++) {
    const pose = grid.poses[p]
    const cosH = Math.cos(pose.headingRad)
    const sinH = Math.sin(pose.headingRad)
    // camera world position: robot pos + Rz(heading) * mount offset
    const camX = pose.x + spec.mount.x * cosH - spec.mount.y * sinH
    const camY = pose.y + spec.mount.x * sinH + spec.mount.y * cosH
    const camZ = spec.mount.z
    // camera axes (roll 0): total yaw = heading + mount yaw
    const psi = pose.headingRad + myaw
    const cosY = Math.cos(psi)
    const sinY = Math.sin(psi)
    const fX = cosY * cosP
    const fY = sinY * cosP
    const fZ = -sinP
    const lX = -sinY
    const lY = cosY
    const lZ = 0
    const uX = cosY * sinP
    const uY = sinY * sinP
    const uZ = cosP
    const occluders = grid.occludersPerPose[p]

    let lo = 0
    let hi = 0
    for (const tag of tagsPre) {
      const dx = camX - tag.cx
      const dy = camY - tag.cy
      const dz = camZ - tag.cz
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 > effRange2 || d2 < 1e-12) continue
      const invD = 1 / Math.sqrt(d2)
      if ((dx * tag.nx + dy * tag.ny + dz * tag.nz) * invD < COS_SKEW_MAX) continue
      let inside = true
      for (let ci = 0; ci < 4 && inside; ci++) {
        const vx = tag.corners[ci * 3] - camX
        const vy = tag.corners[ci * 3 + 1] - camY
        const vz = tag.corners[ci * 3 + 2] - camZ
        const pf = vx * fX + vy * fY + vz * fZ
        if (pf <= 1e-6) {
          inside = false
          break
        }
        const pl = vx * lX + vy * lY + vz * lZ
        const pu = vx * uX + vy * uY + vz * uZ
        if (Math.abs(pl) > tanH * pf || Math.abs(pu) > tanV * pf) inside = false
      }
      if (!inside) continue
      let occluded = false
      for (let ci = 0; ci < 4 && !occluded; ci++) {
        occluded = segmentBlocked(camX, camY, camZ, tag.corners[ci * 3], tag.corners[ci * 3 + 1], tag.corners[ci * 3 + 2], occluders)
      }
      if (!occluded) occluded = segmentBlocked(camX, camY, camZ, tag.cx, tag.cy, tag.cz, occluders)
      if (occluded) continue
      if (tag.bit < 32) lo |= 1 << tag.bit
      else hi |= 1 << (tag.bit - 32)
    }
    out[p * 2] = lo
    out[p * 2 + 1] = hi
  }
  return out
}

function popcount32(v: number): number {
  v = v - ((v >>> 1) & 0x55555555)
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

/**
 * Score of the union of the given camera mask arrays — identical math to
 * objectiveScore/runSweep+coverageScoreVsIdeal (worst-heading count clamped
 * to per-cell ideal, plus the mean-coverage tiebreaker), just computed from
 * cached masks.
 */
function scoreMasks(grid: PoseGrid, maskArrays: Uint32Array[], parts?: { worstPct: number }): number {
  if (grid.idealSum <= 0) {
    if (parts) parts.worstPct = 0
    return 0
  }
  let clampedWorstSum = 0
  let headingSum = 0
  const H = grid.headingCount
  for (let cell = 0; cell < grid.cellCount; cell++) {
    let worst = Infinity
    for (let h = 0; h < H; h++) {
      const p = cell * H + h
      let lo = 0
      let hi = 0
      for (const m of maskArrays) {
        lo |= m[p * 2]
        hi |= m[p * 2 + 1]
      }
      const count = popcount32(lo) + popcount32(hi)
      headingSum += count
      if (count < worst) worst = count
    }
    clampedWorstSum += Math.min(worst, grid.idealPerCell[cell])
  }
  const worstPct = (100 * clampedWorstSum) / grid.idealSum
  if (parts) parts.worstPct = worstPct
  const meanTiebreak = headingSum / grid.poses.length / 10
  return worstPct + meanTiebreak * 0.5
}

/**
 * Greedy coordinate optimization: cameras are optimized one at a time over
 * the sampled mount candidates x aim offsets, keeping the best after each
 * camera, for `rounds` passes. Only mount poses change — FOV/resolution
 * (the purchased hardware) stay fixed.
 *
 * Fast path: only the moving camera is re-evaluated per candidate; the
 * fixed cameras' visibility is cached as bitmasks and OR-ed in.
 */
export function optimizeCameraMounts(
  robot: RobotConfig,
  layout: TagLayout,
  fieldOccluders: OccluderBox[],
  opts: OptimizeOptions,
): OptimizeResult {
  const yawOffsets = opts.yawOffsetsDeg ?? [-30, -15, 0, 15, 30]
  const pitchOffsets = opts.pitchOffsetsDeg ?? [-25, -15, -5, 0, 10]
  const rounds = opts.rounds ?? 2
  const restarts = opts.restarts ?? 2
  const locked = new Set(opts.lockedCameras ?? [])
  const candidates = sampleMountCandidates(robot)
  const rangeCapM = opts.sweepParams.rangeCapM ?? Infinity

  const grid = buildPoseGrid(robot, layout, fieldOccluders, opts.sweepParams)
  const tagsPre = precomputeTags(layout, grid.tagBit)
  const tagSize = layout.tags[0]?.size ?? 0.1651
  // Candidate masks depend only on optics + mount; identical camera models,
  // repeat rounds, AND restarts all hit this cache instead of re-raycasting.
  const maskCache = new Map<string, Uint32Array>()
  const opticsKey = (c: CameraSpec): string =>
    `${c.hfovDeg}|${c.vfovDeg}|${c.resWidth}|${c.resHeight}|${c.maxRangeM ?? 'auto'}`

  let evals = 0
  let stopped = false
  const freeCamCount = robot.cameras.filter((_, i) => !locked.has(i)).length
  const effectiveRestarts = freeCamCount > 0 ? restarts : 1
  const totalEvals =
    effectiveRestarts * (1 + rounds * freeCamCount * candidates.length * yawOffsets.length * pitchOffsets.length)

  let overallBest: OptimizeResult | null = null

  for (let restart = 0; restart < effectiveRestarts && !stopped; restart++) {
    const working: RobotConfig = structuredClone(robot)
    const freeCams = working.cameras.map((_, i) => i).filter((i) => !locked.has(i))
    if (restart > 0) {
      // Deterministic pseudo-random seeding (no RNG: reproducible runs) —
      // scatter free cameras across candidate mounts to escape the local
      // optimum the user's current layout sits in.
      freeCams.forEach((ci, k) => {
        const cand = candidates[(restart * 7919 + k * 104729) % candidates.length]
        working.cameras[ci].mount = { x: cand.x, y: cand.y, z: cand.z, rollDeg: 0, yawDeg: cand.yawDeg, pitchDeg: cand.pitchDeg }
      })
    }
    // Initial masks use the general path (user mounts may have roll != 0).
    const masks = working.cameras.map((spec) => cameraMasks(grid, spec, layout.tags, rangeCapM))
    const scoreParts = { worstPct: 0 }
    let bestScore = scoreMasks(grid, masks, scoreParts)
    let bestWorstPct = scoreParts.worstPct
    evals++

    for (let round = 0; round < rounds && !stopped; round++) {
      for (const ci of freeCams) {
        if (stopped) break
        const others = masks.filter((_, i) => i !== ci)
        let bestMount = { ...working.cameras[ci].mount }
        let bestMask = masks[ci]
        for (const cand of candidates) {
          for (const dy of yawOffsets) {
            for (const dp of pitchOffsets) {
              if (opts.shouldStop?.()) {
                stopped = true
                break
              }
              const mount = {
                x: cand.x,
                y: cand.y,
                z: cand.z,
                rollDeg: 0,
                yawDeg: normDeg(cand.yawDeg + dy),
                pitchDeg: clamp(cand.pitchDeg + dp, -60, 60),
              }
              const key = `${opticsKey(working.cameras[ci])}@${mount.x},${mount.y},${mount.z},${mount.yawDeg},${mount.pitchDeg}`
              let candMask = maskCache.get(key)
              if (!candMask) {
                candMask = fastCameraMasks(grid, { ...working.cameras[ci], mount }, tagsPre, tagSize, rangeCapM)
                maskCache.set(key, candMask)
              }
              const s = scoreMasks(grid, [...others, candMask], scoreParts)
              evals++
              if (s > bestScore) {
                bestScore = s
                bestWorstPct = scoreParts.worstPct
                bestMount = mount
                bestMask = candMask
              }
            }
            if (stopped) break
          }
          opts.onProgress?.({ evals, totalEvals, bestScore: Math.max(bestScore, overallBest?.score ?? 0), bestWorstPct, cameraIndex: ci, round })
          if (stopped) break
        }
        working.cameras[ci].mount = bestMount
        masks[ci] = bestMask
      }
    }
    if (!overallBest || bestScore > overallBest.score) {
      overallBest = { cameras: structuredClone(working.cameras), score: bestScore, evals }
    }
  }
  return { ...(overallBest as OptimizeResult), evals }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const normDeg = (d: number): number => {
  let x = d % 360
  if (x > 180) x -= 360
  if (x < -180) x += 360
  return Number(x.toFixed(1))
}

/** Test-only access to internals for parity verification. */
export const __test = { buildPoseGrid, cameraMasks, fastCameraMasks, precomputeTags }
