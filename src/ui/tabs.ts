export type AppMode = 'field' | 'robot'

export interface TabBar {
  el: HTMLElement
  current(): AppMode
}

/** Field / Robot mode tabs (top-left). Robot mode also shows an "add camera" button. */
export function createTabBar(opts: {
  onChange(mode: AppMode): void
  onAddCamera(): void
}): TabBar {
  const el = document.createElement('div')
  el.className = 'tab-bar'
  let mode: AppMode = 'field'

  const buttons = new Map<AppMode, HTMLButtonElement>()
  const addBtn = document.createElement('button')

  function select(next: AppMode): void {
    if (next === mode) return
    mode = next
    for (const [m, b] of buttons) b.classList.toggle('active', m === mode)
    addBtn.style.display = mode === 'robot' ? '' : 'none'
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

  return { el, current: () => mode }
}
