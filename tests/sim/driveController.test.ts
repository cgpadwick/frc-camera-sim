import { describe, it, expect } from 'vitest'
import { integratePose, createDriveController } from '../../src/sim/driveController'
import type { RobotPose } from '../../src/core/types'

const FIELD_L = 16.54
const FIELD_W = 8.02

function pose(x: number, y: number, headingRad = 0): RobotPose {
  return { x, y, headingRad }
}

describe('integratePose', () => {
  it('W moves +X by speed*dt', () => {
    const p = pose(5, 5)
    integratePose(p, new Set(['w']), 0.5, FIELD_L, FIELD_W)
    expect(p.x).toBeCloseTo(5 + 3 * 0.5, 6)
    expect(p.y).toBeCloseTo(5, 6)
  })

  it('A moves +Y by speed*dt', () => {
    const p = pose(5, 5)
    integratePose(p, new Set(['a']), 0.5, FIELD_L, FIELD_W)
    expect(p.y).toBeCloseTo(5 + 3 * 0.5, 6)
    expect(p.x).toBeCloseTo(5, 6)
  })

  it('S moves -X, D moves -Y', () => {
    const p = pose(5, 5)
    integratePose(p, new Set(['s', 'd']), 0.5, FIELD_L, FIELD_W)
    expect(p.x).toBeCloseTo(5 - 1.5, 6)
    expect(p.y).toBeCloseTo(5 - 1.5, 6)
  })

  it('Q increases heading (CCW)', () => {
    const p = pose(5, 5)
    integratePose(p, new Set(['q']), 1, FIELD_L, FIELD_W)
    expect(p.headingRad).toBeCloseTo(2.5, 6)
  })

  it('E decreases heading (CW)', () => {
    const p = pose(5, 5)
    integratePose(p, new Set(['e']), 1, FIELD_L, FIELD_W)
    expect(p.headingRad).toBeCloseTo(-2.5, 6)
  })

  it('clamps to the low bound with a 0.4 m margin', () => {
    const p = pose(0.5, 0.5)
    integratePose(p, new Set(['s', 'd']), 10, FIELD_L, FIELD_W)
    expect(p.x).toBeCloseTo(0.4, 6)
    expect(p.y).toBeCloseTo(0.4, 6)
  })

  it('clamps to the high bound with a 0.4 m margin', () => {
    const p = pose(FIELD_L - 0.5, FIELD_W - 0.5)
    integratePose(p, new Set(['w', 'a']), 10, FIELD_L, FIELD_W)
    expect(p.x).toBeCloseTo(FIELD_L - 0.4, 6)
    expect(p.y).toBeCloseTo(FIELD_W - 0.4, 6)
  })

  it('combined diagonal: W+A moves +X and +Y simultaneously', () => {
    const p = pose(5, 5)
    integratePose(p, new Set(['w', 'a']), 0.5, FIELD_L, FIELD_W)
    expect(p.x).toBeCloseTo(5 + 1.5, 6)
    expect(p.y).toBeCloseTo(5 + 1.5, 6)
  })

  it('opposing keys cancel out (w+s, a+d)', () => {
    const p = pose(5, 5)
    integratePose(p, new Set(['w', 's', 'a', 'd']), 1, FIELD_L, FIELD_W)
    expect(p.x).toBeCloseTo(5, 6)
    expect(p.y).toBeCloseTo(5, 6)
  })

  it('no keys pressed: no motion', () => {
    const p = pose(5, 5, 1.2)
    integratePose(p, new Set(), 1, FIELD_L, FIELD_W)
    expect(p.x).toBeCloseTo(5, 6)
    expect(p.y).toBeCloseTo(5, 6)
    expect(p.headingRad).toBeCloseTo(1.2, 6)
  })
})

describe('createDriveController', () => {
  it('constructs and disposes without throwing outside a browser (no window/document in the node test env)', () => {
    expect(() => {
      const controller = createDriveController(16.5, 8)
      controller.dispose()
    }).not.toThrow()
  })

  it('setFieldBounds immediately clamps the current pose into the new (smaller) bounds', () => {
    const controller = createDriveController(20, 10)
    controller.pose.x = 19
    controller.pose.y = 9
    controller.setFieldBounds(10, 5)
    expect(controller.pose.x).toBeCloseTo(10 - 0.4, 6)
    expect(controller.pose.y).toBeCloseTo(5 - 0.4, 6)
    controller.dispose()
  })

  it('setFieldBounds widening the field does not needlessly move an in-bounds pose', () => {
    const controller = createDriveController(10, 5)
    expect(controller.pose.x).toBeCloseTo(5, 6)
    expect(controller.pose.y).toBeCloseTo(2.5, 6)
    controller.setFieldBounds(20, 10)
    expect(controller.pose.x).toBeCloseTo(5, 6)
    expect(controller.pose.y).toBeCloseTo(2.5, 6)
    controller.dispose()
  })

  it('update() after setFieldBounds clamps against the new bounds, not the stale ones it was constructed with', () => {
    const controller = createDriveController(20, 10)
    controller.setFieldBounds(10, 5)
    // Reposition (simulating a frame where the pose drifted) back out past the *new*
    // bounds but still within the *old* ones — only correct if update() reads the
    // post-setFieldBounds length/width, not values captured at construction time.
    controller.pose.x = 15
    controller.pose.y = 8
    controller.update(0)
    expect(controller.pose.x).toBeCloseTo(10 - 0.4, 6)
    expect(controller.pose.y).toBeCloseTo(5 - 0.4, 6)
    controller.dispose()
  })
})
