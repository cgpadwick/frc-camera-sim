import type { CameraSpec, OccluderBox, RobotConfig, SimConfig, Vec3 } from '../core/types'

export const STORAGE_KEY = 'frc-camera-sim.config'
export const EXPORT_FILENAME = 'camera-sim-config.json'

/** Occluder JSON filename prefix for each supported field year. */
const OCCLUDER_PREFIX_BY_YEAR: Record<string, string> = {
  '2026-rebuilt-welded': '2026-rebuilt',
  '2025-reefscape-welded': '2025-reefscape',
}

/** `occluders/<prefix>.json` for a known field year; falls back to the year itself if unmapped. */
export function occluderUrlForYear(year: string): string {
  return `occluders/${OCCLUDER_PREFIX_BY_YEAR[year] ?? year}.json`
}

function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Config invalid: "${path}" must be a number`)
  return v
}

function positiveNum(v: unknown, path: string): number {
  const n = num(v, path)
  if (n <= 0) throw new Error(`Config invalid: "${path}" must be positive`)
  return n
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string') throw new Error(`Config invalid: "${path}" must be a string`)
  return v
}

function nullableNum(v: unknown, path: string): number | null {
  if (v === null || v === undefined) return null
  return num(v, path)
}

function parseVec3(v: unknown, path: string): Vec3 {
  const o = v as Record<string, unknown> | null | undefined
  if (!o || typeof o !== 'object') throw new Error(`Config invalid: "${path}" is missing`)
  return { x: num(o.x, `${path}.x`), y: num(o.y, `${path}.y`), z: num(o.z, `${path}.z`) }
}

function parseOccluderBox(v: unknown, path: string): OccluderBox {
  const o = v as Record<string, unknown> | null | undefined
  if (!o || typeof o !== 'object') throw new Error(`Config invalid: "${path}" is missing`)
  return {
    center: parseVec3(o.center, `${path}.center`),
    size: {
      x: positiveNum((o.size as Record<string, unknown> | undefined)?.x, `${path}.size.x`),
      y: positiveNum((o.size as Record<string, unknown> | undefined)?.y, `${path}.size.y`),
      z: positiveNum((o.size as Record<string, unknown> | undefined)?.z, `${path}.size.z`),
    },
    yawDeg: num(o.yawDeg, `${path}.yawDeg`),
  }
}

function parseMount(v: unknown, path: string): CameraSpec['mount'] {
  const o = v as Record<string, unknown> | null | undefined
  if (!o || typeof o !== 'object') throw new Error(`Config invalid: "${path}" is missing`)
  return {
    x: num(o.x, `${path}.x`),
    y: num(o.y, `${path}.y`),
    z: num(o.z, `${path}.z`),
    rollDeg: num(o.rollDeg, `${path}.rollDeg`),
    pitchDeg: num(o.pitchDeg, `${path}.pitchDeg`),
    yawDeg: num(o.yawDeg, `${path}.yawDeg`),
  }
}

// FOV/resolution/team-number policy: non-positive FOV and 0-camera setups
// are surfaced as inline UI warnings (configPanel.ts) rather than rejected
// here, so intentionally-degenerate-but-loadable configs still round-trip.
function parseCameraSpec(v: unknown, path: string): CameraSpec {
  const o = v as Record<string, unknown> | null | undefined
  if (!o || typeof o !== 'object') throw new Error(`Config invalid: "${path}" is missing`)
  return {
    name: str(o.name, `${path}.name`),
    hfovDeg: num(o.hfovDeg, `${path}.hfovDeg`),
    vfovDeg: num(o.vfovDeg, `${path}.vfovDeg`),
    resWidth: positiveNum(o.resWidth, `${path}.resWidth`),
    resHeight: positiveNum(o.resHeight, `${path}.resHeight`),
    maxRangeM: nullableNum(o.maxRangeM, `${path}.maxRangeM`),
    mount: parseMount(o.mount, `${path}.mount`),
  }
}

function parseRobotConfig(v: unknown, path: string): RobotConfig {
  const o = v as Record<string, unknown> | null | undefined
  if (!o || typeof o !== 'object') throw new Error(`Config invalid: missing "${path}"`)
  if (!Array.isArray(o.superstructure)) throw new Error(`Config invalid: "${path}.superstructure" must be an array`)
  if (!Array.isArray(o.cameras)) throw new Error(`Config invalid: "${path}.cameras" must be an array`)
  return {
    lengthM: positiveNum(o.lengthM, `${path}.lengthM`),
    widthM: positiveNum(o.widthM, `${path}.widthM`),
    chassisHeightM: positiveNum(o.chassisHeightM, `${path}.chassisHeightM`),
    teamNumber: str(o.teamNumber, `${path}.teamNumber`),
    superstructure: o.superstructure.map((b, i) => parseOccluderBox(b, `${path}.superstructure[${i}]`)),
    cameras: o.cameras.map((c, i) => parseCameraSpec(c, `${path}.cameras[${i}]`)),
  }
}

/** Validates an arbitrary JSON value into a SimConfig, throwing a human-readable Error on the first problem found. */
export function parseConfig(json: unknown): SimConfig {
  if (!json || typeof json !== 'object') throw new Error('Config invalid: expected a JSON object')
  const j = json as Record<string, unknown>
  return {
    fieldYear: str(j.fieldYear, 'fieldYear'),
    robot: parseRobotConfig(j.robot, 'robot'),
  }
}

function hasLocalStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

/** No-op outside a browser (SSR/tests) — guarded so importing this module in Node never throws. */
export function saveConfig(c: SimConfig): void {
  if (!hasLocalStorage()) return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(c))
}

/**
 * Discriminated result of loadConfig:
 *  - `{ config }` — a validated SimConfig was loaded.
 *  - `{ error }` — something WAS saved under STORAGE_KEY but failed to parse/validate
 *    (corrupt JSON or a shape parseConfig rejects). Callers should surface this to the
 *    user (e.g. a toast) since it means their saved config is being silently discarded.
 *  - `null` — nothing saved (first boot / no localStorage). Silent: not an error.
 *
 * This module stays node-testable (no DOM), so it deliberately returns a plain value
 * here instead of importing/calling a toast itself — main.ts owns surfacing `error`.
 */
export type LoadConfigResult = { config: SimConfig } | { error: string } | null

/** Never throws: malformed JSON or a config parseConfig rejects comes back as `{ error }`, not a thrown exception. */
export function loadConfig(): LoadConfigResult {
  if (!hasLocalStorage()) return null
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return { config: parseConfig(JSON.parse(raw)) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/** Triggers a browser download of `c` as pretty-printed JSON. Browser-only. */
export function exportConfig(c: SimConfig): void {
  const blob = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = EXPORT_FILENAME
  a.click()
  URL.revokeObjectURL(url)
}

/** Reads and validates a File (e.g. from an <input type="file">); rejects with parseConfig's readable Error on bad content. */
export async function importConfig(file: File): Promise<SimConfig> {
  const text = await file.text()
  return parseConfig(JSON.parse(text))
}
