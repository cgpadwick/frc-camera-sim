import { describe, it, expect } from 'vitest'
import { vec3, quatFromEuler, rotateVec, poseToField, fieldToFrame, rad } from '../../src/core/math'

const close = (a: any, b: any) => {
  expect(a.x).toBeCloseTo(b.x, 6); expect(a.y).toBeCloseTo(b.y, 6); expect(a.z).toBeCloseTo(b.z, 6)
}

describe('quatFromEuler + rotateVec', () => {
  it('yaw 90° sends +X to +Y', () => {
    close(rotateVec(quatFromEuler(0, 0, rad(90)), vec3(1, 0, 0)), vec3(0, 1, 0))
  })
  it('pitch 90° sends +X to -Z (nose down rotates forward vector downward? no: pitch +90 about Y sends +X to -Z)', () => {
    close(rotateVec(quatFromEuler(0, rad(90), 0), vec3(1, 0, 0)), vec3(0, 0, -1))
  })
  it('roll 90° sends +Y to +Z', () => {
    close(rotateVec(quatFromEuler(rad(90), 0, 0), vec3(0, 1, 0)), vec3(0, 0, 1))
  })
  it('extrinsic order: roll then yaw', () => {
    // roll 90 sends +Y->+Z, then yaw 90 leaves +Z alone
    close(rotateVec(quatFromEuler(rad(90), 0, rad(90)), vec3(0, 1, 0)), vec3(0, 0, 1))
  })
})

describe('frame transforms', () => {
  const pose = { translation: vec3(2, 3, 0), rotation: quatFromEuler(0, 0, rad(90)) }
  it('poseToField', () => close(poseToField(pose, vec3(1, 0, 0)), vec3(2, 4, 0)))
  it('fieldToFrame inverts poseToField', () => close(fieldToFrame(pose, vec3(2, 4, 0)), vec3(1, 0, 0)))
})
