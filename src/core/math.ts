import type { Vec3, Quat, Pose3 } from './types'

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })
export const add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z)
export const sub = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z)
export const scale = (a: Vec3, s: number): Vec3 => vec3(a.x * s, a.y * s, a.z * s)
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)
export const normalize = (a: Vec3): Vec3 => scale(a, 1 / (length(a) || 1))
export const rad = (d: number): number => (d * Math.PI) / 180
export const deg = (r: number): number => (r * 180) / Math.PI

export function quatMul(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  }
}
export const quatConj = (q: Quat): Quat => ({ w: q.w, x: -q.x, y: -q.y, z: -q.z })

const axisAngle = (x: number, y: number, z: number, angle: number): Quat => {
  const s = Math.sin(angle / 2)
  return { w: Math.cos(angle / 2), x: x * s, y: y * s, z: z * s }
}

/** Extrinsic X (roll) -> Y (pitch) -> Z (yaw), WPILib Rotation3d convention. */
export function quatFromEuler(rollRad: number, pitchRad: number, yawRad: number): Quat {
  return quatMul(axisAngle(0, 0, 1, yawRad), quatMul(axisAngle(0, 1, 0, pitchRad), axisAngle(1, 0, 0, rollRad)))
}

export function rotateVec(q: Quat, v: Vec3): Vec3 {
  const p = quatMul(quatMul(q, { w: 0, ...v }), quatConj(q))
  return vec3(p.x, p.y, p.z)
}

export const poseToField = (pose: Pose3, local: Vec3): Vec3 => add(pose.translation, rotateVec(pose.rotation, local))
export const fieldToFrame = (pose: Pose3, world: Vec3): Vec3 => rotateVec(quatConj(pose.rotation), sub(world, pose.translation))
