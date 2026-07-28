import { describe, it, expect } from 'vitest'
import { CAMERA_PRESETS, applyPreset, presetLabelFor } from '../../src/ui/presets'
import { SAMPLE_CAMERAS } from '../../src/core/defaults'

describe('CAMERA_PRESETS', () => {
  it('has the 6 required presets with exact specs', () => {
    const byLabel = Object.fromEntries(CAMERA_PRESETS.map((p) => [p.label, p]))
    expect(byLabel['OV9281 + 75° lens']).toMatchObject({ hfovDeg: 75, vfovDeg: 47, resWidth: 1280, resHeight: 800 })
    expect(byLabel['OV9281 + 100° lens']).toMatchObject({ hfovDeg: 100, vfovDeg: 70, resWidth: 1280, resHeight: 800 })
    expect(byLabel['Limelight 3']).toMatchObject({ hfovDeg: 63.3, vfovDeg: 49.7, resWidth: 1280, resHeight: 960 })
    expect(byLabel['Limelight 3G']).toMatchObject({ hfovDeg: 80, vfovDeg: 52, resWidth: 1280, resHeight: 800 })
    expect(byLabel['Limelight 4']).toMatchObject({ hfovDeg: 82, vfovDeg: 56, resWidth: 1280, resHeight: 800 })
    expect(byLabel['Custom']).toBeTruthy()
  })
  it('has exactly 6 presets', () => {
    expect(CAMERA_PRESETS).toHaveLength(6)
  })
})

describe('applyPreset', () => {
  const spec = SAMPLE_CAMERAS[0]

  it('fills FOV/res from a named preset, leaving other fields untouched', () => {
    const preset = CAMERA_PRESETS.find((p) => p.label === 'Limelight 4')!
    const result = applyPreset(spec, preset)
    expect(result.hfovDeg).toBe(82)
    expect(result.vfovDeg).toBe(56)
    expect(result.resWidth).toBe(1280)
    expect(result.resHeight).toBe(800)
    expect(result.name).toBe(spec.name)
    expect(result.mount).toEqual(spec.mount)
  })

  it('Custom preset leaves values untouched', () => {
    const preset = CAMERA_PRESETS.find((p) => p.label === 'Custom')!
    const result = applyPreset(spec, preset)
    expect(result).toEqual(spec)
  })
})

describe('presetLabelFor', () => {
  it('matches exact optics to their preset label', () => {
    const spec = { ...SAMPLE_CAMERAS[0], hfovDeg: 82, vfovDeg: 56, resWidth: 1280, resHeight: 800 }
    expect(presetLabelFor(spec)).toBe('Limelight 4')
  })
  it('falls back to Custom for unmatched optics', () => {
    expect(presetLabelFor({ ...SAMPLE_CAMERAS[0], hfovDeg: 83 })).toBe('Custom')
  })
})
