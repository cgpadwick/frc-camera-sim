import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { fieldModelCorrection, tryLoadFieldModel, wrapFieldModel } from '../../src/field/fieldModelLoader'

// AdvantageScope's own per-field config.json for the bundled 2026 model
// states `"coordinateSystem": "wall-blue"` (field-centered) with
// `"rotations": [{ "axis": "x", "degrees": 90 }]` — confirming the
// rotation this helper applies matches the asset's documented convention,
// not just a visual guess.
describe('fieldModelCorrection', () => {
  const L = 16.541
  const W = 8.069
  const correction = fieldModelCorrection(L, W)

  function apply(v: THREE.Vector3, asDirection: boolean): THREE.Vector3 {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), correction.rotationX)
    const rotated = v.clone().applyQuaternion(q)
    if (asDirection) return rotated
    return rotated.add(new THREE.Vector3(correction.position.x, correction.position.y, correction.position.z))
  }

  it('rotationX is +90 degrees, matching AdvantageScope config.json', () => {
    expect(correction.rotationX).toBeCloseTo(Math.PI / 2, 10)
  })

  it('maps model-space field center (0,0,0) to world field center (L/2, W/2, 0)', () => {
    const world = apply(new THREE.Vector3(0, 0, 0), false)
    expect(world.x).toBeCloseTo(L / 2, 6)
    expect(world.y).toBeCloseTo(W / 2, 6)
    expect(world.z).toBeCloseTo(0, 6)
  })

  it('maps model-space up-axis direction (0,1,0) to world +Z', () => {
    const worldDir = apply(new THREE.Vector3(0, 1, 0), true)
    expect(worldDir.x).toBeCloseTo(0, 6)
    expect(worldDir.y).toBeCloseTo(0, 6)
    expect(worldDir.z).toBeCloseTo(1, 6)
  })
})

describe('wrapFieldModel', () => {
  it('wraps the model in a parent group carrying the correction transform', () => {
    const model = new THREE.Group()
    model.name = 'gltf-scene'
    const L = 16.541
    const W = 8.069
    const wrapper = wrapFieldModel(model, L, W)
    expect(wrapper.name).toBe('field-model')
    expect(wrapper.children).toContain(model)
    expect(wrapper.rotation.x).toBeCloseTo(Math.PI / 2, 10)
    expect(wrapper.position.x).toBeCloseTo(L / 2, 6)
    expect(wrapper.position.y).toBeCloseTo(W / 2, 6)
    expect(wrapper.position.z).toBeCloseTo(0, 6)
  })
})

describe('tryLoadFieldModel', () => {
  it('resolves null (never throws/rejects) for a URL that 404s', async () => {
    await expect(tryLoadFieldModel('models/does-not-exist.glb')).resolves.toBeNull()
  })

  it('resolves null (never throws/rejects) for a malformed URL', async () => {
    await expect(tryLoadFieldModel('not a url at all')).resolves.toBeNull()
  })
})
