import type { SimConfig } from '../core/types'
import { CAMERA_PRESETS, applyPreset, presetLabelFor } from './presets'
import { exportConfig, importConfig, KNOWN_FIELD_YEARS } from './configStore'
import { showToast } from './toast'
import { CAMERA_COLORS } from '../viz/frustumView'
import { cameraSummary } from './cameraSummary'

export interface ConfigPanelOptions {
  config: SimConfig
  onChange(c: SimConfig): void
  onFieldChange(year: string): void
}



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

/**
 * Returns `v` unchanged if it's strictly positive, otherwise null. Pure (no DOM) so
 * it's unit-testable on its own — extracted out of positiveNumberField's input
 * handler, which is itself only exercisable in a browser/DOM environment.
 */
export function clampPositive(v: number): number | null {
  return v > 0 ? v : null
}

/**
 * Like `numberField`, but for fields configStore.ts's parseConfig requires to be
 * strictly positive (lengthM/widthM/chassisHeightM, resWidth/resHeight, superstructure
 * box sizes). A non-positive entry is NOT written into `working`/emitted — writing it
 * would produce a config that parseConfig itself rejects on the next load, silently
 * wiping the user's whole config (see loadConfig's corrupt-config path). Instead it
 * shows an inline warning, following the same warning-div pattern as the camera FOV
 * warning above, and leaves the last-valid value in the config untouched.
 */
function positiveNumberField(labelText: string, value: number, step: number, onInput: (v: number) => void): HTMLElement {
  const wrap = document.createElement('div')
  const warn = document.createElement('div')
  warn.className = 'warning'
  warn.style.display = 'none'
  wrap.appendChild(
    numberField(labelText, value, step, (v) => {
      const clamped = clampPositive(v)
      if (clamped !== null) {
        warn.style.display = 'none'
        onInput(clamped)
      } else {
        warn.textContent = `"${labelText}" must be positive — ignoring "${v}".`
        warn.style.display = ''
      }
    }),
  )
  wrap.appendChild(warn)
  return wrap
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
export interface ConfigPanelOptionsExtra {
  /** Card expanded by user click — main.ts mirrors the selection into the 3D editor. */
  onCameraPick?(index: number): void
}

export interface ConfigPanel {
  el: HTMLElement
  /** Show field-only sections (Field tab) or robot sections (Robot tab). */
  setMode(mode: 'field' | 'robot'): void
  /** Replace the working copy with `config` (authoritative, from main.ts) and re-render — e.g. after the robot editor moves a camera. */
  refresh(config: SimConfig): void
  /** Scroll the camera's section into view and mark it selected (null clears). */
  highlightCamera(index: number | null): void
}

/** Range slider + number input pair sharing one value; slider drags update live. */
function sliderField(
  labelText: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onInput: (v: number) => void,
): HTMLLabelElement {
  const row = document.createElement('label')
  row.className = 'field-row slider-row'
  const span = document.createElement('span')
  span.textContent = labelText
  const slider = document.createElement('input')
  slider.type = 'range'
  slider.min = String(min)
  slider.max = String(max)
  slider.step = String(step)
  slider.value = String(value)
  slider.setAttribute('aria-label', labelText)
  const num = document.createElement('input')
  num.type = 'number'
  num.step = String(step)
  num.value = String(value)
  num.className = 'slider-number'
  slider.addEventListener('input', () => {
    num.value = slider.value
    onInput(Number(slider.value))
  })
  num.addEventListener('input', () => {
    const v = Number(num.value)
    if (!Number.isFinite(v)) return
    slider.value = String(v)
    onInput(v)
  })
  row.append(span, slider, num)
  return row
}

export function createConfigPanel(opts: ConfigPanelOptions & ConfigPanelOptionsExtra): ConfigPanel {
  let working: SimConfig = structuredClone(opts.config)
  const root = document.createElement('div')
  root.className = 'config-panel'

  // Collapse toggle: the panel covers the right third of the viewport, which
  // gets in the way in camera-POV views. The tab stays visible when collapsed.
  const toggle = document.createElement('button')
  toggle.className = 'config-panel-toggle'
  toggle.textContent = 'Hide panel ›'
  toggle.addEventListener('click', () => {
    const collapsed = root.classList.toggle('collapsed')
    toggle.textContent = collapsed ? '‹ Show panel' : 'Hide panel ›'
  })
  // Sticky header keeps the toggle above the scrolling content instead of
  // floating over (and obscuring) input fields.
  const header = document.createElement('div')
  header.className = 'config-panel-header'
  header.appendChild(toggle)
  root.appendChild(header)

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

  // Which tab the app is on decides the visible sections: field selection
  // belongs to the Field view; robot dims/boxes/cameras belong to the Robot
  // editor. Import/Export shows in both.
  let panelMode: 'field' | 'robot' = 'field'
  // Camera-card expansion survives re-renders; collapsed by default.
  const expandedCams = new Set<number>()

  function renderPanel(): void {
    // Keep the collapse header: replaceChildren() rebuilds the whole panel,
    // and the header lives inside root so the .collapsed CSS can scope it.
    root.replaceChildren(header)

    if (panelMode === 'field') {
    // --- Field year ---
    root.appendChild(heading('Field'))
    const fieldSelect = document.createElement('select')
    for (const year of KNOWN_FIELD_YEARS) {
      const o = document.createElement('option')
      o.value = year
      // Only the 2026 field ships a 3D model; be upfront in the label so the
      // fallback toast isn't the first hint.
      o.textContent = year === '2025-reefscape-welded' ? `${year} (simplified 3D)` : year
      fieldSelect.appendChild(o)
    }
    fieldSelect.value = working.fieldYear
    fieldSelect.addEventListener('change', () => {
      working.fieldYear = fieldSelect.value
      opts.onFieldChange(fieldSelect.value)
    })
    root.appendChild(fieldSelect)
    }

    if (panelMode === 'robot') {
    // --- Robot ---
    root.appendChild(heading('Robot'))
    root.appendChild(
      positiveNumberField('Length (m)', working.robot.lengthM, 0.01, (v) => {
        working.robot.lengthM = v
        emitChange()
      }),
    )
    root.appendChild(
      positiveNumberField('Width (m)', working.robot.widthM, 0.01, (v) => {
        working.robot.widthM = v
        emitChange()
      }),
    )
    root.appendChild(
      positiveNumberField('Chassis height (m)', working.robot.chassisHeightM, 0.01, (v) => {
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
    root.appendChild(heading('Robot body shapes'))
    working.robot.superstructure.forEach((box, i) => {
      const item = document.createElement('div')
      item.className = 'list-item'
      item.appendChild(labelOnly(`Box ${i}`))
      item.appendChild(
        numberField('Center X (m)', box.center.x, 0.01, (v) => {
          box.center.x = v
          emitChange()
        }),
      )
      item.appendChild(
        numberField('Center Y (m)', box.center.y, 0.01, (v) => {
          box.center.y = v
          emitChange()
        }),
      )
      item.appendChild(
        numberField('Center Z (m)', box.center.z, 0.01, (v) => {
          box.center.z = v
          emitChange()
        }),
      )
      item.appendChild(
        positiveNumberField('Size X (m)', box.size.x, 0.01, (v) => {
          box.size.x = v
          emitChange()
        }),
      )
      item.appendChild(
        positiveNumberField('Size Y (m)', box.size.y, 0.01, (v) => {
          box.size.y = v
          emitChange()
        }),
      )
      item.appendChild(
        positiveNumberField('Size Z (m)', box.size.z, 0.01, (v) => {
          box.size.z = v
          emitChange()
        }),
      )
      item.appendChild(
        numberField('Yaw (°)', box.yawDeg, 1, (v) => {
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
      button('+ Add body shape', () => {
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
      item.className = 'list-item camera-card'
      item.dataset.camIndex = String(i)

      const cardHeader = document.createElement('div')
      cardHeader.className = 'camera-card-header'
      const camDot = document.createElement('span')
      camDot.className = 'camera-dot'
      camDot.style.background = `#${CAMERA_COLORS[i % CAMERA_COLORS.length].toString(16).padStart(6, '0')}`
      const nameEl = document.createElement('span')
      nameEl.className = 'camera-card-name'
      nameEl.textContent = cam.name
      const chevron = document.createElement('button')
      chevron.className = 'camera-card-chevron'
      chevron.textContent = expandedCams.has(i) ? '▾' : '▸'
      chevron.setAttribute('aria-label', expandedCams.has(i) ? `Collapse ${cam.name}` : `Expand ${cam.name}`)
      cardHeader.append(camDot, nameEl, chevron)
      cardHeader.addEventListener('click', () => {
        if (expandedCams.has(i)) expandedCams.delete(i)
        else {
          expandedCams.add(i)
          opts.onCameraPick?.(i)
        }
        renderPanel()
      })
      item.appendChild(cardHeader)

      const summaryEl = document.createElement('div')
      summaryEl.className = 'camera-card-summary'
      summaryEl.textContent = cameraSummary(cam)
      item.appendChild(summaryEl)
      const refreshSummary = (): void => {
        summaryEl.textContent = cameraSummary(cam)
      }

      const presetRow = document.createElement('label')
      presetRow.className = 'field-row'
      const presetSpan = document.createElement('span')
      presetSpan.textContent = 'Preset'
      const presetSelect = document.createElement('select')
      for (const preset of CAMERA_PRESETS) {
        const o = document.createElement('option')
        o.value = preset.label
        o.textContent = preset.label
        presetSelect.appendChild(o)
      }
      presetSelect.value = presetLabelFor(cam)
      presetSelect.addEventListener('change', () => {
        const preset = CAMERA_PRESETS.find((p) => p.label === presetSelect.value)!
        Object.assign(cam, applyPreset(cam, preset))
        renderPanel()
        emitChange()
      })
      presetRow.append(presetSpan, presetSelect)
      item.appendChild(presetRow)

      if (expandedCams.has(i)) {
        const body = document.createElement('div')
        body.className = 'camera-card-body'
        body.appendChild(
          textField('Name', cam.name, (v) => {
            cam.name = v
            nameEl.textContent = v
            emitChange()
          }),
        )
        body.appendChild(
          numberField('H FOV (°)', cam.hfovDeg, 0.1, (v) => {
            cam.hfovDeg = v
            updateCamWarning()
            refreshSummary()
            emitChange()
          }),
        )
        body.appendChild(
          numberField('V FOV (°)', cam.vfovDeg, 0.1, (v) => {
            cam.vfovDeg = v
            updateCamWarning()
            emitChange()
          }),
        )
        body.appendChild(
          positiveNumberField('Resolution W (px)', cam.resWidth, 1, (v) => {
            cam.resWidth = v
            emitChange()
          }),
        )
        body.appendChild(
          positiveNumberField('Resolution H (px)', cam.resHeight, 1, (v) => {
            cam.resHeight = v
            emitChange()
          }),
        )
        body.appendChild(
          numberField('Max range (m, 0 = auto)', cam.maxRangeM ?? 0, 0.1, (v) => {
            cam.maxRangeM = v > 0 ? v : null
            emitChange()
          }),
        )
        body.appendChild(
          numberField('Mount X (m)', cam.mount.x, 0.01, (v) => {
            cam.mount.x = v
            emitChange()
          }),
        )
        body.appendChild(
          numberField('Mount Y (m)', cam.mount.y, 0.01, (v) => {
            cam.mount.y = v
            emitChange()
          }),
        )
        body.appendChild(
          numberField('Mount Z (m)', cam.mount.z, 0.01, (v) => {
            cam.mount.z = v
            refreshSummary()
            emitChange()
          }),
        )
        body.appendChild(
          numberField('Roll (°)', cam.mount.rollDeg, 1, (v) => {
            cam.mount.rollDeg = v
            emitChange()
          }),
        )
        body.appendChild(
          sliderField('Pitch (°, +down/−up)', cam.mount.pitchDeg, -60, 60, 1, (v) => {
            cam.mount.pitchDeg = v
            refreshSummary()
            emitChange()
          }),
        )
        body.appendChild(
          sliderField('Yaw (°)', cam.mount.yawDeg, -180, 180, 1, (v) => {
            cam.mount.yawDeg = v
            refreshSummary()
            emitChange()
          }),
        )
        item.appendChild(body)
      }

      item.appendChild(
        button('Remove', () => {
          working.robot.cameras.splice(i, 1)
          expandedCams.delete(i)
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
    }

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
          showToast(`Import failed: ${e instanceof Error ? e.message : String(e)}`, undefined, undefined, undefined, 'error')
        })
    })
    root.appendChild(button('Import', () => fileInput.click()))
    root.appendChild(fileInput)
  }

  renderPanel()
  return {
    el: root,
    setMode(mode) {
      if (mode === panelMode) return
      panelMode = mode
      renderPanel()
    },
    refresh(config) {
      working = structuredClone(config)
      renderPanel()
    },
    highlightCamera(index) {
      for (const el of root.querySelectorAll('.list-item.selected')) el.classList.remove('selected')
      if (index === null) return
      // 3D selection expands the card too (spec: expand & scroll + highlight).
      if (!expandedCams.has(index)) {
        expandedCams.add(index)
        renderPanel()
      }
      const item = root.querySelector(`[data-cam-index="${index}"]`)
      if (!item) return
      item.classList.add('selected')
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    },
  }
}
