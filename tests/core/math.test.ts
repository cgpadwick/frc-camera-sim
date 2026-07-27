import { describe, it, expect } from 'vitest'
import { vec3, quatFromEuler, rotateVec, poseToField, fieldToFrame, rad, scale, dot, cross, length, normalize, deg } from '../../src/core/math'

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

describe('vector algebra', () => {
  it('scale: multiply by positive scalar', () => close(scale(vec3(2, 3, 4), 2), vec3(4, 6, 8)))
  it('scale: multiply by zero', () => close(scale(vec3(1, 2, 3), 0), vec3(0, 0, 0)))
  it('scale: multiply by negative scalar', () => close(scale(vec3(1, -2, 3), -1), vec3(-1, 2, -3)))

  it('dot: orthogonal vectors', () => expect(dot(vec3(1, 0, 0), vec3(0, 1, 0))).toBeCloseTo(0, 6))
  it('dot: parallel vectors', () => expect(dot(vec3(2, 0, 0), vec3(3, 0, 0))).toBeCloseTo(6, 6))
  it('dot: unit vectors sum', () => expect(dot(vec3(1, 1, 1), vec3(1, 1, 1))).toBeCloseTo(3, 6))

  it('cross: unit X × unit Y = unit Z', () => close(cross(vec3(1, 0, 0), vec3(0, 1, 0)), vec3(0, 0, 1)))
  it('cross: unit Y × unit Z = unit X', () => close(cross(vec3(0, 1, 0), vec3(0, 0, 1)), vec3(1, 0, 0)))
  it('cross: unit Z × unit X = unit Y', () => close(cross(vec3(0, 0, 1), vec3(1, 0, 0)), vec3(0, 1, 0)))
  it('cross: non-axis vectors', () => close(cross(vec3(1, 2, 3), vec3(4, 5, 6)), vec3(-3, 6, -3)))
  it('cross: parallel vectors = zero', () => close(cross(vec3(2, 4, 6), vec3(1, 2, 3)), vec3(0, 0, 0)))

  it('length: unit vectors', () => expect(length(vec3(1, 0, 0))).toBeCloseTo(1, 6))
  it('length: 3-4-5 triangle', () => expect(length(vec3(3, 4, 0))).toBeCloseTo(5, 6))
  it('length: zero vector', () => expect(length(vec3(0, 0, 0))).toBeCloseTo(0, 6))
  it('length: scaled unit vector', () => expect(length(vec3(2, 0, 0))).toBeCloseTo(2, 6))

  it('normalize: unit vector unchanged', () => close(normalize(vec3(1, 0, 0)), vec3(1, 0, 0)))
  it('normalize: scaled vector to unit length', () => close(normalize(vec3(3, 4, 0)), vec3(0.6, 0.8, 0)))
  it('normalize: zero vector returns zero (documented fallback)', () => close(normalize(vec3(0, 0, 0)), vec3(0, 0, 0)))
  it('normalize: arbitrary vector', () => close(normalize(vec3(1, 2, 2)), vec3(1/3, 2/3, 2/3)))
})

describe('angle conversion', () => {
  it('deg: π radians = 180°', () => expect(deg(Math.PI)).toBeCloseTo(180, 6))
  it('deg: π/2 radians = 90°', () => expect(deg(Math.PI / 2)).toBeCloseTo(90, 6))
  it('deg: 2π radians = 360°', () => expect(deg(2 * Math.PI)).toBeCloseTo(360, 6))
  it('deg: zero radians = 0°', () => expect(deg(0)).toBeCloseTo(0, 6))
  it('deg: negative angle', () => expect(deg(-Math.PI)).toBeCloseTo(-180, 6))
})
