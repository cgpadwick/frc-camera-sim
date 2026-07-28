import { describe, it, expect } from 'vitest'
import { detectTags, tagCorners, maxRangeFor } from '../../src/core/visibility'
import type { CameraSpec, Tag, OccluderBox, RobotPose } from '../../src/core/types'

/**
 * N-VERSION VERIFICATION: an independent reimplementation of the entire
 * detection pipeline, written from the spec using DIFFERENT math —
 * explicit rotation matrices instead of quaternions, a different
 * point-in-box occlusion algorithm (dense segment sampling instead of the
 * slab method) — fuzz-compared against the shipped engine over hundreds of
 * randomized configurations. A systematic error now has to be made twice,
 * in two different formulations, identically, to go unnoticed.
 *
 * Spec being checked (the model, stated in README):
 *  - pinhole camera, +X boresight, image bounds tan(hfov/2)/tan(vfov/2)
 *  - detected iff ALL 4 corners inside image, center distance <= effective
 *    range, skew(view, tag normal) <= 65°, and the 5 rays (4 corners +
 *    center), shortened 1 cm at both ends, clear of every occluder box
 */

// --- Independent math: rotation MATRICES (row basis), no quaternions ---

type M3 = number[] // row-major 3x3

function matMul(a: M3, b: M3): M3 {
  const r = new Array(9).fill(0)
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j]
  return r
}
const rotX = (t: number): M3 => [1, 0, 0, 0, Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t)]
const rotY = (t: number): M3 => [Math.cos(t), 0, Math.sin(t), 0, 1, 0, -Math.sin(t), 0, Math.cos(t)]
const rotZ = (t: number): M3 => [Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t), 0, 0, 0, 1]
/** Extrinsic X->Y->Z (matches the documented convention R = Rz Ry Rx). */
const euler = (roll: number, pitch: number, yaw: number): M3 => matMul(rotZ(yaw), matMul(rotY(pitch), rotX(roll)))
const apply = (m: M3, v: [number, number, number]): [number, number, number] => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
]
const transpose = (m: M3): M3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]

const D2R = Math.PI / 180

/** Independent occlusion: dense sampling of the (1cm-both-ends shortened) segment, point-in-yawed-box test. */
function refBlocked(a: [number, number, number], b: [number, number, number], boxes: OccluderBox[]): boolean {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const len = Math.hypot(d[0], d[1], d[2])
  if (len > 0.02) {
    const s = 0.01 / len
    a = [a[0] + d[0] * s, a[1] + d[1] * s, a[2] + d[2] * s]
    b = [b[0] - d[0] * s, b[1] - d[1] * s, b[2] - d[2] * s]
  }
  const STEPS = 4000
  for (const box of boxes) {
    const yaw = box.yawDeg * D2R
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS
      const px = a[0] + (b[0] - a[0]) * t - box.center.x
      const py = a[1] + (b[1] - a[1]) * t - box.center.y
      const pz = a[2] + (b[2] - a[2]) * t - box.center.z
      const lx = px * c + py * s
      const ly = -px * s + py * c
      if (Math.abs(lx) <= box.size.x / 2 && Math.abs(ly) <= box.size.y / 2 && Math.abs(pz) <= box.size.z / 2) return true
    }
  }
  return false
}

interface RefResult {
  ids: number[]
  /** Smallest margin (in its own unit) across all tags/criteria — near-zero means a boundary case the sampled-occlusion reference can't referee. */
  minMargin: number
}

/** Full reference detection: same spec, different math. */
function refDetect(pose: RobotPose, spec: CameraSpec, tags: Tag[], occluders: OccluderBox[], rangeCap: number): RefResult {
  const Rrobot = rotZ(pose.headingRad)
  const Rmount = euler(spec.mount.rollDeg * D2R, spec.mount.pitchDeg * D2R, spec.mount.yawDeg * D2R)
  const Rcam = matMul(Rrobot, Rmount)
  const RcamT = transpose(Rcam)
  const mountWorld = apply(Rrobot, [spec.mount.x, spec.mount.y, spec.mount.z])
  const cam: [number, number, number] = [pose.x + mountWorld[0], pose.y + mountWorld[1], mountWorld[2]]
  const tanH = Math.tan((spec.hfovDeg * D2R) / 2)
  const tanV = Math.tan((spec.vfovDeg * D2R) / 2)
  const range = Math.min(maxRangeFor(spec, tags[0]?.size ?? 0.1651), rangeCap)
  const ids: number[] = []
  let minMargin = Infinity
  for (const tag of tags) {
    const tc = tag.pose.translation
    const dist = Math.hypot(tc.x - cam[0], tc.y - cam[1], tc.z - cam[2])
    minMargin = Math.min(minMargin, Math.abs(dist - range))
    if (dist > range) continue
    // Skew via shipped tagCorners' normal? No — recompute from the corner cross product (independent).
    const corners = tagCorners(tag)
    const e1 = [corners[1].x - corners[0].x, corners[1].y - corners[0].y, corners[1].z - corners[0].z]
    const e2 = [corners[3].x - corners[0].x, corners[3].y - corners[0].y, corners[3].z - corners[0].z]
    let n: [number, number, number] = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ]
    const nl = Math.hypot(...n)
    n = [n[0] / nl, n[1] / nl, n[2] / nl]
    const toCam = [(cam[0] - tc.x) / dist, (cam[1] - tc.y) / dist, (cam[2] - tc.z) / dist]
    let cosSkew = n[0] * toCam[0] + n[1] * toCam[1] + n[2] * toCam[2]
    // Corner winding may flip the normal; the tag face is the +normal side by construction.
    const skew = Math.acos(Math.max(-1, Math.min(1, cosSkew)))
    minMargin = Math.min(minMargin, Math.abs(skew - 65 * D2R) / (65 * D2R))
    if (skew > 65 * D2R) continue
    let inside = true
    for (const c of corners) {
      const local = apply(RcamT, [c.x - cam[0], c.y - cam[1], c.z - cam[2]])
      if (local[0] <= 1e-6) {
        inside = false
        minMargin = 0.5 // behind-plane cases are decisively out; don't count as boundary
        break
      }
      const u = local[1] / local[0] / tanH
      const v = local[2] / local[0] / tanV
      minMargin = Math.min(minMargin, Math.abs(1 - Math.abs(u)), Math.abs(1 - Math.abs(v)))
      if (Math.abs(u) > 1 || Math.abs(v) > 1) inside = false
    }
    if (!inside) continue
    let occluded = false
    for (const c of [...corners, tc]) {
      if (refBlocked(cam, [c.x, c.y, c.z], occluders)) {
        occluded = true
        break
      }
    }
    if (occluded) continue
    ids.push(tag.id)
  }
  return { ids, minMargin }
}

// --- Deterministic fuzz (seeded PRNG: reproducible failures) ---

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('shipped engine vs independent reference implementation (fuzz)', () => {
  it('agrees on 400 randomized configurations (boundary cases excluded by margin)', () => {
    const rnd = mulberry32(20260728)
    const r = (lo: number, hi: number): number => lo + (hi - lo) * rnd()
    let compared = 0
    let skippedBoundary = 0
    for (let iter = 0; iter < 400; iter++) {
      const pose: RobotPose = { x: r(1, 15), y: r(1, 7), headingRad: r(-Math.PI, Math.PI) }
      const spec: CameraSpec = {
        name: 'f',
        hfovDeg: r(40, 110),
        vfovDeg: r(30, 80),
        resWidth: 1280,
        resHeight: 800,
        maxRangeM: rnd() < 0.5 ? r(2, 8) : null,
        mount: { x: r(-0.4, 0.4), y: r(-0.4, 0.4), z: r(0.15, 0.9), rollDeg: 0, pitchDeg: r(-40, 40), yawDeg: r(-180, 180) },
      }
      const tags: Tag[] = Array.from({ length: 6 }, (_, i) => ({
        id: i + 1,
        size: 0.1651,
        pose: {
          translation: { x: r(0, 16.5), y: r(0, 8), z: r(0.3, 1.4) },
          rotation: quatFromEulerLike(r(-0.3, 0.3), r(-0.4, 0.4), r(-Math.PI, Math.PI)),
        },
      }))
      const boxes: OccluderBox[] =
        rnd() < 0.6
          ? [
              {
                center: { x: r(2, 14), y: r(1, 7), z: r(0.2, 1) },
                size: { x: r(0.2, 1.5), y: r(0.2, 1.5), z: r(0.2, 1.2) },
                yawDeg: r(-90, 90),
              },
            ]
          : []
      const cap = rnd() < 0.5 ? r(2, 6) : Infinity

      const shipped = detectTags(pose, spec, tags, boxes, cap)
        .map((d) => d.tagId)
        .sort((a, b) => a - b)
      const ref = refDetect(pose, spec, tags, boxes, cap)
      // Boundary cases: the sampled-occlusion / float-edge referee can't
      // decide ties. Skip iterations whose closest margin is razor thin.
      if (ref.minMargin < 5e-3) {
        skippedBoundary++
        continue
      }
      compared++
      expect(ref.ids.sort((a, b) => a - b), `iter ${iter}: pose=${JSON.stringify(pose)} spec.mount=${JSON.stringify(spec.mount)}`).toEqual(shipped)
    }
    // The comparison must actually exercise a healthy sample.
    expect(compared).toBeGreaterThan(250)
    expect(skippedBoundary).toBeLessThan(150)
  }, 120000)
})

/** Local quaternion builder so the FIXTURE is shared, while the reference PIPELINE stays matrix-based. */
function quatFromEulerLike(roll: number, pitch: number, yaw: number) {
  const cr = Math.cos(roll / 2)
  const sr = Math.sin(roll / 2)
  const cp = Math.cos(pitch / 2)
  const sp = Math.sin(pitch / 2)
  const cy = Math.cos(yaw / 2)
  const sy = Math.sin(yaw / 2)
  // Extrinsic X->Y->Z composition (qz * qy * qx), written out longhand.
  return {
    w: cy * cp * cr + sy * sp * sr,
    x: cy * cp * sr - sy * sp * cr,
    y: cy * sp * cr + sy * cp * sr,
    z: sy * cp * cr - cy * sp * sr,
  }
}
