import { viewModeList } from '../viz/viewModes'
import type { ViewManager } from '../viz/viewModes'

export interface ViewSelect {
  el: HTMLElement
  /** Rebuild the option list after cameras are added/removed/renamed. */
  refresh(cameraNames: string[]): void
}

export interface ViewSelectOptions {
  /** Reset the orbit camera framing and the robot's pose to defaults. */
  onResetView(): void
}

/** Small view-mode dropdown (top center). Cycles are also bound to the V key in main.ts. */
export function createViewSelect(manager: ViewManager, opts: ViewSelectOptions): ViewSelect {
  const wrap = document.createElement('div')
  wrap.className = 'view-select'
  const label = document.createElement('span')
  label.textContent = 'View (V)'
  const select = document.createElement('select')
  const resetBtn = document.createElement('button')
  resetBtn.textContent = '⟲ Reset'
  resetBtn.title = 'Re-center the view and put the robot back at mid-field'
  resetBtn.addEventListener('click', () => opts.onResetView())
  wrap.append(label, select, resetBtn)

  let names: string[] = []
  function rebuildOptions(): void {
    select.replaceChildren(
      ...viewModeList(names).map((m) => {
        const opt = document.createElement('option')
        opt.value = m.id
        opt.textContent = m.label
        return opt
      }),
    )
    select.value = manager.current()
  }

  select.addEventListener('change', () => manager.setMode(select.value))
  manager.onChange((id) => {
    select.value = id
  })

  return {
    el: wrap,
    refresh(cameraNames) {
      const changed =
        cameraNames.length !== names.length || cameraNames.some((n, i) => n !== names[i])
      if (!changed) return
      names = [...cameraNames]
      rebuildOptions()
    },
  }
}
