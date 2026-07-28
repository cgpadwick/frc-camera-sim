const DEFAULT_DURATION_MS = 5000

/**
 * Pure bookkeeping for the keyed-toast registry (extracted so it's
 * unit-testable without a DOM): looks up `key` in `registry`, removes it,
 * and returns whatever was there (`undefined` if nothing was registered for
 * that key). The caller owns the DOM side-effect (removing the returned
 * element, if any, and re-inserting the new one under the same key) — this
 * function only ever mutates the map, never touches an element.
 */
export function takeKeyed<T>(registry: Map<string, T>, key: string): T | undefined {
  const prev = registry.get(key)
  registry.delete(key)
  return prev
}

/** Elements currently shown for each toast `key` passed to `showToast`/`dismissToast`. Module-level: one registry for the whole page. */
const keyedToasts = new Map<string, HTMLElement>()

/**
 * Fire-and-forget transient error/status banner: appends a `div.toast` to
 * `document.body` and removes it after `durationMs`. DOM-only (browser),
 * reused by later tasks (13/15) for their own error surfaces — keep it
 * generic, not config-panel-specific.
 *
 * Passing `durationMs = Infinity` is the "persistent variant" (task 15's
 * field-model-unavailable banner): the toast never auto-dismisses and gains
 * a close button so it's still dismissible by the user.
 *
 * `key`, when given, dedupes: any previously-shown toast under the same key
 * (still on screen — e.g. a still-persistent one, or one whose auto-dismiss
 * timer hasn't fired yet) is removed before the new one is shown, so
 * repeated calls (e.g. `rebuildField` firing the same "model unavailable"
 * banner on every model-less field switch) never stack duplicates. Use
 * `dismissToast(key)` to clear a keyed toast without showing a new one
 * (e.g. once a later model load succeeds).
 */
export function showToast(
  message: string,
  durationMs = DEFAULT_DURATION_MS,
  key?: string,
  action?: { label: string; onClick(): void },
): void {
  if (key) takeKeyed(keyedToasts, key)?.remove()

  const el = document.createElement('div')
  el.className = 'toast'
  el.setAttribute('role', 'alert')
  const text = document.createElement('span')
  text.textContent = message
  el.appendChild(text)
  document.body.appendChild(el)
  if (key) keyedToasts.set(key, el)
  if (action) {
    const btn = document.createElement('button')
    btn.className = 'toast-action'
    btn.textContent = action.label
    btn.onclick = () => {
      action.onClick()
      el.remove()
      if (key && keyedToasts.get(key) === el) keyedToasts.delete(key)
    }
    el.appendChild(btn)
  }

  const cleanup = () => {
    el.remove()
    // Only clear the registry if `el` is still the current holder of `key`
    // — a newer showToast(..., key) call may have already replaced it.
    if (key && keyedToasts.get(key) === el) keyedToasts.delete(key)
  }

  if (Number.isFinite(durationMs)) {
    setTimeout(cleanup, durationMs)
    return
  }
  el.classList.add('toast-persistent')
  const closeBtn = document.createElement('button')
  closeBtn.className = 'toast-close'
  closeBtn.textContent = '×'
  closeBtn.setAttribute('aria-label', 'Dismiss')
  closeBtn.onclick = cleanup
  el.appendChild(closeBtn)
}

/** Removes the toast currently shown under `key`, if any. No-op if none is showing. */
export function dismissToast(key: string): void {
  takeKeyed(keyedToasts, key)?.remove()
}
