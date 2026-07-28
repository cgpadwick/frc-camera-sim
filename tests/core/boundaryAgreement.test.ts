import { describe, it, expect } from 'vitest'
import { detectTags } from '../../src/core/visibility'
import { sphericalCapPoint } from '../../src/viz/frustumView'
import { vec3, quatFromEuler, rad, normalize, scale, add } from '../../src/core/math'
import type { CameraSpec, Tag } from '../../src/core/types'

/**
 * THE guarantee both round-8 bugs violated: the DRAWN cone boundary must be
 * the DETECTION boundary. For a dense sample of view directions inside the
 * FOV, a tag placed just inside the drawn far surface must be detected and
 * one just outside must not. This is checked against the real detectTags —
 * if the rendered geometry and the detection math ever disagree again, this
 * suite goes red.
 */

const RANGE = 4
const EPS = 0.03 // 3 cm straddle around the boundary

const spec = (hfovDeg: number, vfovDeg: number): CameraSpec => ({
  name: 'b',
  hfovDeg,
  vfovDeg,
  resWidth: 4000, // high res so the derived optical range never binds — the cap under test is trustedRange
  resHeight: 3000,
  maxRangeM: null,
  mount: { x: 0, y: 0, z: 1, rollDeg: 0, pitchDeg: 0, yawDeg: 0 },
})

/** A tag centered at `p`, facing back along the view direction (skew 0). */
function facingTag(p: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }): Tag {
  // Tag normal must point from tag back toward the camera: -dir.
  const yaw = Math.atan2(-dir.y, -dir.x)
  const pitch = Math.asin(dir.z) // tilt the face to cancel vertical view angle
  return {
    id: 1,
    size: 0.1651,
    pose: { translation: vec3(p.x, p.y, p.z), rotation: quatFromEuler(0, pitch, yaw) },
  }
}

describe('drawn boundary == detection boundary (round-8 regression class)', () => {
  for (const [h, v] of [
    [75, 47],
    [100, 70],
    [55, 40],
  ] as const) {
    it(`${h}°/${v}° FOV: tags straddling the drawn far cap flip detection exactly there`, () => {
      const cam = spec(h, v)
      const pose = { x: 6, y: 4, headingRad: 0.3 } // arbitrary non-axis-aligned pose
      // Interior directions only: |u|,|v| <= 0.7 keeps the whole tag body
      // clear of the lateral FOV edges, isolating the RANGE boundary.
      for (const u of [-0.7, -0.35, 0, 0.35, 0.7]) {
        for (const vv of [-0.7, 0, 0.7]) {
          // Drawn far-surface point in CAMERA frame, from the same function the renderer uses.
          const capLocal = sphericalCapPoint(u, vv, h, v, RANGE)
          const dirLocal = normalize(capLocal)
          // Transform to field frame: camera at mount (0,0,1) on robot at pose.
          const q = quatFromEuler(0, 0, pose.headingRad)
          const rot = (p: { x: number; y: number; z: number }) => {
            const c = Math.cos(pose.headingRad)
            const s = Math.sin(pose.headingRad)
            return { x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z }
          }
          void q
          const camWorld = { x: pose.x, y: pose.y, z: 1 }
          const dirWorld = rot(dirLocal)

          const inside = add(vec3(camWorld.x, camWorld.y, camWorld.z), scale(vec3(dirWorld.x, dirWorld.y, dirWorld.z), RANGE - EPS))
          const outside = add(vec3(camWorld.x, camWorld.y, camWorld.z), scale(vec3(dirWorld.x, dirWorld.y, dirWorld.z), RANGE + EPS))

          const detIn = detectTags(pose, cam, [facingTag(inside, dirWorld)], [], RANGE)
          const detOut = detectTags(pose, cam, [facingTag(outside, dirWorld)], [], RANGE)
          expect(detIn, `inside cap at u=${u} v=${vv} must be DETECTED`).toHaveLength(1)
          expect(detOut, `outside cap at u=${u} v=${vv} must NOT be detected`).toHaveLength(0)
        }
      }
    })
  }

  it('the lateral FOV edge is stricter than the drawn edge by design (full-tag rule) — documented, not hidden', () => {
    // A tag whose CENTER is just inside the drawn side plane still fails
    // detection because its corners poke out. This is the one intentional
    // divergence between cone and detection; it errs conservative (cone
    // never shows LESS than reality) and is bounded by the tag's angular
    // half-width. Pinned here so it stays a known property, not a surprise.
    const cam = spec(75, 47)
    const pose = { x: 6, y: 4, headingRad: 0 }
    const capLocal = sphericalCapPoint(0.995, 0, 75, 47, 2)
    const dir = normalize(capLocal)
    const p = add(vec3(6, 4, 1), scale(dir, 2))
    const det = detectTags(pose, cam, [facingTag(p, dir)], [], RANGE)
    expect(det).toHaveLength(0) // center inside cone, corners outside image -> correctly undetected
  })
})
