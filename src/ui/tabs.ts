export type AppMode = 'field' | 'robot'

export interface TabBar {
  el: HTMLElement
  current(): AppMode
  /** Sync the 👁 button when frustum visibility is toggled externally (F key). */
  setFrustumsVisible(visible: boolean): void
}

/** Field / Robot mode tabs (top-left). Robot mode also shows an "add camera" button. */
export function createTabBar(opts: {
  onChange(mode: AppMode): void
  onAddCamera(): void
  onAddBox(): void
  onToggleFrustums(visible: boolean): void
}): TabBar {
  const el = document.createElement('div')
  el.className = 'tab-bar'
  let mode: AppMode = 'field'

  const buttons = new Map<AppMode, HTMLButtonElement>()
  const addBtn = document.createElement('button')
  const addBoxBtn = document.createElement('button')
  const frustumBtn = document.createElement('button')
  let frustumsVisible = true

  function select(next: AppMode): void {
    if (next === mode) return
    mode = next
    for (const [m, b] of buttons) b.classList.toggle('active', m === mode)
    addBtn.style.display = mode === 'robot' ? '' : 'none'
    addBoxBtn.style.display = mode === 'robot' ? '' : 'none'
    frustumBtn.style.display = mode === 'robot' ? '' : 'none'
    opts.onChange(mode)
  }

  for (const m of ['field', 'robot'] as AppMode[]) {
    const b = document.createElement('button')
    b.textContent = m === 'field' ? 'Field' : 'Robot'
    b.classList.toggle('active', m === mode)
    b.addEventListener('click', () => select(m))
    buttons.set(m, b)
    el.appendChild(b)
  }

  addBtn.textContent = '➕ Add camera'
  addBtn.title = 'Then click a spot on the robot'
  addBtn.style.display = 'none'
  addBtn.addEventListener('click', opts.onAddCamera)
  el.appendChild(addBtn)

  addBoxBtn.textContent = '▦ Add box'
  addBoxBtn.title = 'Drops a box on the chassis — grab it to move/rotate/scale'
  addBoxBtn.style.display = 'none'
  addBoxBtn.addEventListener('click', opts.onAddBox)
  el.appendChild(addBoxBtn)

  frustumBtn.textContent = '👁 Frustums (F)'
  frustumBtn.title = 'Show/hide camera view cones (F key works everywhere)'
  frustumBtn.style.display = 'none'
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

  return { el, current: () => mode, setFrustumsVisible: applyFrustumsVisible }
}
