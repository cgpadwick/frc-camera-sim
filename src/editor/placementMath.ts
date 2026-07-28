import type { Vec3 } from '../core/types'

/**
 * Yaw/pitch (deg, roll = 0) aiming a camera's +X boresight along `n`
 * (unit surface normal, robot frame). With the mount convention
 * `quatFromEuler(roll, pitch, yaw)` (extrinsic X→Y→Z), the boresight is
 * (cos yaw · cos pitch, sin yaw · cos pitch, −sin pitch), so:
 * pitch = −asin(n.z), yaw = atan2(n.y, n.x). Straight up/down leaves yaw
 * unconstrained — it stays 0 there.
 */
export function normalToYawPitch(n: Vec3): { yawDeg: number; pitchDeg: number } {
  const z = Math.min(1, Math.max(-1, n.z))
  const pitchDeg = (-Math.asin(z) * 180) / Math.PI
  const horizontal = Math.hypot(n.x, n.y)
  const yawDeg = horizontal < 1e-9 ? 0 : (Math.atan2(n.y, n.x) * 180) / Math.PI
  return { yawDeg, pitchDeg }
}
