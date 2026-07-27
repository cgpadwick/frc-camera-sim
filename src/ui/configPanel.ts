import type { SimConfig } from '../core/types'
import { CAMERA_PRESETS, applyPreset } from './presets'
import { exportConfig, importConfig } from './configStore'
import { showToast } from './toast'

export interface ConfigPanelOptions {
  config: SimConfig
  onChange(c: SimConfig): void
  onFieldChange(year: string): void
}

const FIELD_YEARS = ['2026-rebuilt-welded', '2025-reefscape-welded']

function heading(text: string): HTMLHeadingElement {
  const h = document.createElement('h3')
  h.textContent = text
  return h
}

function labelOnly(text: string): HTMLDivElement {
  const d = document.createElement('div')
  d.textContent = text
  return d
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = text
  b.addEventListener('click', onClick)
  return b
}

function numberField(labelText: string, value: number, step: number, onInput: (v: number) => void): HTMLLabelElement {
  const row = document.createElement('label')
  row.className = 'field-row'
  const span = document.createElement('span')
  span.textContent = labelText
  const input = document.createElement('input')
  input.type = 'number'
  input.step = String(step)
  input.value = String(value)
  input.addEventListener('input', () => {
    const v = Number(input.value)
    if (Number.isFinite(v)) onInput(v)
  })
  row.append(span, input)
  return row
}

function textField(labelText: string, value: string, onInput: (v: string) => void): HTMLLabelElement {
  const row = document.createElement('label')
  row.className = 'field-row'
  const span = document.createElement('span')
  span.textContent = labelText
  const input = document.createElement('input')
  input.type = 'text'
  input.value = value
  input.addEventListener('input', () => onInput(input.value))
  row.append(span, input)
  return row
}

/**
 * Plain-DOM right-side config panel: no framework, no virtual DOM. `working`
 * is a private mutable copy of the config; every input mutates it directly
 * and then either calls `emitChange()` (scalar edits, no re-render — keeps
 * focus/cursor stable while typing) or `renderPanel()` (structural edits:
 * add/remove list item, preset pick, import — where losing focus is fine
 * because the user just clicked a button).
 */
export function createConfigPanel(opts: ConfigPanelOptions): HTMLElement {
  const working: SimConfig = structuredClone(opts.config)
  const root = document.createElement('div')
  root.className = 'config-panel'

  function emitChange(): void {
    opts.onChange(structuredClone(working))
  }

  let camWarningEl: HTMLDivElement | null = null
  function updateCamWarning(): void {
    if (!camWarningEl) return
    const warnings: string[] = []
    if (working.robot.cameras.length === 0) warnings.push('No cameras configured — robot is blind.')
    working.robot.cameras.forEach((cam, i) => {
      if (cam.hfovDeg <= 0 || cam.vfovDeg <= 0) warnings.push(`Camera ${i} ("${cam.name}") has a non-positive FOV.`)
    })
    camWarningEl.textContent = warnings.join(' ')
  }

  function renderPanel(): void {
    root.replaceChildren()

    // --- Field year ---
    root.appendChild(heading('Field'))
    const fieldSelect = document.createElement('select')
    for (const year of FIELD_YEARS) {
      const o = document.createElement('option')
      o.value = year
      o.textContent = year
      fieldSelect.appendChild(o)
    }
    fieldSelect.value = working.fieldYear
    fieldSelect.addEventListener('change', () => {
      working.fieldYear = fieldSelect.value
      opts.onFieldChange(fieldSelect.value)
    })
    root.appendChild(fieldSelect)

    // --- Robot ---
    root.appendChild(heading('Robot'))
    root.appendChild(
      numberField('Length (m)', working.robot.lengthM, 0.01, (v) => {
        working.robot.lengthM = v
        emitChange()
      }),
    )
    root.appendChild(
      numberField('Width (m)', working.robot.widthM, 0.01, (v) => {
        working.robot.widthM = v
        emitChange()
      }),
    )
    root.appendChild(
      numberField('Chassis height (m)', working.robot.chassisHeightM, 0.01, (v) => {
        working.robot.chassisHeightM = v
        emitChange()
      }),
    )
    root.appendChild(
      textField('Team #', working.robot.teamNumber, (v) => {
        working.robot.teamNumber = v
        emitChange()
      }),
    )

    // --- Superstructure boxes ---
    root.appendChild(heading('Superstructure boxes'))
    working.robot.superstructure.forEach((box, i) => {
      const item = document.createElement('div')
      item.className = 'list-item'
      item.appendChild(labelOnly(`Box ${i}`))
      item.appendChild(
        numberField('center.x', box.center.x, 0.01, (v) => {
          box.center.x = v
          emitChange()
        }),
      )
      item.appendChild(
        numberField('center.y', box.center.y, 0.01, (v) => {
          box.center.y = v
          emitChange()
        }),
      )
      item.appendChild(
        numberField('center.z', box.center.z, 0.01, (v) => {
          box.center.z = v
          emitChange()
        }),
      )
      item.appendChild(
        numberField('size.x', box.size.x, 0.01, (v) => {
          box.size.x = v
          emitChange()
        }),
      )
      item.appendChild(
        numberField('size.y', box.size.y, 0.01, (v) => {
          box.size.y = v
          emitChange()
        }),
      )
      item.appendChild(
        numberField('size.z', box.size.z, 0.01, (v) => {
          box.size.z = v
          emitChange()
        }),
      )
      item.appendChild(
        numberField('yawDeg', box.yawDeg, 1, (v) => {
          box.yawDeg = v
          emitChange()
        }),
      )
      item.appendChild(
        button('Remove', () => {
          working.robot.superstructure.splice(i, 1)
          renderPanel()
          emitChange()
        }),
      )
      root.appendChild(item)
    })
    root.appendChild(
      button('+ Add box', () => {
        working.robot.superstructure.push({ center: { x: 0, y: 0, z: 0.5 }, size: { x: 0.2, y: 0.2, z: 0.2 }, yawDeg: 0 })
        renderPanel()
        emitChange()
      }),
    )

    // --- Cameras ---
    root.appendChild(heading('Cameras'))
    camWarningEl = document.createElement('div')
    camWarningEl.className = 'warning'
    root.appendChild(camWarningEl)

    working.robot.cameras.forEach((cam, i) => {
      const item = document.createElement('div')
      item.className = 'list-item'
      item.appendChild(labelOnly(`Camera ${i}`))
      item.appendChild(
        textField('name', cam.name, (v) => {
          cam.name = v
          emitChange()
        }),
      )

      const presetRow = document.createElement('label')
      presetRow.className = 'field-row'
      const presetSpan = document.createElement('span')
      presetSpan.textContent = 'preset'
      const presetSelect = document.createElement('select')
      for (const preset of CAMERA_PRESETS) {
        const o = document.createElement('option')
        o.value = preset.label
        o.textContent = preset.label
        presetSelect.appendChild(o)
      }
      presetSelect.value = 'Custom'
      presetSelect.addEventListener('change', () => {
        const preset = CAMERA_PRESETS.find((p) => p.label === presetSelect.value)!
        Object.assign(cam, applyPreset(cam, preset))
        renderPanel()
        emitChange()
      })
      presetRow.append(presetSpan, presetSelect)
      item.appendChild(presetRow)

      item.appendChild(
        numberField('hfovDeg', cam.hfovDeg, 0.1, (v) => {
          cam.hfovDeg = v
          updateCamWarning()
          emitChange()
        }),
      )
      item.appendChild(
        numberField('vfovDeg', cam.vfovDeg, 0.1, (v) => {
          cam.vfovDeg = v
          updateCamWarning()
          emitChange()
        }),
      )
      item.appendChild(
        numberField('resWidth', cam.resWidth, 1, (v) => {
          cam.resWidth = v
          emitChange()
        }),
      )
      item.appendChild(
        numberField('resHeight', cam.resHeight, 1, (v) => {
          cam.resHeight = v
          emitChange()
        }),
      )
      item.appendChild(
        numberField('maxRangeM (0 = auto)', cam.maxRangeM ?? 0, 0.1, (v) => {
          cam.maxRangeM = v > 0 ? v : null
          emitChange()
        }),
      )
      item.appendChild(
        numberField('mount.x', cam.mount.x, 0.01, (v) => {
          cam.mount.x = v
          emitChange()
        }),
      )
      item.appendChild(
        numberField('mount.y', cam.mount.y, 0.01, (v) => {
          cam.mount.y = v
          emitChange()
        }),
      )
      item.appendChild(
        numberField('mount.z', cam.mount.z, 0.01, (v) => {
          cam.mount.z = v
          emitChange()
        }),
      )
      item.appendChild(
        numberField('rollDeg', cam.mount.rollDeg, 1, (v) => {
          cam.mount.rollDeg = v
          emitChange()
        }),
      )
      item.appendChild(
        numberField('pitchDeg', cam.mount.pitchDeg, 1, (v) => {
          cam.mount.pitchDeg = v
          emitChange()
        }),
      )
      item.appendChild(
        numberField('yawDeg', cam.mount.yawDeg, 1, (v) => {
          cam.mount.yawDeg = v
          emitChange()
        }),
      )
      item.appendChild(
        button('Remove', () => {
          working.robot.cameras.splice(i, 1)
          renderPanel()
          emitChange()
        }),
      )
      root.appendChild(item)
    })
    root.appendChild(
      button('+ Add camera', () => {
        working.robot.cameras.push({
          name: `camera-${working.robot.cameras.length}`,
          hfovDeg: 75,
          vfovDeg: 47,
          resWidth: 1280,
          resHeight: 800,
          maxRangeM: null,
          mount: { x: 0, y: 0, z: 0.25, rollDeg: 0, pitchDeg: 0, yawDeg: 0 },
        })
        renderPanel()
        emitChange()
      }),
    )
    updateCamWarning()

    // --- Import / Export ---
    root.appendChild(heading('Import / Export'))
    root.appendChild(button('Export', () => exportConfig(working)))

    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = 'application/json'
    fileInput.style.display = 'none'
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0]
      fileInput.value = ''
      if (!file) return
      importConfig(file)
        .then((imported) => {
          Object.assign(working, structuredClone(imported))
          renderPanel()
          emitChange()
          opts.onFieldChange(working.fieldYear)
        })
        .catch((e: unknown) => {
          showToast(`Import failed: ${e instanceof Error ? e.message : String(e)}`)
        })
    })
    root.appendChild(button('Import', () => fileInput.click()))
    root.appendChild(fileInput)
  }

  renderPanel()
  return root
}
