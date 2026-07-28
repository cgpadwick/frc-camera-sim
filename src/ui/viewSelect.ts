import { viewModeList } from '../viz/viewModes'
import type { ViewManager } from '../viz/viewModes'

export interface ViewSelect {
  el: HTMLElement
  /** Rebuild the option list after cameras are added/removed/renamed. */
  refresh(cameraNames: string[]): void
}

/** Small view-mode dropdown (top center). Cycles are also bound to the V key in main.ts. */
export function createViewSelect(manager: ViewManager): ViewSelect {
  const wrap = document.createElement('div')
  wrap.className = 'view-select'
  const label = document.createElement('span')
  label.textContent = 'View (V)'
  const select = document.createElement('select')
  wrap.append(label, select)

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
