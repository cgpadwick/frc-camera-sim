import type { CameraSpec } from '../core/types'

export interface CameraPreset {
  label: string
  hfovDeg: number
  vfovDeg: number
  resWidth: number
  resHeight: number
}

const CUSTOM_LABEL = 'Custom'

/**
 * Fixed catalog of real sensor/lens combos, plus a `Custom` sentinel whose
 * numeric fields are never read (see `applyPreset`) — they exist only to
 * satisfy the shared `CameraPreset` shape so the panel can render one
 * uniform <select> of labels.
 */
export const CAMERA_PRESETS: CameraPreset[] = [
  { label: 'OV9281 + 75° lens', hfovDeg: 75, vfovDeg: 47, resWidth: 1280, resHeight: 800 },
  { label: 'OV9281 + 100° lens', hfovDeg: 100, vfovDeg: 70, resWidth: 1280, resHeight: 800 },
  { label: 'Limelight 3', hfovDeg: 63.3, vfovDeg: 49.7, resWidth: 1280, resHeight: 960 },
  { label: 'Limelight 3G', hfovDeg: 80, vfovDeg: 52, resWidth: 1280, resHeight: 800 },
  { label: 'Limelight 4', hfovDeg: 82, vfovDeg: 56, resWidth: 1280, resHeight: 800 },
  { label: CUSTOM_LABEL, hfovDeg: 0, vfovDeg: 0, resWidth: 0, resHeight: 0 },
]

/**
 * Pure: returns a new CameraSpec with hfovDeg/vfovDeg/resWidth/resHeight
 * overwritten from `preset` (all other fields, incl. name/mount/maxRangeM,
 * copied through unchanged). The `Custom` preset is a no-op passthrough.
 */
export function applyPreset(spec: CameraSpec, preset: CameraPreset): CameraSpec {
  if (preset.label === CUSTOM_LABEL) return spec
  return {
    ...spec,
    hfovDeg: preset.hfovDeg,
    vfovDeg: preset.vfovDeg,
    resWidth: preset.resWidth,
    resHeight: preset.resHeight,
  }
}

/**
 * Pure: the preset label matching this spec's optics exactly, or 'Custom'.
 * Lets the dropdown REFLECT the camera instead of hard-resetting to Custom
 * on every render (which made a successful preset apply look like a no-op).
 */
export function presetLabelFor(spec: CameraSpec): string {
  const hit = CAMERA_PRESETS.find(
    (p) =>
      p.label !== CUSTOM_LABEL &&
      p.hfovDeg === spec.hfovDeg &&
      p.vfovDeg === spec.vfovDeg &&
      p.resWidth === spec.resWidth &&
      p.resHeight === spec.resHeight,
  )
  return hit ? hit.label : CUSTOM_LABEL
}

/**
 * Cameras for a fresh-layout optimization run: `count` copies of the chosen
 * preset's optics (or 75° OV9281 defaults for Custom/unknown), evenly
 * yaw-fanned at a nominal center mount. Initial mounts barely matter — the
 * optimizer's cluster-fan and scatter seeds reposition everything — but the
 * fan start keeps round counts stable and reproducible.
 */
export function freshCameras(count: number, presetLabel: string): CameraSpec[] {
  const p = CAMERA_PRESETS.find((x) => x.label === presetLabel && x.label !== CUSTOM_LABEL)
  const optics = p ?? { label: CUSTOM_LABEL, hfovDeg: 75, vfovDeg: 47, resWidth: 1280, resHeight: 800 }
  const n = Math.max(1, Math.min(6, Math.round(count)))
  return Array.from({ length: n }, (_, k) => ({
    name: `cam-${k}`,
    hfovDeg: optics.hfovDeg,
    vfovDeg: optics.vfovDeg,
    resWidth: optics.resWidth,
    resHeight: optics.resHeight,
    maxRangeM: null,
    mount: { x: 0, y: 0, z: 0.3, rollDeg: 0, pitchDeg: 0, yawDeg: Math.round((k * 360) / n) },
  }))
}
