// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { createConfigPanel } from '../../src/ui/configPanel'
import { DEFAULT_CONFIG, SAMPLE_CAMERAS } from '../../src/core/defaults'
import type { SimConfig } from '../../src/core/types'

function build() {
  const config: SimConfig = { ...structuredClone(DEFAULT_CONFIG), robot: { ...structuredClone(DEFAULT_CONFIG.robot), cameras: structuredClone(SAMPLE_CAMERAS) } }
  const onChange = vi.fn()
  const panel = createConfigPanel({ config, onChange, onFieldChange: vi.fn(), onCameraPick: vi.fn() })
  document.body.appendChild(panel.el)
  panel.setMode('robot')
  return { panel, onChange }
}

describe('camera preset dropdown (Build tab)', () => {
  it('selecting a preset applies its FOV/resolution and emits a change', () => {
    const { panel, onChange } = build()
    const select = panel.el.querySelector('[data-cam-index="0"] select') as HTMLSelectElement
    expect(select).toBeTruthy()
    select.value = 'Limelight 4'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    expect(onChange).toHaveBeenCalled()
    const emitted = onChange.mock.calls.at(-1)![0] as SimConfig
    expect(emitted.robot.cameras[0].hfovDeg).toBe(82)
    expect(emitted.robot.cameras[0].vfovDeg).toBe(56)
    expect(emitted.robot.cameras[0].resHeight).toBe(800)
    // mount untouched
    expect(emitted.robot.cameras[0].mount).toEqual(SAMPLE_CAMERAS[0].mount)
  })
})

describe('preset dropdown reflects the camera (perceived no-op fix)', () => {
  it('after applying a preset, the re-rendered dropdown shows that preset, and the summary updates', () => {
    const { panel } = build()
    let select = panel.el.querySelector('[data-cam-index="0"] select') as HTMLSelectElement
    select.value = 'Limelight 4'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    // Panel re-rendered: the select must now REFLECT the applied preset...
    select = panel.el.querySelector('[data-cam-index="0"] select') as HTMLSelectElement
    expect(select.value).toBe('Limelight 4')
    // ...and the plain-English summary must show the new lens.
    const summary = panel.el.querySelector('[data-cam-index="0"] .camera-card-summary') as HTMLElement
    expect(summary.textContent).toContain('82° lens')
  })
  it('a camera whose optics match no preset shows Custom', () => {
    const { panel, onChange } = build()
    void onChange
    const select = panel.el.querySelector('[data-cam-index="1"] select') as HTMLSelectElement
    // SAMPLE_CAMERAS[1] is 75/47/1280x800 = the OV9281 + 75° preset values
    expect(select.value).toBe('OV9281 + 75° lens')
  })
})
