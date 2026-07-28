export type AppMode = 'field' | 'robot'

export interface WorkflowState {
  cameraCount: number
  hasSweep: boolean
  /** Optimizer running or a proposal open. */
  optimizeActive: boolean
}

/**
 * Pure step-inference rule (QA round 6 spec): robot view → 1; field view
 * with the optimizer running or a proposal open → 3; otherwise → 2.
 */
export function inferStep(mode: AppMode, state: WorkflowState): 1 | 2 | 3 {
  if (mode === 'robot') return 1
  return state.optimizeActive ? 3 : 2
}

export interface TabBar {
  el: HTMLElement
  current(): AppMode
  /** Sync the 👁 button when frustum visibility is toggled externally (F key). */
  setFrustumsVisible(visible: boolean): void
  /** Refresh step ✓s and the current-step highlight from app state. */
  setWorkflowState(state: WorkflowState): void
  /** Anchor element for a step (1-based) — coach marks target these. */
  stepButton(step: 1 | 2 | 3): HTMLElement
}

/**
 * Workflow stepper: 1 Build → 2 Analyze → 3 Optimize, replacing the old
 * Field/Robot tab pair so there is one navigation metaphor (QA round 6,
 * phase C). Build = robot editor view; Analyze and Optimize share the field
 * view — step 3 is a view state that spotlights the optimize controls, not
 * a separate page. Build-mode tool buttons (add camera/shape, view cones)
 * live in the same bar.
 */
export function createTabBar(opts: {
  onChange(mode: AppMode): void
  onAddCamera(): void
  onAddBox(): void
  onToggleFrustums(visible: boolean): void
  onFrustumOpacity(opacity: number): void
  /** Step 3 clicked: spotlight the optimize controls (field view already shown). */
  onOptimizeSpotlight(): void
}): TabBar {
  const el = document.createElement('div')
  el.className = 'tab-bar stepper'
  let mode: AppMode = 'field'
  let state: WorkflowState = { cameraCount: 0, hasSweep: false, optimizeActive: false }

  interface Step {
    n: 1 | 2 | 3
    btn: HTMLButtonElement
    check: HTMLSpanElement
  }

  const steps: Step[] = (
    [
      [1, 'Build', 'Build your robot and place cameras'],
      [2, 'Analyze', 'Drive the field and analyze coverage'],
      [3, 'Optimize', 'Let the solver search for better camera mounts'],
    ] as const
  ).map(([n, label, title]) => {
    const btn = document.createElement('button')
    btn.className = 'step-btn'
    btn.title = title
    const num = document.createElement('span')
    num.className = 'step-num'
    num.textContent = String(n)
    const text = document.createElement('span')
    text.textContent = label
    const check = document.createElement('span')
    check.className = 'step-check'
    check.textContent = '✓'
    check.style.display = 'none'
    btn.append(num, text, check)
    el.appendChild(btn)
    if (n < 3) {
      const arrow = document.createElement('span')
      arrow.className = 'step-arrow'
      arrow.textContent = '→'
      el.appendChild(arrow)
    }
    return { n, btn, check }
  })

  const currentStep = (): 1 | 2 | 3 => inferStep(mode, state)

  const addBtn = document.createElement('button')
  const addBoxBtn = document.createElement('button')

  function refresh(): void {
    const cur = currentStep()
    for (const s of steps) {
      s.btn.classList.toggle('active', s.n === cur)
      const done = s.n === 1 ? state.cameraCount > 0 : s.n === 2 ? state.hasSweep : false
      s.check.style.display = done ? '' : 'none'
      s.btn.setAttribute('aria-current', s.n === cur ? 'step' : 'false')
    }
    const buildTools = mode === 'robot' ? '' : 'none'
    addBtn.style.display = buildTools
    addBoxBtn.style.display = buildTools
  }

  function setMode(next: AppMode): void {
    if (next === mode) return
    mode = next
    opts.onChange(mode)
    refresh()
  }

  steps[0].btn.addEventListener('click', () => setMode('robot'))
  steps[1].btn.addEventListener('click', () => setMode('field'))
  steps[2].btn.addEventListener('click', () => {
    setMode('field')
    opts.onOptimizeSpotlight()
    refresh()
  })

  addBtn.textContent = '➕ Add camera'
  addBtn.title = 'Then click a spot on the robot'
  addBtn.style.display = 'none'
  addBtn.addEventListener('click', opts.onAddCamera)
  el.appendChild(addBtn)

  addBoxBtn.textContent = '▦ Add body shape'
  addBoxBtn.title = 'Drops a box on the chassis — grab it to move/rotate/scale. Shapes block camera views like your real robot would.'
  addBoxBtn.style.display = 'none'
  addBoxBtn.addEventListener('click', opts.onAddBox)
  el.appendChild(addBoxBtn)

  const frustumBtn = document.createElement('button')
  let frustumsVisible = true
  frustumBtn.textContent = '👁 View cones (F)'
  frustumBtn.title = 'Show/hide the camera view cones (a.k.a. frustums). F key works everywhere.'
  frustumBtn.classList.add('active')
  const applyFrustumsVisible = (visible: boolean): void => {
    frustumsVisible = visible
    frustumBtn.classList.toggle('active', visible)
  }
  frustumBtn.addEventListener('click', () => {
    applyFrustumsVisible(!frustumsVisible)
    opts.onToggleFrustums(frustumsVisible)
  })
  el.appendChild(frustumBtn)

  const opacityWrap = document.createElement('label')
  opacityWrap.className = 'tab-bar-slider'
  opacityWrap.title = 'How solid the camera view cones look (0 = outline only)'
  const opacitySlider = document.createElement('input')
  opacitySlider.type = 'range'
  opacitySlider.min = '0'
  opacitySlider.max = '60'
  opacitySlider.value = '15'
  opacitySlider.setAttribute('aria-label', 'Cone opacity')
  opacitySlider.title = 'How solid the camera view cones look (0 = outline only)'
  opacitySlider.setAttribute('aria-valuetext', '15% solid')
  opacitySlider.addEventListener('input', () => {
    opacitySlider.setAttribute('aria-valuetext', `${opacitySlider.value}% solid`)
    opts.onFrustumOpacity(Number(opacitySlider.value) / 100)
  })
  opacityWrap.append(document.createTextNode('Cone opacity'), opacitySlider)
  el.appendChild(opacityWrap)

  refresh()

  return {
    el,
    current: () => mode,
    setFrustumsVisible: applyFrustumsVisible,
    setWorkflowState(next) {
      state = next
      refresh()
    },
    stepButton: (step) => steps[step - 1].btn,
  }
}
