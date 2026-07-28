import type { CameraSpec } from '../core/types'

/**
 * 8-way compass word for a robot-frame yaw (deg): 0 = front, +90 = left
 * (WPILib +Y), ±180 = back, −90 = right. Boundaries at 22.5° steps.
 */
export function facingWord(yawDeg: number): string {
  let y = yawDeg % 360
  if (y > 180) y -= 360
  if (y < -180) y += 360
  const names = ['front', 'front-left', 'left', 'back-left', 'back', 'back-right', 'right', 'front-right']
  const idx = Math.round(y / 45)
  return names[(idx + 8) % 8]
}

/** One-line plain-English camera description derived from its numbers. */
export function cameraSummary(cam: CameraSpec): string {
  const parts = [`${Math.round(cam.hfovDeg)}° lens`, `faces ${facingWord(cam.mount.yawDeg)}`]
  const pitch = Math.round(Math.abs(cam.mount.pitchDeg))
  if (pitch >= 1) parts.push(cam.mount.pitchDeg < 0 ? `tilted up ${pitch}°` : `tilted down ${pitch}°`)
  else parts.push('level')
  parts.push(`mounted ${cam.mount.z.toFixed(2)} m up`)
  return parts.join(' · ')
}
