import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { tagQuadQuaternion } from '../../src/viz/fieldView'
import { parseWpilibLayout } from '../../src/field/layoutLoader'
import type { Quat } from '../../src/core/types'

// PlaneGeometry's local face normal is +Z, and its local +Y is the texture
// "up" direction (where the tag ID digit reads upright). Ground truth from
// the plan's conventions: a tag quad's world normal must equal the tag
// frame's +X axis (WPILib: +X points out of the tag face), and the quad's
// texture-up direction must map to world +Z (so the ID text is upright,
// i.e. never printed sideways or upside-down).
function worldNormal(q: THREE.Quaternion): THREE.Vector3 {
  return new THREE.Vector3(0, 0, 1).applyQuaternion(q)
}
function worldUp(q: THREE.Quaternion): THREE.Vector3 {
  return new THREE.Vector3(0, 1, 0).applyQuaternion(q)
}

describe('tagQuadQuaternion', () => {
  it('identity tag rotation: normal -> tag +X, texture-up -> world +Z', () => {
    const identity: Quat = { w: 1, x: 0, y: 0, z: 0 }
    const q = tagQuadQuaternion(identity)

    const normal = worldNormal(q)
    expect(normal.x).toBeCloseTo(1, 6)
    expect(normal.y).toBeCloseTo(0, 6)
    expect(normal.z).toBeCloseTo(0, 6)

    const up = worldUp(q)
    expect(up.x).toBeCloseTo(0, 6)
    expect(up.y).toBeCloseTo(0, 6)
    expect(up.z).toBeCloseTo(1, 6)
  })

  it('real 2026 layout tag 1 (yaw-180): normal -> (-1,0,0), texture-up stays world +Z', () => {
    const real = JSON.parse(readFileSync('public/layouts/2026-rebuilt-welded.json', 'utf8'))
    const layout = parseWpilibLayout(real)
    const tag1 = layout.tags.find((t) => t.id === 1)!

    const q = tagQuadQuaternion(tag1.pose.rotation)

    const normal = worldNormal(q)
    expect(normal.x).toBeCloseTo(-1, 6)
    expect(normal.y).toBeCloseTo(0, 6)
    expect(normal.z).toBeCloseTo(0, 6)

    const up = worldUp(q)
    expect(up.x).toBeCloseTo(0, 6)
    expect(up.y).toBeCloseTo(0, 6)
    expect(up.z).toBeCloseTo(1, 6)
  })
})
