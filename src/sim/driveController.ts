import type { RobotPose } from '../core/types'

const SPEED = 3 // m/s
const TURN = 2.5 // rad/s
const FIELD_MARGIN = 0.4 // m, keeps the robot footprint off the walls

export interface DriveController {
  pose: RobotPose
  update(dt: number): void
  /**
   * Updates the field bounds used to clamp `pose` (e.g. after switching field
   * years) and immediately re-clamps the current pose into the new bounds,
   * so a smaller field never leaves the robot rendered outside its walls.
   */
  setFieldBounds(fieldLength: number, fieldWidth: number): void
  dispose(): void
}

/**
 * Pure integration step: field-relative WASD translate + Q/E rotate, with
 * x/y clamped to the field bounds (minus FIELD_MARGIN on each side). Mutates
 * `pose` in place. No DOM dependency, so it is directly unit-testable in
 * Node — `createDriveController.update` below is a thin DOM-event wrapper
 * around this function.
 */
export function integratePose(
  pose: RobotPose,
  keys: Set<string>,
  dt: number,
  fieldLength: number,
  fieldWidth: number,
): void {
  const vx = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0)
  const vy = (keys.has('a') ? 1 : 0) - (keys.has('d') ? 1 : 0)
  const om = (keys.has('q') ? 1 : 0) - (keys.has('e') ? 1 : 0)
  pose.x = Math.min(fieldLength - FIELD_MARGIN, Math.max(FIELD_MARGIN, pose.x + vx * SPEED * dt))
  pose.y = Math.min(fieldWidth - FIELD_MARGIN, Math.max(FIELD_MARGIN, pose.y + vy * SPEED * dt))
  pose.headingRad += om * TURN * dt
}

/** True in a browser; false in Node (tests) — guards all `window` access so this module is constructible headlessly. */
const hasWindow = typeof window !== 'undefined'

export function createDriveController(fieldLength: number, fieldWidth: number): DriveController {
  const keys = new Set<string>()
  const down = (e: KeyboardEvent) => {
    if (!e.repeat && e.target === document.body) keys.add(e.key.toLowerCase())
  }
  const up = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase())
  if (hasWindow) {
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
  }
  // Mutable (not the captured params) so setFieldBounds can update them in place.
  let length = fieldLength
  let width = fieldWidth
  const pose: RobotPose = { x: fieldLength / 2, y: fieldWidth / 2, headingRad: 0 }
  return {
    pose,
    update(dt) {
      integratePose(pose, keys, dt, length, width)
    },
    setFieldBounds(newLength, newWidth) {
      length = newLength
      width = newWidth
      // dt=0, no keys: reuses integratePose purely for its clamp, with zero motion.
      integratePose(pose, keys, 0, length, width)
    },
    dispose() {
      if (hasWindow) {
        window.removeEventListener('keydown', down)
        window.removeEventListener('keyup', up)
      }
    },
  }
}
